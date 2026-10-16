import hashlib
import hmac
import http.cookies
import json
import os
import secrets
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "ccms.db"
SESSIONS = {}
ATTEMPTS = {}
SESSION_SECONDS = 60 * 60 * 8
REMEMBER_SECONDS = 60 * 60 * 24 * 30


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240000)
    return salt.hex() + ":" + digest.hex()


def password_matches(password, stored):
    try:
        salt, digest = stored.split(":", 1)
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 240000)
        return hmac.compare_digest(candidate.hex(), digest)
    except (ValueError, TypeError):
        return False


def public_user(user):
    return {k: user[k] for k in ("id", "name", "email", "role", "dept")}


def seed_state():
    users = [
        {"id": "stu", "name": "Arun Kumar", "email": "student@college.edu", "role": "Student", "dept": "CSBS"},
        {"id": "fac", "name": "Dr. Meena S", "email": "faculty@college.edu", "role": "Faculty", "dept": "CSE"},
        {"id": "t1", "name": "Ravi Shankar", "email": "tech@college.edu", "role": "Technician", "dept": "IT Support"},
        {"id": "t2", "name": "Suresh Babu", "email": "tech2@college.edu", "role": "Technician", "dept": "IT Support"},
        {"id": "adm", "name": "Prof. Lakshmi (HOD)", "email": "admin@college.edu", "role": "Admin", "dept": "Administration"},
    ]
    labs = [
        {"id": "LAB-01", "name": "Computer Science Laboratory", "bld": "Block A", "room": "101", "tech": "t1", "faculty": "fac"},
        {"id": "LAB-02", "name": "Networks Laboratory", "bld": "Block A", "room": "102", "tech": "t2", "faculty": "fac"},
        {"id": "LAB-03", "name": "Programming Laboratory", "bld": "Block B", "room": "201", "tech": "t1", "faculty": "fac"},
    ]
    comps = []
    for lab_index, lab in enumerate(labs, 1):
        for number in range(1, 7):
            comps.append({
                "id": f"LAB0{lab_index}-PC0{number}",
                "serial": f"SN{4100 + (lab_index - 1) * 10 + number}",
                "lab": lab["id"], "name": f"CSL{lab_index}-{number}",
                "cpu": "Intel Core i5-12400", "ram": "16 GB DDR4",
                "disk": "512 GB NVMe SSD", "os": "Windows 11 Pro",
                "status": "Working", "purchase": "2022-07-01",
                "warranty": "2025-07-01", "last": "—",
            })
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    issue = {
        "id": "CMP-2026-0001", "uid": "stu", "cid": "LAB01-PC01",
        "cat": "Keyboard", "title": "Keyboard keys sticking",
        "desc": "Several keys in the numeric keypad are unresponsive.",
        "pri": "Low", "status": "Reported", "created": now, "updated": now,
        "tech": "t1", "diag": None, "repair": None, "verification": None,
        "adminAction": None, "esc": None,
        "log": [{"d": now, "s": "Reported", "m": "Issue reported by Arun Kumar"}],
        "img": None,
    }
    return {"users": users, "labs": labs, "comps": comps, "issues": [issue],
            "hist": [], "notes": [], "seq": 1, "set": {"overdue": 7}}


def connect():
    db = sqlite3.connect(DB_PATH)
    db.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS application_state (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)")
    if db.execute("SELECT COUNT(*) FROM application_state").fetchone()[0] == 0:
        state = seed_state()
        for user in state["users"]:
            db.execute("INSERT OR IGNORE INTO users VALUES (?, ?)", (user["id"], password_hash("demo-ccms-2026")))
        db.execute("INSERT INTO application_state VALUES (1, ?)", (json.dumps(state),))
        db.commit()
    return db


def read_state(db):
    return json.loads(db.execute("SELECT payload FROM application_state WHERE id = 1").fetchone()[0])


def write_state(db, state):
    db.execute("UPDATE application_state SET payload = ? WHERE id = 1", (json.dumps(state),))
    db.commit()


def user_record(db, identifier):
    state = read_state(db)
    return next((u for u in state["users"] if identifier.lower() in (u["id"].lower(), u["email"].lower())), None)


