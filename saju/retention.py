"""손님이 다시 오게: 풀이 받은 뒤 안부 메일, 구독 끝난 뒤 '다시 오라' 메일, 광고 수신거부.

법 기준(정보통신망법): 새 상품을 권하는 메일은 '광고'라서
  - 신청서에서 [선택] 소식 받기에 동의한 손님에게만
  - 제목 앞에 (광고), 본문 끝에 수신거부 링크
산 상품에 대한 안부(풀이 어땠는지)는 광고가 아니라서 모두에게 보낸다.
subs.start_scheduler 가 5분마다 run() 을 부른다 (낮 10시~저녁 8시에만 발송).
"""
import hashlib
import hmac
import os
from datetime import date, datetime, timedelta
from urllib.parse import quote

import db
import mailer
import orders

FOLLOWUP_DAYS = 3   # PDF 보낸 지 며칠 뒤 안부
WINBACK_DAYS = 7    # 구독 끝난 지 며칠 뒤 '다시 오라'
SEND_HOURS = (10, 20)
_SECRET = (os.environ.get("SAJU_SECRET") or "ungyeol-ads").encode()


def ad_token(email):
    return hmac.new(_SECRET, email.lower().encode(), hashlib.sha256).hexdigest()[:24]


def ads_ok(email):
    """이 이메일이 광고 메일에 동의했고, 수신거부하지 않았나."""
    if db.one("SELECT email FROM ad_optout WHERE email=?", email.lower()):
        return False
    return bool(db.one("SELECT id FROM orders WHERE email=? AND marketing_ok=1 LIMIT 1", email.lower()))


def opt_out(email, token):
    if not email or not hmac.compare_digest(ad_token(email), token or ""):
        return False
    db.run("INSERT OR IGNORE INTO ad_optout(email, at) VALUES (?, ?)", email.lower(), datetime.now().isoformat(timespec="seconds"))
    return True


def _ad_footer(email, public_url):
    return (f"\n\n────────\n이 메일은 소식 받기에 동의하신 분께 보내는 광고 메일이에요.\n"
            f"수신거부: {public_url}/stop-ads?e={quote(email)}&t={ad_token(email)}")


def visits(email):
    """이 이메일로 들어온 (취소 안 된) 신청 수."""
    return db.one("SELECT COUNT(*) c FROM orders WHERE email=? AND status!='canceled'", email.lower())["c"]


def followups(public_url):
    since = (datetime.now() - timedelta(days=FOLLOWUP_DAYS)).isoformat(timespec="seconds")
    sent = 0
    for o in db.all_("""SELECT id FROM orders WHERE status='sent' AND sent_at <= ? AND followup_at IS NULL
                        AND product NOT IN (SELECT 'daily')""", since):
        o = orders.get(o["id"])
        ad = ads_ok(o["email"])
        body = (f"{o['name']}, 운결이다.\n\n며칠 전 보낸 {o['product_label'].split(' (')[0]} 풀이는 잘 읽었느냐.\n"
                "읽다가 마음에 걸린 대목이나 더 묻고 싶은 게 있으면, 이 메일에 답장해라. 짧게라도 답해주마.")
        subject = f"[운결] {o['name']}, 풀이는 잘 읽었느냐"
        if ad:
            price = orders.PRODUCTS["daily"]["price"]
            body += (f"\n\n그리고… 한 번의 풀이로 끝내기 아쉽다면.\n"
                     f"매일 아침 7시, 네 사주로 본 오늘의 흐름을 보내주마. 월 {price:,}원, 하루 {round(price / 30):,}원.\n"
                     f"{public_url}/?p=daily&src=followup" + _ad_footer(o["email"], public_url))
            subject = "(광고) " + subject
        if mailer.send(o["email"], subject, body):
            db.run("UPDATE orders SET followup_at=? WHERE id=?", datetime.now().isoformat(timespec="seconds"), o["id"])
            sent += 1
    return sent


def winbacks(public_url):
    before = (date.today() - timedelta(days=WINBACK_DAYS)).isoformat()
    sent = 0
    for s in db.all_("SELECT id, email, name FROM subs WHERE status='expired' AND ends_on <= ? AND winback_at IS NULL", before):
        if not ads_ok(s["email"]):
            db.run("UPDATE subs SET winback_at='skip' WHERE id=?", s["id"])  # 동의 안 한 분께는 보내지 않음
            continue
        body = (f"…{s['name']}, 요즘 네 하루는 어디로 흐르고 있느냐.\n\n"
                "아침마다 오늘의 기운을 들여다보던 날들이 있었지.\n"
                f"다시 받고 싶다면, 여기서 이어가면 된다.\n{public_url}/?p=daily&src=winback" + _ad_footer(s["email"], public_url))
        if mailer.send(s["email"], f"(광고) [운결] {s['name']}, 다시 들여다볼까", body):
            db.run("UPDATE subs SET winback_at=? WHERE id=?", datetime.now().isoformat(timespec="seconds"), s["id"])
            sent += 1
    return sent


def run(public_url, force=False):
    if not force and not SEND_HOURS[0] <= datetime.now().hour < SEND_HOURS[1]:
        return 0, 0
    f, w = followups(public_url), winbacks(public_url)
    if f or w:
        print(f"[다시 오게] 안부 {f}통, 구독 복귀 안내 {w}통")
    return f, w
