"""Pipeline tests (no server, no network). Run: python -m pytest bid_agent_server/tests"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from bid_agent import agent  # noqa: E402
from bid_agent.llm import LLM  # noqa: E402
from bid_agent.store import Store  # noqa: E402
from fixtures import build_tender  # noqa: E402

PROFILE = {
    "general": {"name": "Acme Infra Pvt Ltd", "authorized_signatory": "A. Kumar"},
    "financials": [{"fy": f"202{i}-2{i + 1}", "civil_turnover_inr_cr": str(80 + 10 * i)} for i in range(5)],
    "experience": [{"name_of_work": "Station works", "contract_value_inr_cr": "75", "completion_date": "2024-03-31"}],
    "certificates": [{"name": "ISO 9001:2015", "valid_till": "2099-01-01"}],
}


class FakeLLM(LLM):
    """Answers every structured call with schema-shaped data."""

    def __init__(self):
        super().__init__(api_key="test-key")
        self.calls = []

    def json_call(self, system, content, schema, **kw):
        text = content if isinstance(content, str) else content[0]["text"]
        props = schema["properties"]
        self.calls.append(sorted(props))
        if "segments" in props:
            first = text.splitlines()[0]
            n = int(text.split("PAGES: ")[1].split()[0])
            role = "bidding_forms" if "Forms" in first else "qualification_criteria" if "PQ" in first else "itb"
            return {"employer": "ABC Authority", "tender_reference": "ABC/WORKS/2026/01", "tender_title": "Works",
                    "segments": [{"role": role, "start_page": 1, "end_page": n, "title": "",
                                  "employer_term": f"Volume term {role}", "confidence": 0.9}]}
        if "criteria" in props:
            return {"criteria": [{"ref": "3.4", "category": "Financial", "subject": "Average Annual Turnover",
                                  "requirement": "INR 100 Cr, 5% escalation", "single_entity": "Must meet",
                                  "jv_all_parties": "", "jv_each_member": "", "jv_one_member": "",
                                  "forms": ["FIN-3.2"], "metric": "avg_annual_turnover", "threshold_inr_cr": 100,
                                  "threshold_count": 0, "period_years": 5, "page": 1}],
                    "personnel": [], "equipment": [], "similar_work_definition": "", "financial_year_cutoff": "",
                    "notes": []}
        if "forms" in props:
            n = text.count("===== FORM")
            block = {"type": "fields", "text": "", "fields": [{"id": "n", "label": "Name", "key": "general.name"}],
                     "title": "", "columns": [], "prefilled_rows": [], "rows_hint": 0, "binds_to": ""}
            return {"forms": [{"code": "", "title": "AI", "kind": "letter", "instructions": "", "blocks": [block]}] * n}
        raise AssertionError(props)


def new_store(tmp):
    s = Store(lambda: sqlite3.connect(os.path.join(tmp, "t.db")))
    s.init_schema()
    return s


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "docs")
        build_tender(self.src)
        self.tender = {"id": 7, "tender_id": "2026_ABC_1", "title": "Works", "org_chain": "ABC Authority||Projects"}

    def test_keyword_mode_end_to_end(self):
        store = new_store(self.tmp)
        r = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None)
        roles = {d["file"]: d["segments"][0]["role"] for d in r["documents"]}
        self.assertEqual(roles["Volume 1 - ITT.docx"], "itb")
        self.assertEqual(roles["Volume 2 - PQ Criteria.docx"], "qualification_criteria")
        self.assertEqual(roles["Volume 3 - Bidding Forms.docx"], "bidding_forms")
        refs = [c["ref"] for c in r["criteria"]["criteria"]]
        self.assertEqual(refs, ["3.4", "4.2", "5.1"])
        self.assertEqual(r["expected_forms"], ["FIN-3.2", "EXP-4.2", "CER-5.1"])
        self.assertEqual([f["code"] for f in r["forms"]], ["FIN-3.2", "EXP-4.2"])
        self.assertEqual(r["missing_forms"], ["CER-5.1"])
        status = {c["ref"]: c["status"] for c in r["compliance"]}
        self.assertEqual(status["3.4"], "Meets")       # avg of escalated 80..120 >= 100
        self.assertEqual(status["4.2"], "Meets")       # 75 Cr work within 7 years
        self.assertEqual(status["5.1"], "Shortfall")   # no ISO 14001
        self.assertEqual(r["org_key"], "abc-authority")
        agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None)
        self.assertEqual(store.get_org("abc-authority")["tender_count"], 1)  # same tender twice
        json.dumps(r)  # result must be JSON-serialisable for the DB

    def test_outputs_are_built_on_demand(self):
        store = new_store(self.tmp)
        r = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None)
        names = [o["name"] for o in agent.output_names(r)]
        self.assertIn("Bid Forms Workbook.xlsx", names)
        self.assertIn("Bid Forms.zip", names)
        out = tempfile.mkdtemp()
        import docx
        import openpyxl
        import zipfile
        form_name = names[1]
        d = docx.Document(agent.build_output(r, PROFILE, form_name, out))
        self.assertIn("Acme Infra Pvt Ltd", "\n".join(p.text for p in d.paragraphs))
        wb = openpyxl.load_workbook(agent.build_output(r, PROFILE, "Bid Forms Workbook.xlsx", out))
        self.assertIn("Compliance", wb.sheetnames)
        with zipfile.ZipFile(agent.build_output(r, PROFILE, "Bid Forms.zip", out)) as z:
            self.assertEqual(len(z.namelist()), len(names) - 1)
        with self.assertRaises(FileNotFoundError):
            agent.build_output(r, PROFILE, "../../etc/passwd", out)

    def test_ai_mode_caches_and_reuses_templates(self):
        store = new_store(self.tmp)
        llm = FakeLLM()
        r = agent.analyze_files(self.src, self.tender, store, llm, PROFILE, log=lambda m: None)
        self.assertTrue(all(f["source"] == "ai" for f in r["forms"]))
        self.assertEqual(store.get_org("abc-authority")["aliases"]["itb"], ["Volume term itb"])
        llm2 = FakeLLM()
        r2 = agent.analyze_files(self.src, self.tender, store, llm2, PROFILE, log=lambda m: None)
        self.assertEqual(llm2.calls, [])  # section maps, criteria and forms all reused
        self.assertTrue(all(f["source"] == "library" for f in r2["forms"]))

    def test_schema_upgrade_adds_new_columns(self):
        db = os.path.join(self.tmp, "old.db")
        c = sqlite3.connect(db)
        c.execute("CREATE TABLE bid_org_profiles (org_key TEXT PRIMARY KEY, org_name TEXT, aliases_json TEXT, "
                  "form_codes_json TEXT, tender_count INTEGER DEFAULT 0, updated_at REAL)")
        c.commit()
        c.close()
        store = Store(lambda: sqlite3.connect(db))
        store.init_schema()
        store.init_schema()  # twice is fine
        store.save_org({"org_key": "x", "org_name": "X", "tender_ids": ["T1"]})
        self.assertEqual(store.get_org("x")["tender_count"], 1)

    def test_owner_scoped_storage(self):
        store = new_store(self.tmp)
        store.save_company_profile("org:1", {"general": {"name": "A"}})
        store.save_company_profile("org:2", {"general": {"name": "B"}})
        self.assertEqual(store.get_company_profile("org:1")["general"]["name"], "A")
        store.save_analysis("org:1", 5, status="running", logs=["x"])
        store.save_analysis("org:1", 5, status="completed", result={"ok": 1})
        a = store.get_analysis("org:1", 5)
        self.assertEqual((a["status"], a["logs"], a["result"]), ("completed", ["x"], {"ok": 1}))
        self.assertIsNone(store.get_analysis("org:2", 5))


class ZipTests(unittest.TestCase):
    """Portals deliver tender documents as ZIPs (often a ZIP inside a ZIP)."""

    def setUp(self):
        import zipfile

        self.tmp = tempfile.mkdtemp()
        loose = os.path.join(self.tmp, "loose")
        build_tender(loose)
        self.src = os.path.join(self.tmp, "docs")
        os.makedirs(self.src)
        # inner ZIP with the forms volume, outer ZIP with the rest + inner ZIP + Mac junk
        inner = os.path.join(self.tmp, "forms.zip")
        with zipfile.ZipFile(inner, "w") as z:
            z.write(os.path.join(loose, "Volume 3 - Bidding Forms.docx"), "Volume 3 - Bidding Forms.docx")
        with zipfile.ZipFile(os.path.join(self.src, "2026_ABC_1.zip"), "w") as z:
            z.write(os.path.join(loose, "Volume 1 - ITT.docx"), "Tender/Volume 1 - ITT.docx")
            z.write(os.path.join(loose, "Volume 2 - PQ Criteria.docx"), "Tender/Volume 2 - PQ Criteria.docx")
            z.write(inner, "Tender/forms.zip")
            z.writestr("__MACOSX/Tender/._Volume 1 - ITT.docx", b"junk")
            z.writestr("Tender/notes.rtf", r"{\rtf1\ansi Pre-bid meeting on 26 May 2026.}")
            z.writestr("../../evil.txt", b"zip slip")
        with open(os.path.join(self.src, "broken.zip"), "wb") as f:
            f.write(b"PK\x03\x04 not really a zip")
        with open(os.path.join(self.src, "BOQ.rar"), "wb") as f:
            f.write(b"Rar!")
        self.tender = {"id": 9, "tender_id": "2026_ABC_1", "title": "Works", "org_chain": "ABC Authority"}

    def test_reads_documents_inside_nested_zips(self):
        from bid_agent.docreader import list_tender_files

        report = []
        files = [os.path.relpath(p, self.src) for p in list_tender_files(self.src, report)]
        self.assertIn(os.path.join("2026_ABC_1_unzipped", "Tender", "Volume 1 - ITT.docx"), files)
        self.assertIn(os.path.join("2026_ABC_1_unzipped", "Tender", "forms_unzipped", "Volume 3 - Bidding Forms.docx"), files)
        self.assertFalse(any("__MACOSX" in f or "evil" in f for f in files))
        rtf = [p for p in files if p.endswith("notes.rtf.converted.txt")]
        self.assertEqual(len(rtf), 1)  # old formats are converted where possible
        with open(os.path.join(self.src, rtf[0]), encoding="utf-8") as f:
            self.assertIn("Pre-bid meeting on 26 May 2026", f.read())
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil.txt")))
        issues = {r["file"]: r["issue"] for r in report}
        self.assertIn("damaged", issues["broken.zip"])
        self.assertIn(".rar", issues["BOQ.rar"])

    def test_pipeline_on_zipped_tender(self):
        store = new_store(self.tmp)
        r = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None)
        roles = {d["file"].split("/")[-1].split(" › ")[-1]: (d["segments"][0]["role"] if d["segments"] else d["error"])
                 for d in r["documents"]}
        self.assertEqual(roles["Volume 2 - PQ Criteria.docx"], "qualification_criteria")
        self.assertEqual(roles["Volume 3 - Bidding Forms.docx"], "bidding_forms")
        self.assertEqual([f["code"] for f in r["forms"]], ["FIN-3.2", "EXP-4.2"])
        self.assertIn("damaged", roles["broken.zip"])  # skipped files are listed with the reason
        files = [d["file"] for d in r["documents"]]
        self.assertIn("2026_ABC_1.zip › Tender/forms.zip › Volume 3 - Bidding Forms.docx", files)
        self.assertIn("2026_ABC_1.zip › Tender/notes.rtf", files)

    def test_only_unreadable_files_gives_a_clear_error(self):
        src = os.path.join(self.tmp, "bad")
        os.makedirs(src)
        with open(os.path.join(src, "tender.zip"), "wb") as f:
            f.write(b"nope")
        with self.assertRaisesRegex(RuntimeError, "damaged"):
            agent.analyze_files(src, self.tender, new_store(self.tmp), None, PROFILE, log=lambda m: None)


class FakeStreamClient:
    """Stands in for anthropic.Anthropic: beta.messages.stream returns the scripted responses in turn."""

    def __init__(self, responses):
        from types import SimpleNamespace as NS

        self.responses = list(responses)
        self.calls = []
        self.beta = NS(messages=NS(stream=self.stream))

    def stream(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        resp = self.responses.pop(0)
        text = "".join(getattr(b, "text", "") for b in resp.content if b.type == "text")

        class _S:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            @property
            def text_stream(s):
                for i in range(0, len(text), 5):
                    yield text[i:i + 5]

            def get_final_message(s):
                return resp

        return _S()


class ParallelTests(unittest.TestCase):
    """Independent work runs at the same time, and only what was asked for is read."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "docs")
        build_tender(self.src)
        self.tender = {"id": 7, "tender_id": "2026_ABC_1", "title": "Works", "org_chain": "ABC Authority||Projects"}

    def test_reads_only_the_parts_asked_for_and_merges_later_ones(self):
        store = new_store(self.tmp)
        forms_only = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None, parts=("forms",))
        self.assertEqual(forms_only["parts"], ["forms"])
        self.assertTrue(forms_only["forms"])
        self.assertEqual(forms_only["criteria"], {})
        crit_only = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None,
                                        parts=("criteria",))
        self.assertEqual(crit_only["forms"], [])
        self.assertTrue(crit_only["criteria"]["criteria"])
        both = agent.merge_results(forms_only, crit_only)
        self.assertEqual(both["parts"], ["criteria", "forms"])
        self.assertEqual(both["forms"], forms_only["forms"])
        self.assertEqual(both["criteria"], crit_only["criteria"])
        self.assertIn("missing_forms", both)
        self.assertEqual(agent.parts_of({"criteria": {}}), {"criteria", "forms"})  # old results had both

    def test_criteria_and_forms_run_at_the_same_time(self):
        import threading
        import time
        from unittest import mock

        seen = []

        def slow(name, value):
            def fn(*a, **k):
                seen.append((name, threading.get_ident()))
                time.sleep(0.4)
                return value
            return fn

        crit = {"criteria": [], "personnel": [], "equipment": []}
        with mock.patch.object(agent, "extract_criteria", slow("criteria", crit)), \
                mock.patch.object(agent, "extract_forms", slow("forms", [])):
            t0 = time.time()
            r = agent.analyze_files(self.src, self.tender, new_store(self.tmp), None, PROFILE, log=lambda m: None)
            took = time.time() - t0
        self.assertEqual(sorted(n for n, _t in seen), ["criteria", "forms"])
        self.assertNotEqual(seen[0][1], seen[1][1])
        self.assertLess(took, 0.75)  # one after the other would take 0.8 s
        self.assertEqual(r["parts"], ["criteria", "forms"])

    def test_independent_tools_run_in_parallel_and_the_checklist_waits(self):
        import threading
        import time
        from types import SimpleNamespace as NS

        from bid_agent import chat

        log = []
        asked = []

        class T(chat.Turn):
            def _slow(self, name):
                log.append(("start", name, time.time()))
                time.sleep(0.3)
                self.cards.append({"type": "table", "title": name, "columns": [], "rows": []})
                log.append(("end", name, time.time()))
                return name

            def tool_show_prequalification(self, include_our_position=False):
                return self._slow("prequal")

            def tool_extract_tender_forms(self, codes=None, format="docx"):
                return self._slow("forms")

            def tool_prepare_checklist(self, items=None):
                return self._slow("checklist")

        def get_result(parts):
            asked.append(tuple(parts))
            return {"parts": list(parts), "criteria": {}, "forms": []}

        turn = T(NS(tender={"id": 1}), get_result, lambda: PROFILE)
        t0 = time.time()
        out = turn.run_tools([("prepare_checklist", {}), ("show_prequalification", {}), ("extract_tender_forms", {})])
        took = time.time() - t0
        self.assertEqual(out, ["checklist", "prequal", "forms"])
        self.assertLess(took, 0.85)  # prequal and forms together (0.3) + checklist (0.3)
        ends = {n: t for k, n, t in log if k == "end"}
        starts = {n: t for k, n, t in log if k == "start"}
        self.assertLess(abs(starts["prequal"] - starts["forms"]), 0.15)
        self.assertGreaterEqual(starts["checklist"], max(ends["prequal"], ends["forms"]) - 0.01)
        # cards in call order of each stage; both parts read once, before the step
        self.assertEqual([c["title"] for c in turn.cards], ["prequal", "forms", "checklist"])
        self.assertEqual(asked, [("criteria", "forms")])

    def test_only_the_needed_part_is_requested(self):
        from types import SimpleNamespace as NS

        from bid_agent import chat

        asked = []

        def get_result(parts):
            asked.append(tuple(parts))
            return {"parts": list(parts), "forms": [], "criteria": {}}

        turn = chat.Turn(NS(tender={"id": 1}), get_result, lambda: PROFILE)
        turn.run_tools([("list_tender_forms", {})])
        turn.run_tools([("show_prequalification", {})])
        turn.run_tools([("list_tender_forms", {})])
        self.assertEqual(asked, [("forms",), ("criteria", "forms")])

    def test_keyword_mode_splits_several_requests(self):
        from bid_agent import chat

        r = chat.route_many_without_ai("show the prequalification and extract all the forms as pdf")
        self.assertEqual([n for n, _a in r], ["show_prequalification", "extract_tender_forms"])
        self.assertEqual(r[1][1]["format"], "pdf")
        self.assertEqual([n for n, _a in chat.route_many_without_ai("the criteria are on pages 12 and 14")],
                         ["extract_criteria_from_pages"])
        self.assertEqual(len(chat.route_many_without_ai("prepare the checklist")), 1)


