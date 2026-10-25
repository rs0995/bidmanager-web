"""Scraper for the Gujarat (n)Procure portal (https://tender.nprocure.com).

Architecture (very different from NIC/GePNIC):
  * Organisations = client bodies in the home-page ``select#location123`` dropdown (option
    value = client id; class names the client's subdomain, which not every client has in DNS).
  * Listing = ``POST /beforeLoginTenderTableList`` on the main host, filtered with the
    ``clientname1`` = client id search field (DataTables server-side JSON).
    The body must be wrapped in the site's AES layer: AES-128-CBC/PKCS7, key =
    PBKDF2-HMAC-SHA1(pass, salt, 1000 iterations, 16 bytes); the pass travels with it.
  * Detail / documents / amendments are plain form POSTs with ``tenderid`` on the main host.
  * Files are anonymous ``GET /common/download?uid=..&name=..``.
  * No captcha, login or enforced CSRF. Pre-bid replies/minutes are published as
    amendments (corrigenda) and their files are merged into the tender's document list;
    there is no separate pre-bid section.
  * The server omits its intermediate certificate, so requests verify against certifi
    plus the bundled Sectigo intermediate in ``certs/``.

Persistence reuses ScraperBackend helpers unchanged (upsert_tender_row, dedupe,
archive_missing_tenders_for_org, log_downloaded_file, should_skip_file, storage).
"""

import base64
import datetime
import hashlib
import json
import os
import re
import secrets
import string
import tempfile
import threading
import time
from urllib.parse import parse_qs, urljoin, urlparse

import certifi
import requests
from bs4 import BeautifulSoup
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

import app_core as core
import storage_runtime

DEFAULT_BASE_URL = "https://tender.nprocure.com"
LIST_PAGE_SIZE = 500
_PASS_CHARS = string.ascii_letters + string.digits
_CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs")
_ca_bundle_lock = threading.Lock()
_ca_bundle_cached = None


# ---------------------------------------------------------------------------
# Request wrapper (the site's "encryption")
# ---------------------------------------------------------------------------

def _derive_key(password: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA1(), length=16, salt=salt, iterations=1000).derive(
        password.encode("utf-8")
    )


def encrypt_request(inner, *, password=None, iv=None, salt=None):
    password = password or "".join(secrets.choice(_PASS_CHARS) for _ in range(5))
    iv = iv or secrets.token_bytes(16)
    salt = salt or secrets.token_bytes(16)
    padder = padding.PKCS7(128).padder()
    data = padder.update(json.dumps(inner, separators=(",", ":")).encode("utf-8")) + padder.finalize()
    encryptor = Cipher(algorithms.AES(_derive_key(password, salt)), modes.CBC(iv)).encryptor()
    cipher_text = encryptor.update(data) + encryptor.finalize()
    return {
        "jsonData": base64.b64encode(cipher_text).decode("ascii"),
        "iv": iv.hex(),
        "salt": salt.hex(),
        "key": base64.b64encode(password.encode("utf-8")).decode("ascii"),
    }


def decrypt_request(body):
    password = base64.b64decode(body["key"]).decode("utf-8")
    key = _derive_key(password, bytes.fromhex(body["salt"]))
    decryptor = Cipher(algorithms.AES(key), modes.CBC(bytes.fromhex(body["iv"]))).decryptor()
    padded = decryptor.update(base64.b64decode(body["jsonData"])) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return json.loads(unpadder.update(padded) + unpadder.finalize())


def build_list_inner(start, length=LIST_PAGE_SIZE, echo=1):
    return {
        "reqData": [
            {"name": "sEcho", "value": int(echo)},
            {"name": "iColumns", "value": 3},
            {"name": "iDisplayStart", "value": int(start)},
            {"name": "iDisplayLength", "value": int(length)},
            {"name": "SEARCH", "value": "ADV"},
        ],
        "_csrf": "",
        "idList": "0",
        "id": "Tenders In Progress",
    }


# ---------------------------------------------------------------------------
# Value normalisation
# ---------------------------------------------------------------------------

def _clean(text):
    return " ".join(str(text or "").replace("\xa0", " ").split()).strip()


