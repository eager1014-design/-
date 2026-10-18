"""구독·결제 — 7일 무료체험 + 정기결제(토스페이먼츠 빌링).

TOSS_SECRET_KEY / TOSS_CLIENT_KEY 가 없으면 'mock' 모드로 동작한다(카드 등록·결제를 시뮬레이션).
실서비스: 토스페이먼츠 자동결제(빌링) 계약 후 키를 넣으면 실제 카드 등록·정기결제가 진행된다.
"""
import base64
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import db

TRIAL_DAYS = 3  # 무료체험 기간(일). 화면 문구도 이 값을 따른다.
PLANS = {
    "monthly": {"name": "월간 구독", "price": 9900, "days": 30, "desc": "매월 자동결제 · 언제든 해지"},
    "yearly": {"name": "연간 구독", "price": 79000, "days": 365, "desc": "월 6,583원 꼴 · 33% 할인"},
}
TOSS_SECRET = os.environ.get("TOSS_SECRET_KEY", "")
TOSS_CLIENT = os.environ.get("TOSS_CLIENT_KEY", "")
MODE = "toss" if TOSS_SECRET and TOSS_CLIENT else "mock"


def now():
    return datetime.now()


def iso(dt):
    return dt.replace(microsecond=0).isoformat()


def parse(s):
    return datetime.fromisoformat(s) if s else None