class ChatLoopTests(unittest.TestCase):
    """Claude chooses the tools; the loop feeds results back until it answers."""

    def test_tool_loop(self):
        from types import SimpleNamespace as NS

        from bid_agent import chat

        fake = FakeStreamClient([
            NS(stop_reason="tool_use", content=[
                NS(type="text", text="Let me look."),
                NS(type="tool_use", id="t1", name="show_prequalification", input={"include_our_position": True})]),
            NS(stop_reason="end_turn", content=[NS(type="text", text="Turnover needs INR 100 Cr; you meet it.")]),
        ])
        llm = LLM(api_key="k")
        llm._client = fake
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "docs")
        build_tender(src)
        tender = {"id": 7, "tender_id": "T-1", "title": "Works", "org_chain": "ABC Authority"}
        result = agent.analyze_files(src, tender, new_store(tmp), None, PROFILE, log=lambda m: None)
        turn = chat.Turn(NS(tender=tender), lambda: result, lambda: PROFILE)
        history = [{"role": "assistant", "text": "Hi"}, {"role": "user", "text": "earlier"}, {"role": "assistant", "text": "ok"}]
        partials = []
        grounding = [{"type": "document", "source": {"type": "file", "file_id": "f1"}, "title": "NIT p1-3"}]
        reply = chat.run_turn(turn, history, "What is the prequal and do we meet it?", llm, model="claude-sonnet-5-5",
                              system_extra="Standing instructions: answer in Hindi.", grounding=grounding,
                              on_partial=partials.append)
        self.assertEqual(reply, "Turnover needs INR 100 Cr; you meet it.")
        self.assertEqual(fake.calls[0]["model"], "claude-sonnet-5-5")
        self.assertEqual(fake.calls[0]["output_config"]["effort"], "low")
        self.assertIn("answer in Hindi", fake.calls[0]["system"][0]["text"])
        self.assertTrue(partials and partials[-1].startswith("Turnover"))
        grounded = fake.calls[0]["messages"][0]["content"]
        self.assertEqual(grounded[0]["source"]["file_id"], "f1")
        self.assertIn("cache_control", grounded[0])
        self.assertEqual(turn.cards[0]["title"], "Prequalification criteria")
        self.assertIn("Ours", turn.cards[0]["columns"])
        first = fake.calls[0]["messages"][2:]  # after the grounding pages
        self.assertEqual([m["role"] for m in first], ["user", "assistant", "user"])  # history starts with a user turn
        second = fake.calls[1]["messages"]
        self.assertEqual(second[-1]["content"][0]["tool_use_id"], "t1")
        self.assertIn("3.4", second[-1]["content"][0]["content"])
        self.assertTrue(all(t.get("strict") for t in fake.calls[0]["tools"]))