def normalize_date(raw):
    """'30-10-2026 18:00[:00]' -> '30-Oct-2026 06:00 PM' (the NIC listing format)."""
    txt = _clean(raw)
    if not txt or txt.upper() in {"N/A", "NA", "-", "--"}:
        return "N/A"
    for fmt in ("%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(txt, fmt).strftime("%d-%b-%Y %I:%M %p")
        except ValueError:
            continue
    try:
        return datetime.datetime.strptime(txt, "%d-%m-%Y").strftime("%d-%b-%Y")
    except ValueError:
        return txt


def _indian_group(int_part: str) -> str:
    if len(int_part) <= 3:
        return int_part
    head, tail = int_part[:-3], int_part[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups + [tail])


def format_amount(raw):
    """'4301691.00' / '43,017 INR. ( )' -> '43,01,691' / '43,017'. Unknown -> 'N/A'."""
    match = re.search(r"\d[\d,]*(?:\.\d+)?", _clean(raw))
    if not match:
        return "N/A"
    number = match.group(0).replace(",", "")
    int_part, _, frac = number.partition(".")
    int_part = int_part.lstrip("0") or "0"
    out = _indian_group(int_part)
    if frac.strip("0"):
        return f"{out}.{(frac + '00')[:2]}"
    return out


def _safe_file_name(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', "", _clean(name))
    return cleaned or "document"


# ---------------------------------------------------------------------------
# Parsers (pure)
# ---------------------------------------------------------------------------

def parse_client_dropdown(html):
    """Clients from the home page: [{'name', 'count', 'base_url'}]."""
    soup = BeautifulSoup(html or "", "html.parser")
    select = soup.find("select", id="location123")
    clients = []
    if not select:
        return clients
    for option in select.find_all("option"):
        base_url = ""
        for cls in option.get("class") or []:
            if cls.startswith("subDomainName_"):
                base_url = cls[len("subDomainName_"):]
                break
        if not base_url:
            continue
        parsed = urlparse(base_url)
        netloc = parsed.netloc[:-4] if parsed.netloc.endswith(":443") else parsed.netloc
        base_url = f"{parsed.scheme or 'https'}://{netloc}".rstrip("/")
        label = _clean(option.get_text(" "))
        count_match = re.search(r"\((\d+)\)\s*$", label)
        count = int(count_match.group(1)) if count_match else 0
        name = _clean(re.sub(r"\(\d+\)\s*$", "", label))
        if name and all(c["name"] != name for c in clients):
            clients.append({
                "name": name, "count": count, "base_url": base_url,
                "client_id": str(option.get("value") or "").strip(),
            })
    return clients


def _cell_text(html):
    html = str(html or "")
    if "<" not in html:
        return _clean(html)
    return _clean(BeautifulSoup(html, "html.parser").get_text(" "))


def parse_list_rows(payload):
    """(total_records, [row dict]) from a beforeLoginTenderTableList response."""
    data = payload if isinstance(payload, dict) else json.loads(payload)
    total = int(data.get("iTotalRecords") or data.get("recordsTotal") or 0)
    rows = []
    for item in data.get("data") or []:
        cell = str(item.get("2") or "")
        soup = BeautifulSoup(cell, "html.parser")
        id_input = soup.find("input", attrs={"name": "tenderid"})
        tender_id = str(id_input.get("value") or "").strip() if id_input else ""
        if not tender_id:
            match = re.search(r"Tender Id\s*:\s*(\d+)", cell)
            tender_id = match.group(1) if match else ""
        if not tender_id:
            continue
        office = ""
        first_span = soup.find("span")
        if first_span is not None:
            office = _clean(next((s for s in first_span.strings), ""))
        title = ""
        label = soup.find("strong", string=re.compile(r"Name Of Work", re.I))
        if label is not None:
            anchor = label.find_parent("a") or label.parent
            title = _clean(anchor.get_text(" ").replace(label.get_text(), "", 1))
        has_amendment = False
        amendment_label = ""
        for anchor in soup.find_all("a"):
            text = _clean(anchor.get_text(" "))
            if not text.lower().startswith("corrigendum"):
                continue
            style = str(anchor.get("style") or "").replace(" ", "").lower()
            has_amendment = "display:none" not in style
            amendment_label = _clean(text.split(":", 1)[1]) if ":" in text else ""
            break
        text = soup.get_text("\n")
        value_match = re.search(r"Estimated Contract Value[ \t]*:[ \t]*([^\n]*)", text)
        closing_match = re.search(r"Last Date\s*&\s*Time For Submission[ \t]*:[ \t]*([^\n]*)", text)
        docs_match = re.search(r"Total No\s*:\s*(\d+)", _cell_text(item.get("3")))
        rows.append({
            "tender_id": tender_id,
            "notice_no": _cell_text(item.get("1")),
            "office": office,
            "title": title,
            "est_value": _clean(value_match.group(1)) if value_match else "",
            "closing_raw": _clean(closing_match.group(1)) if closing_match else "",
            "has_amendment": has_amendment,
            "amendment_label": amendment_label if has_amendment else "",
            "doc_count": int(docs_match.group(1)) if docs_match else 0,
        })
    return total, rows


def _norm_label(text):
    return _clean(text).lower().rstrip(":").strip()


def parse_label_pairs(html):
    """Detail page label -> value (labels lower-cased, whitespace collapsed).

    Also returns '_stage_dates': evaluation dates of the 'Stage Name' table in order.
    """
    soup = BeautifulSoup(html or "", "html.parser")
    pairs = {}
    stage_dates = []
    in_stage_table = False
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"], recursive=False)
        texts = [_clean(c.get_text(" ")) for c in cells]
        if not texts:
            continue
        if texts[0].lower() == "stage name":
            in_stage_table = True
            continue
        if in_stage_table:
            if len(texts) == 3 and texts[0].lower().endswith("stage"):
                stage_dates.append(texts[1])
                continue
            in_stage_table = False
        if len(texts) in (2, 4):
            for index in range(0, len(texts), 2):
                label = _norm_label(texts[index])
                if label and label not in pairs:
                    pairs[label] = texts[index + 1]
    pairs["_stage_dates"] = stage_dates
    return pairs


def _pick(pairs, prefixes, exclude=()):
    for label, value in pairs.items():
        if label.startswith("_"):
            continue
        if any(label.startswith(p) for p in prefixes) and not any(x in label for x in exclude):
            if _clean(value):
                return _clean(value)
    return ""


def parse_document_links(html, base_url=DEFAULT_BASE_URL):
    """[(file_name, absolute_url, uid)] from a /view-nit-document page, de-duplicated."""
    soup = BeautifulSoup(html or "", "html.parser")
    out = []
    seen_urls = set()
    seen_names = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if "/common/download" not in href:
            continue
        url = urljoin(base_url + "/", href)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        query = parse_qs(urlparse(url).query)
        uid = (query.get("uid") or [""])[0]
        name = _safe_file_name((query.get("name") or [""])[0] or anchor.get_text(" "))
        if name.lower() in seen_names:
            stem, ext = os.path.splitext(name)
            name = f"{stem}_{uid[:8]}{ext}"
        seen_names.add(name.lower())
        out.append((name, url, uid))
    return out


def parse_amendments(html):
    """[{'amendment_id', 'subject', 'date'}] from a /view-nit-amendment page."""
    soup = BeautifulSoup(html or "", "html.parser")
    out = []
    for form in soup.find_all("form", action=re.compile(r"view-amendment-home")):
        field = form.find("input", attrs={"name": "tenderamendmentid"})
        amendment_id = str(field.get("value") or "").strip() if field else ""
        if not amendment_id:
            continue
        row = form.find_parent("tr")
        cells = [_clean(td.get_text(" ")) for td in row.find_all("td", recursive=False)] if row else []
        out.append({
            "amendment_id": amendment_id,
            "subject": cells[2] if len(cells) > 2 else "",
            "date": cells[3] if len(cells) > 3 else "",
        })
    return out


def parse_amendment_document_names(html):
    """File names listed on one /view-amendment-home page (its 'Document Name' table)."""
    soup = BeautifulSoup(html or "", "html.parser")
    names = []
    in_docs = False
    for tr in soup.find_all("tr"):
        texts = [_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"], recursive=False)]
        if not texts:
            continue
        if len(texts) >= 2 and texts[0].lower().startswith("sr") and texts[1].lower() == "document name":
            in_docs = True
            continue
        if in_docs:
            if len(texts) >= 2 and texts[0].isdigit():
                names.append(_safe_file_name(texts[1]))
                continue
            in_docs = False
    return names


def detail_fields(pairs):
    """Map parsed detail labels onto tender columns (values already normalised)."""
    pre_bid_raw = _pick(pairs, ["pre-bid meeting"], exclude=("mode",))
    pre_bid = normalize_date(pre_bid_raw) if re.search(r"\d{2}-\d{2}-\d{4}", pre_bid_raw) else "N/A"
    stage_dates = [d for d in pairs.get("_stage_dates") or [] if _clean(d)]
    return {
        "title": _pick(pairs, ["tender title", "tender title/name of project"]),
        "work_description": _pick(pairs, ["description of material", "description"]),
        "tender_value": format_amount(_pick(pairs, ["estimated cost value"])),
        "emd": format_amount(_pick(pairs, ["bid security/emd"], exclude=("payable",))),
        "closing_date": normalize_date(_pick(pairs, ["bid submission closing date"])),
        "opening_date": normalize_date(stage_dates[0]) if stage_dates else "N/A",
        "published_date": normalize_date(_pick(pairs, ["bid submission start date"])),
        "pre_bid_meeting_date": pre_bid,
        "location": _pick(pairs, ["location"]) or "N/A",
        "tender_category": _pick(pairs, ["tender category"]) or "N/A",
    }


def listing_signature(row):
    raw = "|".join(str(row.get(k, "")) for k in (
        "closing_raw", "est_value", "title", "amendment_label", "doc_count", "notice_no",
    ))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def tender_url_for(base_url, tender_id):
    return f"{base_url.rstrip('/')}/view-nit-home?tenderid={tender_id}"


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _ca_bundle():
    """certifi + bundled intermediates, written once to a temp file (requests needs a path)."""
    global _ca_bundle_cached
    override = str(os.getenv("NPROCURE_CA_BUNDLE") or "").strip()
    if override and os.path.isfile(override):
        return override
    with _ca_bundle_lock:
        if _ca_bundle_cached and os.path.isfile(_ca_bundle_cached):
            return _ca_bundle_cached
        parts = [open(certifi.where(), "rb").read()]
        for name in sorted(os.listdir(_CERT_DIR)):
            if name.endswith(".pem"):
                parts.append(open(os.path.join(_CERT_DIR, name), "rb").read())
        blob = b"\n".join(parts)
        path = os.path.join(
            tempfile.gettempdir(), f"bidmanager_nprocure_ca_{hashlib.sha1(blob).hexdigest()[:12]}.pem"
        )
        if not os.path.isfile(path):
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "wb") as handle:
                handle.write(blob)
            os.replace(tmp, path)
        _ca_bundle_cached = path
        return path


class Client:
    """One polite, TLS-fixed HTTP session for a job."""

    def __init__(self, base_url=DEFAULT_BASE_URL):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.session = core._new_scraper_session() or requests.Session()
        self.session.verify = _ca_bundle()
        self.delay_s = core.setting_int("nprocure_request_delay_ms", 600, minimum=0, maximum=10000) / 1000.0
        self.attempts = core.setting_int("retry_attempts", 3, minimum=1, maximum=10)
        self.backoff_s = core.setting_int("retry_backoff_s", 3, minimum=0, maximum=300)
        self.timeout_s = core.setting_int("page_load_timeout_s", 45, minimum=5, maximum=300)
        self._last_request_at = 0.0
        self.request_count = 0

    def _pace(self):
        wait = self.delay_s - (time.time() - self._last_request_at)
        if wait > 0:
            time.sleep(wait)

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", self.timeout_s)
        last_error = None
        for attempt in range(1, self.attempts + 1):
            core.check_job_cancelled()
            self._pace()
            try:
                self.request_count += 1
                response = self.session.request(method, url, **kwargs)
            except requests.exceptions.SSLError as exc:
                core.log_to_gui(
                    "nProcure TLS verification failed — the portal's certificate chain may have "
                    "changed; update scrapers/certs (or set NPROCURE_CA_BUNDLE)."
                )
                raise
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_error = exc
            else:
                if response.status_code < 400:
                    return response
                if response.status_code != 429 and response.status_code < 500:
                    response.raise_for_status()
                last_error = requests.HTTPError(f"HTTP {response.status_code} for {url}")
            finally:
                self._last_request_at = time.time()
            if attempt < self.attempts:
                time.sleep(self.backoff_s * attempt)
        raise last_error

    def list_page(self, client_id, start, length=LIST_PAGE_SIZE, host_url=None):
        """One listing page for a client: main host + clientname1 filter, or (legacy,
        no client id known) the client's own subdomain unfiltered."""
        inner = build_list_inner(start, length)
        if client_id:
            inner["reqData"].append({"name": "clientname1", "value": str(client_id)})
        response = self.request(
            "POST",
            f"{(host_url or self.base_url).rstrip('/')}/beforeLoginTenderTableList",
            json=encrypt_request(inner),
        )
        return parse_list_rows(response.text)

    def tender_page(self, path, tender_id):
        response = self.request(
            "POST", f"{self.base_url}/{path}", data={"tenderid": str(tender_id), "_csrf": "token"}
        )
        return response.text

    def amendment_page(self, amendment_id):
        response = self.request(
            "POST", f"{self.base_url}/view-amendment-home",
            data={"tenderamendmentid": str(amendment_id), "tempFlag": "2"},
        )
        return response.text


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _connect():
    return core.sqlite3.connect(core.DB_FILE)


def ensure_tables(conn=None):
    """Module-owned tables: client ids per organisation, and per-tender listing state
    (so unchanged tenders skip the detail POST)."""
    owns = conn is None
    conn = conn or _connect()
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS nprocure_clients (
                website_id INTEGER NOT NULL,
                org_name TEXT NOT NULL,
                client_id TEXT NOT NULL,
                PRIMARY KEY (website_id, org_name)
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS nprocure_listing_state (
                website_id INTEGER NOT NULL,
                tender_id TEXT NOT NULL,
                signature TEXT,
                detail_fetched_at REAL,
                PRIMARY KEY (website_id, tender_id)
            )"""
        )
        conn.commit()
    finally:
        if owns:
            conn.close()


def _website(website_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT id, name, url FROM websites WHERE id=?", (int(website_id),)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    url = str(row[2] or "").strip() or DEFAULT_BASE_URL
    parsed = urlparse(url)
    base = f"{parsed.scheme or 'https'}://{parsed.netloc}" if parsed.netloc else DEFAULT_BASE_URL
    return {"id": int(row[0]), "name": str(row[1] or ""), "base_url": base.rstrip("/")}


# ---------------------------------------------------------------------------
# Organisations
# ---------------------------------------------------------------------------

def fetch_organisations(website_id):
    site = _website(website_id)
    if not site:
        core.log_to_gui(f"Website {website_id} not found.")
        return False
    core.log_to_gui(f"Fetching nProcure clients from {site['base_url']}...")
    try:
        client = Client(site["base_url"])
        html = client.request("GET", site["base_url"] + "/").text
        clients = parse_client_dropdown(html)
        if not clients:
            core.log_to_gui("Could not find the nProcure client list on the home page.")
            return False
        now = time.time()
        ensure_tables()
        conn = _connect()
        try:
            for entry in clients:
                if entry["client_id"]:
                    conn.execute(
                        "DELETE FROM nprocure_clients WHERE website_id=? AND org_name=?", (site["id"], entry["name"])
                    )
                    conn.execute(
                        "INSERT INTO nprocure_clients (website_id, org_name, client_id) VALUES (?, ?, ?)",
                        (site["id"], entry["name"], entry["client_id"]),
                    )
                existing = conn.execute(
                    "SELECT id FROM organizations WHERE website_id=? AND name=?",
                    (site["id"], entry["name"]),
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE organizations SET tender_count=?, tenders_url=?, is_available=1, last_seen_at=? "
                        "WHERE id=?",
                        (entry["count"], entry["base_url"], now, existing[0]),
                    )
                else:
                    conn.execute(
                        "INSERT INTO organizations (website_id, name, tender_count, tenders_url, is_available, "
                        "last_seen_at) VALUES (?, ?, ?, ?, 1, ?)",
                        (site["id"], entry["name"], entry["count"], entry["base_url"], now),
                    )
            names = [entry["name"] for entry in clients]
            placeholders = ",".join("?" for _ in names)
            conn.execute(
                f"UPDATE organizations SET is_available=0 WHERE website_id=? AND name NOT IN ({placeholders})",
                (site["id"], *names),
            )
            conn.commit()
        finally:
            conn.close()
        core.log_to_gui(f"Updated {len(clients)} organizations for {site['name']}")
        return True
    except core.JobCancelledError:
        raise
    except Exception as exc:
        core.log_to_gui(f"Error fetching nProcure clients: {exc}")
        return False


# ---------------------------------------------------------------------------
# Tenders
# ---------------------------------------------------------------------------

_DETAIL_COLUMNS = (
    "title", "tender_value", "emd", "closing_date", "opening_date", "location",
    "tender_category", "pre_bid_meeting_date", "published_date", "work_description",
)


def _selected_orgs(conn, website_id, org_ids):
    ids = []
    for value in org_ids or []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    if ids:
        placeholders = ",".join("?" for _ in ids)
        return conn.execute(
            f"SELECT id, name, tenders_url FROM organizations WHERE website_id=? AND id IN ({placeholders})",
            (website_id, *ids),
        ).fetchall()
    return conn.execute(
        "SELECT id, name, tenders_url FROM organizations WHERE website_id=? AND is_selected=1",
        (website_id,),
    ).fetchall()


def _list_all(client, client_id, org_url):
    """(rows, complete) for one client; complete is False when the listing came back short."""
    rows = []
    total = None
    start = 0
    while True:
        page_total, page_rows = client.list_page(client_id, start, host_url=None if client_id else org_url)
        total = page_total if total is None else total
        rows.extend(page_rows)
        start += LIST_PAGE_SIZE
        if not page_rows or start >= (total or 0):
            break
    unique = {row["tender_id"]: row for row in rows}
    return list(unique.values()), len(unique) >= int(total or 0)


def _build_tuple(website_id, org_name, base_url, row, details, existing, corrigendum_count):
    """upsert_tender_row tuple: listing values first, then detail page, then stored values."""
    previous = existing or {}
    details = details or {}

    def choose(column, listing_value=None):
        for candidate in (listing_value, details.get(column), previous.get(column)):
            if candidate and candidate != "N/A":
                return candidate
        return "N/A"

    title = choose("title", row["title"])
    work_description = choose("work_description")
    return (
        website_id,
        org_name,
        row["tender_id"],
        title,
        choose("tender_value", format_amount(row["est_value"])),
        choose("emd"),
        choose("closing_date", normalize_date(row["closing_raw"])),
        choose("opening_date"),
        tender_url_for(base_url, row["tender_id"]),
        choose("location"),
        choose("tender_category"),
        choose("pre_bid_meeting_date"),
        choose("published_date"),
        title if work_description == "N/A" else work_description,
        0,
        corrigendum_count,
    )


def _save_isolated(conn, fn):
    try:
        conn.execute("SAVEPOINT nprocure_row")
    except Exception:
        return True, fn()
    try:
        result = fn()
    except Exception as exc:
        try:
            conn.execute("ROLLBACK TO SAVEPOINT nprocure_row")
            conn.execute("RELEASE SAVEPOINT nprocure_row")
        except Exception:
            conn.rollback()
        return False, exc
    conn.execute("RELEASE SAVEPOINT nprocure_row")
    return True, result


def fetch_tenders(website_id, org_ids=None, force_detail_ids=None):
    site = _website(website_id)
    if not site:
        core.log_to_gui(f"Website {website_id} not found.")
        return False
    ensure_tables()
    conn = _connect()
    try:
        selected = _selected_orgs(conn, site["id"], org_ids)
    except Exception:
        conn.close()
        raise
    if not selected:
        core.log_to_gui("No organizations selected. Please select organizations first.")
        conn.close()
        return None

    force_detail_ids = {str(x) for x in (force_detail_ids or [])}
    detail_budget = core.setting_int("nprocure_detail_max_per_run", 400, minimum=1, maximum=100000)
    client = Client(site["base_url"])
    db_errors = 0
    fully_listed = {}
    failed_orgs = []
    client_ids = dict(conn.execute(
        "SELECT org_name, client_id FROM nprocure_clients WHERE website_id=?", (site["id"],)
    ).fetchall())
    try:
        for org_id, org_name, org_url in selected:
            org_url = str(org_url or "").strip()
            client_id = str(client_ids.get(org_name) or "")
            if not client_id and not org_url:
                core.log_to_gui(f"No client id stored for {org_name}; refresh organizations first.")
                failed_orgs.append(org_name)
                continue
            core.log_to_gui(f"Scraping tenders for: {org_name}")
            try:
                rows, complete = _list_all(client, client_id, org_url)
            except core.JobCancelledError:
                raise
            except Exception as exc:
                core.log_to_gui(f"Error listing tenders for {org_name}: {exc}")
                failed_orgs.append(org_name)
                continue

            existing = {}
            for record in conn.execute(
                "SELECT tender_id, " + ", ".join(_DETAIL_COLUMNS) + " FROM tenders WHERE website_id=? AND org_chain=?",
                (site["id"], org_name),
            ).fetchall():
                existing[str(record[0])] = dict(zip(_DETAIL_COLUMNS, [str(v or "") for v in record[1:]]))
            state = {
                str(r[0]): (str(r[1] or ""), r[2])
                for r in conn.execute(
                    "SELECT tender_id, signature, detail_fetched_at FROM nprocure_listing_state WHERE website_id=?",
                    (site["id"],),
                ).fetchall()
            }

            counts = {"inserted": 0, "updated": 0, "unchanged": 0}
            details_fetched = 0
            for row in rows:
                tender_id = row["tender_id"]
                signature = listing_signature(row)
                stored_sig, fetched_at = state.get(tender_id, ("", None))
                needs_detail = (
                    tender_id not in existing or stored_sig != signature or not fetched_at
                    or tender_id in force_detail_ids
                )
                details = None
                corrigendum_count = None if row["has_amendment"] else 0
                new_state = False
                if needs_detail and detail_budget > 0:
                    try:
                        details = detail_fields(parse_label_pairs(client.tender_page("view-nit-home", tender_id)))
                        if row["has_amendment"]:
                            corrigendum_count = len(parse_amendments(
                                client.tender_page("view-nit-amendment", tender_id)
                            ))
                        detail_budget -= 1
                        details_fetched += 1
                        new_state = True
                    except core.JobCancelledError:
                        raise
                    except Exception as exc:
                        core.log_to_gui(f"  Detail fetch failed for {tender_id}: {exc}")
                        details = None
                tender_tuple = _build_tuple(
                    site["id"], org_name, site["base_url"], row, details, existing.get(tender_id), corrigendum_count,
                )

                def _write(tender_tuple=tender_tuple, row=row, signature=signature, new_state=new_state):
                    outcome = core.ScraperBackend.upsert_tender_row(conn, tender_tuple)
                    if row["notice_no"]:
                        conn.execute(
                            "UPDATE tenders SET tender_ref_no=? WHERE website_id=? AND normalized_tender_id=?",
                            (row["notice_no"], site["id"], core.ScraperBackend.canonical_tender_id(row["tender_id"])),
                        )
                    if new_state:
                        conn.execute(
                            "DELETE FROM nprocure_listing_state WHERE website_id=? AND tender_id=?",
                            (site["id"], row["tender_id"]),
                        )
                        conn.execute(
                            "INSERT INTO nprocure_listing_state (website_id, tender_id, signature, detail_fetched_at) "
                            "VALUES (?, ?, ?, ?)",
                            (site["id"], row["tender_id"], signature, time.time()),
                        )
                    return outcome

                ok, outcome = _save_isolated(conn, _write)
                if ok:
                    counts[outcome if outcome in counts else "unchanged"] += 1
                else:
                    db_errors += 1
                    core.log_to_gui(f"Upsert failed for tender '{tender_id}': {outcome}")
            conn.commit()
            core.log_to_gui(
                f"  {org_name}: {len(rows)} listed, inserted={counts['inserted']}, updated={counts['updated']}, "
                f"unchanged={counts['unchanged']}, detail pages={details_fetched}"
            )
            if detail_budget <= 0:
                core.log_to_gui("  Detail-page budget for this run is used up; remaining tenders fill in next run.")

            if complete:
                fully_listed[org_name] = {row["tender_id"] for row in rows}
            else:
                core.log_to_gui(f"  Listing for {org_name} came back incomplete; stale-archive skipped.")
            org_row = conn.execute(
                "SELECT COALESCE(scrape_enabled,0), COALESCE(scrape_interval_minutes,0) FROM organizations WHERE id=?",
                (org_id,),
            ).fetchone()
            if org_row and int(org_row[0]) == 1 and int(org_row[1]) > 0:
                now = time.time()
                conn.execute(
                    "UPDATE organizations SET next_scrape_at=?, last_scraped_at=? WHERE id=?",
                    (now + int(org_row[1]) * 60, now, org_id),
                )
                conn.commit()

        ok, removed = _save_isolated(conn, lambda: core.ScraperBackend.dedupe_tenders_for_website(conn, site["id"]))
        archived = 0
        for org_name, seen_ids in fully_listed.items():
            archived += core.ScraperBackend.archive_missing_tenders_for_org(conn, site["id"], org_name, seen_ids)
            conn.execute(
                "UPDATE organizations SET last_scraped_at=? WHERE website_id=? AND name=?",
                (time.time(), site["id"], org_name),
            )
        conn.commit()
        if ok and removed:
            core.log_to_gui(f"Post-scrape dedupe removed {removed} duplicate rows.")
        if archived:
            core.log_to_gui(f"Auto-archived {archived} stale tenders no longer present in latest scrape.")
        if failed_orgs:
            core.log_to_gui(f"Skipped stale-archive for failed org scrape(s): {', '.join(sorted(failed_orgs))}")
        if db_errors:
            core.log_to_gui(
                f"Tender fetching finished with {db_errors} database error(s) — some tenders "
                "may not have been saved. Check the connection and re-run."
            )
            return False
        core.log_to_gui(f"Tender fetching complete ({client.request_count} portal requests).")
        return True
    finally:
        conn.close()


def refresh_details(website_id, target_db_ids):
    """Re-read the detail pages of specific tenders by re-scraping their clients."""
    ids = []
    for value in target_db_ids or []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    if not ids:
        core.log_to_gui("No tenders were selected for refresh.")
        return False
    conn = _connect()
    try:
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT t.tender_id, o.id FROM tenders t JOIN organizations o ON o.website_id=t.website_id "
            f"AND LOWER(TRIM(COALESCE(o.name,'')))=LOWER(TRIM(COALESCE(t.org_chain,''))) "
            f"WHERE t.website_id=? AND t.id IN ({placeholders})",
            (int(website_id), *ids),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        core.log_to_gui("Could not identify the organization for the selected tender(s). Refresh organizations first.")
        return False
    result = fetch_tenders(
        website_id,
        org_ids=sorted({int(r[1]) for r in rows}),
        force_detail_ids={str(r[0]) for r in rows},
    )
    return result is True


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------

def _save_dir(tender_id, existing_folder):
    safe_id = re.sub(r'[\\/*?:"<>|]', "", str(tender_id))
    preferred = os.path.join(core.BASE_DOWNLOAD_DIRECTORY, safe_id)
    existing = str(existing_folder or "").strip()
    save_dir = preferred
    if existing:
        try:
            if os.path.normcase(os.path.abspath(existing)) == os.path.normcase(os.path.abspath(preferred)):
                save_dir = existing
        except Exception:
            pass
    os.makedirs(save_dir, exist_ok=True)
    return save_dir


def _allowed_extensions():
    raw = core.ScraperBackend.get_setting("allowed_extensions", "pdf, zip, rar, xls, xlsx, doc, docx") or ""
    return {item.strip().lower().lstrip(".") for item in str(raw).split(",") if item.strip()}


def _download_file(client, url, file_path, tender_id, file_type):
    """Same storage/ledger behaviour as ScraperBackend.download_file_with_requests, over our session."""
    storage_runtime.require_durable_cloud_storage()
    storage = storage_runtime.active_document_storage()
    extension = os.path.splitext(file_path)[1].lower().lstrip(".")
    allowed = _allowed_extensions()
    if extension and allowed and extension not in allowed:
        core.log_to_gui(f"Download blocked by allowed_extensions: {os.path.basename(file_path)}")
        return False
    max_bytes = core.setting_int("max_file_size_mb", 80, minimum=1, maximum=2048) * 1024 * 1024
    fetched_ok = False
    try:
        response = client.request("GET", url, stream=True, timeout=120)
        content_length = int(response.headers.get("Content-Length") or 0)
        if content_length > max_bytes:
            core.log_to_gui(f"Download blocked by max_file_size_mb: {os.path.basename(file_path)} ({content_length} bytes)")
            return False
        written = 0
        digest = hashlib.sha256()
        with open(file_path, "wb") as handle:
            for chunk in response.iter_content(chunk_size=8192):
                core.check_job_cancelled()
                written += len(chunk)
                if written > max_bytes:
                    raise ValueError(f"File exceeds configured maximum of {max_bytes // (1024 * 1024)} MB")
                handle.write(chunk)
                digest.update(chunk)
        fetched_ok = True
        digest_hex = digest.hexdigest()
        reference = core.ScraperBackend.downloaded_content_reference(tender_id, digest_hex)
        if reference:
            remove_local = bool(
                storage.remote
                or os.path.normcase(os.path.abspath(file_path)) != os.path.normcase(os.path.abspath(reference))
            )
        else:
            last_error = None
            stored = None
            for attempt in range(3):
                try:
                    stored = storage.persist(
                        file_path, str(tender_id), file_type,
                        core.ScraperBackend.get_setting("storage_prefix", "tenders/"),
                    )
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt < 2:
                        time.sleep(2)
            if last_error is not None:
                raise last_error
            reference = stored.reference
            remove_local = stored.remove_local_copy
        core.ScraperBackend.log_downloaded_file(
            tender_id, os.path.basename(file_path), file_type=file_type, source_url=url,
            local_path=reference, content_sha256=digest_hex, file_size_bytes=written,
        )
        if remove_local and os.path.isfile(file_path):
            os.remove(file_path)
        return True
    except core.JobCancelledError:
        if os.path.isfile(file_path):
            os.remove(file_path)
        raise
    except Exception as exc:
        if os.path.isfile(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass
        verb = "Fetched but could not store" if fetched_ok else "Download failed for"
        core.log_to_gui(f"{verb} {os.path.basename(file_path)}: {exc}")
        return False


def _record_result(tender_db_id, tender_id, folder_path, complete, any_new, corrigendum_count):
    storage = storage_runtime.active_document_storage()
    durable_folder = storage.folder_reference(
        folder_path, str(tender_id), core.ScraperBackend.get_setting("storage_prefix", "tenders/"),
    )
    now = time.time()
    now_iso = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
    conn = _connect()
    try:
        old = conn.execute("SELECT corrigendum_count FROM tenders WHERE id=?", (int(tender_db_id),)).fetchone()
        if corrigendum_count is not None:
            conn.execute(
                "UPDATE tenders SET corrigendum_count=? WHERE id=?", (int(corrigendum_count), int(tender_db_id))
            )
            core.ScraperBackend._record_field_change_if_different(
                conn, int(tender_db_id), "corrigendum_count", old[0] if old else None, int(corrigendum_count),
            )
        conn.execute(
            "UPDATE tenders SET folder_path=?, download_status=?, "
            "is_downloaded=CASE WHEN ?=1 THEN 1 ELSE COALESCE(is_downloaded,0) END, "
            "initial_download_completed_at=CASE WHEN ?=1 THEN COALESCE(initial_download_completed_at,?) "
            "ELSE initial_download_completed_at END, last_update_checked_at=?, "
            "last_downloaded_at=CASE WHEN ?=1 OR ?=1 THEN ? ELSE last_downloaded_at END, "
            "last_dl_prebid_count=0, last_dl_corrigendum_count=COALESCE(corrigendum_count,0), "
            "last_download_error='' WHERE id=?",
            (
                durable_folder, "complete" if complete else "partial", 1 if complete else 0,
                1 if complete else 0, now, now, 1 if complete else 0, 1 if any_new else 0, now_iso,
                int(tender_db_id),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _download_one(client, db_id, tender_id, existing_folder):
    save_dir = _save_dir(tender_id, existing_folder)
    core.log_to_gui(f"Processing: {tender_id}...")
    try:
        files = parse_document_links(client.tender_page("view-nit-document", tender_id), client.base_url)
        amendments = parse_amendments(client.tender_page("view-nit-amendment", tender_id))
        corrigendum_names = set()
        for amendment in amendments:
            names = parse_amendment_document_names(client.amendment_page(amendment["amendment_id"]))
            corrigendum_names.update(name.lower() for name in names)
        if not files:
            core.log_to_gui(f"  No documents listed on the portal for {tender_id}.")
        present = 0
        any_new = False
        for file_name, url, _uid in files:
            file_type = "corrigendum" if file_name.lower() in corrigendum_names else "document"
            file_path = os.path.join(save_dir, file_name)
            if core.ScraperBackend.should_skip_file(tender_id, file_name, file_path, source_url=url, file_type=file_type):
                present += 1
                continue
            if _download_file(client, url, file_path, tender_id, file_type):
                present += 1
                any_new = True
                label = "Corrigendum" if file_type == "corrigendum" else "Document"
                core.log_to_gui(f"    Downloaded {label}: {file_name}")
        complete = bool(files) and present == len(files)
        _record_result(db_id, tender_id, save_dir, complete, any_new, len(amendments))
        return True
    except core.JobCancelledError:
        raise
    except Exception as exc:
        core.log_to_gui(f"Error downloading {tender_id}: {exc}")
        conn = _connect()
        try:
            conn.execute(
                "UPDATE tenders SET download_status='failed', last_update_checked_at=?, last_download_error=? "
                "WHERE id=?",
                (time.time(), str(exc), int(db_id)),
            )
            conn.commit()
        finally:
            conn.close()
        return False
    finally:
        storage_runtime.cleanup_scratch_folder(save_dir)


def download_tenders(website_id, target_db_ids=None, forced_mode=None, include_all=False):
    """Same target rules as ScraperBackend.download_tenders_logic. Every mode lists the
    portal's files and fetches whatever is not stored yet ('redownload' re-fetches all)."""
    storage_runtime.require_durable_cloud_storage()
    core.ScraperBackend.ensure_download_tables()
    site = _website(website_id)
    if not site:
        core.log_to_gui(f"Website {website_id} not found.")
        return False
    ids = []
    for value in target_db_ids or []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    where = "website_id=? AND COALESCE(is_archived,0)=0"
    params = [site["id"]]
    if ids:
        where += f" AND id IN ({','.join('?' for _ in ids)})"
        params.extend(ids)
    elif not include_all:
        where += " AND COALESCE(is_downloaded,0)=1"
    conn = _connect()
    try:
        targets = conn.execute(f"SELECT id, tender_id, folder_path FROM tenders WHERE {where}", tuple(params)).fetchall()
    finally:
        conn.close()
    if not targets:
        core.log_to_gui("No tenders marked for download.")
        return False
    core.log_to_gui(f"Starting download for {len(targets)} tenders...")
    client = Client(site["base_url"])
    for db_id, tender_id, folder_path in targets:
        _download_one(client, db_id, str(tender_id), folder_path)
    core.log_to_gui("Download process finished.")
    return True


def download_single(tender_db_id, mode):
    try:
        target_id = int(tender_db_id)
    except (TypeError, ValueError):
        core.log_to_gui("Download: invalid tender selection.")
        return False
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT website_id, COALESCE(is_archived,0) FROM tenders WHERE id=?", (target_id,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        core.log_to_gui("Download: selected tender not found.")
        return False
    if int(row[1] or 0) != 0:
        core.log_to_gui("Download: selected tender is archived; only active tenders are allowed.")
        return False
    forced = str(mode or "").strip().lower() == "redownload"
    if forced:
        core.log_to_gui(f"Re-download requested for tender #{target_id}: existing stored files will be fetched again.")
    core._job_runtime.force_redownload = forced
    try:
        result = download_tenders(row[0], target_db_ids=[target_id])
    finally:
        core._job_runtime.force_redownload = False
    return result is not False