def scoped_state(state, user):
    if user["role"] == "Admin":
        return state
    result = dict(state)
    if user["role"] == "Student":
        issue_filter = lambda item: item["uid"] == user["id"]
    elif user["role"] == "Technician":
        issue_filter = lambda item: item.get("tech") == user["id"]
    else:
        lab_ids = {lab["id"] for lab in state["labs"] if lab.get("faculty") == user["id"]}
        comp_ids = {comp["id"] for comp in state["comps"] if comp["lab"] in lab_ids}
        issue_filter = lambda item: item["uid"] == user["id"] or item["cid"] in comp_ids
    result["issues"] = [item for item in state["issues"] if issue_filter(item)]
    result["hist"] = [item for item in state["hist"] if item.get("iid") in {i["id"] for i in result["issues"]}]
    result["notes"] = [item for item in state["notes"] if item.get("uid") == user["id"]]
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "CCMS/1.0"

    def log_message(self, *_):
        return

    def send_json(self, status, payload, cookies=()):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = min(int(self.headers.get("Content-Length", "0")), 2_000_000)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def session(self):
        jar = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        token = jar.get("ccms_session")
        session = SESSIONS.get(token.value) if token else None
        if not session or session["expires"] < time.time():
            if token:
                SESSIONS.pop(token.value, None)
            return None
        return session

    def require_auth(self):
        session = self.session()
        if not session:
            self.send_json(401, {"error": "Your session has expired. Please sign in again."})
            return None
        return session

    def csrf_ok(self):
        jar = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        csrf = jar.get("ccms_csrf")
        return csrf and hmac.compare_digest(csrf.value, self.headers.get("X-CSRF-Token", ""))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/session":
            session = self.require_auth()
            if not session:
                return
            with connect() as db:
                state = read_state(db)
            self.send_json(200, {"user": session["user"], "data": scoped_state(state, session["user"])})
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "Not found"})
            return
        file_path = (ROOT / (path.lstrip("/") or "index.html")).resolve()
        allowed_files = {ROOT / "index.html", ROOT / "css" / "style.css", ROOT / "js" / "app.js"}
        if file_path not in allowed_files:
            self.send_json(404, {"error": "Not found"})
            return
        if not file_path.is_file():
            self.send_json(404, {"error": "Not found"})
            return
        types = {".html": "text/html", ".css": "text/css", ".js": "application/javascript"}
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", types.get(file_path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            self.login()
            return
        session = self.require_auth()
        if not session:
            return
        if not self.csrf_ok():
            self.send_json(403, {"error": "Security validation failed. Refresh and try again."})
            return
        if path == "/api/logout":
            jar = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            token = jar.get("ccms_session")
            if token:
                SESSIONS.pop(token.value, None)
            self.send_json(200, {"ok": True}, ["ccms_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"])
            return
        if path == "/api/sync":
            self.sync(session)
            return
        self.send_json(404, {"error": "Not found"})

    def login(self):
        data = self.body()
        identifier = str(data.get("identifier", "")).strip()
        key = f"{self.client_address[0]}:{identifier.lower()}"
        recent = [t for t in ATTEMPTS.get(key, []) if t > time.time() - 600]
        if len(recent) >= 8:
            self.send_json(429, {"error": "Too many sign-in attempts. Please wait and try again."})
            return
        with connect() as db:
            user = user_record(db, identifier)
            stored = db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone() if user else None
            valid = bool(user and stored and password_matches(str(data.get("password", "")), stored[0]))
            state = read_state(db)
        if not valid:
            recent.append(time.time())
            ATTEMPTS[key] = recent
            self.send_json(401, {"error": "Invalid email or password."})
            return
        ATTEMPTS.pop(key, None)
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        duration = REMEMBER_SECONDS if data.get("remember") else SESSION_SECONDS
        SESSIONS[token] = {"user": public_user(user), "expires": time.time() + duration}
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        cookies = [
            f"ccms_session={token}; Max-Age={duration}; Path=/; HttpOnly; SameSite=Lax{secure}",
            f"ccms_csrf={csrf}; Max-Age={duration}; Path=/; SameSite=Lax{secure}",
        ]
        self.send_json(200, {"user": public_user(user), "data": scoped_state(state, user)}, cookies)

    def sync(self, session):
        incoming = self.body().get("data")
        if not isinstance(incoming, dict):
            self.send_json(400, {"error": "Invalid data."})
            return
        with connect() as db:
            current = read_state(db)
            user = session["user"]
            if user["role"] == "Admin":
                for key in ("issues", "hist", "notes", "labs", "comps", "seq", "set"):
                    if key in incoming:
                        current[key] = incoming[key]
            else:
                allowed = {i["id"] for i in current["issues"] if (
                    i["uid"] == user["id"] or i.get("tech") == user["id"] or
                    any(l["id"] == next((c["lab"] for c in current["comps"] if c["id"] == i["cid"]), None)
                        and l.get("faculty") == user["id"] for l in current["labs"])
                )}
                submitted = {i["id"]: i for i in incoming.get("issues", [])}
                for index, issue in enumerate(current["issues"]):
                    if issue["id"] in allowed and issue["id"] in submitted:
                        current["issues"][index] = submitted[issue["id"]]
                known_ids = {i["id"] for i in current["issues"]}
                for issue in submitted.values():
                    if issue["id"] not in known_ids and issue.get("uid") == user["id"]:
                        issue["status"] = "Assigned" if issue.get("tech") else "Reported"
                        current["issues"].append(issue)
                notes = {n["id"]: n for n in incoming.get("notes", []) if n.get("uid") == user["id"]}
                current["notes"] = [notes.get(n["id"], n) for n in current["notes"]]
                current["notes"].extend(n for key, n in notes.items() if key not in {x["id"] for x in current["notes"]})
                known_history = {item.get("iid") for item in current["hist"]}
                current["hist"].extend(
                    item for item in incoming.get("hist", [])
                    if item.get("iid") in allowed and item.get("iid") not in known_history
                )
            write_state(db, current)
        self.send_json(200, {"data": scoped_state(current, user)})


if __name__ == "__main__":
    with connect() as db:
        pass
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print(f"CCMS running at http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
