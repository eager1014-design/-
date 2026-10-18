"""운결 전체 흐름 + 보안 시험 (AI를 끈 시험 서버에 대고 실행 — 무료).

실행:
  1) 시험 서버 켜기 (AI 끔, 시험용 DB):  .claude/launch.json 의 saju-test
  2) python3 saju/tests/test_e2e.py          (기본 주소 http://localhost:8765)
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("SAJU_TEST_URL", "http://localhost:8765")
RUN = str(int(time.time()))
PW = "pw-" + RUN + "-test"
results = []


def client():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def call(path, body=None, ctype="application/json", raw=False):
        if path == "/api/signup" and body is not None:
            body = dict(body, invite=os.environ.get("SAJU_TEST_INVITE", ""))
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": ctype} if data else {})
        try:
            with op.open(req, timeout=60) as r:
                payload = r.read()
                return (r.status, payload, dict(r.headers)) if raw else (r.status, json.loads(payload))
        except urllib.error.HTTPError as e:
            payload = e.read()
            if raw:
                return e.code, payload, dict(e.headers)
            try:
                return e.code, json.loads(payload or b"{}")
            except ValueError:
                return e.code, {}
    return call


def ok(cond, msg):
    results.append(bool(cond))
    print(("✅" if cond else "❌"), msg)


PROFILE = {"birth": {"year": 1990, "month": 4, "day": 21, "calendar": "lunar", "leap": False, "hour": 14, "minute": 30,
                     "gender": "female", "city": "서울"},
           "situation": {"job": "회사원", "concern": "career", "story": "회의 때 말을 삼키게 되고 이직을 고민 중입니다"}}


def flow():
    A = client()
    email = f"flow{RUN}@example.test"
    st, r = A("/api/signup", {"name": "테스터", "email": email, "password": PW, "agree": True})
    ok(st == 400, "AI 국외 이전 동의 없이 가입 거절")
    st, r = A("/api/signup", {"name": "테스터", "email": email, "password": PW, "agree": True, "agree_ai": True})
    ok(st == 200 and "dev_link" in r, "가입 + 인증메일 링크")
    verify_tok = r["dev_link"].split("token=")[1]
    st, me = A("/api/me")
    ok(me["user"]["ai_consent"] and not me["user"]["email_verified"], "가입 직후: 동의 기록됨, 미인증")
    for birth, msg in [({"year": 1990, "month": 1, "day": 30, "calendar": "lunar"}, "음력 없는 날짜"),
                       ({"year": 2024, "month": 2, "day": 1, "calendar": "lunar", "leap": True}, "없는 윤달")]:
        st, r = A("/api/profile", {"birth": dict(birth, hour=14, minute=30, gender="female", city="서울"),
                                   "situation": PROFILE["situation"]})
        ok(st == 400, f"{msg} 거절: {r.get('error')}")
    st, r = A("/api/profile", PROFILE)
    ok(st == 200, "음력 생일 저장")
    st, c = A("/api/chart")
    i = c["chart"]["input"]
    ok((i["year"], i["month"], i["day"]) == (1990, 5, 15), "음력 1990-04-21 → 양력 1990-05-15")
    st, r = A("/api/reading", {})
    ok(st == 200 and r["engine"] == "rules", "리포트(규칙 기반)")
    st, r = A("/api/yearly")
    ok(st == 200 and len(r["months"]) == 12, "올해 운세 12달")
    st, r = A("/api/match", {"relation": "연인", "partner": {"name": "민수", "year": 1988, "month": 9, "day": 24,
                                                         "calendar": "lunar", "hour": 9, "gender": "male", "city": "부산"}})
    ok(st == 200 and r.get("score"), "궁합 점수")
    st, r2 = A("/api/match", {"relation": "연인", "partner": {"name": "민수", "year": 1988, "month": 9, "day": 24,
                                                          "calendar": "lunar", "hour": 9, "gender": "male", "city": "부산"}})
    ok(r2.get("cached") and r2.get("score") == r.get("score"), "궁합 저장본에도 점수 포함")
    st, r = A("/api/billing/prepare", {"plan": "monthly"})
    ok(st == 403 and r.get("need_verify"), "미인증이면 구독 막힘")
    st, r = A("/api/verify", {"token": verify_tok})
    ok(st == 200, "이메일 인증")
    st, r = A("/api/verify", {"token": verify_tok})
    ok(st == 400, "인증 링크 재사용 거절")
    return A, email


def password_reset(A, email):
    B = client()
    st, r = B("/api/password/forgot", {"email": "nobody-" + RUN + "@example.test"})
    ok(st == 200 and "dev_link" not in r, "없는 이메일도 같은 응답")
    st, r = B("/api/password/forgot", {"email": email})
    tok = r["dev_link"].split("token=")[1]
    st, r = B("/api/password/reset", {"token": tok, "password": "new-" + PW})
    ok(st == 200, "비밀번호 재설정")
    st, r = B("/api/password/reset", {"token": tok, "password": "again-" + PW})
    ok(st == 400, "재설정 링크 재사용 거절")
    st, me = A("/api/me")
    ok(me["user"] is None, "다른 기기의 기존 로그인 해제")
    return B


def security(B, email):
    # 로그인 시도 제한
    C = client()
    codes = [C("/api/login", {"email": email, "password": "wrong-password"})[0] for _ in range(9)]
    ok(codes[:8] == [401] * 8 and codes[8] == 429, f"틀린 비밀번호 9번째에 잠금: {codes}")
    st, r = C("/api/login", {"email": email, "password": "new-" + PW})
    ok(st == 429, "잠긴 동안은 맞는 비밀번호도 대기")
    # JSON 이 아닌 POST 거절 (다른 사이트의 몰래 보내는 폼 요청 차단)
    st, r = B("/api/logout", {}, ctype="text/plain")
    ok(st == 415, "JSON 아닌 요청 거절")
    # 정적 파일: 상위·옆 폴더 접근 차단
    st, body, _ = B("/../server.py", raw=True)
    st2, body2, _ = B("/%2e%2e/server.py", raw=True)
    ok(b"SECRET" not in body and b"SECRET" not in body2, "서버 코드 파일 노출 안 됨")
    # 보안 헤더
    st, body, h = B("/", raw=True)
    ok(h.get("X-Frame-Options") == "DENY" and "frame-ancestors 'none'" in h.get("Content-Security-Policy", ""),
       "보안 헤더(다른 사이트에 끼워넣기 차단, CSP)")
    # 탈퇴
    uid = B("/api/me")[1]["user"]["id"]
    st, r = B("/api/account/delete", {"password": "wrong"})
    ok(st == 401, "탈퇴: 틀린 비밀번호 거절")
    st, r = B("/api/account/delete", {"password": "new-" + PW})
    ok(st == 200, "탈퇴 완료")
    st, me = B("/api/me")
    ok(me["user"] is None, "탈퇴 후 로그아웃 상태")
    con = _db()
    if con:
        left = {t: con.execute(f"SELECT COUNT(*) FROM {t} WHERE {'id' if t == 'users' else 'user_id'}=?", (uid,)).fetchone()[0]
                for t in ("users", "profiles", "readings", "email_tokens", "subscriptions")}
        ok(not any(left.values()), f"탈퇴 후 DB에 남은 개인 데이터 없음: {left}")


def _db():
    import sqlite3
    db_path = os.environ.get("SAJU_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "..", ".tmp", "test.db"))
    if not os.path.exists(db_path):
        print("ℹ️ 시험 DB를 찾지 못해 DB 확인 시험은 건너뜀")
        return None
    return sqlite3.connect(db_path)


def legacy_consent():
    # 예전 가입자(동의 기록 없음)는 정보 저장 때 동의 필요 — DB를 직접 조작해 재현
    con = _db()
    if not con:
        return
    E = client()
    email = f"legacy{RUN}@example.test"
    E("/api/signup", {"name": "옛회원", "email": email, "password": PW, "agree": True, "agree_ai": True})
    con.execute("UPDATE users SET ai_consent_at=NULL WHERE email=?", (email,))
    con.commit()
    st, r = E("/api/profile", PROFILE)
    ok(st == 400 and r.get("need_consent"), "예전 가입자: 동의 없이 정보 저장 거절")
    st, r = E("/api/profile", dict(PROFILE, ai_consent=True))
    ok(st == 200, "예전 가입자: 동의 후 저장")


if __name__ == "__main__":
    A, email = flow()
    B = password_reset(A, email)
    security(B, email)
    legacy_consent()
    passed = sum(results)
    print(f"\n결과: {passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)
