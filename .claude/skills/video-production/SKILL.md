---
name: video-production
description: 유튜브 채널 "예민한자립가" 영상(긴 영상·쇼츠·릴스)을 처음부터 끝까지 만든다 — 참고 영상 분석, 자료 조사(논문 확인), 대본(episode.json), 무료 초안 렌더링, 목소리(제미나이·일레븐랩스·직접 녹음), 그림, 배경음악·효과음, 완성 mp4, 썸네일, 업로드 문구(제목·설명란·태그). 사장님이 영상 만들기, 대본, 모션그래픽, 효과음, 렌더링, 업로드 준비를 말하면 사용.
---

# 영상 제작 (자료 조사 → 대본 → 목소리 → 모션그래픽 → mp4)

## 목표
채널 "예민한자립가"(HSP 주제)에 올릴 영상을, 근거 있는 자료와 일관된 디자인으로 만든다.
가로 긴 영상(유튜브)과 세로 쇼츠·릴스를 같은 대본·같은 장면 틀로 뽑는다.

## 필요한 입력
- 주제 (예: "예민한 사람에게 맞는 일의 조건")
- 형식: 긴 영상(`long`, 1920×1080) / 쇼츠(`short`, 1080×1920)
- (선택) 참고 영상: 구조를 따라 하고 싶은 유튜브 링크 또는 영상 파일 (인스타는 내려받은 파일로)
- 사장님 경험 중 쓸 이야기 (기존 영상·메모에 있는 것만. 새로운 개인사는 지어내지 않는다)

## 사용할 Tool
- `tools/papers.mjs` — 논문이 실제로 있는지와 초록 확인 (무료)
- `tools/video_batch.mjs`, ai-bridge `gemini_watch_video` — 같은 주제의 잘된 영상 분석, `--mode=blueprint` 로 참고 영상 설계도 (유료, 승인 후)
- ai-bridge `ask_chatgpt` — 사실 교차 확인, 제목 아이디어 (사장님 ChatGPT 구독·코덱스 경유, API 요금 없음)
- `tools/gpt_image.mjs` — 챗GPT 그림 (코덱스 경유. **ChatGPT 무료 계정은 그림 기능이 잠겨 있음** → Plus 결제 후 사용, 캔바 대신)
- `video/scripts/check_episode.mjs` — 대본 검사 (무료)
- `tools/tts.mjs` — AI 목소리 (유료, 제미나이 `gemini-3.8-flash-tts`)
- `video/` — Remotion 영상 공장 (무료, 내 컴퓨터에서 렌더링)

## 순서
0. **(선택) 참고 영상으로 시작하기** — 사장님이 "이 영상 구조로 ○○ 주제 만들어줘" + 링크/파일을 줬을 때
   - 1번(편 폴더)을 먼저 만들고: `node tools/video_batch.mjs <링크|파일> --mode=blueprint --out=video/public/episodes/<편>/reference.md` (미리보기, 무료)
   - 예상 토큰을 사장님께 보고 → 승인 → 끝에 `--yes` (유료). 결과: `reference.md`(사람이 읽는 설계도) + `reference.json`
   - 설계도에서 가져오는 것은 **뼈대만**: 훅 기법, 장면 순서·길이, 전환, 말투, 화면 글씨 방식. 장면마다 `our_scene` 이 우리 장면 종류
   - 원본의 문장·이야기·화면·주제 내용은 쓰지 않는다 (저작권, 채널 신뢰). 내용은 2번 자료 조사에서 새로 찾는다
   - 원본 장면 길이가 우리 장면보다 훨씬 짧으면(1~2초 컷) 장면을 합쳐서 우리 틀에 맞춘다
