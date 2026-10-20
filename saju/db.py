import os
import sqlite3
import threading

DB_PATH = os.environ.get("SAJU_DB", os.path.join(os.path.dirname(__file__), "data", "saju.db"))
_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  trial_ends_at TEXT NOT NULL,
  marketing_ok INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY,
  birth TEXT NOT NULL,          -- JSON: year, month, day, hour, minute, gender, city
  situation TEXT NOT NULL,      -- JSON: job, concern, story, mood, goal
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- full | counsel | daily
  question TEXT,
  content TEXT NOT NULL,
  engine TEXT,
  cache_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_user ON readings(user_id, kind, created_at);
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,  -- 원래 토큰은 저장하지 않고 sha256 만 저장
  user_id INTEGER NOT NULL,
  purpose TEXT NOT NULL,        -- verify | reset
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,         -- active | canceled | past_due | expired
  provider TEXT NOT NULL,       -- mock | toss
  customer_key TEXT,
  billing_key TEXT,
  card_info TEXT,
  current_period_end TEXT NOT NULL,
  canceled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,         -- paid | failed
  raw TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,     -- 손님에게 알려주는 신청번호
  product TEXT NOT NULL,
  amount INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  birth TEXT NOT NULL,           -- JSON (server.parse_birth 결과)
  partner TEXT,                  -- 궁합일 때 상대 JSON: {name, relation, birth}
  situation TEXT NOT NULL,       -- JSON: job, concern, story, goal
  status TEXT NOT NULL,
  content TEXT,                  -- 풀이(마크다운). 사장님이 고친 최종본
  engine TEXT,
  note TEXT,                     -- 사장님 메모
  source TEXT NOT NULL,          -- apply(신청서) | manual(사장님 직접 입력)
  channel TEXT,                  -- 들어온 홍보 채널: threads | instagram | daangn | (없으면 직접)
  ip TEXT,
  consent_at TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE TABLE IF NOT EXISTS promo_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,          -- threads | instagram | daangn
  theme TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL,           -- draft | scheduled(예약) | posted | discarded
  engine TEXT,
  post_id TEXT,                   -- 스레드 게시물 번호
  permalink TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ref_codes (code TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);  -- 친구 초대 코드
CREATE TABLE IF NOT EXISTS ref_credits (email TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0);  -- 초대로 받은 무료 횟수
CREATE TABLE IF NOT EXISTS ad_optout (email TEXT PRIMARY KEY, at TEXT NOT NULL);  -- 광고 메일 수신거부
CREATE TABLE IF NOT EXISTS outbox (    -- 맥북이 대신 보낼 메일 (mailer.MODE == relay)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  files TEXT,                       -- JSON [{name, type, data(base64)}]
  created_at TEXT NOT NULL,
  sent_at TEXT,
  tries INTEGER DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  birth TEXT NOT NULL,             -- JSON
  situation TEXT NOT NULL,         -- JSON
  status TEXT NOT NULL,            -- active | expired | stopped(손님이 그만 받기) | paused(사장님이 멈춤)
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,           -- 이 날까지 발송
  last_sent TEXT,                  -- 마지막 발송 날짜
  sent_count INTEGER DEFAULT 0,
  token TEXT UNIQUE NOT NULL,      -- 그만 받기 링크용
  last_order INTEGER,
  renew_noticed TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def conn():
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        c = sqlite3.connect(DB_PATH, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        _migrate(c)
        _local.conn = c
    return c


def _migrate(c):
    """예전 DB에 없는 칸을 추가한다."""
    cols = {r[1] for r in c.execute("PRAGMA table_info(users)")}
    if "email_verified" not in cols:
        c.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0")
    if "ai_consent_at" not in cols:
        c.execute("ALTER TABLE users ADD COLUMN ai_consent_at TEXT")  # 개인정보 국외 이전(AI) 동의 시각
    if "channel" not in {r[1] for r in c.execute("PRAGMA table_info(orders)")}:
        c.execute("ALTER TABLE orders ADD COLUMN channel TEXT")  # 손님이 들어온 홍보 채널(?src=)
    if "scheduled_at" not in {r[1] for r in c.execute("PRAGMA table_info(promo_posts)")}:
        c.execute("ALTER TABLE promo_posts ADD COLUMN scheduled_at TEXT")  # 예약 게시 시각
    pcols = {r[1] for r in c.execute("PRAGMA table_info(promo_posts)")}
    for col in ("views", "likes", "replies", "reposts"):  # 스레드 성적 (하루 몇 번 갱신)
        if col not in pcols:
            c.execute(f"ALTER TABLE promo_posts ADD COLUMN {col} INTEGER")
    if "stats_at" not in pcols:
        c.execute("ALTER TABLE promo_posts ADD COLUMN stats_at TEXT")
    ocols = {r[1] for r in c.execute("PRAGMA table_info(orders)")}
    if "ref_from" not in ocols:
        c.execute("ALTER TABLE orders ADD COLUMN ref_from TEXT")    # 이 손님을 초대한 사람 이메일
        c.execute("ALTER TABLE orders ADD COLUMN free_kind TEXT")   # 무료 이유: first(첫 1회) | ref(친구 초대로 받은 무료)
    if "marketing_ok" not in ocols:
        c.execute("ALTER TABLE orders ADD COLUMN marketing_ok INTEGER DEFAULT 0")  # [선택] 소식 받기 동의
        c.execute("ALTER TABLE orders ADD COLUMN followup_at TEXT")                # 풀이 뒤 안부 메일 보낸 때
    scols = {r[1] for r in c.execute("PRAGMA table_info(subs)")}
    if "winback_at" not in scols:
        c.execute("ALTER TABLE subs ADD COLUMN winback_at TEXT")                   # 구독 끝난 뒤 복귀 안내 보낸 때
    if "gen_state" not in ocols:
        c.execute("ALTER TABLE orders ADD COLUMN gen_state TEXT")      # 긴 풀이 생성: running | done | error
        c.execute("ALTER TABLE orders ADD COLUMN gen_progress TEXT")   # 예) 3/8
    c.commit()


def one(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def all_(sql, *args):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def run(sql, *args):
    c = conn()
    cur = c.execute(sql, args)
    c.commit()
    return cur.lastrowid
