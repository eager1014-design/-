# 운결 보안·개인정보 점검 기록

외부 개발자 보안 점검(판매 전 필수)을 맡길 때 함께 전달하는 문서입니다.
마지막 자체 점검: 2026-10-18 (AI 보조 점검, 사람 전문가 검수 전)

## 1. 서비스 개요
- Python 3.9 표준 라이브러리만 사용 (`http.server` 기반, 외부 패키지 없음), SQLite 단일 파일 DB
- 민감 정보: 생년월일시, 상황·고민 서술(심리 상태 포함 가능), 궁합 상대의 생일
- 외부 전송: Gemini / OpenAI / Anthropic API(풀이 생성), 토스페이먼츠(빌링), SMTP(메일)

## 2. 적용된 보호 조치
| 영역 | 조치 | 위치 |
|---|---|---|
| 비밀번호 | PBKDF2-SHA256 20만 회 + 사용자별 salt | `server.hash_pw` |
| 세션 | HMAC 서명 쿠키(HttpOnly, SameSite=Lax, https면 Secure), 서명에 비밀번호 해시 일부 포함 → 비밀번호 변경 시 전 세션 무효 | `make_token`, `read_token` |
| 로그인 | 이메일당 15분 8회, IP당 15분 30회 제한, 미가입 이메일도 동일 연산(응답 시간으로 회원 여부 추측 방지) | `api_login`, `too_many` |
| 메일 토큰 | 32바이트 난수, DB에는 sha256만 저장, 1회용, 인증 48시간·재설정 1시간 만료, 재발급 시 이전 토큰 무효 | `issue_email_token` |
| 비밀번호 찾기 | 가입 여부와 무관하게 같은 응답, IP·사용자별 발송 제한 | `api_password_forgot` |
| 개발 편의 기능 | 메일 링크 응답 노출·모의 결제·체험 만료 도구는 localhost 에서만(또는 `ALLOW_MOCK_BILLING=1` 명시) | `dev_link`, `ALLOW_MOCK_BILLING` |
| CSRF | SameSite=Lax + POST 는 `application/json` 만 허용 | `do_POST` |
| XSS | 화면의 모든 사용자·AI 텍스트는 escape 후 렌더(`esc`, `md`), CSP(`script-src 'self' js.tosspayments.com`) | `static/app.js`, `Handler.CSP` |
| 클릭재킹 | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | `end_headers` |
| 정적 파일 | `static/` 바깥 경로 차단 | `serve_static` |
| 오류 노출 | 손님에게는 일반 메시지, 상세는 서버 로그 | `route_api` |
| 로그 | 품질 검사 로그에서 풀이 원문 제외, 공개 서버에서 메일 본문(링크) 로그 제외 | `quality.report_text`, `mailer.send` |
| 개인정보 | AI 국외 이전 별도 동의(가입 시 필수, 기존 회원은 정보 저장 시), 회원 탈퇴 시 즉시 삭제(결제 기록만 보관) | `api_signup`, `api_account_delete` |

자동 시험: `python3 saju/tests/test_e2e.py` (29개 — 흐름 + 보안)

## 3. 남은 위험 — 판매 전 처리 필요
1. **DB 평문 저장**: 고민 내용이 SQLite에 암호화 없이 저장됨. 서버 디스크 암호화 또는 필드 암호화 검토 필요(표준 라이브러리에 AES 없음).
2. **서버 운영**: HTTPS 종단(리버스 프록시) 구성, 방화벽, DB·`.env`·`data/secret.key` 접근 권한, 정기 백업과 백업 암호화.
3. **세션 즉시 무효화 없음**: 로그아웃은 쿠키 삭제만(토큰 30일 유효). 탈취 대응이 필요하면 서버 측 세션 목록 도입.
4. **시도 제한이 메모리 기반**: 서버 재시작 시 초기화, 서버 여러 대면 공유 안 됨.
5. **`ThreadingHTTPServer` 운영 적합성**: 실서비스는 앞단에 nginx/Caddy 등(요청 크기·속도 제한, 느린 연결 공격 대응) 권장.
6. **AI 업체 데이터 정책**: 각 API의 데이터 보관 기간·학습 미사용 조건 확인 후 처리방침에 기재.
7. **약관·처리방침**: `#/terms`, `#/privacy` 는 초안. [대괄호] 사업자 정보 기입 + 법률 검토.
8. **자동결제 사전 고지**: 전자상거래법상 유료 전환·갱신 전 고지 메일 미구현.
9. **접속 기록 보관**: 개인정보 안전성 확보조치 기준의 접속기록 보관·점검 체계 미구현(현재는 표준 출력 로그뿐).
10. **로그인 쿠키 이름 고정(`sid`)·HSTS preload 등 세부 설정**: 전문가 판단에 맡김.
11. **컨테이너가 root 권한으로 실행**: Railway 저장 공간(Volume) 쓰기 권한 문제를 피하려고 현재 root. 전용 사용자 실행 검토.
12. **초대 코드·결제 시뮬레이션**: 지인 테스트용 설정(`INVITE_CODE`, `ALLOW_MOCK_BILLING=1`). 판매 전 반드시 제거.
