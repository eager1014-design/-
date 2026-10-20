"""친구 초대: 손님마다 '나만의 초대 링크'(/?ref=코드). 그 링크로 처음 온 친구가 신청하면
링크를 보낸 사람에게 무료 풀이 1회가 쌓이고, 다음 신청 때 자동으로 쓰인다.

막는 것: 자기 링크로 자기 신청(같은 이메일), 이미 왔던 사람(이메일·이름+생년월일)이 친구로 오는 것.
"""
import os
import secrets
from datetime import datetime

import db

MAX_CREDITS = 10  # 한 사람이 쌓아둘 수 있는 무료 횟수 상한 (부정 사용 대비)


def now():
    return datetime.now().isoformat(timespec="seconds")


def code_for(email):
    """이메일마다 하나의 초대 코드 (처음 부를 때 만든다)."""
    email = email.lower()
    r = db.one("SELECT code FROM ref_codes WHERE email=?", email)
    if r:
        return r["code"]
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not db.one("SELECT code FROM ref_codes WHERE code=?", code):
            db.run("INSERT INTO ref_codes(code,email,created_at) VALUES (?,?,?)", code, email, now())
            return code


def owner_of(code):
    r = db.one("SELECT email FROM ref_codes WHERE code=?", (code or "").strip().upper()[:12])
    return r["email"] if r else None


def credits(email):
    r = db.one("SELECT credits FROM ref_credits WHERE email=?", email.lower())
    return r["credits"] if r else 0


def use_credit(email):
    """무료 1회를 쓴다. 남아 있었으면 True."""
    if credits(email) <= 0:
        return False
    db.run("UPDATE ref_credits SET credits=credits-1 WHERE email=? AND credits>0", email.lower())
    return True


def reward(code, new_email, is_new_person):
    """친구가 초대 링크로 신청했을 때. 링크 주인의 이메일을 돌려준다 (보상이 없으면 None).
    PDF는 언제나 유료라서 '무료 1회' 보상은 기본으로 꺼져 있다 (REF_FREE=1 로만 켬). 평생 종합 친구 할인은 invite.py"""
    if os.environ.get("REF_FREE") != "1":
        return None
    owner = owner_of(code)
    if not owner or owner == new_email.lower() or not is_new_person:
        return None
    if credits(owner) >= MAX_CREDITS:
        return None
    db.run("""INSERT INTO ref_credits(email,credits,earned) VALUES (?,1,1)
              ON CONFLICT(email) DO UPDATE SET credits=credits+1, earned=earned+1""", owner)
    return owner
