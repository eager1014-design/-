"""월 구독: 매일 아침 '오늘의 흐름' 메일.

흐름: 손님이 신청서에서 '매일 아침, 오늘의 흐름'(products.py 의 daily) 신청 → 계좌이체
     → 사장님이 관리 화면에서 '입금 확인' → activate() 가 30일 구독을 켜거나 연장
     → 매일 아침 SEND_HOUR 시에 구독자마다 interpret.daily 로 오늘 풀이를 만들어 메일 발송
     → 끝나기 3일 전부터 연장 안내, 끝나면 '구독 종료' 메일
메일 하단의 '그만 받기' 링크(/stop?t=…)로 손님이 직접 끊을 수 있다.
"""
import json
import os
import re
import secrets
import threading
import time
from datetime import date, datetime, timedelta

import db
import interpret
import mailer
import orders
from saju_engine import current_luck

SEND_HOUR = int(os.environ.get("DAILY_SEND_HOUR", "7"))
RENEW_NOTICE_DAYS = 3


def now():
    return datetime.now().isoformat(timespec="seconds")


def activate(order):
    """입금 확인된 구독 신청 → 같은 이메일 구독이 있으면 30일 연장, 없으면 새로 시작 (내일 아침부터 발송)."""
    days = orders.PRODUCTS[order["product"]].get("days", 30)
    s = db.one("SELECT * FROM subs WHERE email=? ORDER BY id DESC LIMIT 1", order["email"])
    today = date.today()
    if s and s["status"] in ("active", "expired", "stopped"):
        base = max(today, date.fromisoformat(s["ends_on"])) if s["status"] == "active" else today
        db.run("""UPDATE subs SET status='active', ends_on=?, name=?, birth=?, situation=?, last_order=?, renew_noticed=NULL,
                  updated_at=? WHERE id=?""", (base + timedelta(days=days)).isoformat(), order["name"],
               json.dumps(order["birth"], ensure_ascii=False), json.dumps(order["situation"], ensure_ascii=False),
               order["id"], now(), s["id"])
        return get(s["id"])
    sid = db.run("""INSERT INTO subs(email,name,birth,situation,status,starts_on,ends_on,token,last_order,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""", order["email"], order["name"],
                 json.dumps(order["birth"], ensure_ascii=False), json.dumps(order["situation"], ensure_ascii=False), "active",
                 today.isoformat(), (today + timedelta(days=days)).isoformat(), secrets.token_urlsafe(18), order["id"], now(), now())
    return get(sid)


def get(sid):
    s = db.one("SELECT * FROM subs WHERE id=?", sid)
    if s:
        s["birth"], s["situation"] = json.loads(s["birth"]), json.loads(s["situation"])
    return s


def listing():
    rows = db.all_("SELECT id,email,name,status,starts_on,ends_on,last_sent,sent_count,created_at FROM subs ORDER BY status='active' DESC, ends_on DESC")
    return rows


def stop(token):
    s = db.one("SELECT * FROM subs WHERE token=?", token or "")
    if not s:
        return None
    db.run("UPDATE subs SET status='stopped', updated_at=? WHERE id=?", now(), s["id"])
    return s


def set_status(sid, status, extend_days=0):
    s = get(sid)
    if not s:
        return None
    ends = date.fromisoformat(s["ends_on"])
    if extend_days:
        ends = max(ends, date.today()) + timedelta(days=extend_days)
    db.run("UPDATE subs SET status=?, ends_on=?, updated_at=? WHERE id=?", status, ends.isoformat(), now(), sid)
    return get(sid)


def _plain(md):
    """메일용: 마크다운 → 읽기 좋은 글."""
    t = re.sub(r"^#{1,4}\s*(.+)$", r"【\1】", md, flags=re.M)
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    return re.sub(r"(^|\s)\*(\S.*?)\*", r"\1\2", t)


def daily_mail(s, chart_of_birth, public_url):
    chart = chart_of_birth(s["birth"])
    luck = current_luck(chart)
    res = interpret.daily(chart, luck, s["situation"])
    left = (date.fromisoformat(s["ends_on"]) - date.today()).days
    body = (f"…{s['name']}, 오늘 너의 하루다.\n\n"
            f"{date.today():%m월 %d일} · 오늘의 일진 {luck['day']['ko']}일\n\n{_plain(res['markdown'])}\n\n")
    if 0 < left <= RENEW_NOTICE_DAYS:
        bank = orders.BANK_ACCOUNT or "(계좌는 답장으로 알려드려요)"
        price = orders.PRODUCTS["daily"]["price"]
        body += (f"────────\n구독이 {left}일 남았어요. 계속 받으시려면 {price:,}원을 입금해 주세요.\n"
                 f"입금 계좌: {bank} (입금자명: {s['name']})\n\n")
    body += f"운결 · 사주로 보는 커리어·관계 코칭\n그만 받기: {public_url}/stop?t={s['token']}"
    return f"[운결] {s['name']}님의 {date.today():%m월 %d일} 오늘의 흐름", body, res["engine"]


def send_due(chart_of_birth, public_url):
    """오늘 아직 못 받은 활성 구독자에게 보내고, 끝난 구독은 정리한다."""
    today = date.today().isoformat()
    for s in db.all_("SELECT id FROM subs WHERE status='active' AND ends_on < ?", today):
        sub = get(s["id"])
        db.run("UPDATE subs SET status='expired', updated_at=? WHERE id=?", now(), sub["id"])
        mailer.send(sub["email"], "[운결] 매일 아침 오늘의 흐름 구독이 끝났어요",
                    f"{sub['name']}님, 그동안 운결의 아침 메일을 받아주셔서 고마워요.\n\n"
                    f"다시 받고 싶으시면 {public_url}/?p=daily 에서 신청해 주세요.")
    sent = 0
    for s in db.all_("SELECT id FROM subs WHERE status='active' AND ends_on >= ? AND (last_sent IS NULL OR last_sent < ?)",
                     today, today):
        sub = get(s["id"])
        try:
            subject, body, engine = daily_mail(sub, chart_of_birth, public_url)
        except Exception as e:  # noqa — 한 명 실패가 다른 구독자를 막지 않게
            print(f"[구독] {sub['email']} 오늘 풀이 만들기 실패: {e}")
            continue
        if mailer.send(sub["email"], subject, body):
            db.run("UPDATE subs SET last_sent=?, sent_count=COALESCE(sent_count,0)+1, updated_at=? WHERE id=?",
                   today, now(), sub["id"])
            sent += 1
    if sent:
        print(f"[구독] 오늘의 흐름 {sent}통 발송")
    return sent


def start_scheduler(chart_of_birth, public_url, interval=300):
    """5분마다 확인해서, 아침 SEND_HOUR 시 이후 오늘 안 보낸 구독자에게 보낸다."""
    def loop():
        while True:
            try:
                if datetime.now().hour >= SEND_HOUR:
                    send_due(chart_of_birth, public_url)
            except Exception as e:  # noqa
                print("[구독] 발송 오류:", e)
            time.sleep(interval)
    threading.Thread(target=loop, daemon=True).start()
