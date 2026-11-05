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


if __name__ == "__main__":
    unittest.main()