1. **편 폴더 만들기**: `video/public/episodes/<번호-영문이름>/` (예: `ep01-work-conditions`)
2. **자료 조사 → `research.md`**
   - 연구 인용은 `node tools/papers.mjs search "영어 검색어" 5` → `node tools/papers.mjs doi <DOI>` 로 초록까지 읽고, 초록에 있는 내용만 쓴다
   - 표에 "대본 내용 | 근거(저자·연도·DOI) | 확인" 으로 정리. 확인 못 한 내용은 대본에 넣지 않는다 (예: 연구진 국적처럼 초록에 없는 정보)
   - 작은 연구(참가자 수십 명)는 "~했다"로 말하고 "뇌가 다르다"처럼 단정하지 않는다
3. **대본 → `episode.json`** (장면 종류는 아래 표)
   - 채널 공식: 0~5초 바닥 고백 + 관점 뒤집기 → 30초 안에 "오늘 3가지" 예고 → 챕터마다 경험 → 연구 한 줄 → 비유 → 할 일 → 행동 요청 1개
   - 숫자는 내레이션에서 한글로 ("일곱 번"), 화면 글씨에서는 숫자로 ("7번")
   - 화면 글씨에서 `**강조**` 는 형광펜, 줄바꿈은 `\n`
   - 화면 요소마다 `cue`(그 요소를 말하는 순간의 단어)를 내레이션에 있는 그대로 적는다
   - `node video/scripts/check_episode.mjs <episode.json>` 으로 검사 → 문제 0개일 때까지
4. **무료 초안 영상** (목소리 없이 화면·효과음만): `cd video && npx remotion render Episode out/<편>_draft.mp4 --props=public/episodes/<편>/episode.json`
5. **사장님 확인**: 대본 + 초안 영상. 대본을 고치면 3~4를 반복 (목소리 만들기 전에 끝낼 것 — 목소리는 돈이 든다)
6. **목소리**: `node tools/tts.mjs video/public/episodes/<편>/episode.json` (미리보기, 무료) → 사장님께 "N장면, M자, 약 K초" 승인 → `--yes`
   - 처음이거나 목소리를 바꿀 때: `node tools/tts.mjs voices --yes` 로 6개 목소리를 비교해서 사장님이 고름 → `episode.json` 의 `"voice": {"name": …}`
   - 고친 장면만 다시 만들어진다 (내레이션이 같으면 건너뜀). 특정 장면만: `--only=s05,s09`
6-1. **(추천) 일레븐랩스 API로 바로 통녹음** — 사장님 복제 목소리 "천성준" (ID `vithIMnhyN3GwRbVmrZt`, 한국어)
   - `episode.json` 에 `"voice": {"provider": "elevenlabs", "id": "vithIMnhyN3GwRbVmrZt", "name": "천성준"}` (모델은 `"model"` 로 바꿀 수 있음, 기본 `eleven_v3`)
   - `node tools/elevenlabs.mjs narrate <episode.json>` (미리보기, 무료) → 사장님께 "N자 ≈ 크레딧 N" 승인 → `--yes` → 편 폴더 `voice_full.mp3`
   - 그 다음 바로 6-2의 split_voice (장면 자르기 + 자막 타이밍). 같은 대본·같은 목소리면 다시 녹음하지 않음
   - 지금 키는 크레딧 조회(`user_read`)·모델 목록(`models_read`) 권한이 없음 → 남은 크레딧은 ElevenLabs 웹에서 확인
6-2. **(ElevenLabs 등에서 통으로 녹음한 경우)** `voice_full.mp3` 를 편 폴더에 넣고 `cd video && node scripts/split_voice.mjs public/episodes/<편>/episode.json --dry` → 장면 경계 확인 → `--dry` 빼고 실행
   - 처음 한 번: `node scripts/setup_whisper.mjs` (내 컴퓨터 받아쓰기, 무료, 약 1.5GB)
   - ElevenLabs 대본은 대괄호 영어 말투 지시(`[warm]`), 숫자는 한글, 쉼은 "…" (v4 는 `<break>` 미지원). 문단 하나 = 장면 하나
