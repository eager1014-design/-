"""운결 운세 달력 (2026-10-30 사장님: 가족·지인 체험용, 무료로 천천히).
내 생일로 만든 '날마다 기운' 달력을 구글·아이폰 달력에 구독한다 — 쓰던 달력을 그대로 쓰면서 날마다 한 줄이 보임.

생년월일은 서버에 저장하지 않는다: 달력 주소 안에 넣고 서명(위조 방지)해 두고, 달력 앱이 주소를 열 때마다 계산한다.
shortcut: 주소의 생일은 서명만 했지 암호화는 안 했다(주소를 받은 사람은 생일을 읽을 수 있음) — 지인 체험 단계라 이대로, 일반 손님에게 열 때 암호화나 DB 저장으로 바꿀 것.

자체 점검: python3 calendar_feed.py
"""
import base64
import hashlib
import hmac
import json
from datetime import date, datetime, timedelta, timezone

from quick import TODAY_GOD
from saju_engine import current_luck

# 달력 칸에 뜨는 짧은 제목 (일진의 천간이 나에게 무엇인지 — 십신)
DAY_TITLE = {
    "비견": "💪 밀어붙일 날", "겁재": "🤐 돈·말 아낄 날", "식신": "✨ 잘하는 걸 보여 줄 날", "상관": "🫢 말 한 번 삼킬 날",
    "편재": "👀 기회 스치는 날", "정재": "✅ 하나 마무리할 날", "편관": "🛡 버텨 내는 날", "정관": "🤝 약속 지킬 날",
    "편인": "🌙 혼자 생각할 날", "정인": "🙏 도움 청할 날",
}
KEEP = ("calendar", "year", "month", "day", "leap", "hour", "minute", "gender", "city")


def _sig(raw, secret):
    return hmac.new(secret, raw.encode(), hashlib.sha256).hexdigest()[:20]


def make_token(birth, secret):
    raw = base64.urlsafe_b64encode(json.dumps({k: birth[k] for k in KEEP if k in birth}, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{raw}.{_sig(raw, secret)}"


def read_token(token, secret):
    """서명이 맞으면 생일(dict), 아니면 None."""
    raw, _, sig = str(token).partition(".")
    if not raw or not hmac.compare_digest(sig, _sig(raw, secret)):
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except ValueError:
        return None


def _esc(s):
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    """iCalendar 규칙: 한 줄 75바이트 넘으면 접기 (한글이 안 깨지게 글자 단위로)."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode()) > (75 if not out else 74):
            out.append(cur)
            cur = ""
        cur += ch
    out.append(cur)
    return "\r\n ".join(out)


def ics(birth, chart_of_birth, start=None, days=120):
    """지난 1주 + 앞으로 약 4달의 하루 단위 일정(종일)."""
    chart = chart_of_birth(birth)
    start = start or date.today() - timedelta(days=7)
    uid = hashlib.sha256(json.dumps(birth, sort_keys=True).encode()).hexdigest()[:12]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ungyeol//fortune-calendar//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:운결 운세 달력", "X-WR-TIMEZONE:Asia/Seoul", "REFRESH-INTERVAL;VALUE=DURATION:P1D", "X-PUBLISHED-TTL:P1D"]
    for i in range(days):
        d = start + timedelta(days=i)
        day = current_luck(chart, d)["day"]
        title = DAY_TITLE.get(day["stem_god"], "운결")
        if any(r.get("type") == "충" and "일주" in r["between"] for r in day["relations"]):  # 나 자신(일주)과 부딪는 날만 — 다 표시하면 4일에 1번꼴이라 겁만 줌
            title += " · 변동 주의"
        desc = f"{day['ko']}일 · {TODAY_GOD.get(day['stem_god'], '')}\n재미로 보는 참고용이에요. — 운결"
        lines += ["BEGIN:VEVENT", f"UID:{d:%Y%m%d}-{uid}@ungyeol", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{d:%Y%m%d}",
                  f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}", f"SUMMARY:{_esc(title)}", f"DESCRIPTION:{_esc(desc)}",
                  "TRANSP:TRANSPARENT", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


if __name__ == "__main__":
    from saju_engine import compute_chart
    b = {"calendar": "solar", "year": 1993, "month": 3, "day": 14, "hour": None, "minute": 0, "gender": "female", "city": "서울"}
    t = make_token(b, b"k")
    assert read_token(t, b"k") == b, "토큰을 다시 못 읽음"
    assert read_token(t[:-1] + "0", b"k") is None and read_token(t, b"x") is None, "위조 토큰을 통과시킴"
    out = ics(b, lambda x: compute_chart(x["year"], x["month"], x["day"], x["hour"], 0, x["gender"], x["city"]), date(2026, 11, 1), 3)
    assert out.count("BEGIN:VEVENT") == 3 and all(len(l.encode()) <= 75 for l in out.split("\r\n")), "달력 형식 이상"
    print(out)
    print("✅ 자체 점검 통과")
