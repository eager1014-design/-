"""운결(運結) — 상담형 사주 구독 서비스 서버. (Python 3.9+ 표준 라이브러리만 사용)

실행:  python3 server.py   → http://localhost:8000
환경변수(saju/.env 에 적으면 자동으로 읽음):
  AI_PROVIDERS       AI 시도 순서. 예: gemini,openai,claude (모두 실패하면 규칙 기반 해석)
  GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY  각 AI 키
  GEMINI_MODEL / OPENAI_MODEL / CLAUDE_MODEL           각 AI 모델 이름
  TOSS_CLIENT_KEY / TOSS_SECRET_KEY  토스페이먼츠 빌링(없으면 결제 시뮬레이션)
  PORT, SAJU_SECRET, PUBLIC_URL
"""
import envload  # noqa: F401  (.env 를 다른 모듈보다 먼저 읽어야 함)
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import time
from datetime import datetime, timedelta, date
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import billing
import db
import interpret
import knowledge as K
import llm
import lunar
import mailer
from saju_engine import compute_chart, current_luck, year_months, compatibility, CITIES

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
PORT = int(os.environ.get("PORT", "8000"))
PUBLIC_URL = os.environ.get("PUBLIC_URL", f"http://localhost:{PORT}")
COUNSEL_DAILY_LIMIT = 20
MATCH_DAILY_LIMIT = 10
VERIFY_TTL_H = 48
RESET_TTL_H = 1


def _secret():
    s = os.environ.get("SAJU_SECRET")
    if s:
        return s.encode()
    path = os.path.join(ROOT, "data", "secret.key")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    return open(path).read().strip().encode()


SECRET = _secret()
PENDING_BILLING = {}  # customerKey -> (user_id, plan, ts)


# ---------------------------------------------------------------- 인증 유틸
def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex(), salt


def _sign(uid, exp, pw_hash):
    # 비밀번호 해시 일부를 서명에 섞는다 → 비밀번호를 바꾸면 기존 로그인이 모두 풀린다.
    return hmac.new(SECRET, f"{uid}.{exp}.{pw_hash[:16]}".encode(), hashlib.sha256).hexdigest()


def make_token(u):
    exp = int(time.time()) + 60 * 60 * 24 * 30
    return f"{u['id']}.{exp}.{_sign(u['id'], exp, u['pw_hash'])}"


def read_token(tok):
    """유효하면 사용자 행, 아니면 None."""
    try:
        uid, exp, sig = tok.split(".")
        if int(exp) <= time.time():
            return None
        u = db.one("SELECT * FROM users WHERE id=?", int(uid))
        if u and hmac.compare_digest(sig, _sign(u["id"], exp, u["pw_hash"])):
            return u
    except Exception:
        pass
    return None


def public_user(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "created_at": u["created_at"],
            "email_verified": bool(u.get("email_verified"))}