6-3. **캐릭터 그림 (캔바, 사장님 캔바 AI 사용량 사용)**
   - 캐릭터 기준 그림: `video/public/characters/main/` (원본 선화). 캔바 미디어 ID: `MAHYXSysZ8s` (이미 올라가 있음)
   - 장면 그림: 캔바 `generate-image` (기준 그림 + "캐릭터는 검은 선화 그대로, 환경만 부드러운 3D" 지시, 16:9) → 결과는 미리보기 크기만 오므로
     캔바 디자인 "Blank illustration canvas" (`DAHYXUpShBw`) 에 페이지 추가 → 페이지 배경을 그 그림으로 채움 → **사장님 승인 후 저장** → PNG 1920×1080 내보내기 → `<편 폴더>/<장면>.png`
   - 장면 칸: `"image"`, `"motion"`(zoomIn·zoomOut·panLeft·panRight·focus), `"focusX/focusY"`, `"textSide":"left"` (그림의 빈 쪽에 글씨)
   - 모션그래픽 옆 캐릭터: 흰 배경 포즈 그림 → `node scripts/cutout.mjs <그림>` (바깥 흰색만 투명하게 + 여백 자르기) → 장면에 `"pose": "characters/main/<이름>.cut.png"`
   - 캔바 AI 크레딧이 떨어지면 "You have exceeded your credit quota" → 크레딧이 다시 찰 때까지 기다리거나 캔바 요금제 확인
6-4. **배경음악·음악 연출**
   - 만들기 (ElevenLabs 크레딧): `node tools/elevenlabs.mjs music <이름> "<영어 설명, 가사 없음, 내레이션 밑에 깔리게>" --seconds=<영상 길이+5>` → 미리보기 → 사장님 승인 → `--yes`
   - 효과음도 같은 방식: `node tools/elevenlabs.mjs sfx <이름> "<설명>" --seconds=1.5 --yes` → `"sfx": [{"name": "<이름>", "ext": "mp3", "cue": "단어"}]`
   - episode.json: `"music": "music/<이름>.mp3"`, `"musicStart": "<장면 id>"`(그 전은 무음 — 첫 훅을 또렷하게), `"musicVolume": 0.16`
   - **음악 빼기 센스** (사장님 요청): 영상의 핵심 반전·위로·결론 문장 3~4곳에 `"musicDrop": {"at": "단어", "until": "단어", "level": 0}` (0 = 완전히 뺌, 0.15 = 거의 뺌)
     마지막 "오늘의 한 줄"은 `"musicMute": true` + `"sfx": [{"name": "chime", "after": true}]` (말이 끝나면 띵)
   - 너무 자주 빼면 효과가 없다. 한 편에 3~4번 + 마지막 한 줄
