"""FastAPI routes for the Bid Agent on the BidManager server.

Mount from ``api_server.py`` (see bid_agent_server/INTEGRATION.md)::

    import bid_agent.server_routes as bid_agent_routes
    bid_client_router, bid_admin_router = bid_agent_routes.create_routers(require_admin_key)
    app.include_router(bid_client_router)
    app.include_router(bid_admin_router)

Client routes follow client_api conventions: ``x-client-key`` auth, tender
access scoped by the account's sections, 404 for tenders outside them. Work is
owned by the account's organisation (``org:<id>``) or, for individual accounts,
by the user (``user:<id>``), so everyone in an organisation shares one company
profile and one bid pack per tender.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from . import agent, chat, company, providers
from .docreader import load_document
from .llm import DEFAULT_MODEL, LLM
from .roles import ROLES
from .store import Store, org_key_for
from .workspace import Workspace

PROVIDER_SETTING = "bid_agent_provider"      # anthropic (default) | gemini | openai
API_KEY_SETTING = "bid_agent_api_key"
MODEL_SETTING = "bid_agent_model"            # reads documents (criteria, forms, scanned pages)
CHAT_MODEL_SETTING = "bid_agent_chat_model"  # answers in the chat
DEFAULT_CHAT_MODEL = "claude-sonnet-5-5"
STALE_RUN_SEC = 45 * 60


def _key_setting(provider: str) -> str:
    """Claude keeps the original setting names; the others get their own."""
    return API_KEY_SETTING if provider == "anthropic" else f"bid_agent_{provider}_api_key"


def _model_setting(provider: str) -> str:
    return MODEL_SETTING if provider == "anthropic" else f"bid_agent_{provider}_model"


def _chat_model_setting(provider: str) -> str:
    return CHAT_MODEL_SETTING if provider == "anthropic" else f"bid_agent_{provider}_chat_model"


def _hint(key: str) -> str:
    return (key[:7] + "…" + key[-4:]) if len(key) > 12 else ""

_runs: dict[tuple[str, int], threading.Thread] = {}
_runs_lock = threading.Lock()


class SegmentIn(BaseModel):
    role: str
    start_page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    title: str = ""


class DocumentRolesIn(BaseModel):
    file: str
    segments: list[SegmentIn] = Field(min_length=1, max_length=50)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class InstructionsIn(BaseModel):
    text: str = Field(default="", max_length=8000)


class LearningIn(BaseModel):
    text: Optional[str] = Field(default=None, max_length=600)
    active: Optional[bool] = None


class ConfigIn(BaseModel):
    provider: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    chat_model: Optional[str] = None


class ModelsIn(BaseModel):
    provider: str = "anthropic"
    api_key: Optional[str] = Field(default=None, max_length=500)


def create_routers(require_admin: Callable[..., Any]) -> tuple[APIRouter, APIRouter]:
    # Imported here so this package can be unit-tested without the server.
    import app_core as core
    import client_api
    import org_access

    client = APIRouter(prefix="/client", tags=["client", "bid-agent"])
    admin = APIRouter(prefix="/admin/bid-agent", tags=["admin", "bid-agent"], dependencies=[Depends(require_admin)])

    def connect():
        conn = core.sqlite3.connect(core.DB_FILE)
        conn.row_factory = core.sqlite3.Row
        return conn

    store = Store(connect)
    try:
        store.init_schema()
    except Exception as e:  # never block server start-up
        print(f"[bid-agent] schema init failed: {e}")

    def setting(key: str, default: str = "") -> str:
        try:
            return str(core.ScraperBackend.get_setting(key, default) or default)
        except Exception:
            return default

    def provider() -> str:
        p = setting(PROVIDER_SETTING).strip().lower()
        return p if p in providers.PROVIDERS else "anthropic"

    def provider_key(p: str) -> tuple[str, str]:
        """(key, source) for a provider: the console setting, else the container env."""
        key = setting(_key_setting(p)).strip()
        if key:
            return key, "settings"
        for env in providers.ENV_KEYS[p]:
            if os.getenv(env, "").strip():
                return os.getenv(env, "").strip(), "env"
        return "", ""

    def doc_model(p: str) -> str:
        m = setting(_model_setting(p)).strip()
        if not m and p == "anthropic":
            m = os.getenv("BID_AGENT_MODEL", "").strip()
        return m or providers.DEFAULT_MODELS[p][0]

    def make_llm(log: Callable[[str], None]) -> LLM:
        p = provider()
        return LLM(api_key=provider_key(p)[0], model=doc_model(p), log=log, provider=p)

    def account(user_id: int) -> dict:
        with client_api._get_db() as conn:
            return org_access.get_account(conn, user_id)

    def owner_of(user_id: int) -> str:
        acc = account(user_id)
        return f"org:{acc['org_id']}" if acc.get("org_id") is not None else f"user:{user_id}"

    def tender_row(user_id: int, tender_db_id: int) -> dict:
        client_api._require_section(user_id, "projects")
        with client_api._get_db() as conn:
            client_api._require_tender_access(conn, user_id, tender_db_id)
            return dict(client_api._find_tender(conn, tender_db_id))

    def materialize(tender: dict, dest: str) -> int:
        """Copy the tender's stored documents (local disk or Drive) into ``dest``."""
        canonical = str(tender.get("tender_id") or "").strip().upper()
        with client_api._get_db() as conn:
            rows = conn.execute(
                "SELECT d.id,d.file_name,d.local_path,d.drive_file_id FROM downloaded_files d "
                f"WHERE {client_api._document_condition()}",
                (int(tender["id"]), canonical),
            ).fetchall()
        n = 0
        for row in rows:
            data = dict(row)
            name = os.path.basename(str(data.get("file_name") or f"document_{data['id']}")) or f"document_{data['id']}"
            target = os.path.join(dest, name)
            if os.path.exists(target):  # same name twice: keep both
                target = os.path.join(dest, f"{data['id']}_{name}")
            try:
                kind, ref = client_api._download_reference(data)
                if kind == "local":
                    shutil.copyfile(ref, target)
                else:
                    import drive_storage

                    _meta, response = drive_storage.open_download(ref)
                    with open(target, "wb") as f:
                        for chunk in drive_storage.iter_download_response(response):
                            f.write(chunk)
                n += 1
            except Exception:
                continue
        return n

    def analyse(owner: str, tender: dict, overrides: dict, log: Callable[[str], None]) -> dict:
        """Reads the tender's documents and stores the result for the owner."""
        work = tempfile.mkdtemp(prefix="bidpack_")
        try:
            log("Collecting the tender’s documents…")
            n = materialize(tender, work)
            if not n:
                raise RuntimeError("No downloaded documents are available for this tender yet. Request the documents first.")
            profile = store.get_company_profile(owner)
            result = agent.analyze_files(work, tender, store, make_llm(log), profile, log=log, overrides=overrides)
            store.save_analysis(owner, tender["id"], status="completed", result=result, error="")
            return result
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def run_analysis(owner: str, tender: dict, user_id: int, overrides: dict) -> None:
        key = (owner, int(tender["id"]))
        logs: list[str] = []
        last_flush = [0.0]

        def log(msg: str) -> None:
            logs.append(str(msg))
            if time.time() - last_flush[0] > 1.5:
                last_flush[0] = time.time()
                store.save_analysis(owner, tender["id"], status="running", logs=logs[-400:])

        try:
            result = analyse(owner, tender, overrides, log)
            store.save_analysis(owner, tender["id"], status="completed", logs=logs[-400:], result=result, error="")
        except Exception as e:
            logs.append(f"Error: {e}")
            store.save_analysis(owner, tender["id"], status="failed", logs=logs[-400:], error=str(e))
        finally:
            with _runs_lock:
                _runs.pop(key, None)

    def start(owner: str, tender: dict, user_id: int, overrides: dict) -> dict:
        key = (owner, int(tender["id"]))
        with _runs_lock:
            t = _runs.get(key)
            if t and t.is_alive():
                return {"status": "running"}
            current = store.get_analysis(owner, tender["id"])
            if current and current["status"] == "running" and time.time() - float(current.get("updated_at") or 0) < STALE_RUN_SEC:
                return {"status": "running"}  # running in another worker process
            store.save_analysis(owner, tender["id"], status="running", logs=["Queued…"], error="", started_by=user_id)
            t = threading.Thread(target=run_analysis, args=(owner, tender, user_id, overrides), daemon=True)
            _runs[key] = t
            t.start()
        return {"status": "running"}

    def public(a: Optional[dict], since: int = 0) -> dict:
        if not a:
            return {"status": "none", "logs": [], "next": 0, "result": None, "files": []}
        logs = a.get("logs") or []
        res = a.get("result")
        return {
            "status": a["status"], "error": a.get("error", ""), "updated_at": a.get("updated_at"),
            "logs": logs[since:], "next": len(logs), "result": res,
            "files": agent.output_names(res) if res else [],
        }

    # ------------------------------------------------------------ client
    @client.get("/bid-agent/status")
    def client_bid_status(user_id: int = Depends(client_api.require_client_user)) -> dict:
        acc = account(user_id)
        return {
            "ai_enabled": make_llm(lambda m: None).available,
            "provider": provider(),
            "model": doc_model(provider()),
            "owner": "organisation" if acc.get("org_id") is not None else "individual",
            "can_edit_profile": acc.get("org_id") is None or acc.get("role") == "admin",
            "roles": [{"role": k, "label": v["label"]} for k, v in ROLES.items()],
        }

    @client.get("/bid-agent/analyses")
    def client_bid_analyses(user_id: int = Depends(client_api.require_client_user)) -> dict:
        return {"items": store.list_analyses(owner_of(user_id))}

    @client.post("/tenders/{tender_db_id}/bid-pack")
    def client_bid_pack_start(tender_db_id: int, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        prev = store.get_analysis(owner, tender_db_id) or {}
        overrides = ((prev.get("result") or {}).get("overrides") or {})
        start(owner, tender, user_id, overrides)
        return public(store.get_analysis(owner, tender_db_id))

    @client.get("/tenders/{tender_db_id}/bid-pack")
    def client_bid_pack(tender_db_id: int, since: int = 0, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender_row(user_id, tender_db_id)
        return public(store.get_analysis(owner_of(user_id), tender_db_id), max(0, since))

    @client.put("/tenders/{tender_db_id}/bid-pack/documents")
    def client_bid_pack_correct(tender_db_id: int, body: DocumentRolesIn,
                                user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        a = store.get_analysis(owner, tender_db_id)
        if not a or not a.get("result"):
            raise HTTPException(400, "Prepare the bid pack first.")
        bad = [s.role for s in body.segments if s.role not in ROLES]
        if bad:
            raise HTTPException(400, f"Unknown section type: {', '.join(bad)}")
        result = a["result"]
        if body.file not in {d["file"] for d in result.get("documents", [])}:
            raise HTTPException(404, "File not found in this bid pack.")
        segs = [{"role": s.role, "label": ROLES[s.role]["label"], "start_page": s.start_page,
                 "end_page": max(s.start_page, s.end_page), "title": s.title, "source": "manual", "confidence": 1.0}
                for s in body.segments]
        overrides = dict(result.get("overrides") or {})
        overrides[body.file] = segs
        # Remember the employer's wording for these sections (shared learning).
        org_key = result.get("org_key") or ""
        if org_key:
            for s in segs:
                if s["role"] != "other":
                    stem = os.path.splitext(body.file.split("/")[-1])[0]
                    store.learn_alias(org_key, result.get("org_name", ""), s["role"], stem.replace("_", " "))
        start(owner, tender, user_id, overrides)
        return public(store.get_analysis(owner, tender_db_id))

    @client.get("/tenders/{tender_db_id}/bid-pack/files/{name}")
    def client_bid_pack_file(tender_db_id: int, name: str, user_id: int = Depends(client_api.require_client_user)):
        tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        a = store.get_analysis(owner, tender_db_id)
        if not a or not a.get("result"):
            raise HTTPException(404, "No bid pack for this tender.")
        profile = store.get_company_profile(owner)
        result = agent.refresh_compliance(a["result"], profile)
        out = tempfile.mkdtemp(prefix="bidpack_out_")
        try:
            path = agent.build_output(result, profile, name, out)
        except FileNotFoundError:
            shutil.rmtree(out, ignore_errors=True)
            raise HTTPException(404, "File not found.")
        media = ("application/zip" if name.endswith(".zip") else
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if name.endswith(".xlsx") else
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return FileResponse(path, media_type=media, filename=name,
                            background=BackgroundTask(shutil.rmtree, out, True))


    # ------------------------------------------------------------- chat
    # The Bid Agent works as a chat: each message runs one agent turn in the
    # background; the apps poll GET .../chat?since=n for new messages and, while
    # it works, for ``partial`` (the reply as it is being written).
    def chat_model(p: str = "") -> str:
        p = p or provider()
        m = setting(_chat_model_setting(p)).strip()
        if not m and p == "anthropic":
            m = os.getenv("BID_AGENT_CHAT_MODEL", "").strip()
        return m or providers.DEFAULT_MODELS[p][1]

    def training_text(owner: str, employer: str) -> str:
        """Standing instructions (global, then the owner's) and learned notes, for the prompt."""
        parts = []
        g = store.get_instructions("global").strip()
        if g:
            parts.append("Standing instructions from the operator:\n" + g)
        if owner != "admin":
            o = store.get_instructions(owner).strip()
            if o:
                parts.append("Standing instructions from the user's organisation (follow these):\n" + o)
            notes = store.list_learnings(owner, org_key_for(employer) if employer else "")
            if notes:
                parts.append("Things the user taught you earlier (apply them):\n" +
                             "\n".join(f"- {n['text']}" for n in notes[:40]))
        return "\n\n".join(parts)

    class _AdminWorkspace:
        """Console chats: read and answer only; saving belongs to the apps."""

        def __init__(self, tender):
            self.tender = tender

        def _no(self, *a, **k):
            raise RuntimeError("Saving files or checklist rows is done from the apps (Bidwise or the desktop app).")

        save_file = add_checklist_rows = _no

        def references(self):
            return []

        def template_rows(self, employer):
            return "", []

        def files(self, folder=None):
            return []

        def checklist(self):
            return []

        def attach_matching(self, saved):
            return []

    def run_chat(owner: str, tender: dict, user_id: int, text: str, admin: bool = False) -> None:
        key = ("chat", owner, int(tender["id"]))
        tid = int(tender["id"])
        last_partial = [0.0]

        def progress(msg: str) -> None:
            store.save_chat(owner, tid, progress=str(msg)[:200])

        def partial(txt: str) -> None:
            if time.time() - last_partial[0] > 0.35:
                last_partial[0] = time.time()
                store.set_chat_partial(owner, tid, txt)

        pages = None
        try:
            ws = _AdminWorkspace(tender) if admin else Workspace(connect, user_id, tender)

            def get_result() -> dict:
                a = store.get_analysis(owner, tid)
                res = (a or {}).get("result") or {}
                if a and a.get("status") == "completed" and res and \
                        res.get("pipeline_version", 1) >= agent.PIPELINE_VERSION:
                    return res
                progress("Reading the tender documents (the first time takes a minute)…")
                return analyse(owner, tender, res.get("overrides") or {}, lambda m: progress(m))

            class Pages:
                """The tender's files, copied once per turn for page-level requests."""

                def __init__(self):
                    self.dir = None

                def _src(self) -> str:
                    if self.dir is None:
                        self.dir = tempfile.mkdtemp(prefix="bidpages_")
                        if not materialize(tender, self.dir):
                            raise RuntimeError("No downloaded documents are available for this tender yet.")
                    return self.dir

                def read(self, file: str, start: int, end: int):
                    return agent.read_pages(self._src(), file, start, end)

                def criteria(self, file: str, start: int, end: int):
                    return agent.criteria_from_pages(self._src(), file, start, end, store, make_llm(progress), progress)

                def cleanup(self):
                    if self.dir:
                        shutil.rmtree(self.dir, ignore_errors=True)

            pages = Pages()

            def save_result(res: dict) -> None:
                store.save_analysis(owner, tid, status="completed", result=res, error="")

            def remember(note: str, applies_to: str) -> None:
                if admin:
                    store.set_instructions("global", (store.get_instructions("global") + "\n- " + note).strip())
                    return
                emp = ((get_result().get("tender") or {}).get("employer") or "") if applies_to == "employer" else ""
                store.add_learning(owner, note, employer_key=org_key_for(emp) if emp else "", source="chat",
                                   tender_db_id=tid, user_id=user_id)

            turn = chat.Turn(ws, get_result, lambda: store.get_company_profile(owner), progress,
                             pages=pages, save_result=save_result, remember=remember)
            history = store.get_chat(owner, tid)["messages"][:-1]
            llm = make_llm(lambda m: None)
            extra, grounding = "", None
            if llm.available:
                result = get_result()
                extra = training_text(owner, (result.get("tender") or {}).get("employer") or "")
                grounding = grounding_for(tender, result, pages, llm, progress)
            try:
                reply = chat.run_turn(turn, history, text, llm, model=chat_model(), effort="low",
                                      system_extra=extra, grounding=grounding, on_partial=partial)
            except Exception as e:
                if grounding and "file" in str(e).lower():
                    store.put_doc_cache(agent.grounding_key(tid, turn.result), "grounding", None)
                    reply = chat.run_turn(turn, history, text, llm, model=chat_model(), effort="low",
                                          system_extra=extra, grounding=None, on_partial=partial)
                else:
                    raise
            msg = {"role": "assistant", "text": reply, "cards": turn.cards}
        except Exception as e:
            msg = {"role": "assistant", "text": f"Sorry, that didn’t work: {e}", "cards": [], "error": True}
        finally:
            if pages:
                pages.cleanup()
            with _runs_lock:
                _runs.pop(key, None)
        cur = store.get_chat(owner, tid)["messages"]
        msg.update({"id": (cur[-1]["id"] + 1) if cur else 1, "at": time.time()})
        store.save_chat(owner, tid, messages=cur + [msg], status="idle", progress="")
        store.set_chat_partial(owner, tid, "")

    def grounding_for(tender: dict, result: dict, pages, llm, progress) -> list | None:
        """The tender's key pages for the chat model. Claude: uploaded once (Files API) and reused;
        Gemini / ChatGPT: sent inline each turn (the cached Claude file ids don't work there)."""
        if not result.get("criteria_pages"):
            return None
        claude = llm.provider == "anthropic"
        key = agent.grounding_key(int(tender["id"]), result)
        cached = store.get_doc_cache(key) if claude else None
        if cached:
            return cached
        try:
            progress("Opening the tender pages…")
            blocks = agent.grounding_blocks(pages._src(), result, llm._get_client() if claude else None)
        except Exception:
            return None
        if claude and blocks and all(b["source"]["type"] in ("file", "text") for b in blocks):
            store.put_doc_cache(key, "grounding", blocks)
        return blocks or None

    def chat_state(owner: str, tid: int, since: int = 0) -> dict:
        c = store.get_chat(owner, tid)
        working = c["status"] == "working" and time.time() - float(c.get("updated_at") or 0) < STALE_RUN_SEC
        msgs = c["messages"]
        return {
            "messages": [m for m in msgs if int(m.get("id", 0)) > since],
            "next": msgs[-1]["id"] if msgs else 0,
            "status": "working" if working else "idle",
            "progress": c["progress"] if working else "",
            "partial": store.get_chat_partial(owner, tid) if working else "",
            "ai_enabled": make_llm(lambda m: None).available,
            "suggestions": chat.suggestions(True),
        }

    def start_chat(owner: str, tender: dict, user_id: int, text: str, since: int, admin: bool = False) -> dict:
        tid = int(tender["id"])
        key = ("chat", owner, tid)
        with _runs_lock:
            t = _runs.get(key)
            busy = (t and t.is_alive()) or chat_state(owner, tid)["status"] == "working"
            if busy:
                raise HTTPException(409, detail={"reason": "busy", "message": "The agent is still working on the last request."})
            cur = store.get_chat(owner, tid)["messages"]
            msg = {"id": (cur[-1]["id"] + 1) if cur else 1, "role": "user", "text": text.strip(),
                   "user_id": user_id, "at": time.time()}
            store.save_chat(owner, tid, messages=cur + [msg], status="working", progress="Thinking…")
            store.set_chat_partial(owner, tid, "")
            t = threading.Thread(target=run_chat, args=(owner, tender, user_id, msg["text"], admin), daemon=True)
            _runs[key] = t
            t.start()
        return chat_state(owner, tid, max(0, since))

    @client.get("/tenders/{tender_db_id}/bid-agent/chat")
    def client_bid_chat(tender_db_id: int, since: int = 0, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender_row(user_id, tender_db_id)
        return chat_state(owner_of(user_id), tender_db_id, max(0, since))

    @client.post("/tenders/{tender_db_id}/bid-agent/chat")
    def client_bid_chat_send(tender_db_id: int, body: ChatIn, since: int = 0,
                             user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        return start_chat(owner_of(user_id), tender, user_id, body.message, since)

    @client.delete("/tenders/{tender_db_id}/bid-agent/chat")
    def client_bid_chat_clear(tender_db_id: int, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        if chat_state(owner, tender_db_id)["status"] == "working":
            raise HTTPException(409, detail={"reason": "busy", "message": "Wait for the agent to finish."})
        store.save_chat(owner, tender_db_id, messages=[], status="idle", progress="")
        return chat_state(owner, tender_db_id)

    # Files the agent / team saved for the tender (download through the usual
    # POST /client/project-files/{file_id}/download-request).
    @client.get("/tenders/{tender_db_id}/bid-agent/files")
    def client_bid_files(tender_db_id: int, folder: str = "", user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        ws = Workspace(connect, user_id, tender)
        return {"items": ws.files(folder if folder in ("prep", "ready") else None)}

    def receive_upload(file: UploadFile, save: Callable[[str, str], dict]) -> dict:
        max_bytes = core.setting_int("max_file_size_mb", 80, minimum=1, maximum=2048) * 1024 * 1024
        tmp = tempfile.mkdtemp(prefix="bidupload_")
        try:
            name = os.path.basename(str(file.filename or "file")) or "file"
            path = os.path.join(tmp, name)
            size = 0
            with open(path, "wb") as out:
                while True:
                    chunk = file.file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(413, f"The file is larger than {max_bytes // (1024 * 1024)} MB.")
                    out.write(chunk)
            if not size:
                raise HTTPException(400, "The file is empty.")
            return save(path, name)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    @client.post("/tenders/{tender_db_id}/bid-agent/prep-files")
    def client_bid_prep_upload(tender_db_id: int, file: UploadFile = File(...),
                               user_id: int = Depends(client_api.require_client_user)) -> dict:
        """A user's own Docs for Preparation file, stored on Drive beside the agent's."""
        tender = tender_row(user_id, tender_db_id)
        return receive_upload(file, lambda path, name: Workspace(connect, user_id, tender).save_file(
            path, name, kind="user", folder="prep", device="app"))

    @client.delete("/tenders/{tender_db_id}/bid-agent/prep-files/{file_id}")
    def client_bid_prep_delete(tender_db_id: int, file_id: int,
                               user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        if not Workspace(connect, user_id, tender).remove_prep_file(file_id):
            raise HTTPException(404, "File not found.")
        return {"ok": True}

    # --------------------------------------------- open anywhere / training
    def can_edit_training(user_id: int) -> bool:
        acc = account(user_id)
        return acc.get("org_id") is None or acc.get("role") == "admin"

    def tender_brief(conn, tid: int) -> dict:
        t = dict(client_api._find_tender(conn, tid))
        return {"id": tid, "tender_id": t.get("tender_id") or "", "title": t.get("title") or "",
                "organisation": (t.get("org_chain") or "").split("||")[0].strip(),
                "closing_date": t.get("closing_date") or ""}

    @client.get("/bid-agent/recent")
    def client_bid_recent(limit: int = 20, user_id: int = Depends(client_api.require_client_user)) -> dict:
        """Tenders the owner chatted with the agent about, newest first."""
        client_api._require_section(user_id, "projects")
        items = []
        with client_api._get_db() as conn:
            for c in store.recent_chats(owner_of(user_id), max(1, min(int(limit), 50))):
                try:
                    client_api._require_tender_access(conn, user_id, c["tender_id"])
                    info = tender_brief(conn, c["tender_id"])
                except Exception:
                    continue
                info.update({"last": c["last"], "count": c["count"], "updated_at": c["updated_at"]})
                items.append(info)
        return {"items": items}

    @client.get("/bid-agent/instructions")
    def client_bid_instructions(user_id: int = Depends(client_api.require_client_user)) -> dict:
        return {"text": store.get_instructions(owner_of(user_id)), "can_edit": can_edit_training(user_id)}

    @client.put("/bid-agent/instructions")
    def client_bid_instructions_save(body: InstructionsIn, user_id: int = Depends(client_api.require_client_user)) -> dict:
        if not can_edit_training(user_id):
            raise HTTPException(403, detail={"reason": "org_admin_only",
                                             "message": "Only your organisation's admins can change the agent's instructions."})
        store.set_instructions(owner_of(user_id), body.text.strip(), user_id)
        return client_bid_instructions(user_id)

    @client.get("/bid-agent/learnings")
    def client_bid_learnings(user_id: int = Depends(client_api.require_client_user)) -> dict:
        return {"items": store.list_learnings(owner_of(user_id), include_inactive=True),
                "can_edit": can_edit_training(user_id)}

    @client.patch("/bid-agent/learnings/{learning_id}")
    def client_bid_learning_update(learning_id: int, body: LearningIn,
                                   user_id: int = Depends(client_api.require_client_user)) -> dict:
        if not can_edit_training(user_id):
            raise HTTPException(403, detail={"reason": "org_admin_only", "message": "Only your organisation's admins can change this."})
        if not store.update_learning(owner_of(user_id), learning_id, text=body.text, active=body.active):
            raise HTTPException(404, "Not found.")
        return client_bid_learnings(user_id)

    @client.delete("/bid-agent/learnings/{learning_id}")
    def client_bid_learning_delete(learning_id: int, user_id: int = Depends(client_api.require_client_user)) -> dict:
        if not can_edit_training(user_id):
            raise HTTPException(403, detail={"reason": "org_admin_only", "message": "Only your organisation's admins can change this."})
        if not store.delete_learning(owner_of(user_id), learning_id):
            raise HTTPException(404, "Not found.")
        return client_bid_learnings(user_id)

    def library(user_id: int) -> Workspace:
        client_api._require_section(user_id, "projects")
        return Workspace(connect, user_id, {"id": 0, "tender_id": "", "title": ""})

    def public_refs(ws: Workspace) -> list:
        return [{k: v for k, v in r.items() if k != "storage_ref"} for r in ws.references()]

    @client.get("/bid-agent/references")
    def client_bid_references(user_id: int = Depends(client_api.require_client_user)) -> dict:
        return {"items": public_refs(library(user_id))}

    @client.post("/bid-agent/references")
    def client_bid_reference_upload(file: UploadFile = File(...), label: str = "",
                                    user_id: int = Depends(client_api.require_client_user)) -> dict:
        ws = library(user_id)
        receive_upload(file, lambda path, name: ws.save_file(path, name, kind="reference", folder="library",
                                                             label=label[:200], device="app"))
        return {"items": public_refs(ws)}

    @client.delete("/bid-agent/references/{file_id}")
    def client_bid_reference_delete(file_id: int, user_id: int = Depends(client_api.require_client_user)) -> dict:
        ws = library(user_id)
        if not ws.remove_reference(file_id):
            raise HTTPException(404, "File not found.")
        return {"items": public_refs(ws)}

    @client.get("/company-profile")
    def client_company_profile(user_id: int = Depends(client_api.require_client_user)) -> dict:
        data = company.empty_profile()
        data.update(store.get_company_profile(owner_of(user_id)))
        acc = account(user_id)
        return {"profile": data, "schema": company.profile_schema(),
                "can_edit": acc.get("org_id") is None or acc.get("role") == "admin"}

    @client.put("/company-profile")
    def client_save_company_profile(body: dict, user_id: int = Depends(client_api.require_client_user)) -> dict:
        acc = account(user_id)
        if acc.get("org_id") is not None and acc.get("role") != "admin":
            raise HTTPException(403, detail={"reason": "org_admin_only",
                                             "message": "Only your organisation's admins can edit the company profile."})
        allowed = {"general", *company.LIST_SECTIONS.keys()}
        clean = {k: v for k, v in (body or {}).items() if k in allowed}
        if len(str(clean)) > 2_000_000:
            raise HTTPException(413, "Company profile is too large.")
        merged = store.get_company_profile(owner_of(user_id))
        merged.update(clean)
        store.save_company_profile(owner_of(user_id), merged, user_id)
        return client_company_profile(user_id)

    # ------------------------------------------------------------- admin
    def key_info(p: str) -> dict:
        key, source = provider_key(p)
        return {"set": bool(key), "hint": _hint(key), "source": source}

    @admin.get("/config")
    def admin_bid_config() -> dict:
        p = provider()
        active = key_info(p)
        return {"provider": p, "providers": providers.runnable(), "provider_labels": providers.LABELS,
                "keys": {q: key_info(q) for q in providers.PROVIDERS},
                "api_key_set": active["set"], "api_key_hint": active["hint"], "api_key_source": active["source"],
                "model": doc_model(p), "default_model": providers.DEFAULT_MODELS[p][0],
                "chat_model": chat_model(p), "default_chat_model": providers.DEFAULT_MODELS[p][1]}

    def checked_provider(value: Optional[str]) -> str:
        p = (value or "").strip().lower()
        if p not in providers.runnable():
            raise HTTPException(400, detail={"reason": "unknown_provider",
                                             "message": f"Unknown or unavailable AI provider: {value}"})
        return p

    @admin.put("/config")
    def admin_bid_config_save(body: ConfigIn) -> dict:
        """``provider`` names the provider the key / models are for. It also becomes the active
        provider, unless the request only removes a key (``api_key: ""`` and nothing else)."""
        p = provider()
        if body.provider is not None:
            p = checked_provider(body.provider)
            only_removing_key = body.api_key == "" and body.model is None and body.chat_model is None
            if not only_removing_key:
                core.ScraperBackend.set_setting(PROVIDER_SETTING, p)
        if body.api_key is not None:
            core.ScraperBackend.set_setting(_key_setting(p), body.api_key.strip())
        if body.model is not None:
            core.ScraperBackend.set_setting(_model_setting(p), body.model.strip())
        if body.chat_model is not None:
            core.ScraperBackend.set_setting(_chat_model_setting(p), body.chat_model.strip())
        return admin_bid_config()

    @admin.post("/models")
    def admin_bid_models(body: ModelsIn) -> dict:
        """The provider's models, listed live with the given key (else the saved / env key)."""
        p = checked_provider(body.provider)
        key = (body.api_key or "").strip() or provider_key(p)[0]
        if not key:
            return {"models": [], "source": "none", "error": "No API key for this provider."}
        try:
            return {"models": providers.list_models(p, key), "source": "live"}
        except Exception as e:
            msg = str(e).replace(key, "…")[:300]
            return {"models": [], "source": "error", "error": msg}

    @admin.get("/employers")
    def admin_bid_employers() -> list:
        return [{k: v for k, v in o.items() if k != "tender_ids"} for o in store.list_orgs()]

    @admin.delete("/employers/{org_key}")
    def admin_bid_employer_forget(org_key: str) -> dict:
        store.delete_org(org_key)
        return {"ok": True}

    @admin.get("/forms")
    def admin_bid_forms(org_key: str = "") -> list:
        return store.list_forms(org_key)

    @admin.get("/instructions")
    def admin_bid_instructions() -> dict:
        return {"text": store.get_instructions("global")}

    @admin.put("/instructions")
    def admin_bid_instructions_save(body: InstructionsIn) -> dict:
        store.set_instructions("global", body.text.strip(), None)
        return admin_bid_instructions()

    @admin.get("/learnings")
    def admin_bid_learnings(owner: str = "") -> dict:
        """Learned notes of one owner (``org:N`` / ``user:N``), or of everyone."""
        if owner:
            return {"items": [dict(r, owner=owner) for r in store.list_learnings(owner, include_inactive=True)]}
        return {"items": store.all_learnings()}

    def admin_tender(tid: int) -> dict:
        with client_api._get_db() as conn:
            return dict(client_api._find_tender(conn, tid))

    @admin.get("/tenders/{tender_db_id}/chat")
    def admin_bid_chat(tender_db_id: int, since: int = 0) -> dict:
        admin_tender(tender_db_id)
        return chat_state("admin", tender_db_id, max(0, since))

    @admin.post("/tenders/{tender_db_id}/chat")
    def admin_bid_chat_send(tender_db_id: int, body: ChatIn, since: int = 0) -> dict:
        return start_chat("admin", admin_tender(tender_db_id), 0, body.message, since, admin=True)

    @admin.delete("/tenders/{tender_db_id}/chat")
    def admin_bid_chat_clear(tender_db_id: int) -> dict:
        if chat_state("admin", tender_db_id)["status"] == "working":
            raise HTTPException(409, detail={"reason": "busy", "message": "Wait for the agent to finish."})
        store.save_chat("admin", tender_db_id, messages=[], status="idle", progress="")
        return chat_state("admin", tender_db_id)

    return client, admin
