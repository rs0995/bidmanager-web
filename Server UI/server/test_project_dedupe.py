import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent


class ProjectDedupeTests(unittest.TestCase):
    def test_same_tender_project_is_kept_once(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-project-dedupe-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import api_server as api
                    import client_api as ca
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)

                    # 1. The production case: one tender, two project ids.
                    blob = {
                        "projects": [
                            {"id": 15, "title": "FOB Metro 6", "source_tender_id": "2026_MMRDA_1345405_1",
                             "status": "Active", "client_name": ""},
                            {"id": 16, "title": "Other", "source_tender_id": "356726"},
                            {"id": 17, "title": "FOB Metro 6", "source_tender_id": " 2026_mmrda_1345405_1 ",
                             "status": "Submitted", "client_name": "MMRDA"},
                            {"id": 20, "title": "Manual project, no tender"},
                            {"id": 21, "title": "Manual project, no tender"},
                        ],
                        "_v": {"projects": {"15": 100.0, "17": 200.0}},
                        "checklist": [
                            {"id": 1, "project_id": 17, "req_file_name": "BOQ.pdf", "subfolder": ""},
                            {"id": 2, "project_id": 15, "req_file_name": "BOQ.pdf", "subfolder": ""},
                            {"id": 3, "project_id": 16, "req_file_name": "BOQ.pdf", "subfolder": ""},
                            {"id": 4, "project_id": 16, "req_file_name": "BOQ.pdf", "subfolder": ""},
                        ],
                    }
                    out = ca._dedupe_projects(blob)
                    ids = [p["id"] for p in out["projects"]]
                    assert ids == [15, 16, 20, 21], ids                     # earliest id kept, order kept
                    kept = out["projects"][0]
                    assert kept["status"] == "Submitted", kept               # newest copy's values
                    assert kept["client_name"] == "MMRDA", kept
                    cl = out["checklist"]
                    assert [c["project_id"] for c in cl] == [15, 16, 16], cl # moved to 15, one BOQ kept
                    assert out is not blob and blob["projects"][2]["id"] == 17  # input not mutated

                    # 2. Nothing to merge: the same object comes back.
                    clean = {"projects": [{"id": 1, "source_tender_id": "A"}, {"id": 2, "source_tender_id": "B"}]}
                    assert ca._dedupe_projects(clean) is clean

                    # 3. End to end: a second device adds the same tender under a new id.
                    with api.get_db() as conn:
                        stored = {"projects": [{"id": 1, "title": "Road", "source_tender_id": "T-1"}]}
                        incoming = {"projects": [{"id": 1, "title": "Road", "source_tender_id": "T-1"},
                                                 {"id": 2, "title": "Road", "source_tender_id": "T-1"}]}
                        merged = ca._merge_sync_blob(stored, incoming, {}, conn)
                    assert [p["id"] for p in merged["projects"]] == [1], merged["projects"]
                    print("OK")
                """)],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                timeout=180,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