6-5. **효과음 늘리기 (사장님이 직접 받기 — 클로드 토큰 0)**
   - 받는 곳 (추천 순서): ① 유튜브 스튜디오 → 오디오 보관함 → 효과음 탭 ② pixabay.com/sound-effects ③ freesound.org (왼쪽 필터 License 에서 **Creative Commons 0** 만 체크)
   - 검색어는 영어가 잘 나옴: whoosh, pop, click, ding, swipe, typing, paper, notification, soft hit
   - 1~2초짜리만. 길면 앞부분만 쓰임
   - 파일 이름은 영어 소문자로 바꿔서 `video/public/sfx/` 에 넣기 (예: `click.mp3`, `paper.mp3`)
   - 클로드에게는 "sfx 폴더에 click, paper 넣었어" 한 줄만 → 클로드가 장면에 `"sfx": [{"name": "click", "ext": "mp3", "cue": "단어"}]` 로 붙임
   - 한 번 받은 효과음은 모든 편에서 재사용. 처음에 10개 정도 모아두면 끝
   - 클로드가 받을 때는 `node tools/freesound.mjs pick <이름>="<영어 검색어>"` (무료, CC0만, 미리보기 → 사장님 승인 → `--yes`). 사이트를 읽지 않고 도구가 골라서 토큰이 적게 듦. 출처는 `sfx/SOURCES.md` 에 자동 기록
   - 픽사베이는 로봇 차단(403)이라 도구로 못 받음 → 사장님이 직접
   - **유튜브 오디오 보관함 창고 `video/sfx/` (2026-10-19, 999개·1.6GB, 출처 표기 필요 없음)**: 분류 폴더(ambiences·water·weather·household·office·cartoon·impacts·alarms·human_voices·animals·foley·doors). 먼저 `video/sfx/index.json` 에서 제목·길이로 찾고, 고른 파일만 `video/public/sfx/<영어이름>.mp3` 로 복사해서 쓴다 (창고 통째로 public 에 넣으면 렌더가 느려짐). 총·공포·스포츠·교통·SF·공구는 채널 분위기와 안 맞아 뺐다
   - 창고 다시 채우기: 앱 안 브라우저에서 사장님 로그인 → 스튜디오 오디오 보관함 → 페이지 안 스크립트로 목록·다운로드 주소를 뽑아 `node tools/sfx_download.mjs <뽑은 json> 10`. 주소는 약 10분 뒤 만료되니 400개씩 뽑자마자 받기. 동시받기 16개는 끊김 → 10개. 앱 브라우저는 파일 다운로드·localhost 전송이 막혀 있어서, 결과를 크게 돌려받아 도구 결과 파일로 저장되게 하는 방식으로 넘긴다
   - 지금 있는 효과음 (2026-10-19): chime·pop·whoosh(.wav, 직접 만든 것) + click·swipe·typing·paper·notification·bubble·riser·ding·camera·sparkle·heartbeat·softhit(.mp3, Freesound CC0)
6-4. **쇼츠(세로)에서 가로 그림 쓰기**: 세로 화면에는 그림 폭의 약 32%만 보인다. 장면에 `"focusX"`(캐릭터 가로 위치 0~1)를 꼭 적으면 캐릭터가 가운데 오게 잘린다. 글씨는 자동으로 화면 위쪽으로 감
   - 옆 캐릭터(`pose`)는 bigNumber·citation 처럼 글씨가 많은 장면에서 출처 글씨를 가린다 → 쇼츠에서는 statement 같은 짧은 장면에만
7. **완성 렌더링**: 4번 명령에서 파일 이름만 `_final.mp4` 로
8. **유튜브 업로드 (게시 버튼은 항상 사장님)**
   - 키워드: `node tools/youtube.mjs keywords "씨앗1" "씨앗2" --check=5` (자동완성 무료 + 상위 N개 조회수, 101점씩) → 많이 치는 말 + 영상 주제에 맞는 말
   - `<편 폴더>/upload.json`: 제목 후보 3개(핵심 키워드를 맨 앞, 100자 이내) → 사장님이 고름, 설명란(첫 2줄에 키워드, 조건·댓글 질문, 출처 논문, "경험 정리" 고지, 해시태그 3개), 태그, `altered_content`
   - 썸네일: `cd video && npx remotion still Thumbnail out/<편>_thumb.png --props=public/episodes/<편>/upload.json` (upload.json 의 `thumbnail`: kicker, lines, image, format)
     - **쇼츠는 컴퓨터에서 썸네일을 못 바꿈** → 휴대폰 유튜브 앱에서 표지 장면 고르기. 썸네일 이미지는 긴 영상·커뮤니티용
   - **AI 복제 목소리(천성준)를 쓰면 "변경되거나 합성된 콘텐츠: 예"** (사장님 결정, 2026-10-19)
   - **올리기 = 업로드 도구 (2026-10-19 연결 완료, 무료·하루 약 6편)**
     1. 사장님이 고른 제목으로 `<편 폴더>/youtube.json` 만들기: `title`(1개), `description`, `tags`, `thumbnail`(긴 영상만, 2MB 이하), `altered_content`, 예약이면 `publishAt`
     2. 미리보기(무료, 안 올라감): ai-bridge `youtube_upload` (confirm=false) 또는 `node tools/youtube_upload.mjs upload <영상.mp4> <youtube.json>`
     3. 미리보기를 사장님께 보여주고 **"올려" 확인을 받은 뒤에만** confirm=true / `--yes`
     4. 영상은 비공개로 올라감 (구글 심사 안 받은 개인용 연결이라 유튜브가 잠금) → 스튜디오 링크 드리고 사장님이 확인 후 공개
   - 연결 정보: 구글 클라우드 "My First Project" → OAuth 클라이언트 `youtube-upload`(데스크톱), 테스트 사용자 eager1014 계정. 열쇠 파일 `credentials.json`·`token.json`(둘 다 git 제외)
   - **7일마다 열쇠 만료** (구글 "테스트 중" 앱 규칙) → "열쇠가 만료" 오류가 나면 `node tools/youtube_upload.mjs login` 을 백그라운드로 돌리고 사장님께 브라우저에서 허용 눌러달라고 하기
   - 썸네일 실패 = 채널 전화번호 인증 안 됨 → 사장님이 youtube.com/verify 에서 인증
   - Claude in Chrome·앱 브라우저로 스튜디오에 직접 올리는 건 파일 선택 창이 막혀서 안 됨 → 도구를 쓸 것

