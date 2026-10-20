"""운결(運結) — 상담형 사주 구독 서비스 서버. (Python 3.9+ 표준 라이브러리만 사용)

실행:  python3 server.py   → http://localhost:8000
환경변수(saju/.env 에 적으면 자동으로 읽음):
  AI_PROVIDERS       AI 시도 순서. 예: gemini,openai,claude (모두 실패하면 규칙 기반 해석)
  GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY  각 AI 키
  GEMINI_MODEL / OPENAI_MODEL / CLAUDE_MODEL           각 AI 모델 이름
  TOSS_CLIENT_KEY / TOSS_SECRET_KEY  토스페이먼츠 빌링(없으면 결제 시뮬레이션)
  PORT, SAJU_SECRET, PUBLIC_URL
  ADMIN_EMAIL, BANK_ACCOUNT, PRICE_*  1인 상담 판매 (orders.py) / SMTP_*  메일 (mailer.py)
  THREADS_ACCESS_TOKEN, THREADS_LINK_TEXT  스레드 자동 게시 (threads.py, promo.py)
"""
import envload  # noqa: F401  (.env 를 다른 모듈보다 먼저 읽어야 함)
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, date
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

import billing
import db
import interpret
import knowledge as K
import llm
import lunar
import mailer
import longform
import orders
import products
import promo
import subs
import threads
from saju_engine import compute_chart, current_luck, year_months, compatibility, CITIES

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
PORT = int(os.environ.get("PORT", "8000"))
PUBLIC_URL = os.environ.get("PUBLIC_URL", f"http://localhost:{PORT}")
COUNSEL_DAILY_LIMIT = 20
IS_LOCAL = urlparse(PUBLIC_URL).hostname in ("localhost", "127.0.0.1")
HTTPS = PUBLIC_URL.startswith("https://")
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"  # 터널·프록시 뒤에서 실제 접속자 IP를 쓰려면 1
# 결제 키 없이 인터넷에 공개하면 누구나 공짜 구독이 되므로, 지인 테스트처럼 의도한 경우에만 허용
ALLOW_MOCK_BILLING = IS_LOCAL or os.environ.get("ALLOW_MOCK_BILLING") == "1"
INVITE_CODE = os.environ.get("INVITE_CODE", "").strip()  # 설정하면 이 코드를 아는 사람만 가입(지인 테스트용)
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
STARTED_AT = datetime.now().isoformat(timespec="seconds")  # 서버가 켜진 시각 (다시 배포됐는지 확인용)
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
            "email_verified": bool(u.get("email_verified")), "ai_consent": bool(u.get("ai_consent_at"))}


# ---------------------------------------------------------------- 시도 횟수 제한
_attempts = {}
_attempts_lock = threading.Lock()


def too_many(key, limit, window_sec):
    """window_sec 안에 limit 번을 넘으면 True. 호출할 때마다 1회로 센다."""
    now_t = time.time()
    with _attempts_lock:
        hits = [t for t in _attempts.get(key, []) if now_t - t < window_sec]
        hits.append(now_t)
        _attempts[key] = hits
        if len(_attempts) > 50_000:  # 메모리 보호
            _attempts.clear()
        return len(hits) > limit


def clear_attempts(key):
    with _attempts_lock:
        _attempts.pop(key, None)