def access(user):
    """사용자의 이용 권한 상태."""
    sub = db.one("SELECT * FROM subscriptions WHERE user_id=?", user["id"])
    t_end = parse(user["trial_ends_at"])
    n = now()
    trial_left_sec = max(0, (t_end - n).total_seconds())
    state = "expired"
    period_end = None
    if sub:
        period_end = parse(sub["current_period_end"])
        if sub["status"] in ("active", "canceled") and period_end > n:
            state = "active" if sub["status"] == "active" else "canceled_active"
        elif sub["status"] == "past_due":
            state = "past_due"
    if state == "expired" and trial_left_sec > 0:
        state = "trial"
    if state in ("active", "canceled_active") and trial_left_sec > 0 and sub and period_end <= t_end + timedelta(seconds=5):
        # 체험 중에 미리 결제수단을 등록한 경우: 체험 종료 시점에 첫 결제
        state = "trial_scheduled" if sub["status"] == "active" else "trial"
    return {
        "state": state,
        "has_access": state in ("trial", "trial_scheduled", "active", "canceled_active"),
        "trial_ends_at": user["trial_ends_at"],
        "trial_days_left": int(trial_left_sec // 86400) + (1 if trial_left_sec % 86400 else 0) if trial_left_sec else 0,
        "trial_hours_left": round(trial_left_sec / 3600, 1),
        "plan": sub["plan"] if sub else None,
        "plan_info": PLANS.get(sub["plan"]) if sub else None,
        "current_period_end": sub["current_period_end"] if sub else None,
        "card_info": sub["card_info"] if sub else None,
        "subscription_status": sub["status"] if sub else None,
        "mode": MODE,
    }


# ---------------------------------------------------------------- 토스페이먼츠 API
def _toss(path, body):
    auth = base64.b64encode((TOSS_SECRET + ":").encode()).decode()
    req = urllib.request.Request("https://api.tosspayments.com" + path, data=json.dumps(body).encode(),
                                 method="POST", headers={"Authorization": "Basic " + auth,
                                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return False, json.loads(e.read() or b"{}")
    except urllib.error.URLError as e:
        return False, {"message": str(e)}


def customer_key_for(user):
    return f"cust_{user['id']}_{secrets.token_hex(6)}"


def issue_billing_key(auth_key, customer_key):
    if MODE == "mock":
        return True, {"billingKey": "mock_bk_" + secrets.token_hex(8),
                      "card": {"issuerCode": "MOCK", "number": "4330********1234", "cardType": "신용"}}
    return _toss("/v1/billing/authorizations/issue", {"authKey": auth_key, "customerKey": customer_key})


def charge(user, sub, plan):
    p = PLANS[plan]
    order_id = f"saju_{user['id']}_{int(time.time())}_{secrets.token_hex(3)}"
    if MODE == "mock":
        ok, res = True, {"status": "DONE", "mock": True}
    else:
        ok, res = _toss(f"/v1/billing/{sub['billing_key']}", {
            "customerKey": sub["customer_key"], "amount": p["price"], "orderId": order_id,
            "orderName": f"운결 사주 {p['name']}", "customerEmail": user["email"], "customerName": user["name"]})
        ok = ok and res.get("status") == "DONE"
    db.run("INSERT INTO payments(user_id, order_id, amount, plan, status, raw, created_at) VALUES (?,?,?,?,?,?,?)",
           user["id"], order_id, p["price"], plan, "paid" if ok else "failed", json.dumps(res, ensure_ascii=False), iso(now()))
    return ok, res


def activate(user, plan, billing_key, customer_key, card_info):
    """결제수단 등록 완료 → 구독 활성화. 체험 기간이 남아있으면 체험 종료 시 첫 결제."""
    n = now()
    t_end = parse(user["trial_ends_at"])
    existing = db.one("SELECT * FROM subscriptions WHERE user_id=?", user["id"])
    sub = {"billing_key": billing_key, "customer_key": customer_key}
    if t_end > n:
        period_end = t_end  # 첫 결제는 체험 종료 시
        charged = None
    elif existing and existing["status"] in ("active", "canceled") and parse(existing["current_period_end"]) > n:
        period_end = parse(existing["current_period_end"])  # 남은 기간 유지 후 갱신
        charged = None
    else:
        ok, res = charge(user, sub, plan)
        if not ok:
            return False, res.get("message", "결제에 실패했습니다.")
        period_end = n + timedelta(days=PLANS[plan]["days"])
        charged = PLANS[plan]["price"]
    db.run("""INSERT INTO subscriptions(user_id, plan, status, provider, customer_key, billing_key, card_info,
              current_period_end, canceled_at, created_at) VALUES (?,?,?,?,?,?,?,?,NULL,?)
              ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, status='active', provider=excluded.provider,
              customer_key=excluded.customer_key, billing_key=excluded.billing_key, card_info=excluded.card_info,
              current_period_end=excluded.current_period_end, canceled_at=NULL""",
           user["id"], plan, "active", MODE, customer_key, billing_key, card_info, iso(period_end), iso(n))
    return True, {"charged": charged, "next_billing": iso(period_end)}


def cancel(user):
    db.run("UPDATE subscriptions SET status='canceled', canceled_at=? WHERE user_id=? AND status IN ('active','past_due')",
           iso(now()), user["id"])


def resume(user):
    db.run("UPDATE subscriptions SET status='active', canceled_at=NULL WHERE user_id=? AND status='canceled'", user["id"])


# ---------------------------------------------------------------- 정기결제 스케줄러
def run_renewals():
    n = iso(now())
    due = db.all_("SELECT * FROM subscriptions WHERE current_period_end <= ? AND status IN ('active','canceled','past_due')", n)
    for sub in due:
        user = db.one("SELECT * FROM users WHERE id=?", sub["user_id"])
        if sub["status"] == "canceled":
            db.run("UPDATE subscriptions SET status='expired' WHERE user_id=?", sub["user_id"])
            continue
        ok, _ = charge(user, sub, sub["plan"])
        if ok:
            new_end = parse(sub["current_period_end"]) + timedelta(days=PLANS[sub["plan"]]["days"])
            if new_end < now():
                new_end = now() + timedelta(days=PLANS[sub["plan"]]["days"])
            db.run("UPDATE subscriptions SET status='active', current_period_end=? WHERE user_id=?", iso(new_end), sub["user_id"])
        else:
            # 결제 실패: 3일 유예 후 재시도, 실패 지속 시 만료
            fails = db.one("SELECT COUNT(*) c FROM payments WHERE user_id=? AND status='failed' AND created_at >= ?",
                           sub["user_id"], sub["current_period_end"])["c"]
            if fails >= 3:
                db.run("UPDATE subscriptions SET status='expired' WHERE user_id=?", sub["user_id"])
            else:
                db.run("UPDATE subscriptions SET status='past_due', current_period_end=? WHERE user_id=?",
                       iso(now() + timedelta(days=1)), sub["user_id"])


def start_scheduler(interval=600):
    def loop():
        while True:
            try:
                run_renewals()
            except Exception as e:  # noqa
                print("[billing] renewal error:", e)
            time.sleep(interval)
    threading.Thread(target=loop, daemon=True).start()