## 장면 종류 (video/src/scenes.jsx)
| type | 쓰는 곳 | 주요 칸 |
|---|---|---|
| `hook` | 첫 문장들 | lines[{text, cue}], kicker |
| `statement` | 한 문장 강조 | text, kicker, sub, cue |
| `roadmap` | 오늘의 순서 예고 | title, items[] |
| `chapter` | 챕터 시작 (화면 전체 세이지색) | number, title, sub |
| `bigNumber` | 큰 숫자 | value, prefix, suffix, label, source, cue |
| `citation` | 논문 출처 카드 | authors, year, title, journal, finding, cue, findingCue |
| `compare` | 좌우 비교 (세로 영상은 위아래) | title, left/right{title, emoji, cue, items[]}, leftColor |
| `checklist` | 체크 표시 목록 | title, items[] |
| `bars` | 막대 차트 (실제 데이터만!) | title, bars[{label, value, color}], unit, source |
| `story` | 이야기 장면 (이미지·영상 있으면 천천히 확대, 없으면 이모지) | image / video / emoji, lines[] |
| `outro` | 마무리 댓글 질문 | question, cue, channelCue |

편 전체 칸 (빠른 쇼츠 느낌, 2026-10-19 참고 영상 분석에서):
- `"style": "punchy"` — 글씨·카드가 통 튀어나오는 등장, 굵은 자막, 자막 속 키워드 노란색 (기본은 `"calm"`)
- `"pace": {"speed": 1.1, "trim": true}` — 장면 앞뒤 쉼을 잘라내고 목소리를 1.1배로 (녹음 다시 안 해도 됨, 받아쓰기 시각이 있는 장면만 자름)
- `"steps": ["사람","깊이","쉼"]` + 장면마다 `"step": 1~3` — 쇼츠 위쪽 단계 막대. step 없는 장면은 막대 숨김
- 장면 `"keywords": ["단어", …]` — 자막에서 노란색으로 칠할 말 (화면 글씨의 `**강조**` 는 자동 포함). 조사는 달라도 맞춰짐

공통 칸: `narration`(필수), `direction`(목소리 말투 지시, 영어), `captions`(false 로 자막 끄기), `musicMute`(true 면 이 장면에서 배경음악 끔).
`chapters`(상단 진행 표시 이름, 짧게), `music`(public 안 음악 파일 경로), `voice`({name, speed, style}).

## 디자인 규칙
- 색·글꼴은 `video/src/theme.js` 한 곳에서만 바꾼다 (크림·세이지·호박색, Pretendard)
- 효과음은 `video/scripts/make_sfx.mjs` 가 코드로 만든 것 (저작권 없음). 배경음악은 사장님이 고른 저작권 없는 파일만 `video/public/music/`
- 다른 유튜버 영상은 자료화면으로 쓰지 않는다

