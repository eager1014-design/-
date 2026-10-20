"""1인 상담 판매: 손님 신청서 → 계좌이체 → 사장님이 풀이 작성 → PDF 메일 발송.

상품 가격·입금 계좌는 saju/.env 에서 바꾼다 (코드 수정 없이).
  PRICE_<상품키>  상품 가격(원). 예) PRICE_NEWYEAR=12900  (상품 목록은 products.py)
  BANK_ACCOUNT   신청 완료 화면·안내 메일에 보여줄 입금 계좌. 예) 카카오뱅크 3333-00-0000000 홍길동
  ADMIN_EMAIL    사장님 로그인 이메일(쉼표로 여러 개). 이 계정만 /admin 을 열 수 있고, 새 신청 알림을 받는다.
"""
import json
import os
import secrets
from datetime import datetime

import db
import products

PRODUCTS = products.PRODUCTS  # 상품·가격·목차는 products.py

# 진행 상태: 입금 대기 → 입금 확인 → 풀이 작성 중 → 발송 완료 (또는 취소)
STATUS = {"pending": "입금 대기", "paid": "입금 확인", "writing": "풀이 작성 중", "sent": "발송 완료", "canceled": "취소"}

BANK_ACCOUNT = os.environ.get("BANK_ACCOUNT", "").strip()
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "").split(",") if e.strip()}


def now():
    return datetime.now().isoformat(timespec="seconds")


def new_code():
    # 헷갈리는 글자(0/O, 1/I) 빼고 4자리 → 예) UG1019-K7QX
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = datetime.now().strftime("UG%m%d-") + "".join(secrets.choice(alphabet) for _ in range(4))
        if not db.one("SELECT id FROM orders WHERE code=?", code):
            return code


def is_admin(user):
    return bool(user) and user["email"].lower() in ADMIN_EMAILS


def create(product, name, email, birth, partner, situation, source, ip=None, status="pending", channel=None):
    code = new_code()
    n = now()
    oid = db.run("""INSERT INTO orders(code,product,amount,name,email,birth,partner,situation,status,source,ip,consent_at,
                    created_at,updated_at,paid_at,channel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 code, product, PRODUCTS[product]["price"], name, email, json.dumps(birth, ensure_ascii=False),
                 json.dumps(partner, ensure_ascii=False) if partner else None, json.dumps(situation, ensure_ascii=False),
                 status, source, ip, n if source == "apply" else None, n, n, n if status == "paid" else None, channel)
    return get(oid)


def get(oid):
    o = db.one("SELECT * FROM orders WHERE id=?", oid)
    if not o:
        return None
    for k in ("birth", "partner", "situation"):
        o[k] = json.loads(o[k]) if o[k] else None
    o["product_label"] = PRODUCTS.get(o["product"], {}).get("label", o["product"])
    o["status_label"] = STATUS.get(o["status"], o["status"])
    return o


def listing(status=None):
    sql = "SELECT id,code,product,amount,name,email,status,source,channel,created_at,paid_at,sent_at FROM orders"
    rows = db.all_(sql + (" WHERE status=?" if status else "") + " ORDER BY id DESC LIMIT 300", *([status] if status else []))
    for r in rows:
        r["product_label"] = PRODUCTS.get(r["product"], {}).get("label", r["product"])
        r["status_label"] = STATUS.get(r["status"], r["status"])
    return rows


def set_status(oid, status):
    extra = {"paid": ", paid_at=COALESCE(paid_at, ?)", "sent": ", sent_at=?"}.get(status, "")
    args = [status, now()] + ([now()] if extra else []) + [oid]
    db.run(f"UPDATE orders SET status=?, updated_at=?{extra} WHERE id=?", *args)


def save_content(oid, content, engine=None):
    if engine:
        db.run("UPDATE orders SET content=?, engine=?, updated_at=? WHERE id=?", content, engine, now(), oid)
    else:
        db.run("UPDATE orders SET content=?, updated_at=? WHERE id=?", content, now(), oid)


def save_note(oid, note):
    db.run("UPDATE orders SET note=?, updated_at=? WHERE id=?", note, now(), oid)


def set_gen(oid, state, progress=""):
    """풀이 생성 진행 상황: running(진행 중) | done | error."""
    db.run("UPDATE orders SET gen_state=?, gen_progress=?, updated_at=? WHERE id=?", state, progress, now(), oid)
