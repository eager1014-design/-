"""친구 초대 보상 두 가지 (같은 친구 방문으로 둘 다):
  ① 가벼운 풀이 PDF 1개 무료 (고민상담·연애·반려동물·재회·궁합·직업재물 중, 1인 1회) — invite_pdf
  ② 할인 1회: 평생 종합 9,900원, 기본 사주·신년운세 10% (products.friend_discount)

평생 종합 사주 친구 할인: 내 링크(/?inv=방문자번호)로 온 친구가 '무료 바로 보기'에서 자기 사주를 보면,
나는 평생 종합 사주를 FRIEND_DISCOUNT(기본 9,900원) 깎아 받는다. 1인 1회.

방문자번호(vid)는 손님 폰 브라우저에 저장되는 무작위 값 (개인정보 아님).
친구 한 명은 생년월일·성별로 구분해서, 같은 친구가 여러 번 봐도 한 번으로 센다.
"""
import hashlib
import re
from datetime import datetime

import db
import products


def _ok(vid):
    return bool(vid) and bool(re.match(r"^[A-Za-z0-9]{8,24}$", vid))


def record(inviter_vid, my_vid, birth):
    """친구가 초대 링크로 와서 자기 사주를 봤다."""
    if not _ok(inviter_vid) or inviter_vid == my_vid:
        return False
    key = hashlib.sha256(f"{birth.get('solar')}|{birth.get('gender')}".encode()).hexdigest()[:16]
    db.run("INSERT OR IGNORE INTO invites(vid, friend_key, at) VALUES (?,?,?)", inviter_vid, key,
           datetime.now().isoformat(timespec="seconds"))
    return True


def status(vid, email=None):
    if not _ok(vid):
        return {"friends": 0, "ready": False, "used": False, "amount": products.FRIEND_DISCOUNT,
                "pdf_ready": False, "pdf_used": False}
    friends = db.one("SELECT COUNT(*) c FROM invites WHERE vid=?", vid)["c"]
    used = bool(db.one("SELECT order_id FROM invite_used WHERE vid=?", vid)) or bool(
        email and db.one("SELECT order_id FROM invite_used WHERE email=?", email.lower()))
    pdf_used = bool(db.one("SELECT order_id FROM invite_pdf WHERE vid=?", vid)) or bool(
        email and db.one("SELECT order_id FROM invite_pdf WHERE email=?", email.lower()))
    return {"friends": friends, "ready": friends > 0 and not used, "used": used, "amount": products.FRIEND_DISCOUNT,
            "pdf_ready": friends > 0 and not pdf_used, "pdf_used": pdf_used}


def use(vid, email, order_id):
    db.run("INSERT OR IGNORE INTO invite_used(vid, email, order_id, at) VALUES (?,?,?,?)", vid, email.lower(), order_id,
           datetime.now().isoformat(timespec="seconds"))


def use_pdf(vid, email, order_id):
    db.run("INSERT OR IGNORE INTO invite_pdf(vid, email, order_id, at) VALUES (?,?,?,?)", vid, email.lower(), order_id,
           datetime.now().isoformat(timespec="seconds"))