## 비용
- **분담 원칙 (사장님 결정, 2026-10-19): 토큰·크레딧 아끼기가 먼저**
  - 정보 수집·참고 영상 분석 = 제미나이 (무료 한도) → 클로드는 요약만 읽는다
  - 대본·모션그래픽·업로드 문구 = 클로드 (대본·출처를 이미 알고 있어서)
  - 챗GPT = 구독(코덱스)으로만. API 키는 쓰지 않는다
  - 일레븐랩스 = 선택. 대본 확정 후 한 번만. 효과음은 무료 `scripts/make_sfx.mjs` 것(chime·pop·whoosh) 먼저
  - 사장님이 직접: 참고 링크 고르기, 초안 수정사항 한 번에 모아 말하기, 게시 버튼. 한 편 끝나면 새 대화
- 무료: 논문 확인, 대본 검사, 초안·완성 렌더링
- 유료(매번 승인): 제미나이 목소리(대본 3분 ≈ 1,500자), 영상 분석

## 문제가 생겼을 때
- ElevenLabs "키에 OO 권한이 없습니다" → elevenlabs.io/app/settings/api-keys → 키 편집 → 그 권한 켜기 (Music Generation, Sound Effects, Text to Speech, User Read)
- "제미나이 무료 등급에서 막혀 있습니다 (한도 0)" → 지금 키는 무료 등급이라 **이미지 생성(gemini-*-image)은 쓸 수 없음**. Google AI Studio 에서 결제를 켜야 함. 영상 분석·목소리는 무료 한도 안에서 작동했음 (지금까지 요금 0원)
- 렌더링이 매우 느림(10초 분량에 1분 이상) → 이전 렌더링이 뒤에서 아직 돌고 있을 수 있음. `pkill -f "remotion render"; pkill -f chrome-headless-shell` 후 다시. 정상 속도는 10초 분량에 약 17초 (맥 8코어)
- 배경에 `filter: blur` 나 매 프레임 계산하는 SVG 질감을 넣지 말 것 → 렌더링이 몇 배 느려짐. 질감은 이미지(`scripts/make_textures.mjs`)로
- "Your macOS version is older than macOS 15" 경고 → 지금까지는 렌더링에 문제 없었음. 화면이 깨지면 이 경고부터 의심
- `check_episode` 가 "등장 단어가 내레이션에 없음" → cue 를 내레이션 문장 그대로 복사 (띄어쓰기까지)
- 장면 종류 추가 시: `src/scenes.jsx` 의 SCENES 와 `scripts/scene-types.mjs` 둘 다 고칠 것

## 변경 기록
- 2026-10-19: 효과음 늘리기(6-5) — 사장님이 무료 사이트에서 직접 받아 sfx 폴더에 넣는 방식
- 2026-10-19: 챗GPT 질문을 API 키 → 구독(코덱스)으로 변경, 분담 원칙 추가, 코덱스 그림 도구(gpt_image) 추가
- 2026-10-19: 빠른 스타일(`style: punchy`, `pace`, `steps`, `keywords`) 추가. VS Code 안에서 mp4를 열면 소리가 안 나옴 → 맥 기본 플레이어로 확인
- 2026-10-18: 일레븐랩스 API 통녹음(`narrate`, 천성준 목소리), 쇼츠에서 가로 그림 캐릭터 중심 자르기·글씨 위로
- 2026-10-18: 참고 영상 설계도 단계(0번) 추가 — `video_batch.mjs --mode=blueprint`
- 2026-10-18: ElevenLabs API 연결(음악·효과음), 음악 연출(musicStart/musicDrop/musicMute), 받아쓰기 기반 정확한 타이밍(charTimes)
- 2026-10-18: ElevenLabs 통녹음 → 장면별 자르기(split_voice, 받아쓰기 기반), 캐릭터 그림 도구(illustrate), 무료 등급 이미지 한도 0 발견
- 2026-10-18: 처음 작성 (장면 틀 11종, 논문 확인, 대본 검사, 제미나이 목소리, 렌더링 속도 문제 해결)
