import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent


class WebsiteUpdateTests(unittest.TestCase):
    def test_update_keeps_children_and_validates(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-website-update-") as tmp:
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
                    from fastapi import HTTPException
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)

                    a = api.create_website(api.WebsiteCreate(name='Portal A', url='https://a.example'))
                    b = api.create_website(api.WebsiteCreate(name='Portal B', url='https://b.example'))
                    with api.get_db() as conn:
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) VALUES (?,'Org A',1,'https://a.example/t')",
                            (a['id'],),
                        )
                        conn.execute(
                            "INSERT INTO tenders (website_id,org_chain,tender_id,title) VALUES (?,'Org A','T-A','Tender A')",
                            (a['id'],),
                        )
                        conn.commit()

                    # Rename + new URLs, in place: children stay attached.
                    out = api.update_website(a['id'], api.WebsiteUpdate(
                        name='  Portal A2 ', url='https://a2.example', status_url='https://a2.example/status',
                    ))
                    assert out == {'id': a['id'], 'name': 'Portal A2', 'url': 'https://a2.example',
                                   'status_url': 'https://a2.example/status'}, out
                    with api.get_db() as conn:
                        assert conn.execute("SELECT COUNT(*) FROM organizations WHERE website_id=?", (a['id'],)).fetchone()[0] == 1
                        assert conn.execute("SELECT COUNT(*) FROM tenders WHERE website_id=?", (a['id'],)).fetchone()[0] == 1

                    # Keeping its own name is fine.
                    api.update_website(a['id'], api.WebsiteUpdate(name='Portal A2', url='https://a3.example'))

                    def status(fn):
                        try:
                            fn()
                        except HTTPException as e:
                            return e.status_code
                        return 200

                    assert status(lambda: api.update_website(a['id'], api.WebsiteUpdate(name='Portal B', url='https://x'))) == 409
                    assert status(lambda: api.update_website(99999, api.WebsiteUpdate(name='Z', url='https://z'))) == 404
                    assert status(lambda: api.update_website(b['id'], api.WebsiteUpdate(name='Portal B', url='  '))) == 400
                    print('OK')
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
