"""판매·홍보 기능 시험 (AI를 끈 시험 서버에 대고 실행 — 무료).

실행:
  1) 시험 서버 켜기:
     env AI_PROVIDERS=none SAJU_DB=.tmp/sales_test.db PORT=8767 ADMIN_EMAIL=boss@test.com \\
         ADMIN_API_KEY=testkey-0123456789abcdefghijklmn BANK_ACCOUNT=테스트은행 MAIL_RELAY=1 APPLY_LIMIT=200 python3 saju/server.py
  2) python3 saju/tests/test_sales.py     (기본 주소 http://localhost:8767, 시험 DB는 매번 새로)
확인하는 것: 신청서 → 관리 화면(입금·풀이·수정) → PDF·메일 → 홍보 센터 → 맥북 일꾼 대기열 → 보안(차단)
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("SAJU_TEST_URL", "http://localhost:8767")
KEY = os.environ.get("SAJU_TEST_KEY", "testkey-0123456789abcdefghijklmn")
results = []


def client(headers=None):
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        h = dict(headers or {}, **({"Content-Type": "application/json"} if data else {}))
        try:
            with op.open(urllib.request.Request(BASE + path, data=data, headers=h), timeout=60) as r:
                p = r.read()
                return r.status, (p if raw else json.loads(p))
        except urllib.error.HTTPError as e:
            p = e.read()
            return e.code, (p if raw else json.loads(p or b"{}"))
    return call


def ok(cond, msg):
    results.append(bool(cond))
    print(("✅" if cond else "❌"), msg)


B = {"year": 1995, "month": 3, "day": 14, "calendar": "solar", "hour": 9, "minute": 0, "gender": "female"}
SIT = {"concern": "career", "job": "마케터", "story": "회사에서 인정받고 싶은데 이직을 해야 할지 고민이에요.", "goal": "방향"}


def apply(c, product, name, **extra):
    return c("/api/apply", dict({"product": product, "name": name, "email": f"{name}@test.com", "birth": B, "situation": SIT,
                                 "agree": True, "agree_ai": True}, **extra))


def gen(c, oid, **kw):
    st, r = c("/api/admin/order/generate", dict({"id": oid, "overwrite": True}, **kw))
    if st != 200:
        return st, r
    for _ in range(60):
        time.sleep(0.5)
        st, r = c(f"/api/admin/order?id={oid}")
        if r["order"].get("gen_state") != "running":
            return st, r
    return 0, r


def main():
    guest, boss, machine = client(), client(), client({"X-Admin-Key": KEY})
    # 신청서
    st, body = guest("/", raw=True)
    ok(st == 200 and b'id="form"' in body and "너의 인생이".encode() in body, "첫 화면 = 웹툰 + 신청서")
    ok(guest("/app", raw=True)[0] in (200, 302) and b"app.js" not in guest("/app", raw=True)[1], "예전 구독 앱(/app)은 닫힘")
    st, c = guest("/api/apply/config")
    ok(st == 200 and len(c["products"]) == 10 and c["bank"], f"상품 {len(c['products'])}개 + 계좌")
    ok(apply(guest, "full", "동의없음", agree_ai=False)[0] == 400, "AI 동의 없으면 거절")
    st, r = apply(guest, "newyear", "김손님", src="threads")
    ok(st == 200 and r["code"].startswith("UG"), "신청 완료 + 신청번호")
    ok(r["free"] and r["amount"] == 0, "첫 신청은 무료")
    st, jobs = machine("/api/admin/jobs")
    ok(any(j["name"] == "김손님" for j in jobs["jobs"]), "무료 신청은 바로 맥북 풀이 대기열에 (자동 시작)")
    st, r = apply(guest, "love", "김손님")
    ok(not r["free"] and r["amount"] > 0, "같은 이메일 두 번째는 유료")
    st, r = guest("/api/apply", {"product": "love", "name": "김손님", "email": "other@test.com", "birth": B, "situation": SIT,
                                 "agree": True, "agree_ai": True})
    ok(not r["free"], "이메일 바꿔도 같은 이름+생년월일이면 유료")
    pet = {"name": "콩이", "relation": "강아지", "birth": dict(B, year=2021, hour="", gender="male")}
    ok(apply(guest, "pet", "견주", partner=pet)[0] == 200, "반려동물 신청")
    ok(apply(guest, "pet", "견주2")[1].get("error", "").startswith("반려동물"), "반려동물 정보 없으면 거절")
    ok(apply(guest, "reunion", "재회", partner={"birth": {"year": ""}})[0] == 200, "재회운: 상대 정보 없어도 신청")
    ok(apply(guest, "yearly", "숨김")[0] == 400, "숨긴 상품은 신청 불가")
    # 무료 바로 보기 (생년월일 → 성향·운세·추천, 저장 안 함)
    st, r = guest("/api/quick", {"birth": B})
    ok(st == 200 and r["image"] and r["good"] and r["year"]["text"] and r["today"]["text"] and 2 <= len(r["recs"]) <= 3,
       f"무료 바로 보기: {r.get('image')} / 추천 {[x['key'] for x in r.get('recs', [])]}")
    ok(guest("/api/quick", {"birth": {"year": 1995}})[0] == 400, "바로 보기: 잘못된 생년월일 거절")
    import re as _re
    ok(len(r["locked"]) >= 2 and not _re.search(r"\d", "".join(x["masked"] for x in r["locked"])), "잠긴 칸: 진짜 결과(숫자) 안 보냄")
    st, u = guest("/api/quick/unlock", {"birth": B, "id": "love"})
    ok(st == 200 and "인연" in u["text"], "친구에게 보내면 '인연이 들어오는 때' 열림")
    ok(guest("/api/quick/unlock", {"birth": B, "id": "months"})[0] == 200, "친구에게 보내면 '좋은 달·조심할 달'도 열림")
    ok(guest("/api/quick/unlock", {"birth": B, "id": "turn"})[0] == 403, "평생 종합 칸은 결제해야만")
    # 평생 종합 친구 할인: 내 링크(inv)로 온 친구가 자기 사주를 보면 9,900원 할인 (1인 1회)
    ok(not guest("/api/invite/status?vid=ME12345678")[1]["ready"], "친구가 오기 전엔 할인 없음")
    guest("/api/quick", {"birth": dict(B, year=1999), "inv": "ME12345678", "vid": "FR87654321"})
    ok(guest("/api/invite/status?vid=ME12345678")[1]["ready"], "친구가 내 링크로 사주를 보면 할인 준비")
    st, r = guest("/api/apply", {"product": "life", "name": "할인손님", "email": "disc@test.com", "birth": B, "situation": SIT,
                                 "agree": True, "agree_ai": True, "vid": "ME12345678"})
    ok(r["discount"] == 9900 and r["amount"] == 34900 - 9900, f"평생 종합 친구 할인 적용 ({r['amount']:,}원)")
    st, r = guest("/api/apply", {"product": "life", "name": "할인손님", "email": "disc@test.com", "birth": B, "situation": SIT,
                                 "agree": True, "agree_ai": True, "vid": "ME12345678"})
    ok(r["discount"] == 0 and r["amount"] == 34900, "할인은 한 번만")
    # 보안
    ok(guest("/api/admin/orders")[0] == 401, "비로그인 → 관리 화면 차단")
    ok(client({"X-Admin-Key": "wrong-key-0123456789abcdefgh"})("/api/admin/orders")[0] == 401, "틀린 기계 열쇠 차단")
    st, r = guest("/api/signup", {"email": "stranger@test.com", "name": "x", "password": "12345678xx", "agree": True, "agree_ai": True})
    ok(st == 400, "사장님 외 가입 차단")
    # 관리 화면
    boss("/api/signup", {"email": "boss@test.com", "name": "사장", "password": "boss-pass-123", "agree": True, "agree_ai": True})
    st, r = boss("/api/admin/orders")
    ok(st == 200 and len(r["orders"]) >= 5, "사장님 목록 보기")
    ny = next(o for o in r["orders"] if o["product"] == "newyear")
    ok(ny["status"] == "paid" and ny["amount"] == 0, "무료 신청은 바로 '입금 확인' 상태")
    ok(ny["channel"] == "threads", "신청 채널 기록 (스레드에서)")
    st, r = boss("/api/admin/order/status", {"id": ny["id"], "status": "paid"})
    ok(r["order"]["paid_at"], "입금 확인")
    st, r = gen(boss, ny["id"])
    ok(st == 200 and len(r["order"]["content"] or "") > 300 and r["order"]["status"] == "writing", "풀이 생성 (서버)")
    st, r = boss("/api/admin/order/generate", {"id": ny["id"]})
    ok(st == 409, "덮어쓰기 확인 없이 재생성 막힘")
    st, r = boss("/api/admin/order/save", {"id": ny["id"], "content": "## 수정본\n\n" + "고친 글입니다. " * 20})
    ok(r["order"]["content"].startswith("## 수정본"), "풀이 수정 저장")
    # PDF · 메일
    st, data = boss(f"/api/admin/order/pdf?id={ny['id']}", raw=True)
    ok(st == 200 and data[:4] == b"%PDF", f"PDF 미리보기 ({len(data):,}바이트)")
    ok(guest(f"/api/admin/order/pdf?id={ny['id']}", raw=True)[0] == 401, "비로그인 PDF 차단")
    st, r = boss("/api/admin/order/send", {"id": ny["id"]})
    ok(st == 200 and r["order"]["status"] == "sent", "손님에게 발송 → 발송 완료")
    ok(boss("/api/admin/order/send", {"id": ny["id"]})[0] == 409, "중복 발송 확인")
    # 직접 입력 + 맥북 일꾼 대기열
    st, r = boss("/api/admin/order/create", {"product": "love", "name": "맥북", "email": "m@test.com", "birth": B, "situation": SIT})
    mid = r["order"]["id"]
    ok(r["order"]["status"] == "paid" and r["order"]["source"] == "manual", "손님 직접 입력")
    st, r = boss("/api/admin/order/generate", {"id": mid, "engine": "mac"})
    ok(r["order"]["gen_state"] == "mac_wait", "맥북 챗GPT로 만들기 → 대기")
    st, r = machine("/api/admin/jobs")
    ok(st == 200 and boss(f"/api/admin/order?id={mid}")[1]["order"]["gen_state"] == "mac_wait", "맥북 대기열에 들어감")
    ok(machine("/api/admin/jobs/update", {"id": mid, "state": "claim"})[0] == 200, "맥북이 맡음")
    ok(machine("/api/admin/jobs/update", {"id": mid, "state": "claim"})[0] == 409, "두 번 맡기 막힘")
    machine("/api/admin/jobs/update", {"id": mid, "state": "done", "markdown": "## 맥북이 쓴 풀이\n\n" + "내용 " * 50, "engine": "codex:시험"})
    st, r = boss(f"/api/admin/order?id={mid}")
    ok(r["order"]["gen_state"] == "done" and r["order"]["engine"] == "codex:시험" and r["order"]["status"] == "writing", "맥북 풀이 도착")
    ok(boss("/api/admin/orders")[1]["mac_online"], "관리 화면에 '맥북 켜짐'")
    # 홍보 센터
    st, r = boss("/api/admin/promo")
    ok(st == 200 and r["links"]["threads"].endswith("?src=threads"), "홍보 센터 + 채널 링크")
    for ch in ("threads", "instagram", "daangn"):
        st, r = boss("/api/admin/promo/generate", {"channel": ch, "n": 5})
        ok(st == 200 and len(r["drafts"]) >= 3, f"{ch} 글 후보 {len(r['drafts'])}개")
    d = r["drafts"][0]
    st, r = boss("/api/admin/promo/post", {"id": d["id"], "text": "고친 당근 글"})
    ok(r["post"]["status"] == "posted", "당근: 올렸어요 기록")
    th = next(x for x in boss("/api/admin/promo")[1]["drafts"] if x["channel"] == "threads")
    st, r = boss("/api/admin/promo/post", {"id": th["id"]})
    ok(st == 502 and "연결" in r["error"], "스레드 미연결 시 안내")
    st, r = machine("/api/admin/promo/import", {"posts": [{"theme": "love", "text": "맥북 클로드가 쓴 글"}], "engine": "claude:시험"})
    ok(r["count"] == 1, "맥북 클로드 글 받기")
    ok(any(s["ch"] == "threads" for s in boss("/api/admin/promo")[1]["stats"]), "채널별 집계")
    # 월 구독 (매일 아침 오늘의 흐름)
    st, r = apply(guest, "daily", "구독자", src="instagram")
    ok(st == 200 and not r["free"] and r["amount"] == 9900, "구독 신청 (첫 무료 대상 아님)")
    oid = next(o["id"] for o in boss("/api/admin/orders")[1]["orders"] if o["name"] == "구독자")
    st, r = boss("/api/admin/order/status", {"id": oid, "status": "paid"})
    ok(r["order"]["status"] == "sent" and "구독" in (r["order"]["note"] or ""), "입금 확인 → 구독 시작")
    st, r = boss("/api/admin/subs")
    sub = next(x for x in r["subs"] if x["name"] == "구독자")
    ok(sub["status"] == "active" and r["active"] == 1, f"구독 목록 ({sub['starts_on']} ~ {sub['ends_on']})")
    st, r = boss("/api/admin/subs/send-now", {})
    ok(st == 200 and r["sent"] == 1, "오늘의 흐름 지금 보내기")
    ok(boss("/api/admin/subs/send-now", {})[1]["sent"] == 0, "같은 날 두 번 안 보냄")
    st, r = boss("/api/admin/subs/update", {"id": sub["id"], "action": "story", "story": "요즘 팀장이 바뀌어서 눈치가 보여요"})
    ok(st == 200 and next(x for x in boss("/api/admin/subs")[1]["subs"] if x["id"] == sub["id"])["story"].startswith("요즘 팀장"), "답장 받은 상황 반영")
    st, r = boss("/api/admin/subs/update", {"id": sub["id"], "action": "extend"})
    ok(r["sub"]["ends_on"] > sub["ends_on"], "+30일 연장")
    tok = __import__("sqlite3").connect(os.environ.get("SAJU_TEST_DB", ".tmp/sales_test.db")).execute(
        "SELECT token FROM subs WHERE id=?", (sub["id"],)).fetchone()[0]
    st, body = guest(f"/stop?t={tok}", raw=True)
    ok(st == 200 and "보내지 않을게요".encode() in body, "손님 '그만 받기'")
    ok(next(x for x in boss("/api/admin/subs")[1]["subs"] if x["id"] == sub["id"])["status"] == "stopped", "그만 받기 → 상태 반영")
    # 메일 보관함 (서버 대신 맥북이 Gmail로 보냄)
    mails = []
    for _ in range(20):  # 맥북처럼 5통씩 가져가서 '보냄' 처리
        batch = machine("/api/admin/outbox")[1]["mails"]
        if not batch:
            break
        mails += batch
        for m in batch:
            machine("/api/admin/outbox/done", {"id": m["id"], "ok": True})
    pdf_mail = next((m for m in mails if m["files"]), None)
    ok(mails and pdf_mail and pdf_mail["files"][0]["name"].endswith(".pdf"), f"보낼 메일 보관함 ({len(mails)}통, PDF 첨부 포함)")
    ok(machine("/api/admin/outbox")[1]["mails"] == [], "보낸 메일은 보관함에서 빠짐")
    ok(boss("/api/admin/orders")[1]["mail_mode"] == "relay", "관리 화면: 맥북 대신 발송 방식")
    # 다시 오게: 재방문 표시, 안부 메일(풀이 3일 뒤), 광고 동의·수신거부
    st, r = apply(guest, "career", "단골", marketing=True)
    st, r = apply(guest, "match", "단골", partner={"name": "철수", "relation": "연인", "birth": dict(B, year=1993, gender="male")})
    ok(r["returning"] == 1, "두 번째 온 손님 알아봄")
    rows = boss("/api/admin/orders")[1]["orders"]
    ok(max(o["visit"] for o in rows if o["name"] == "단골") == 2, "관리 목록에 재방문 2번째")
    import sqlite3
    dbp = os.environ.get("SAJU_TEST_DB", ".tmp/sales_test.db")
    first = min(o["id"] for o in rows if o["name"] == "단골")
    con = sqlite3.connect(dbp)
    con.execute("UPDATE orders SET status='sent', sent_at=datetime('now','-4 days') WHERE id=?", (first,)); con.commit()
    for _ in range(20):  # 보관함 비우기
        batch = machine("/api/admin/outbox")[1]["mails"]
        if not batch: break
        for m in batch: machine("/api/admin/outbox/done", {"id": m["id"], "ok": True})
    st, r = boss("/api/admin/retention/run", {})
    ok(r["followups"] >= 1, f"풀이 3일 뒤 안부 메일 ({r['followups']}통)")
    mails = machine("/api/admin/outbox")[1]["mails"]
    fm = next((m for m in mails if m["to_addr"] == "단골@test.com"), None)
    ok(fm and fm["subject"].startswith("(광고)") and "수신거부" in fm["body"] and "p=daily" in fm["body"], "동의한 손님: (광고) + 구독 안내 + 수신거부")
    link = fm["body"].split("수신거부: ")[1].strip().replace(BASE, "")
    st, body = guest(link, raw=True)
    ok(st == 200 and "광고 메일을 더 보내지 않을게요".encode() in body, "광고 수신거부 링크")
    ok(boss("/api/admin/retention/run", {})[1]["followups"] == 0, "안부 메일은 한 번만")
    # 친구 초대: 내 링크로 처음 온 친구가 신청하면 나에게 무료 1회, 다음 신청이 무료
    st, r = apply(guest, "love", "초대자")
    ref = r["my_link"].split("ref=")[1]
    ok(r["free"] and "ref=" in r["my_link"] and r["credits"] == 0, "신청하면 나만의 초대 링크")
    st, r = apply(guest, "love", "친구1", ref=ref)
    ok(r["free"] and r["referred"], "친구가 초대 링크로 처음 신청 → 친구도 무료")
    st, r = apply(guest, "career", "초대자")
    ok(r["free"] and r["free_kind"] == "ref" and r["credits"] == 0, "초대한 사람의 다음 신청은 무료(쌓인 1회 사용)")
    st, r = apply(guest, "match", "초대자", partner={"name": "철수", "relation": "연인", "birth": dict(B, year=1993, gender="male")})
    ok(not r["free"] and r["amount"] > 0, "무료를 다 쓰면 다시 유료")
    st, r = apply(guest, "love", "초대자", ref=ref)
    ok(not r["referred"], "자기 링크로 자기 신청은 보상 없음")
    st, r = guest("/api/apply", {"product": "love", "name": "친구1", "email": "다른메일@test.com", "birth": B, "situation": SIT,
                                 "agree": True, "agree_ai": True, "ref": ref})
    ok(not r["referred"], "이미 왔던 사람(같은 이름+생년월일)은 보상 없음")
    rows = boss("/api/admin/orders")[1]["orders"]
    ok(any(o["free_kind"] == "ref" for o in rows) and any(o["ref_from"] for o in rows), "관리 목록에 초대 표시")
    # 평생 종합 사주: 34,900원, 첫 무료·초대 무료 대상 아님
    st, c = guest("/api/apply/config")
    ok(c["products"]["life"]["price"] == 34900 and c["products"]["life"]["no_free"], "평생 종합 34,900원 · 무료 제외 표시")
    st, r = apply(guest, "life", "프리미엄첫손님")
    ok(not r["free"] and r["amount"] == 34900, "처음 온 손님도 평생 종합은 유료")
    st, r = apply(guest, "love", "프리미엄첫손님")
    ok(r["free"], "평생 종합 신청 뒤에도 다른 풀이 첫 무료는 남아 있음")
    # 비상: 사장님 비밀번호 재설정 링크 (기계 열쇠로만)
    ok(guest("/api/admin/owner-reset", {"email": "boss@test.com"})[0] == 404, "열쇠 없이 비번 재설정 링크 차단")
    ok(machine("/api/admin/owner-reset", {"email": "stranger@test.com"})[0] == 404, "사장님 아닌 계정은 재설정 불가")
    st, r = machine("/api/admin/owner-reset", {"email": "boss@test.com"})
    ok(st == 200 and "#/reset?token=" in r["link"], "사장님 비번 재설정 링크 발급")
    tok = r["link"].split("token=")[1]
    fresh = client()
    st, r = fresh("/api/password/reset", {"token": tok, "password": "new-boss-pass-1"})
    ok(st == 200 and fresh("/api/admin/orders")[0] == 200, "새 비밀번호로 바꾸고 관리 화면 열림")
    print(f"\n결과: {sum(results)}/{len(results)} 통과")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