# ---------------------------------------------------------------- 이메일 토큰
def _th(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_email_token(uid, purpose, ttl_hours):
    raw = secrets.token_urlsafe(32)
    n = datetime.now()
    db.run("UPDATE email_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL",
           billing.iso(n), uid, purpose)  # 이전 링크는 무효화
    db.run("INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)",
           _th(raw), uid, purpose, billing.iso(n + timedelta(hours=ttl_hours)), billing.iso(n))
    return raw


def consume_email_token(raw, purpose):
    """1회용. 유효하면 user_id, 아니면 None."""
    t = db.one("SELECT * FROM email_tokens WHERE token_hash=? AND purpose=?", _th(raw or ""), purpose)
    if not t or t["used_at"] or billing.parse(t["expires_at"]) < datetime.now():
        return None
    db.run("UPDATE email_tokens SET used_at=? WHERE token_hash=?", billing.iso(datetime.now()), t["token_hash"])
    return t["user_id"]


def send_verify_mail(u):
    raw = issue_email_token(u["id"], "verify", VERIFY_TTL_H)
    link = f"{PUBLIC_URL}/#/verify?token={raw}"
    mailer.send(u["email"], "[운결] 이메일 주소를 인증해 주세요",
                f"{u['name']}님, 운결에 가입해 주셔서 감사합니다.\n\n아래 링크를 눌러 이메일 인증을 완료해 주세요"
                f"({VERIFY_TTL_H}시간 동안 유효).\n{link}\n\n본인이 가입하지 않았다면 이 메일을 무시해 주세요.")
    return link


# ---------------------------------------------------------------- 생일 입력
def parse_birth(birth, min_year=1920):
    """화면 입력 → 저장용 dict. 잘못되면 ValueError(사용자에게 보여줄 메시지)."""
    try:
        y, m, d = int(birth["year"]), int(birth["month"]), int(birth["day"])
        hour = birth.get("hour")
        hour = None if hour in (None, "", "unknown") else int(hour)
        minute = int(birth.get("minute") or 0)
    except (KeyError, ValueError, TypeError):
        raise ValueError("생년월일시를 정확히 입력해 주세요.")
    if not 1 <= m <= 12 or not 1 <= d <= 31:
        raise ValueError("월은 1~12, 일은 1~31 사이로 입력해 주세요.")
    calendar = "lunar" if birth.get("calendar") == "lunar" else "solar"
    leap = bool(birth.get("leap")) and calendar == "lunar"
    if not min_year <= y <= date.today().year:
        raise ValueError(f"태어난 해는 {min_year}~{date.today().year}년 사이로 입력해 주세요.")
    if hour is not None and not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError("태어난 시간을 정확히 입력해 주세요.")
    if calendar == "lunar":
        solar = lunar.lunar_to_solar(y, m, d, leap)  # 없는 날짜면 ValueError
    else:
        try:
            solar = date(y, m, d)
        except ValueError:
            raise ValueError(f"{y}년 {m}월에는 {d}일이 없습니다.")
    if solar > date.today():
        raise ValueError("미래 날짜는 입력할 수 없습니다.")
    if birth.get("gender") not in ("male", "female"):
        raise ValueError("성별을 선택해 주세요.")
    return {"year": y, "month": m, "day": d, "calendar": calendar, "leap": leap,
            "solar": solar.isoformat(), "hour": hour, "minute": minute, "gender": birth["gender"],
            "city": birth.get("city") if birth.get("city") in CITIES else "서울"}


def solar_of(b):
    """저장된 생일 → 양력 (년, 월, 일). 예전 데이터(양력만 있던 시절)도 처리."""
    if b.get("calendar") == "lunar":
        s = lunar.lunar_to_solar(int(b["year"]), int(b["month"]), int(b["day"]), bool(b.get("leap")))
        return s.year, s.month, s.day
    return int(b["year"]), int(b["month"]), int(b["day"])


def chart_of_birth(b):
    hour = b.get("hour")
    y, m, d = solar_of(b)
    return compute_chart(y, m, d, None if hour in (None, "", "unknown") else int(hour),
                         int(b.get("minute") or 0), b.get("gender", "male"), b.get("city", "서울"))


def load_profile(uid):
    p = db.one("SELECT * FROM profiles WHERE user_id=?", uid)
    if not p:
        return None
    return {"birth": json.loads(p["birth"]), "situation": json.loads(p["situation"]), "updated_at": p["updated_at"]}


def chart_for(profile):
    chart = chart_of_birth(profile["birth"])
    return chart, current_luck(chart)


# ---------------------------------------------------------------- 핸들러
class Handler(BaseHTTPRequestHandler):
    server_version = "Ungyeol/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    # -- 응답 헬퍼
    def send_json(self, obj, status=200, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def error(self, msg, status=400, **extra):
        self.send_json(dict({"error": msg}, **extra), status)

    def redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 100_000:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def user(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        if "sid" not in c:
            return None
        return read_token(c["sid"].value)

    def cookie(self, token, max_age=60 * 60 * 24 * 30):
        return f"sid={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"

    # -- 라우팅
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if path.startswith("/api/"):
            return self.route_api("GET", path, q)
        if path == "/billing/success":
            return self.billing_success(q)
        if path == "/billing/fail":
            return self.redirect("/#/subscribe?fail=" + q.get("message", "결제가 취소되었습니다"))
        self.serve_static(path)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            return self.route_api("POST", u.path, {})
        self.error("not found", 404)

    def serve_static(self, path):
        if path in ("/", "") or not os.path.splitext(path)[1]:
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self.error("not found", 404)
        data = open(full, "rb").read()
        self.send_response(200)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route_api(self, method, path, q):
        routes = {
            ("GET", "/api/config"): self.api_config,
            ("POST", "/api/signup"): self.api_signup,
            ("POST", "/api/login"): self.api_login,
            ("POST", "/api/logout"): self.api_logout,
            ("GET", "/api/me"): self.api_me,
            ("POST", "/api/profile"): self.api_profile,
            ("GET", "/api/chart"): self.api_chart,
            ("POST", "/api/reading"): self.api_reading,
            ("GET", "/api/readings"): self.api_readings,
            ("POST", "/api/counsel"): self.api_counsel,
            ("GET", "/api/daily"): self.api_daily,
            ("GET", "/api/yearly"): self.api_yearly,
            ("POST", "/api/match"): self.api_match,
            ("POST", "/api/verify/send"): self.api_verify_send,
            ("POST", "/api/verify"): self.api_verify,
            ("POST", "/api/password/forgot"): self.api_password_forgot,
            ("POST", "/api/password/reset"): self.api_password_reset,
            ("POST", "/api/billing/prepare"): self.api_billing_prepare,
            ("POST", "/api/billing/mock-register"): self.api_billing_mock,
            ("POST", "/api/billing/cancel"): self.api_billing_cancel,
            ("POST", "/api/billing/resume"): self.api_billing_resume,
            ("POST", "/api/dev/expire-trial"): self.api_dev_expire,
        }
        fn = routes.get((method, path))
        if not fn:
            return self.error("not found", 404)
        try:
            fn(q) if method == "GET" else fn(self.body())
        except Exception as e:  # noqa
            import traceback
            traceback.print_exc()
            self.error("서버 오류가 발생했습니다: " + str(e), 500)

    # -- 인증 필요 헬퍼
    def need_user(self):
        u = self.user()
        if not u:
            self.error("로그인이 필요합니다.", 401)
        return u

    def need_access(self):
        u = self.need_user()
        if not u:
            return None, None
        acc = billing.access(u)
        if not acc["has_access"]:
            self.error("이용 기간이 끝났습니다. 구독 후 이용해 주세요.", 402, access=acc)
            return None, None
        return u, acc

    # ---------------------------------------------------------------- API
    def api_config(self, q):
        self.send_json({"plans": billing.PLANS, "trial_days": billing.TRIAL_DAYS, "mode": billing.MODE,
                        "toss_client_key": billing.TOSS_CLIENT if billing.MODE == "toss" else None,
                        "ai": bool(llm.available()), "mail_mode": mailer.MODE, "cities": list(CITIES.keys()),
                        "concerns": {k: v["label"] for k, v in K.CONCERNS.items()}})

    def api_signup(self, b):
        email = (b.get("email") or "").strip().lower()
        name = (b.get("name") or "").strip()[:30]
        pw = b.get("password") or ""
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return self.error("올바른 이메일을 입력해 주세요.")
        if not name:
            return self.error("이름(닉네임)을 입력해 주세요.")
        if len(pw) < 8:
            return self.error("비밀번호는 8자 이상이어야 합니다.")
        if not b.get("agree"):
            return self.error("이용약관 및 무료체험 조건에 동의해 주세요.")
        if db.one("SELECT id FROM users WHERE email=?", email):
            return self.error("이미 가입된 이메일입니다.")
        h, salt = hash_pw(pw)
        n = datetime.now()
        uid = db.run("INSERT INTO users(email,name,pw_hash,salt,created_at,trial_ends_at,marketing_ok) VALUES (?,?,?,?,?,?,?)",
                     email, name, h, salt, billing.iso(n), billing.iso(n + timedelta(days=billing.TRIAL_DAYS)),
                     1 if b.get("marketing") else 0)
        u = db.one("SELECT * FROM users WHERE id=?", uid)
        link = send_verify_mail(u)
        self.send_json(dict({"ok": True, "id": uid}, **self.dev_link(link)), cookie=self.cookie(make_token(u)))

    def api_login(self, b):
        u = db.one("SELECT * FROM users WHERE email=?", (b.get("email") or "").strip().lower())
        if not u or not hmac.compare_digest(hash_pw(b.get("password") or "", u["salt"])[0], u["pw_hash"]):
            return self.error("이메일 또는 비밀번호가 올바르지 않습니다.", 401)
        self.send_json({"ok": True}, cookie=self.cookie(make_token(u)))

    def api_logout(self, b):
        self.send_json({"ok": True}, cookie=self.cookie("", 0))

    def api_me(self, q):
        u = self.user()
        if not u:
            return self.send_json({"user": None})
        self.send_json({"user": public_user(u), "access": billing.access(u), "profile": load_profile(u["id"])})

    def api_profile(self, b):
        u = self.need_user()
        if not u:
            return
        birth, sit = b.get("birth") or {}, b.get("situation") or {}
        try:
            clean_birth = parse_birth(birth)
        except ValueError as e:
            return self.error(str(e))
        sit = {k: str(sit.get(k, ""))[:2000] for k in ("job", "concern", "story", "mood", "goal")}
        if len(sit["story"].strip()) < 10:
            return self.error("현재 상황과 고민을 10자 이상 적어주세요. 구체적일수록 정확한 풀이가 가능합니다.")
        db.run("""INSERT INTO profiles(user_id,birth,situation,updated_at) VALUES (?,?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET birth=excluded.birth, situation=excluded.situation, updated_at=excluded.updated_at""",
               u["id"], json.dumps(clean_birth, ensure_ascii=False), json.dumps(sit, ensure_ascii=False), billing.iso(datetime.now()))
        self.send_json({"ok": True})

    def api_chart(self, q):
        """원국 계산은 무료(체험 종료 후에도 미리보기 제공)."""
        u = self.need_user()
        if not u:
            return
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 생년월일과 상황을 입력해 주세요.", 404)
        chart, luck = chart_for(p)
        dm = K.DAY_MASTER[chart["day_master"]["ko"]]
        self.send_json({"chart": chart, "luck": luck, "day_master_info": dm, "birth": p["birth"],
                        "element_info": K.ELEMENT, "ten_god_info": K.TEN_GOD, "group_info": K.GROUP,
                        "shinsal_info": K.SHINSAL, "luck_god_info": K.LUCK_GOD, "access": billing.access(u)})

    def api_reading(self, b):
        u, acc = self.need_access()
        if not u:
            return
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 생년월일과 상황을 입력해 주세요.", 404)
        chart, luck = chart_for(p)
        key = hashlib.sha256((json.dumps(p["birth"], sort_keys=True) + json.dumps(p["situation"], sort_keys=True)
                              + luck["month"]["hanja"] + str(luck["year"]["year"])).encode()).hexdigest()
        if not b.get("refresh"):
            cached = db.one("SELECT * FROM readings WHERE user_id=? AND kind='full' AND cache_key=? ORDER BY id DESC LIMIT 1",
                            u["id"], key)
            if cached:
                return self.send_json({"markdown": cached["content"], "engine": cached["engine"],
                                       "created_at": cached["created_at"], "cached": True})
        res = interpret.full_reading(chart, luck, p["situation"], u["name"])
        n = billing.iso(datetime.now())
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,cache_key,created_at) VALUES (?,?,?,?,?,?,?)",
               u["id"], "full", None, res["markdown"], res["engine"], key, n)
        self.send_json(dict(res, created_at=n, cached=False))

    def api_readings(self, q):
        u = self.need_user()
        if not u:
            return
        rows = db.all_("SELECT id,kind,question,content,engine,created_at FROM readings WHERE user_id=? ORDER BY id DESC LIMIT 100", u["id"])
        self.send_json({"readings": rows})

    def api_counsel(self, b):
        u, acc = self.need_access()
        if not u:
            return
        question = (b.get("question") or "").strip()[:1500]
        if len(question) < 2:
            return self.error("질문을 입력해 주세요.")
        today = date.today().isoformat()
        cnt = db.one("SELECT COUNT(*) c FROM readings WHERE user_id=? AND kind='counsel' AND created_at >= ?", u["id"], today)["c"]
        if cnt >= COUNSEL_DAILY_LIMIT:
            return self.error(f"오늘 상담 가능 횟수({COUNSEL_DAILY_LIMIT}회)를 모두 사용했습니다. 내일 다시 이용해 주세요.", 429)
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 생년월일과 상황을 입력해 주세요.", 404)
        chart, luck = chart_for(p)
        hist_rows = db.all_("SELECT question, content FROM readings WHERE user_id=? AND kind='counsel' ORDER BY id DESC LIMIT 5", u["id"])
        history = []
        for r in reversed(hist_rows):
            history += [{"role": "user", "content": r["question"]}, {"role": "assistant", "content": r["content"]}]
        res = interpret.counsel(chart, luck, p["situation"], history, question, u["name"])
        n = billing.iso(datetime.now())
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,created_at) VALUES (?,?,?,?,?,?)",
               u["id"], "counsel", question, res["markdown"], res["engine"], n)
        self.send_json(dict(res, created_at=n, remaining=COUNSEL_DAILY_LIMIT - cnt - 1))

    def api_daily(self, q):
        u, acc = self.need_access()
        if not u:
            return
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 생년월일과 상황을 입력해 주세요.", 404)
        today = date.today().isoformat()
        cached = db.one("SELECT * FROM readings WHERE user_id=? AND kind='daily' AND cache_key=?", u["id"], today)
        chart, luck = chart_for(p)
        if cached:
            return self.send_json({"markdown": cached["content"], "engine": cached["engine"], "day": luck["day"], "today": today})
        res = interpret.daily(chart, luck, p["situation"])
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,cache_key,created_at) VALUES (?,?,?,?,?,?,?)",
               u["id"], "daily", None, res["markdown"], res["engine"], today, billing.iso(datetime.now()))
        self.send_json(dict(res, day=luck["day"], today=today))

    def api_yearly(self, q):
        u, acc = self.need_access()
        if not u:
            return
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 생년월일과 상황을 입력해 주세요.", 404)
        chart, luck = chart_for(p)
        cur = luck["year"]["year"]
        try:
            year = int(q.get("year") or cur)
        except ValueError:
            year = cur
        if year not in (cur, cur + 1):
            return self.error(f"{cur}년과 {cur + 1}년 운세만 볼 수 있습니다.")
        months = year_months(chart, year)
        key = f"{year}:" + hashlib.sha256((json.dumps(p["birth"], sort_keys=True)
                                           + json.dumps(p["situation"], sort_keys=True)).encode()).hexdigest()[:24]
        cached = None if q.get("refresh") == "1" else db.one(
            "SELECT * FROM readings WHERE user_id=? AND kind='yearly' AND cache_key=? ORDER BY id DESC LIMIT 1", u["id"], key)
        if cached:
            return self.send_json({"markdown": cached["content"], "engine": cached["engine"], "months": months,
                                   "year": year, "current_year": cur, "created_at": cached["created_at"], "cached": True})
        res = interpret.yearly(chart, luck, p["situation"], months, year, u["name"])
        n = billing.iso(datetime.now())
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,cache_key,created_at) VALUES (?,?,?,?,?,?,?)",
               u["id"], "yearly", f"{year}년 운세", res["markdown"], res["engine"], key, n)
        self.send_json(dict(res, months=months, year=year, current_year=cur, created_at=n, cached=False))

    def api_match(self, b):
        u, acc = self.need_access()
        if not u:
            return
        p = load_profile(u["id"])
        if not p:
            return self.error("먼저 내 생년월일과 상황을 입력해 주세요.", 404)
        partner_in = b.get("partner") or {}
        pname = (partner_in.get("name") or "").strip()[:20] or "상대"
        relation = (b.get("relation") or "").strip()[:20]
        try:
            pbirth = parse_birth(partner_in, min_year=1900)
        except ValueError as e:
            return self.error("상대방 정보: " + str(e))
        key = hashlib.sha256((json.dumps(p["birth"], sort_keys=True) + json.dumps(pbirth, sort_keys=True)
                              + pname + relation).encode()).hexdigest()
        if not b.get("refresh"):
            cached = db.one("SELECT * FROM readings WHERE user_id=? AND kind='match' AND cache_key=? ORDER BY id DESC LIMIT 1",
                            u["id"], key)
            if cached:
                return self.send_json({"markdown": cached["content"], "engine": cached["engine"],
                                       "created_at": cached["created_at"], "cached": True, "partner_name": pname})
        today = date.today().isoformat()
        cnt = db.one("SELECT COUNT(*) c FROM readings WHERE user_id=? AND kind='match' AND created_at >= ?", u["id"], today)["c"]
        if cnt >= MATCH_DAILY_LIMIT:
            return self.error(f"궁합은 하루 {MATCH_DAILY_LIMIT}번까지 볼 수 있습니다. 내일 다시 이용해 주세요.", 429)
        chart, luck = chart_for(p)
        partner = chart_of_birth(pbirth)
        comp = compatibility(chart, partner)
        res = interpret.match_reading(chart, luck, p["situation"], partner, comp, u["name"], pname, relation)
        n = billing.iso(datetime.now())
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,cache_key,created_at) VALUES (?,?,?,?,?,?,?)",
               u["id"], "match", f"{pname}님과의 궁합" + (f" ({relation})" if relation else ""), res["markdown"],
               res["engine"], key, n)
        self.send_json(dict(res, score=comp["score"], partner_name=pname, created_at=n, cached=False))

    # -- 이메일 인증 · 비밀번호 찾기
    def dev_link(self, link):
        """메일 모의 모드에서만 화면에 링크를 돌려준다(개발 편의)."""
        return {"dev_link": link} if mailer.MODE == "mock" else {}

    def api_verify_send(self, b):
        u = self.need_user()
        if not u:
            return
        if u.get("email_verified"):
            return self.send_json({"ok": True, "already": True})
        recent = db.one("SELECT COUNT(*) c FROM email_tokens WHERE user_id=? AND purpose='verify' AND created_at >= ?",
                        u["id"], billing.iso(datetime.now() - timedelta(minutes=10)))["c"]
        if recent >= 3:
            return self.error("인증 메일을 너무 자주 요청했습니다. 10분 뒤에 다시 시도해 주세요.", 429)
        self.send_json(dict({"ok": True}, **self.dev_link(send_verify_mail(u))))

    def api_verify(self, b):
        uid = consume_email_token(b.get("token"), "verify")
        if not uid:
            return self.error("인증 링크가 만료되었거나 이미 사용되었습니다. 로그인 후 인증 메일을 다시 받아주세요.")
        db.run("UPDATE users SET email_verified=1 WHERE id=?", uid)
        self.send_json({"ok": True})

    def api_password_forgot(self, b):
        email = (b.get("email") or "").strip().lower()
        u = db.one("SELECT * FROM users WHERE email=?", email)
        extra = {}
        if u:
            recent = db.one("SELECT COUNT(*) c FROM email_tokens WHERE user_id=? AND purpose='reset' AND created_at >= ?",
                            u["id"], billing.iso(datetime.now() - timedelta(hours=1)))["c"]
            if recent < 3:
                raw = issue_email_token(u["id"], "reset", RESET_TTL_H)
                link = f"{PUBLIC_URL}/#/reset?token={raw}"
                mailer.send(u["email"], "[운결] 비밀번호 재설정 안내",
                            f"{u['name']}님, 비밀번호 재설정을 요청하셨습니다.\n\n아래 링크에서 새 비밀번호를 정해 주세요"
                            f"({RESET_TTL_H}시간 동안 유효, 한 번만 사용 가능).\n{link}\n\n"
                            "본인이 요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.")
                extra = self.dev_link(link)
        # 가입 여부와 관계없이 같은 응답 → 이메일로 회원 여부를 알아낼 수 없게 함
        self.send_json(dict({"ok": True, "message": "가입된 이메일이라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요."}, **extra))

    def api_password_reset(self, b):
        pw = b.get("password") or ""
        if len(pw) < 8:
            return self.error("비밀번호는 8자 이상이어야 합니다.")
        uid = consume_email_token(b.get("token"), "reset")
        if not uid:
            return self.error("재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 진행해 주세요.")
        h, salt = hash_pw(pw)
        # 메일 링크로 재설정했다는 것은 메일 소유를 확인한 것이므로 인증도 함께 완료
        db.run("UPDATE users SET pw_hash=?, salt=?, email_verified=1 WHERE id=?", h, salt, uid)
        u = db.one("SELECT * FROM users WHERE id=?", uid)
        self.send_json({"ok": True}, cookie=self.cookie(make_token(u)))  # 기존 로그인은 모두 풀리고 이 기기만 로그인

    # -- 결제
    def api_billing_prepare(self, b):
        u = self.need_user()
        if not u:
            return
        plan = b.get("plan")
        if plan not in billing.PLANS:
            return self.error("요금제를 선택해 주세요.")
        if not u.get("email_verified"):
            return self.error("구독 전에 이메일 인증이 필요합니다. 가입한 메일함의 인증 링크를 확인해 주세요.", 403, need_verify=True)
        ck = billing.customer_key_for(u)
        PENDING_BILLING[ck] = (u["id"], plan, time.time())
        self.send_json({"customerKey": ck, "mode": billing.MODE, "clientKey": billing.TOSS_CLIENT or None,
                        "successUrl": f"{PUBLIC_URL}/billing/success?plan={plan}",
                        "failUrl": f"{PUBLIC_URL}/billing/fail",
                        "customerEmail": u["email"], "customerName": u["name"]})

    def billing_success(self, q):
        ck, auth = q.get("customerKey"), q.get("authKey")
        pend = PENDING_BILLING.pop(ck, None)
        if not pend or time.time() - pend[2] > 3600:
            return self.redirect("/#/subscribe?fail=결제 세션이 만료되었습니다. 다시 시도해 주세요.")
        user = db.one("SELECT * FROM users WHERE id=?", pend[0])
        ok, res = billing.issue_billing_key(auth, ck)
        if not ok:
            return self.redirect("/#/subscribe?fail=" + res.get("message", "카드 등록 실패"))
        card = res.get("card") or {}
        ok, info = billing.activate(user, pend[1], res["billingKey"], ck, f"{card.get('cardType','')} {card.get('number','')}".strip())
        if not ok:
            return self.redirect("/#/subscribe?fail=" + str(info))
        self.redirect("/#/account?welcome=1")

    def api_billing_mock(self, b):
        """결제 키가 없는 개발 환경용: 카드 등록과 결제를 시뮬레이션."""
        if billing.MODE != "mock":
            return self.error("mock 모드가 아닙니다.", 403)
        u = self.need_user()
        if not u:
            return
        plan = b.get("plan")
        ck = b.get("customerKey")
        pend = PENDING_BILLING.pop(ck, None)
        if not pend or pend[0] != u["id"] or plan not in billing.PLANS:
            return self.error("결제 세션이 올바르지 않습니다.")
        ok, res = billing.issue_billing_key("mock", ck)
        card = res["card"]
        ok, info = billing.activate(u, plan, res["billingKey"], ck, f"{card['cardType']} {card['number']}")
        if not ok:
            return self.error(str(info))
        self.send_json({"ok": True, **info})

    def api_billing_cancel(self, b):
        u = self.need_user()
        if u:
            billing.cancel(u)
            self.send_json({"ok": True, "access": billing.access(u)})

    def api_billing_resume(self, b):
        u = self.need_user()
        if u:
            billing.resume(u)
            self.send_json({"ok": True, "access": billing.access(u)})

    def api_dev_expire(self, b):
        """[개발 전용] 무료체험 종료 상황을 즉시 재현."""
        if billing.MODE != "mock":
            return self.error("개발 모드에서만 사용할 수 있습니다.", 403)
        u = self.need_user()
        if not u:
            return
        past = billing.iso(datetime.now() - timedelta(minutes=1))
        db.run("UPDATE users SET trial_ends_at=? WHERE id=?", past, u["id"])
        db.run("UPDATE subscriptions SET current_period_end=? WHERE user_id=? AND current_period_end > ?", past, u["id"], past)
        billing.run_renewals()
        self.send_json({"ok": True, "access": billing.access(db.one("SELECT * FROM users WHERE id=?", u["id"]))})


def main():
    db.conn()
    billing.start_scheduler()
    print(f"운결 사주 서버 실행: {PUBLIC_URL}  (AI: {' → '.join(llm.label(n) for n in llm.available()) or '규칙 기반'}, 결제: {billing.MODE}, 메일: {mailer.MODE})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