_DUMMY_SALT = secrets.token_hex(16)


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
    link = f"{PUBLIC_URL}/admin#/verify?token={raw}"  # 1인 운영에서는 거의 안 씀 (예전 구독 앱 흐름 유지)
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
    CSP = ("default-src 'self'; script-src 'self' https://js.tosspayments.com; "
           "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
           "img-src 'self' data: blob:; connect-src 'self' https://*.tosspayments.com; "
           "frame-src https://*.tosspayments.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")

    def end_headers(self):
        # 모든 응답에 붙는 브라우저 보안 설정
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", self.CSP)
        if HTTPS:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def client_ip(self):
        if TRUST_PROXY:
            fwd = self.headers.get("CF-Connecting-IP") or (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if fwd:
                return fwd
        return self.client_address[0]

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
        if n > 300_000:  # 사장님이 고친 긴 풀이 저장까지 허용
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
        return f"sid={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}" + ("; Secure" if HTTPS else "")

    # -- 라우팅
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if path.startswith("/api/"):
            return self.route_api("GET", path, q)
        if path == "/stop":
            return self.stop_page(q)
        if path == "/billing/success":
            return self.billing_success(q)
        if path == "/billing/fail":
            return self.redirect("/app#/subscribe?fail=" + q.get("message", "결제가 취소되었습니다"))
        self.serve_static(path)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                return self.error("잘못된 요청입니다.", 415)
            return self.route_api("POST", u.path, {})
        self.error("not found", 404)

    def serve_static(self, path):
        # 첫 화면 = 손님 신청서, /admin = 사장님 관리 화면(가입·비밀번호 재설정 포함).
        # 예전 구독 앱(/app, index.html)은 판매 방식이 바뀌어 닫음 → 첫 화면으로 보냄
        if path in ("/", ""):
            path = "/apply.html"
        elif path.rstrip("/") == "/admin":
            path = "/admin.html"
        elif not os.path.splitext(path)[1] or path in ("/index.html", "/app.js"):
            return self.redirect("/")
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self.error("not found", 404)
        data = open(full, "rb").read()
        if path == "/apply.html":  # 링크 미리보기(스레드·카톡)에 쓸 그림 주소는 실제 사이트 주소로
            data = data.replace(b"__PUBLIC_URL__", PUBLIC_URL.encode())
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
            ("POST", "/api/account/delete"): self.api_account_delete,
            ("POST", "/api/billing/prepare"): self.api_billing_prepare,
            ("POST", "/api/billing/mock-register"): self.api_billing_mock,
            ("POST", "/api/billing/cancel"): self.api_billing_cancel,
            ("POST", "/api/billing/resume"): self.api_billing_resume,
            ("POST", "/api/dev/expire-trial"): self.api_dev_expire,
            ("GET", "/api/apply/config"): self.api_apply_config,
            ("POST", "/api/apply"): self.api_apply,
            ("GET", "/api/admin/orders"): self.api_admin_orders,
            ("GET", "/api/admin/order"): self.api_admin_order,
            ("POST", "/api/admin/order/create"): self.api_admin_create,
            ("POST", "/api/admin/order/status"): self.api_admin_status,
            ("POST", "/api/admin/order/generate"): self.api_admin_generate,
            ("POST", "/api/admin/order/save"): self.api_admin_save,
            ("GET", "/api/admin/jobs"): self.api_admin_jobs,
            ("GET", "/api/admin/outbox"): self.api_admin_outbox,
            ("POST", "/api/admin/outbox/done"): self.api_admin_outbox_done,
            ("GET", "/api/admin/subs"): self.api_admin_subs,
            ("POST", "/api/admin/subs/update"): self.api_admin_subs_update,
            ("POST", "/api/admin/subs/send-now"): self.api_admin_subs_send_now,
            ("POST", "/api/admin/owner-reset"): self.api_admin_owner_reset,
            ("POST", "/api/admin/jobs/update"): self.api_admin_job_update,
            ("GET", "/api/admin/order/pdf"): self.api_admin_pdf,
            ("POST", "/api/admin/order/send"): self.api_admin_send,
            ("GET", "/api/admin/promo"): self.api_admin_promo,
            ("POST", "/api/admin/promo/generate"): self.api_admin_promo_generate,
            ("POST", "/api/admin/promo/save"): self.api_admin_promo_save,
            ("POST", "/api/admin/promo/post"): self.api_admin_promo_post,
            ("POST", "/api/admin/promo/discard"): self.api_admin_promo_discard,
            ("POST", "/api/admin/promo/refs"): self.api_admin_promo_refs,
            ("POST", "/api/admin/promo/unschedule"): self.api_admin_promo_unschedule,
            ("POST", "/api/admin/promo/auto"): self.api_admin_promo_auto,
            ("GET", "/api/admin/promo/brief"): self.api_admin_promo_brief,
            ("POST", "/api/admin/promo/import"): self.api_admin_promo_import,
        }
        fn = routes.get((method, path))
        if not fn:
            return self.error("not found", 404)
        try:
            fn(q) if method == "GET" else fn(self.body())
        except Exception as e:  # noqa
            import traceback
            traceback.print_exc()
            self.error("일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500)  # 내부 정보는 로그에만

    # -- 인증 필요 헬퍼
    def need_user(self):
        u = self.user()
        if not u:
            self.error("로그인이 필요합니다.", 401)
        return u

    def need_admin(self):
        # 맥북의 자동 글쓰기 프로그램은 로그인 대신 비밀 키(ADMIN_API_KEY)로 들어온다
        key = os.environ.get("ADMIN_API_KEY", "")
        if len(key) >= 24 and hmac.compare_digest(self.headers.get("X-Admin-Key", ""), key):
            return {"email": "api", "name": "자동 글쓰기"}
        u = self.user()
        if not orders.is_admin(u):
            self.error("사장님 계정으로 로그인해야 열 수 있습니다.", 401 if not u else 403)
            return None
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
                        "ai": bool(llm.available()), "mail_mode": mailer.MODE, "invite_required": bool(INVITE_CODE), "cities": list(CITIES.keys()),
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
            return self.error("이용약관 및 개인정보 처리방침에 동의해 주세요.")
        if not b.get("agree_ai"):
            return self.error("AI 풀이를 위한 개인정보 국외 이전에 동의해 주세요. 동의하지 않으면 서비스를 제공할 수 없습니다.")
        # 사장님 1인 운영: 사장님 이메일(ADMIN_EMAIL)이 정해져 있으면 그 계정만 가입 가능 (초대 코드가 맞으면 예외)
        invited = bool(INVITE_CODE) and hmac.compare_digest((b.get("invite") or "").strip().upper(), INVITE_CODE.upper())
        if orders.ADMIN_EMAILS and email not in orders.ADMIN_EMAILS and not invited:
            return self.error("지금은 회원가입을 받지 않습니다. 사주 풀이 신청은 첫 화면의 신청서를 이용해 주세요.")
        if INVITE_CODE and not hmac.compare_digest((b.get("invite") or "").strip().upper(), INVITE_CODE.upper()):
            return self.error("초대 코드가 올바르지 않습니다. 지금은 초대받은 분만 가입할 수 있어요.")
        if too_many("signup:" + self.client_ip(), 10, 3600):
            return self.error("가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
        if db.one("SELECT id FROM users WHERE email=?", email):
            return self.error("이미 가입된 이메일입니다.")
        h, salt = hash_pw(pw)
        n = datetime.now()
        uid = db.run("INSERT INTO users(email,name,pw_hash,salt,created_at,trial_ends_at,marketing_ok,ai_consent_at) VALUES (?,?,?,?,?,?,?,?)",
                     email, name, h, salt, billing.iso(n), billing.iso(n + timedelta(days=billing.TRIAL_DAYS)),
                     1 if b.get("marketing") else 0, billing.iso(n))
        u = db.one("SELECT * FROM users WHERE id=?", uid)
        link = send_verify_mail(u)
        self.send_json(dict({"ok": True, "id": uid}, **self.dev_link(link)), cookie=self.cookie(make_token(u)))

    def api_login(self, b):
        email = (b.get("email") or "").strip().lower()
        if too_many("login-ip:" + self.client_ip(), 30, 900) or too_many("login:" + email, 8, 900):
            return self.error("로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하거나 비밀번호 찾기를 이용해 주세요.", 429)
        u = db.one("SELECT * FROM users WHERE email=?", email)
        # 가입 여부와 관계없이 같은 계산을 해서 응답 시간으로 회원 여부를 알 수 없게 함
        h = hash_pw(b.get("password") or "", u["salt"] if u else _DUMMY_SALT)[0]
        if not u or not hmac.compare_digest(h, u["pw_hash"]):
            return self.error("이메일 또는 비밀번호가 올바르지 않습니다.", 401)
        clear_attempts("login:" + email)
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
        if not u.get("ai_consent_at"):
            if not b.get("ai_consent"):
                return self.error("AI 풀이를 위한 개인정보 국외 이전에 동의해 주세요.", need_consent=True)
            db.run("UPDATE users SET ai_consent_at=? WHERE id=?", billing.iso(datetime.now()), u["id"])
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
        chart, luck = chart_for(p)
        partner = chart_of_birth(pbirth)
        comp = compatibility(chart, partner)  # 계산은 무료라 저장본을 돌려줄 때도 점수를 다시 계산
        if not b.get("refresh"):
            cached = db.one("SELECT * FROM readings WHERE user_id=? AND kind='match' AND cache_key=? ORDER BY id DESC LIMIT 1",
                            u["id"], key)
            if cached:
                return self.send_json({"markdown": cached["content"], "engine": cached["engine"], "score": comp["score"],
                                       "created_at": cached["created_at"], "cached": True, "partner_name": pname,
                                       "relation": relation})
        today = date.today().isoformat()
        cnt = db.one("SELECT COUNT(*) c FROM readings WHERE user_id=? AND kind='match' AND created_at >= ?", u["id"], today)["c"]
        if cnt >= MATCH_DAILY_LIMIT:
            return self.error(f"궁합은 하루 {MATCH_DAILY_LIMIT}번까지 볼 수 있습니다. 내일 다시 이용해 주세요.", 429)
        res = interpret.match_reading(chart, luck, p["situation"], partner, comp, u["name"], pname, relation)
        n = billing.iso(datetime.now())
        db.run("INSERT INTO readings(user_id,kind,question,content,engine,cache_key,created_at) VALUES (?,?,?,?,?,?,?)",
               u["id"], "match", f"{pname}님과의 궁합" + (f" ({relation})" if relation else ""), res["markdown"],
               res["engine"], key, n)
        self.send_json(dict(res, score=comp["score"], partner_name=pname, relation=relation, created_at=n, cached=False))

    # -- 손님 신청서 (공개)
    def api_apply_config(self, q):
        self.send_json({"products": products.public(), "bank": bool(orders.BANK_ACCOUNT), "free_first": orders.FREE_FIRST,
                        "cities": list(CITIES.keys()),
                        "concerns": {k: v["label"] for k, v in K.CONCERNS.items()}})

    def read_order_form(self, b):
        """신청서·직접 입력 공통 검사. (product, name, email, birth, partner, situation) — 잘못되면 ValueError."""
        product = b.get("product")
        if product not in orders.PRODUCTS or orders.PRODUCTS[product].get("hidden"):
            raise ValueError("상품을 선택해 주세요.")
        name = (b.get("name") or "").strip()[:20]
        email = (b.get("email") or "").strip().lower()[:120]
        if not name:
            raise ValueError("이름을 입력해 주세요. 입금자 이름과 같게 적어 주세요.")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("풀이를 받을 이메일을 정확히 입력해 주세요.")
        birth = parse_birth(b.get("birth") or {})
        partner = None
        need = orders.PRODUCTS[product]["partner"]  # None | required | optional | pet
        p = b.get("partner") or {}
        given = bool(str((p.get("birth") or {}).get("year") or "").strip())
        if need in ("required", "pet") or (need == "optional" and given):
            who = "반려동물 정보: " if need == "pet" else "상대방 정보: "
            try:
                pbirth = parse_birth(p.get("birth") or {}, min_year=1900)
            except ValueError as e:
                raise ValueError(who + str(e))
            default_name = "우리 아이" if need == "pet" else "상대"
            partner = {"name": (p.get("name") or "").strip()[:20] or default_name,
                       "relation": (p.get("relation") or "").strip()[:20] or ("반려동물" if need == "pet" else ""),
                       "birth": pbirth, "kind": "pet" if need == "pet" else "person"}
        sit = b.get("situation") or {}
        sit = {k: str(sit.get(k, "")).strip()[:2000] for k in ("job", "concern", "story", "goal")}
        if sit["concern"] not in K.CONCERNS:
            sit["concern"] = ""
        if len(sit["story"]) < 10:
            raise ValueError("지금 상황이나 궁금한 점을 10자 이상 적어 주세요. 구체적일수록 풀이가 정확해집니다."
                             if product != "counsel" else "질문을 10자 이상 적어 주세요.")
        return product, name, email, birth, partner, sit

    def api_apply(self, b):
        if not b.get("agree") or not b.get("agree_ai"):
            return self.error("개인정보 수집·이용과 AI 풀이를 위한 국외 이전에 모두 동의해 주세요.")
        if too_many("apply:" + self.client_ip(), 10, 3600):
            return self.error("신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
        try:
            form = self.read_order_form(b)
        except ValueError as e:
            return self.error(str(e))
        src = str(b.get("src") or "").strip().lower()[:20]
        product, name, email, birth = form[:4]
        free = not orders.PRODUCTS[product].get("subscription") and orders.free_eligible(name, email, birth)
        o = orders.create(*form, source="apply", ip=self.client_ip(), free=free,
                          channel=src if re.match(r"^[a-z0-9_-]+$", src) else None)
        prod = orders.PRODUCTS[o["product"]]
        bank = orders.BANK_ACCOUNT or "(입금 계좌는 곧 메일로 안내해 드립니다)"
        if free:
            mailer.send(o["email"], f"[운결] 첫 풀이 무료 신청이 접수되었습니다 ({o['code']})",
                        f"{o['name']}님, 운결에 사주 풀이를 신청해 주셔서 감사합니다.\n\n"
                        f"신청번호: {o['code']}\n상품: {prod['label']} (첫 1회 무료)\n\n"
                        "입금하실 필요 없어요. 풀이를 정성껏 작성해 1~2일 안에 이 메일 주소로 PDF로 보내드립니다.")
        else:
            mailer.send(o["email"], f"[운결] {prod['label']} 신청이 접수되었습니다 ({o['code']})",
                        f"{o['name']}님, 운결에 사주 풀이를 신청해 주셔서 감사합니다.\n\n"
                        f"신청번호: {o['code']}\n상품: {prod['label']}\n금액: {o['amount']:,}원\n입금 계좌: {bank}\n"
                        f"입금자명: {o['name']}\n\n입금이 확인되면 풀이를 정성껏 작성해 이 메일 주소로 PDF로 보내드립니다.\n"
                        "보통 입금 확인 후 1~2일 안에 받아보실 수 있어요.")
        price = "무료(첫 1회)" if free else f"{o['amount']:,}원"
        for admin_email in orders.ADMIN_EMAILS:
            mailer.send(admin_email, f"[운결] 새 신청 {o['code']} — {o['name']} / {prod['label']} {price}",
                        f"새 신청이 들어왔습니다.\n\n{o['name']} ({o['email']})\n{prod['label']} {price}\n"
                        f"관리 화면: {PUBLIC_URL}/admin")
        self.send_json({"ok": True, "code": o["code"], "amount": o["amount"], "product": prod["label"], "free": free, "key": o["product"],
                        "name": o["name"], "bank": orders.BANK_ACCOUNT})

    # -- 사장님 관리 화면
    def api_admin_orders(self, q):
        if self.need_admin():
            self.send_json({"orders": orders.listing(q.get("status") or None), "status": orders.STATUS,
                            "products": orders.PRODUCTS, "ai": [llm.label(n) for n in llm.available()],
                            "mail_mode": mailer.MODE, "bank": orders.BANK_ACCOUNT, "mac_online": mac_online(), "started_at": STARTED_AT,
                            "outbox_waiting": db.one("SELECT COUNT(*) c FROM outbox WHERE sent_at IS NULL AND tries < 5")["c"],
                            "outbox_failed": db.one("SELECT COUNT(*) c FROM outbox WHERE sent_at IS NULL AND tries >= 5")["c"],
                            "concerns": {k: v["label"] for k, v in K.CONCERNS.items()}, "cities": list(CITIES.keys())})

    def order_or_404(self, oid):
        try:
            o = orders.get(int(oid))
        except (TypeError, ValueError):
            o = None
        if not o:
            self.error("신청을 찾을 수 없습니다.", 404)
        return o

    def api_admin_order(self, q):
        if not self.need_admin():
            return
        o = self.order_or_404(q.get("id"))
        if o:
            chart = chart_of_birth(o["birth"])
            self.send_json({"order": o, "chart_text": interpret.chart_summary(chart, current_luck(chart))})

    def api_admin_create(self, b):
        """카톡·DM 등으로 따로 받은 손님을 사장님이 직접 입력. 바로 '입금 확인' 상태로 만든다."""
        if not self.need_admin():
            return
        try:
            form = self.read_order_form(b)
        except ValueError as e:
            return self.error(str(e))
        o = orders.create(*form, source="manual", status="paid" if b.get("paid", True) else "pending")
        self.send_json({"ok": True, "order": o})

    def api_admin_status(self, b):
        if not self.need_admin():
            return
        o = self.order_or_404(b.get("id"))
        if not o:
            return
        if b.get("status") not in orders.STATUS:
            return self.error("알 수 없는 상태입니다.")
        orders.set_status(o["id"], b["status"])
        if b["status"] == "paid" and orders.PRODUCTS.get(o["product"], {}).get("subscription") and o["status"] == "pending":
            s = subs.activate(o)  # 구독: 입금 확인 = 30일 구독 시작/연장 → 신청은 '발송 완료'로
            orders.set_status(o["id"], "sent")
            orders.save_note(o["id"], f"구독 {s['ends_on']}까지")
        if "note" in b:
            orders.save_note(o["id"], str(b.get("note") or "")[:2000])
        self.send_json({"ok": True, "order": orders.get(o["id"])})

    def api_admin_generate(self, b):
        """신청서 정보로 긴 풀이 생성 (장마다 AI 호출 → 상품에 따라 2~13회). 뒤에서 돌리고 화면은 진행 상황을 확인한다."""
        if not self.need_admin():
            return
        o = self.order_or_404(b.get("id"))
        if not o:
            return
        if o.get("gen_state") in ("running", "mac_wait", "mac_running"):
            return self.error("이미 풀이를 만드는 중입니다. 잠시만 기다려 주세요.", 409)
        if o["content"] and not b.get("overwrite"):
            return self.error("이미 작성된 풀이가 있습니다. 새로 만들면 지금 글이 사라집니다.", 409, need_overwrite=True)
        total = len(orders.PRODUCTS.get(o["product"], {}).get("chapters", [])) or 1
        if b.get("engine") == "mac":
            # 맥북의 챗GPT 구독(코덱스)이 가져가서 쓴다 (tools/saju_worker.py)
            orders.set_gen(o["id"], "mac_wait", "맥북이 가져가기를 기다리는 중")
            return self.send_json({"ok": True, "started": True, "order": orders.get(o["id"])})
        orders.set_gen(o["id"], "running", f"0/{total}")

        def job():
            try:
                chart = chart_of_birth(o["birth"])
                partner = chart_of_birth(o["partner"]["birth"]) if o.get("partner") else None
                res = longform.generate(o, chart, partner,
                                        progress=lambda d, t: orders.set_gen(o["id"], "running", f"{d}/{t}"))
                orders.save_content(o["id"], res["markdown"], res["engine"])
                if o["status"] in ("pending", "paid"):
                    orders.set_status(o["id"], "writing")
                orders.set_gen(o["id"], "done", f"{total}/{total}")
            except Exception as e:  # noqa
                import traceback
                traceback.print_exc()
                orders.set_gen(o["id"], "error", str(e)[:200])

        threading.Thread(target=job, daemon=True).start()
        self.send_json({"ok": True, "started": True, "order": orders.get(o["id"])})

    # -- 메일 보관함: 맥북 일꾼이 가져가 Gmail로 보낸다 (서버는 메일 포트가 막혀 있음)
    def api_admin_outbox(self, q):
        if not self.need_admin():
            return
        promo.kv_set("mac_seen", promo.now())
        rows = db.all_("SELECT * FROM outbox WHERE sent_at IS NULL AND tries < 5 ORDER BY id LIMIT 5")
        for r in rows:
            r["files"] = json.loads(r["files"] or "[]")
        self.send_json({"mails": rows})

    def api_admin_outbox_done(self, b):
        if not self.need_admin():
            return
        try:
            mid = int(b.get("id"))
        except (TypeError, ValueError):
            return self.error("메일을 찾을 수 없습니다.", 404)
        if b.get("ok"):
            db.run("UPDATE outbox SET sent_at=datetime('now','localtime'), error=NULL WHERE id=?", mid)
        else:
            db.run("UPDATE outbox SET tries=tries+1, error=? WHERE id=?", str(b.get("error") or "")[:300], mid)
        self.send_json({"ok": True})

    # -- 월 구독 (매일 아침 오늘의 흐름)
    def api_admin_subs(self, q):
        if self.need_admin():
            rows = subs.listing()
            self.send_json({"subs": rows, "active": sum(1 for r in rows if r["status"] == "active"),
                            "send_hour": subs.SEND_HOUR, "mail_mode": mailer.MODE})

    def api_admin_subs_update(self, b):
        if not self.need_admin():
            return
        action = b.get("action")
        try:
            sid = int(b.get("id"))
        except (TypeError, ValueError):
            return self.error("구독을 찾을 수 없습니다.", 404)
        if action == "extend":
            s = subs.set_status(sid, "active", extend_days=int(b.get("days") or 30))
        elif action == "story":
            s = subs.set_story(sid, b.get("story") or "")
        elif action in ("pause", "resume"):
            s = subs.set_status(sid, "paused" if action == "pause" else "active")
        else:
            return self.error("알 수 없는 작업입니다.")
        if not s:
            return self.error("구독을 찾을 수 없습니다.", 404)
        self.send_json({"ok": True, "sub": {k: s[k] for k in ("id", "status", "ends_on")}})

    def api_admin_subs_send_now(self, b):
        """아침 시간을 기다리지 않고, 오늘 아직 못 받은 구독자에게 지금 보내기."""
        if self.need_admin():
            self.send_json({"ok": True, "sent": subs.send_due(chart_of_birth, PUBLIC_URL)})

    def stop_page(self, q):
        """구독 메일 하단 '그만 받기' 링크."""
        s = subs.stop(q.get("t"))
        msg = (f"{s['name']}님, 매일 아침 메일을 더 보내지 않을게요. 그동안 고마웠어요." if s
               else "이미 그만 받기 처리되었거나 링크가 올바르지 않아요.")
        body = (f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<title>운결</title><body style="background:#0b0910;color:#efe8f5;font-family:sans-serif;text-align:center;padding:60px 20px">'
                f'<p style="font-size:18px">{msg}</p><p><a style="color:#d9b26a" href="/">운결 첫 화면</a></p></body>').encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_admin_owner_reset(self, b):
        """사장님이 비밀번호를 잊었을 때: 맥북의 비밀 열쇠(ADMIN_API_KEY)로만 '새 비밀번호 정하기' 링크를 만든다.
        메일 설정 전이라 비밀번호 찾기 메일이 안 갈 때 쓰는 비상구. 사장님 계정(ADMIN_EMAIL)에만 쓸 수 있다."""
        key = os.environ.get("ADMIN_API_KEY", "")
        if not (len(key) >= 24 and hmac.compare_digest(self.headers.get("X-Admin-Key", ""), key)):
            return self.error("not found", 404)
        email = (b.get("email") or "").strip().lower()
        u = db.one("SELECT * FROM users WHERE email=?", email)
        if not u or email not in orders.ADMIN_EMAILS:
            return self.error("사장님 계정을 찾을 수 없습니다.", 404)
        clear_attempts("login:" + email)  # 로그인 잠김도 풀기
        raw = issue_email_token(u["id"], "reset", RESET_TTL_H)
        print(f"[비상] 사장님 비밀번호 재설정 링크 발급 ({email})")
        self.send_json({"ok": True, "link": f"{PUBLIC_URL}/admin#/reset?token={raw}", "valid_hours": RESET_TTL_H})

    # -- 맥북 일꾼(tools/saju_worker.py): 맥북의 챗GPT 구독으로 풀이를 써서 올려 준다
    def api_admin_jobs(self, q):
        if not self.need_admin():
            return
        promo.kv_set("mac_seen", promo.now())
        ids = [r["id"] for r in db.all_("SELECT id FROM orders WHERE gen_state='mac_wait' ORDER BY id LIMIT 3")]
        self.send_json({"jobs": [orders.get(i) for i in ids]})

    def api_admin_job_update(self, b):
        """맥북 일꾼의 진행 보고: state = running(진행 n/N) | done(풀이 도착) | error"""
        if not self.need_admin():
            return
        o = self.order_or_404(b.get("id"))
        if not o:
            return
        state = b.get("state")
        if state == "claim":
            if o.get("gen_state") != "mac_wait":
                return self.error("이미 다른 곳에서 처리 중입니다.", 409)
            orders.set_gen(o["id"], "mac_running", "맥북에서 쓰는 중")
        elif state == "running":
            orders.set_gen(o["id"], "mac_running", str(b.get("progress") or "")[:40])
        elif state == "done":
            text = str(b.get("markdown") or "")
            if len(text) < 50:
                return self.error("풀이가 비어 있습니다.")
            orders.save_content(o["id"], text[:120_000], str(b.get("engine") or "mac")[:60])
            if o["status"] in ("pending", "paid"):
                orders.set_status(o["id"], "writing")
            orders.set_gen(o["id"], "done", "맥북에서 완료")
        else:
            orders.set_gen(o["id"], "error", ("맥북: " + str(b.get("error") or "알 수 없는 오류"))[:200])
        self.send_json({"ok": True})

    def api_admin_save(self, b):
        if not self.need_admin():
            return
        o = self.order_or_404(b.get("id"))
        if not o:
            return
        orders.save_content(o["id"], str(b.get("content") or "")[:60_000])
        self.send_json({"ok": True, "order": orders.get(o["id"])})

    def order_pdf(self, o):
        import pdf_report  # reportlab 이 없는 환경에서도 나머지 기능은 돌아가게 필요할 때만 불러옴
        name = f"운결_{o['name']}_{o['product_label'].split(' (')[0].replace(' ', '')}.pdf"
        return name, pdf_report.build(o, chart_of_birth(o["birth"]))

    def api_admin_pdf(self, q):
        """보내기 전 미리보기: 브라우저 새 탭에서 PDF 열기."""
        if not self.need_admin():
            return
        o = self.order_or_404(q.get("id"))
        if not o:
            return
        if not o["content"]:
            return self.error("풀이를 먼저 만들어 주세요.")
        name, data = self.order_pdf(o)
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", "inline; filename*=UTF-8''" + quote(name))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def api_admin_send(self, b):
        """풀이 PDF를 손님 이메일로 보내고 '발송 완료'로 바꾼다."""
        if not self.need_admin():
            return
        o = self.order_or_404(b.get("id"))
        if not o:
            return
        if not o["content"] or len(o["content"].strip()) < 50:
            return self.error("보낼 풀이가 없습니다. 풀이를 만들고 저장한 뒤 보내 주세요.")
        if o["status"] == "sent" and not b.get("resend"):
            return self.error("이미 보낸 신청입니다. 다시 보낼까요?", 409, need_resend=True)
        name, data = self.order_pdf(o)
        label = o["product_label"].split(" (")[0]
        ok_ = mailer.send(o["email"], f"[운결] {o['name']}님께 보내드리는 {label}",
                          f"{o['name']}님, 안녕하세요. 운결입니다.\n\n"
                          f"신청해 주신 {label} 결과를 정성껏 작성해 PDF로 첨부해 드립니다.\n"
                          "천천히 읽어 보시고, 궁금한 점이 있으면 이 메일에 답장 주세요.\n\n"
                          "사주는 정해진 운명이 아니라 타고난 기운의 지도예요. 오늘의 선택에 작은 힌트가 되길 바랍니다.\n\n"
                          f"운결 드림\n{PUBLIC_URL}", attachments=[(name, data, "application/pdf")])
        if not ok_:
            return self.error("메일 발송에 실패했습니다. 메일 설정(SMTP)과 손님 이메일 주소를 확인해 주세요.", 502)
        orders.set_status(o["id"], "sent")
        self.send_json({"ok": True, "mail_mode": mailer.MODE, "order": orders.get(o["id"])})

    # -- 홍보 센터
    def api_admin_promo(self, q):
        if not self.need_admin():
            return
        th = {"configured": threads.configured(), "username": None, "error": None}
        if th["configured"] and q.get("check") == "1":
            try:
                th["username"] = threads.me().get("username")
            except threads.ThreadsError as e:
                th["error"] = str(e)
        self.send_json({"channels": promo.CHANNELS, "themes": promo.THEMES, "products": products.public(), "drafts": promo.listing("draft"),
                        "scheduled": sorted(promo.listing("scheduled"), key=lambda x: x["scheduled_at"] or ""),
                        "auto": {"on": promo.auto_drafts_on(), "hour": promo.DRAFT_HOUR, "times": promo.POST_TIMES},
                        "posted": promo.listing("posted")[:30], "stats": promo.channel_stats(), "threads": th,
                        "links": {k: promo.link_for(PUBLIC_URL, k) for k in promo.CHANNELS},
                        "ai": [llm.label(n) for n in llm.available()], "refs": promo.kv_get("promo_refs", "")})

    def api_admin_promo_refs(self, b):
        """잘 되는 다른 계정 글을 붙여넣어 두면, 글 후보를 만들 때 구조를 참고한다."""
        if self.need_admin():
            promo.kv_set("promo_refs", str(b.get("refs") or "")[:8000])
            self.send_json({"ok": True})

    def promo_or_404(self, pid):
        try:
            p = promo.get(int(pid))
        except (TypeError, ValueError):
            p = None
        if not p:
            self.error("글을 찾을 수 없습니다.", 404)
        return p

    def api_admin_promo_generate(self, b):
        """채널별 글 후보 만들기. AI가 켜져 있으면 유료 호출 1회(후보 여러 개)."""
        if not self.need_admin():
            return
        ch = b.get("channel")
        if ch not in promo.CHANNELS:
            return self.error("채널을 골라 주세요.")
        n = max(1, min(int(b.get("n") or 5), 8))
        self.send_json({"ok": True, "drafts": promo.generate_drafts(ch, n, orders.PRODUCTS, b.get("theme"))})

    def api_admin_promo_save(self, b):
        if not self.need_admin():
            return
        p = self.promo_or_404(b.get("id"))
        if p:
            promo.update(p["id"], text=str(b.get("text") or "")[:promo.CHANNELS[p["channel"]]["limit"]])
            self.send_json({"ok": True})

    def api_admin_promo_discard(self, b):
        if not self.need_admin():
            return
        p = self.promo_or_404(b.get("id"))
        if p:
            promo.update(p["id"], status="discarded")
            self.send_json({"ok": True})

    def api_admin_promo_post(self, b):
        """승인. 스레드는 바로 게시(+신청서 링크 댓글), 인스타·당근은 '올렸음'으로 표시만."""
        if not self.need_admin():
            return
        p = self.promo_or_404(b.get("id"))
        if not p:
            return
        text = str(b.get("text") or p["text"]).strip()
        if not text:
            return self.error("글이 비어 있습니다.")
        if p["status"] == "posted":
            return self.error("이미 올린 글입니다.", 409)
        if p["channel"] == "threads" and b.get("schedule"):
            if not threads.configured():
                return self.error("스레드 연결 전에는 예약할 수 없어요. '복사'해서 직접 올려 주세요.")
            return self.send_json({"ok": True, "post": promo.schedule(p["id"], text)})
        try:
            publish_post(dict(p, text=text))
        except threads.ThreadsError as e:
            promo.update(p["id"], text=text, error=str(e))
            return self.error(str(e), 502)
        self.send_json({"ok": True, "post": promo.get(p["id"])})

    def api_admin_promo_unschedule(self, b):
        if not self.need_admin():
            return
        p = self.promo_or_404(b.get("id"))
        if p and p["status"] == "scheduled":
            promo.update(p["id"], status="draft", scheduled_at=None)
        self.send_json({"ok": True})

    def api_admin_promo_brief(self, q):
        if self.need_admin():
            self.send_json(promo.brief_data(orders.PRODUCTS))

    def api_admin_promo_import(self, b):
        if not self.need_admin():
            return
        items = b.get("posts") if isinstance(b.get("posts"), list) else []
        saved = promo.import_drafts([i for i in items if isinstance(i, dict)], str(b.get("engine") or "external"))
        print(f"[스레드] 밖에서 쓴 글 후보 {len(saved)}개 받음 ({b.get('engine')})")
        self.send_json({"ok": True, "count": len(saved)})

    def api_admin_promo_auto(self, b):
        """매일 아침 스레드 글 후보 자동 생성 켜기/끄기 (켜면 하루 AI 호출 1회)."""
        if self.need_admin():
            promo.kv_set("auto_drafts", "1" if b.get("on") else "0")
            self.send_json({"ok": True, "on": promo.auto_drafts_on()})

    # -- 이메일 인증 · 비밀번호 찾기
    def dev_link(self, link):
        """메일 모의 모드 + 내 컴퓨터(localhost)에서만 화면에 링크를 돌려준다(개발 편의).
        인터넷에 공개된 주소에서 이걸 열면 남의 비밀번호 재설정 링크를 받아갈 수 있으므로 절대 열지 않는다."""
        local = urlparse(PUBLIC_URL).hostname in ("localhost", "127.0.0.1")
        return {"dev_link": link} if mailer.MODE == "mock" and local else {}

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
        if too_many("forgot:" + self.client_ip(), 10, 3600):
            return self.error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
        u = db.one("SELECT * FROM users WHERE email=?", email)
        extra = {}
        if u:
            recent = db.one("SELECT COUNT(*) c FROM email_tokens WHERE user_id=? AND purpose='reset' AND created_at >= ?",
                            u["id"], billing.iso(datetime.now() - timedelta(hours=1)))["c"]
            if recent < 3:
                raw = issue_email_token(u["id"], "reset", RESET_TTL_H)
                link = f"{PUBLIC_URL}/admin#/reset?token={raw}"
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

    def api_account_delete(self, b):
        """회원 탈퇴: 사주·고민·상담 기록·인증 정보를 즉시 삭제. 결제 기록만 법정 보관(전자상거래법 5년)."""
        u = self.need_user()
        if not u:
            return
        if too_many("delete:" + str(u["id"]), 5, 900):
            return self.error("시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
        if not hmac.compare_digest(hash_pw(b.get("password") or "", u["salt"])[0], u["pw_hash"]):
            return self.error("비밀번호가 올바르지 않습니다.", 401)
        uid = u["id"]
        for sql in ("DELETE FROM readings WHERE user_id=?", "DELETE FROM profiles WHERE user_id=?",
                    "DELETE FROM email_tokens WHERE user_id=?", "DELETE FROM subscriptions WHERE user_id=?",
                    "DELETE FROM users WHERE id=?"):
            db.run(sql, uid)
        print(f"[탈퇴] 회원 {uid} 데이터 삭제 완료")
        self.send_json({"ok": True}, cookie=self.cookie("", 0))

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
            return self.redirect("/app#/subscribe?fail=결제 세션이 만료되었습니다. 다시 시도해 주세요.")
        user = db.one("SELECT * FROM users WHERE id=?", pend[0])
        ok, res = billing.issue_billing_key(auth, ck)
        if not ok:
            return self.redirect("/app#/subscribe?fail=" + res.get("message", "카드 등록 실패"))
        card = res.get("card") or {}
        ok, info = billing.activate(user, pend[1], res["billingKey"], ck, f"{card.get('cardType','')} {card.get('number','')}".strip())
        if not ok:
            return self.redirect("/app#/subscribe?fail=" + str(info))
        self.redirect("/app#/account?welcome=1")

    def api_billing_mock(self, b):
        """결제 키가 없는 개발 환경용: 카드 등록과 결제를 시뮬레이션."""
        if billing.MODE != "mock" or not ALLOW_MOCK_BILLING:
            return self.error("결제 시뮬레이션은 사용할 수 없습니다.", 403)
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
        if billing.MODE != "mock" or not ALLOW_MOCK_BILLING:
            return self.error("개발 모드에서만 사용할 수 있습니다.", 403)
        u = self.need_user()
        if not u:
            return
        past = billing.iso(datetime.now() - timedelta(minutes=1))
        db.run("UPDATE users SET trial_ends_at=? WHERE id=?", past, u["id"])
        db.run("UPDATE subscriptions SET current_period_end=? WHERE user_id=? AND current_period_end > ?", past, u["id"], past)
        billing.run_renewals()
        self.send_json({"ok": True, "access": billing.access(db.one("SELECT * FROM users WHERE id=?", u["id"]))})


def mac_online():
    """맥북 일꾼이 최근 1분 안에 들렀으면 켜져 있는 것."""
    seen = promo.kv_get("mac_seen")
    return bool(seen) and datetime.now() - datetime.fromisoformat(seen) < timedelta(seconds=60)


def publish_post(p):
    """홍보 글 게시. 스레드는 실제로 올리고(+첫 댓글 신청서 링크), 인스타·당근은 '올렸음' 기록만."""
    post_id = permalink = None
    if p["channel"] == "threads":
        link = promo.link_for(PUBLIC_URL, "threads")
        if (p["theme"] or "").startswith("product:"):  # 상품 시리즈 글이면 그 상품을 미리 골라둔 링크
            link += "&p=" + p["theme"].split(":", 1)[1]
        comment = os.environ.get("THREADS_LINK_TEXT", "내 사주 풀이 신청은 여기서 할 수 있어요 👉 {link}").replace("{link}", link)
        post_id, permalink = threads.post(p["text"], comment)
    promo.update(p["id"], text=p["text"], status="posted", post_id=post_id, permalink=permalink, error=None,
                 posted_at=promo.now())


def main():
    db.conn()
    # 풀이를 만들던 중 서버가 꺼졌으면 '중단'으로 표시 (다시 만들기 버튼이 보이게)
    db.run("UPDATE orders SET gen_state='error', gen_progress='서버가 다시 시작되어 중단됨' WHERE gen_state='running'")
    # 맥북이 쓰던 중이던 건은 다시 대기로 (맥북이 다시 가져감)
    db.run("UPDATE orders SET gen_state='mac_wait', gen_progress='맥북이 가져가기를 기다리는 중' WHERE gen_state='mac_running'")
    if not IS_LOCAL:
        if billing.MODE == "mock":
            print("⚠️  결제 키 없이 공개 주소로 실행 중: " + ("결제 시뮬레이션 허용(ALLOW_MOCK_BILLING=1)" if ALLOW_MOCK_BILLING else "구독 결제 불가"))
        if mailer.MODE == "mock":
            print("⚠️  메일 설정 없음: 인증·비밀번호 찾기 메일이 실제로 발송되지 않습니다.")
        if not HTTPS:
            print("⚠️  PUBLIC_URL 이 https 가 아닙니다. 공개 서비스는 반드시 https 로 운영하세요.")
    billing.start_scheduler()
    promo.start_scheduler(publish_post, orders.PRODUCTS, stats=threads.insights if threads.configured() else None)
    subs.start_scheduler(chart_of_birth, PUBLIC_URL)
    print(f"운결 사주 서버 실행: {PUBLIC_URL}  (AI: {' → '.join(llm.label(n) for n in llm.available()) or '규칙 기반'}, 결제: {billing.MODE}, 메일: {mailer.MODE})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
