# 운결 지인 테스트 · 서버 올리기

## A. 무료: 이 맥북을 임시 주소로 열기 (지금 쓰는 방법)
```bash
./saju/friend_test.sh
```
- 화면에 **주소와 초대 코드**가 나옴 → 지인에게 전달
- 멈추기: 그 창에서 Ctrl+C
- 테스트 동안 맥북 **전원 연결 + 덮개 열기** (잠들지 않게 자동 설정됨)
- 실행할 때마다 **주소가 바뀜** → 다시 켜면 새 주소를 지인에게 다시 보내야 함
- 지인 데이터는 `saju/data/friends.db` 에 따로 저장, 초대 코드는 `saju/.env` 의 `FRIEND_INVITE_CODE`

## B. 유료: Railway (판매하거나 24시간 켜둘 때)

지인 테스트용 배포 안내입니다. 명령어 없이 웹 화면 클릭만으로 진행합니다.
비용: Railway Hobby 요금제 월 5달러 + AI 사용량(하루 상한 `AI_DAILY_LIMIT`).

## 사장님이 하실 일 (약 15분)

### 1. Railway 가입
1. https://railway.com 접속 → **Login** → **GitHub로 로그인** (eager1014-design 계정)
2. 왼쪽 아래 프로필 → **Plans** → **Hobby** 선택 → 카드 등록

### 2. 프로젝트 만들기
1. **New Project** → **Deploy from GitHub repo**
2. 처음이면 **Configure GitHub App** → `eager1014-design/ai` 저장소만 허용
3. 저장소 `ai` 선택 → 자동으로 빌드가 시작됨 (저장소 맨 위의 `Dockerfile` 사용, 첫 빌드는 실패해도 괜찮음)

### 3. 저장 공간(Volume) 연결 — 회원 정보가 사라지지 않게
1. 만들어진 서비스 카드에서 오른쪽 클릭(또는 Ctrl+K) → **Add Volume**
2. Mount path 에 `/data` 입력 → 저장

### 4. 주소 만들기
1. 서비스 → **Settings** → **Networking** → **Generate Domain**
2. 만들어진 주소(예: `https://ai-production-xxxx.up.railway.app`)를 복사

### 5. 설정값 넣기
1. 서비스 → **Variables** → **Raw Editor**
2. 맥에서 `ai/.tmp/railway_설정값.txt` 를 열어 **전체 복사** → 붙여 넣기
3. 첫 줄 `PUBLIC_URL=` 뒤를 4번에서 복사한 주소로 바꾸기 → **Update Variables**
4. 자동으로 다시 배포됨. **Deployments** 탭에서 초록색 **Active** 가 되면 완료

### 6. 확인
- 주소로 접속 → 첫 화면(손님 신청서)이 보이면 성공
- **Deployments → View Logs** 에 `운결 사주 서버 실행: https://…  (AI: gemini:…` 줄이 보여야 함

### 7. 판매·홍보용 마무리 (2026-10-20~)
1. `주소/app#/signup` 에서 **eager1014@gmail.com** 으로 가입 (이 이메일만 가입됨) → `주소/admin` 로그인
2. Variables 의 `BANK_ACCOUNT=` 뒤에 입금 계좌 입력 (예: 카카오뱅크 3333-00-0000000 홍길동)
3. 맥북 루트 `.env` 의 `SAJU_URL` 을 Railway 주소로 바꾸고, 아침 글쓰기 자동 실행 켜기 (`tools/threads_daily.plist` 안내)
4. 스레드 연결 후 Variables 에 `THREADS_ACCESS_TOKEN=` 추가 (workflows/스레드_홍보.md)
5. 메일을 실제로 보내려면 `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=`, `SMTP_PASS=`(Gmail 앱 비밀번호) 추가
- 서버의 AI는 제미나이(코덱스는 맥북에만 있음)

## 지인에게 보낼 것
- 주소 + 초대 코드(`.tmp/railway_설정값.txt` 의 `INVITE_CODE`)
- 안내 문구 예: "사주 서비스 시험 중이야. 가입할 때 초대 코드 넣어줘. 결제 화면은 가짜라 돈 안 나가. 다 써보고 솔직한 후기 부탁해!"

## 지인 테스트 중 주의
- **결제는 시뮬레이션**(`ALLOW_MOCK_BILLING=1`): 실제 돈이 나가지 않음. 판매 전에는 이 줄을 지우고 토스 키를 넣을 것
- **메일은 실제로 발송되지 않음**: 이메일 인증·비밀번호 찾기 메일이 가지 않음 → 구독 시험(인증 필요)은 불가. 체험 3일 동안 모든 기능은 사용 가능
- **AI 비용**: 하루 150회 넘으면 자동으로 기본 풀이로 전환. 사용량은 로그의 `[llm] ⚠️ 오늘 AI 사용` 줄로 확인
- 개인정보 처리방침은 초안 — 지인에게 "시험 서비스이며 테스트 후 데이터를 삭제한다"고 미리 알릴 것

## 코드를 고친 뒤 다시 올리기
Claude 가 변경을 커밋하고 깃허브에 올리면(push) Railway 가 자동으로 다시 배포합니다.
