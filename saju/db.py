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