class IndianNitTests(unittest.TestCase):
    """Criteria as an 'Eligibility Criteria' paragraph list inside one NIT (e.g. MMRDA)."""

    def setUp(self):
        from fixtures import build_mmrda_style_nit

        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "docs")
        self.nit = build_mmrda_style_nit(self.src)
        self.tender = {"id": 11, "tender_id": "2026_MMRDA_1345405_1", "title": "Flyover",
                       "org_chain": "Mumbai Metropolitan Region Development Authority||Engineering"}

    def test_finds_every_criterion_not_only_jv(self):
        r = agent.analyze_files(self.src, self.tender, new_store(self.tmp), None, PROFILE, log=lambda m: None)
        reqs = " | ".join(c["requirement"] for c in r["criteria"]["criteria"])
        for needle in ("Rs. 45.00 Crore", "Rs. 60.00 Crore", "2AN-B", "net worth", "60% of the qualification"):
            self.assertIn(needle.lower(), reqs.lower())
        turnover = next(c for c in r["criteria"]["criteria"] if "turnover" in c["requirement"].lower()
                        and "45" in c["requirement"])
        self.assertEqual((turnover["metric"], turnover["threshold_inr_cr"], turnover["period_years"]),
                         ("avg_annual_turnover", 45.0, 3))
        self.assertTrue(r["criteria_pages"])
        self.assertEqual(r["pipeline_version"], agent.PIPELINE_VERSION)

    def test_criteria_from_pages_the_user_names(self):
        from bid_agent.docreader import load_document

        doc = load_document(self.nit)
        page = next(p.number for p in doc.pages if "ELIGIBILITY CRITERIA" in p.text)
        name, crit = agent.criteria_from_pages(self.src, "", page, page, new_store(self.tmp), None, lambda m: None)
        self.assertTrue(name.startswith("Tender Document MMRDA"))
        self.assertGreaterEqual(len(crit["criteria"]), 4)
        _name, text, scanned = agent.read_pages(self.src, "mmrda", page, page)
        self.assertIn("ELIGIBILITY CRITERIA", text)
        self.assertFalse(scanned)

    def test_chat_reextracts_from_named_pages_and_keeps_them(self):
        from types import SimpleNamespace as NS

        from bid_agent import chat
        from bid_agent.docreader import load_document

        store = new_store(self.tmp)
        result = agent.analyze_files(self.src, self.tender, store, None, PROFILE, log=lambda m: None)
        result["criteria"] = {"criteria": [{"ref": "a", "subject": "JV", "requirement": "JV only", "forms": []}]}
        saved = {}
        page = next(p.number for p in load_document(self.nit).pages if "ELIGIBILITY CRITERIA" in p.text)
        pages = NS(read=lambda f, a, b: agent.read_pages(self.src, f, a, b),
                   criteria=lambda f, a, b: agent.criteria_from_pages(self.src, f, a, b, store, None, lambda m: None))
        turn = chat.Turn(NS(tender=self.tender), lambda: result, lambda: PROFILE, pages=pages,
                         save_result=lambda r: saved.update(r))
        reply = chat.run_turn(turn, [], f"The eligibility criteria are on page {page}", None)
        self.assertTrue(reply.startswith("Read "), reply)
        self.assertGreaterEqual(len(saved["criteria"]["criteria"]), 4)
        self.assertEqual(saved["criteria_pages"][0]["by"], "user")
        self.assertEqual(turn.cards[0]["title"], "Prequalification criteria")


if __name__ == "__main__":
    unittest.main()
