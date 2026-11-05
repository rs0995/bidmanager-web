"""Apply the Bid Agent to ``Server UI/server`` (run by the server session).

    python bid_agent_server/install.py            # from the repo root
    python bid_agent_server/install.py --dry-run

Idempotent. Follows Server UI/CLAUDE.md:
  * backs up every file it edits to Server UI/restore/<YYYY-MM-DD>/server/ with
    copy-if-missing semantics (never replaces the day's original)
  * appends (never rewrites) a ---- entry to that folder's CHANGES.txt and to
    Server UI/CHANGELOG_PENDING.txt
Edits:
  1. copies bid_agent/ -> Server UI/server/bid_agent/
  2. api_server.py: mounts the client + admin routers just before the final
     _mount_frontend_if_available() call (after require_admin_key exists)
  3. requirements.txt: adds anthropic, pdfplumber, pypdf, python-docx, openpyxl
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SERVER_UI = os.path.join(REPO, "Server UI")
SERVER = os.path.join(SERVER_UI, "server")
MARKER = "# -- Bid Agent (bid packs: section map, qualification criteria, bid forms) --"
SNIPPET = f'''{MARKER}
try:
    import bid_agent.server_routes as _bid_agent_routes

    _bid_client_router, _bid_admin_router = _bid_agent_routes.create_routers(require_admin_key)
    app.include_router(_bid_client_router)
    app.include_router(_bid_admin_router)
except Exception as _bid_agent_error:  # the rest of the API must keep working
    print(f"[bid-agent] disabled: {{_bid_agent_error}}")

'''
REQUIREMENTS = ["anthropic>=2.5.0", "pdfplumber>=0.11.0", "pypdf>=5.0.0", "python-docx>=1.1.0", "openpyxl>=3.1.0"]


def backup(path: str, day_dir: str, dry: bool) -> None:
    rel = os.path.relpath(path, SERVER_UI)
    dest = os.path.join(day_dir, rel)
    if os.path.exists(dest) or not os.path.exists(path):
        return
    print(f"backup  {rel} -> restore/{os.path.basename(day_dir)}/{rel}")
    if not dry:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(path, dest)


def append(path: str, text: str, dry: bool) -> None:
    print(f"append  {os.path.relpath(path, REPO)}")
    if not dry:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--server-dir", default=SERVER, help="override for testing")
    args = ap.parse_args()
    dry = args.dry_run
    server = os.path.abspath(args.server_dir)
    api = os.path.join(server, "api_server.py")
    req = os.path.join(server, "requirements.txt")
    if not os.path.isfile(api):
        print(f"api_server.py not found in {server}")
        return 1
    testing = server != os.path.abspath(SERVER)
    day = datetime.now().strftime("%Y-%m-%d")
    day_dir = os.path.join(SERVER_UI, "restore", day) if not testing else os.path.join(server, "_restore", day)
    changes: list[str] = []

    # 1. package
    src_pkg = os.path.join(HERE, "bid_agent")
    dst_pkg = os.path.join(server, "bid_agent")
    print(f"copy    bid_agent/ -> {os.path.relpath(dst_pkg, REPO) if not testing else dst_pkg}")
    if not dry:
        shutil.copytree(src_pkg, dst_pkg, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "tests"))
    changes.append("server/bid_agent/ (new package: Bid Agent pipeline + /client bid-pack and /admin/bid-agent routes)")

    # 2. api_server.py
    with open(api, encoding="utf-8-sig") as f:
        src = f.read()
    if MARKER in src:
        print("skip    api_server.py already mounts the Bid Agent")
    else:
        anchor = "\n_mount_frontend_if_available()\n"
        idx = src.rfind(anchor)
        if idx < 0:
            print("Could not find the final _mount_frontend_if_available() call; add the snippet by hand:\n" + SNIPPET)
            return 1
        backup(api, day_dir, dry)
        new = src[: idx + 1] + SNIPPET + src[idx + 1:]
        if not dry:
            with open(api, "w", encoding="utf-8", newline="") as f:
                f.write(new)
        changes.append("server/api_server.py: mount bid_agent routers before the SPA catch-all")

    # 3. requirements
    with open(req, encoding="utf-8") as f:
        have = f.read()
    missing = [r for r in REQUIREMENTS if r.split(">=")[0].lower() not in have.lower()]
    if missing:
        backup(req, day_dir, dry)
        if not dry:
            with open(req, "a", encoding="utf-8") as f:
                f.write(("" if have.endswith("\n") else "\n") + "\n".join(missing) + "\n")
        changes.append("server/requirements.txt: " + ", ".join(missing))

    if len(changes) > 1 or (changes and not os.path.isdir(dst_pkg)):
        stamp = datetime.now().strftime("%H:%M")
        entry = f"----\n{stamp} Bid Agent installed (bid_agent_server/install.py)\n" + "".join(f"  - {c}\n" for c in changes)
        append(os.path.join(day_dir, "CHANGES.txt"), entry, dry)
        if not testing:
            append(os.path.join(SERVER_UI, "CHANGELOG_PENDING.txt"),
                   f"----\n{stamp} Bid Agent: bid packs per tender (section map, qualification criteria vs company "
                   f"profile, Word/Excel bid forms). Routes /client/tenders/{{id}}/bid-pack*, /client/company-profile, "
                   f"/admin/bid-agent/*. Needs an Anthropic API key in the console.\n", dry)
    print("done" + (" (dry run)" if dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
