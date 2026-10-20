"""판매·홍보 기능 시험 (AI를 끈 시험 서버에 대고 실행 — 무료).

실행:
  1) 시험 서버 켜기:
     env AI_PROVIDERS=none SAJU_DB=.tmp/sales_test.db PORT=8767 ADMIN_EMAIL=boss@test.com \\
         ADMIN_API_KEY=testkey-0123456789abcdefghijklmn BANK_ACCOUNT=테스트은행 python3 saju/server.py
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
    ok(st == 200 and "풀이 신청".encode() in body, "첫 화면 = 신청서")
    st, c = guest("/api/apply/config")
    ok(st == 200 and len(c["products"]) == 9 and c["bank"], f"상품 {len(c['products'])}개 + 계좌")
    ok(apply(guest, "full", "동의없음", agree_ai=False)[0] == 400, "AI 동의 없으면 거절")
    st, r = apply(guest, "newyear", "김손님", src="threads")
    ok(st == 200 and r["code"].startswith("UG"), "신청 완료 + 신청번호")
    pet = {"name": "콩이", "relation": "강아지", "birth": dict(B, year=2021, hour="", gender="male")}
    ok(apply(guest, "pet", "견주", partner=pet)[0] == 200, "반려동물 신청")
    ok(apply(guest, "pet", "견주2")[1].get("error", "").startswith("반려동물"), "반려동물 정보 없으면 거절")
    ok(apply(guest, "reunion", "재회", partner={"birth": {"year": ""}})[0] == 200, "재회운: 상대 정보 없어도 신청")
    ok(apply(guest, "yearly", "숨김")[0] == 400, "숨긴 상품은 신청 불가")
    # 보안
    ok(guest("/api/admin/orders")[0] == 401, "비로그인 → 관리 화면 차단")
    ok(client({"X-Admin-Key": "wrong-key-0123456789abcdefgh"})("/api/admin/orders")[0] == 401, "틀린 기계 열쇠 차단")
    st, r = guest("/api/signup", {"email": "stranger@test.com", "name": "x", "password": "12345678xx", "agree": True, "agree_ai": True})
    ok(st == 400, "사장님 외 가입 차단")
    # 관리 화면
    boss("/api/signup", {"email": "boss@test.com", "name": "사장", "password": "boss-pass-123", "agree": True, "agree_ai": True})
    st, r = boss("/api/admin/orders")
    ok(st == 200 and len(r["orders"]) == 3, "사장님 목록 보기")
    ny = next(o for o in r["orders"] if o["product"] == "newyear")
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
    ok([j["id"] for j in r["jobs"]] == [mid], "맥북이 대기 주문을 받아감")
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
