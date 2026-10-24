// 매일 쇼츠 일꾼 — 예민한자립가. 사장님 일기 + 떡상 쇼츠 연출 분석 → 대본(episode.json) → 목소리 없는 초안 영상.
// 목소리(일레븐랩스, 크레딧)와 업로드는 사장님이 앱(tools/viral)에서 버튼을 눌렀을 때만 한다.
//
// 사용법:
//   node tools/daily_short.mjs run [--date=2026-10-24] [--skip-source]   새벽 5시 자동 (launchd) — 소싱·분석·대본·초안
//   node tools/daily_short.mjs redo <날짜> "고칠 점" [--ref=<보관함 id>]     대본 다시 쓰기 + 초안 (--ref: 사장님이 고른 참고 자료를 가장 크게 따름)
//   node tools/daily_short.mjs photos <날짜>                              대본은 그대로, 위인 사진·삽화만 다시 채우기 + 초안
//   node tools/daily_short.mjs voice <날짜>                               일레븐랩스 천성준 녹음 → 장면 자르기 → 완성 영상 (크레딧 사용)
//   node tools/daily_short.mjs upload <날짜>                              유튜브에 비공개로 올리기
//
// 비용: 소싱(유튜브 무료 한도 300점) · 분석(제미나이, 쇼츠 1개 ≈ 2만 토큰 × 3) · 대본(클로드 구독, 추가 0원) · 렌더(무료)
// 상태: tools/viral/data/daily/<날짜>.json — 앱이 이 파일을 읽어 화면에 보여준다.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, DATA_DIR, load, save, upsert, searchYoutube, analyze, saveSettings } from "./viral/core.mjs";
import { fetchPortraits, locateFace, creditLines } from "./commons.mjs";

const DAILY_DIR = path.join(DATA_DIR, "daily");
const VIDEO = path.join(ROOT, "video");
const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME, ".local/bin/claude");
const NODE = process.execPath;
const VOICE = { provider: "elevenlabs", id: "vithIMnhyN3GwRbVmrZt", name: "천성준" };
// 2026-10-23 주제 조사 (쇼츠 24개 주제 × 50개, 최근 3달 떡상 수): 손절·가스라이팅·사주 궁합·직장 인간관계·회피형이 강하고
// 번아웃·생각 많은·착한아이·혼자가 편한·연락 불안 같은 '자기 돌봄' 주제는 떡상 0개 → 소싱 키워드도 강한 쪽으로
const DEFAULT_KEYWORDS = ["손절해야 하는 사람", "친구 손절", "가스라이팅", "사주 궁합", "직장 인간관계", "회피형 연애", "예민한 사람", "자존감 낮은 사람", "눈치 많이 보는 사람", "나르시시스트"];
const PEOPLE_GUIDE = `[철학자·심리학자·위인 편 — 사장님 시리즈 (쇼펜하우어·칼 융·니체·에픽테토스·반 고흐 등, 하루 한 명 천천히)]
- 틀: 위인의 실제 삶의 장면(사진) → 그가 남긴 관계·고독·예민함에 대한 생각 → 예민한 사람인 나(채널 주인)에게 주는 의미 → 오늘 할 한 가지.
- 사진 장면 "type": "photo" 를 2~3개: {"person": "영문 전체 이름(위키백과 표기, 예: Arthur Schopenhauer)", "name": "한글 이름", "years": "1788–1860", "lines": [{text, cue}], "circle": {"at": "그 사람을 가리키는 순간의 단어"}}. 사진·얼굴 위치는 자동으로 채워지니 image·x·y 쓰지 말 것.
- 사실만: 생몰년·잘 알려진 일화·명언은 확실한 것만. 명언은 원문이 확실치 않으면 직접 인용("~라고 했다") 대신 "~라는 생각을 남겼어요" 처럼 뜻만. 지어낸 일화·가짜 명언 절대 금지. 설명란에 출처 책 이름(예: 쇼펜하우어 『소품과 부록』)을 적을 것.
- 위인을 HSP 라고 단정하지 말 것 ("~였다는 기록이 있어요" 처럼 알려진 성향만).`;

const TOPIC_GUIDE = `[주제 고르는 법 — 2026-10-23 유튜브 쇼츠 조사 결과, 반드시 따를 것]
- 뜨는 틀: ① "반드시 거리 둬야 할 사람 유형"(손절·가스라이팅·나르시시스트) ② "사주로 보는 피해야 할 인연·최악의 궁합" ③ "~한 사람만 하는 행동"(시청자를 콕 집는 정체성 호출) ④ 회피형·불안형 연애에서 상대가 하는 말·행동 ⑤ 직장에서 휘둘리지 않고 거리 두는 법
- 안 뜨는 틀: 번아웃·생각 많음·착한아이·혼자가 편함·연락 불안처럼 '내 마음 돌보기'만 하는 주제 → 떡상 0개. 위로는 끝에 한 줄만.
- 예민한 사람(HSP) 시선은 유지하되, 제목·첫 문장은 '타인' 또는 '관계의 위험 신호'로 시작 (예: "예민한 사람을 무너뜨리는 사람 유형 3", "계수 일간이 절대 만나면 안 되는 사람").
- 일기가 있으면 일기 속 사건을 위 틀 중 하나로 바꿔서 기획 (예: 일기 속 서운했던 사람 → '이런 말 하는 사람은 거리 두세요').`;
const MIN = { views: 90000, likes: 5000, comments: 50 };

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")).map(([k, v]) => [k, v ?? true]));
const args = rest.filter((a) => !a.startsWith("--"));
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜

// ---------- 상태 파일 ----------
const stateFile = (date) => path.join(DAILY_DIR, `${date}.json`);
function readState(date) {
  try { return JSON.parse(fs.readFileSync(stateFile(date), "utf8")); } catch { return null; }
}
function writeState(st) {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.writeFileSync(stateFile(st.date), JSON.stringify(st, null, 2));
}
function log(st, msg) {
  const line = `${new Date().toLocaleTimeString("ko-KR", { hour12: false })} ${msg}`;
  console.log(line);
  st.log = [...(st.log || []), line].slice(-80);
  writeState(st);
}
function begin(date, status) {
  const st = readState(date) || { date, log: [] };
  if (st.pid && st.pid !== process.pid && ["running", "voicing", "uploading"].includes(st.status)) {
    try { process.kill(st.pid, 0); throw new Error(`이미 작업 중입니다 (${st.status}).`); } catch (e) { if (e.message.startsWith("이미")) throw e; }
  }
  Object.assign(st, { status, pid: process.pid, error: null });
  writeState(st);
  return st;
}
function fail(st, e) {
  st.status = "failed";
  st.error = String(e?.message || e);
  log(st, `❌ ${st.error}`);
  process.exitCode = 1;
}

function run(st, label, bin, argv, opts = {}) {
  log(st, `▶ ${label}`);
  const r = spawnSync(bin, argv, { cwd: opts.cwd || ROOT, encoding: "utf8", timeout: opts.timeout || 1800_000, input: opts.input, maxBuffer: 64 << 20 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${label} 실패: ${out.trim().split("\n").slice(-6).join(" / ")}`);
  return { ok: r.status === 0, out };
}

// ---------- 1. 소싱 ----------
async function source(st) {
  const db = load();
  const keywords = db.settings?.keywords?.length ? db.settings.keywords : DEFAULT_KEYWORDS;
  const dayIndex = Math.floor(Date.parse(st.date) / 864e5);
  const picks = [0, 1, 2].map((i) => keywords[(dayIndex * 3 + i) % keywords.length]);
  const chosen = [];
  for (const keyword of [...new Set(picks)]) {
    try {
      const r = await searchYoutube({ keyword, shorts: true, since: "quarter", min: MIN, pages: 1 });
      const fresh = r.hits.filter((h) => !db.items[h.id] && !chosen.some((c) => c.id === h.id));
      log(st, `🔍 "${keyword}" ${r.checked}개 중 ${r.hits.length}개 통과, 새것 ${fresh.length}개`);
      if (fresh[0]) chosen.push({ ...fresh[0], keyword });
    } catch (e) {
      log(st, `⚠️ "${keyword}" 검색 실패: ${e.message}`);
    }
  }
  for (const c of chosen) upsert({ ...c, source: "daily" });
  st.sources = chosen.map((c) => c.id);
  st.keywords = picks;
  log(st, `📥 오늘 참고할 떡상 쇼츠 ${chosen.length}개`);
}

// ---------- 2. 연출 분석 ----------
async function analyzeSources(st) {
  for (const id of st.sources || []) {
    if (load().items[id]?.analysis) continue;
    try {
      const it = await analyze(id);
      log(st, `🧠 분석: ${it.title.slice(0, 30)} — ${it.analysis.one_line?.slice(0, 50) || ""}`);
    } catch (e) {
      log(st, `⚠️ 분석 실패 (${id}): ${e.message} — 이미 쌓인 분석으로 계속`);
    }
  }
}

// ---------- 3. 아이디어 + 대본 (클로드 구독) ----------
const TEMPLATE_EP = path.join(VIDEO, "public/episodes/ep02s-born-sensitive/episode.json");
const AUDIO_KEYS = ["charTimes", "wordTimes", "audio", "audioDuration", "audioStart", "playbackRate", "audioSource"];
const stripAudio = (ep) => ({ ...ep, scenes: ep.scenes.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !AUDIO_KEYS.includes(k)))) });

function pastDailies(limit = 14) {
  if (!fs.existsSync(DAILY_DIR)) return [];
  return fs.readdirSync(DAILY_DIR).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit + 1)
    .map((f) => JSON.parse(fs.readFileSync(path.join(DAILY_DIR, f), "utf8"))).filter((d) => d.idea);
}

function writingPrompt(st, feedback) {
  const db = load();
  const diary = db.diary || [];
  const fresh = diary.filter((d) => !d.usedIn?.length).slice(-8);
  const older = diary.filter((d) => d.usedIn?.length).slice(-4);
  const refs = [...new Set([...(st.refs || []), ...(st.sources || [])])].map((id) => db.items[id]).filter((x) => x?.analysis);
  // 오늘 분석이 없으면 예전에 쌓인 분석 중 최근 것
  const analyses = refs.length ? refs : Object.values(db.items).filter((x) => x.analysis).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 3);
  const techniques = Object.values(db.techniques || {}).filter((t) => t.status === "auto" || t.status === "done").slice(-12);
  const past = pastDailies().filter((d) => d.date !== st.date).map((d) => `- ${d.date}: ${d.idea.title}`).join("\n") || "(없음)";
  const template = JSON.stringify(stripAudio(JSON.parse(fs.readFileSync(TEMPLATE_EP, "utf8"))), null, 1);
  const diaryText = fresh.length
    ? `[사장님 일기 — 아직 영상에 안 쓴 것]\n${fresh.map((d) => `(${d.id}, ${d.at.slice(0, 10)})\n${d.text}${d.photoNote ? `\n[붙인 사진 내용] ${d.photoNote}` : ""}${d.links ? `\n[붙인 링크] ${d.links}` : ""}`).join("\n\n")}\n\n[예전에 쓴 일기 — 맥락 참고용, 같은 이야기 반복 금지]\n${older.map((d) => d.text.slice(0, 300)).join("\n---\n") || "(없음)"}`
    : `[사장님 일기] 오늘은 새 일기가 없습니다. → 위 '뜨는 틀' 중 최근에 안 쓴 것으로 기획하세요 (심리학 관점 + 연애·인간관계). 사장님 개인 경험은 지어내지 말고, 시청자의 상황을 묘사하는 2인칭으로.`;

  return `너는 유튜브 채널 "예민한자립가"의 쇼츠 기획자 겸 대본 작가야. 오늘 올릴 세로 쇼츠 1편을 기획하고, 우리 영상 공장이 바로 렌더링할 수 있는 episode.json 을 써.

[채널]
- 시청자: 예민한 사람(HSP), 관계·일에 지친 2030. 채널 주인(사장님)은 퇴사 7번, 이혼, 빚을 겪고 다시 일어서는 중인 사람. 말투는 차분하고 담백한 존댓말 내레이션 (목소리 = 사장님 복제 목소리).
- 시리즈 방향: 예민함 × 사주 × 심리학 × 연애·관계. 사주는 과학처럼 말하지 않는다 ("~래요", "사주에서는 ~라고 봐요").
- 사장님이 "맨날 같은 얘기(퇴사 7번)"를 지겨워함 → 일기의 새 이야기를 중심으로.

${st.topic ? `[★ 사장님이 정한 오늘 주제 — 반드시 이 주제로. 아래 '주제 고르는 법'보다 우선]\n${st.topic}\n\n` : ""}${TOPIC_GUIDE}

${PEOPLE_GUIDE}

${diaryText}

[오늘 참고하는 떡상 쇼츠 분석 — 공식·훅 방식만 빌리고 내용·문장은 베끼지 말 것]
${st.refs?.length ? "(첫 번째 자료는 사장님이 직접 고른 참고 자료 — 이 구조·연출을 가장 크게 따를 것)\n" : ""}${analyses.map((a) => `■ ${a.title} (조회 ${a.views}, 좋아요 ${a.likes})\n 왜 떴나: ${a.analysis.one_line}\n 훅: ${a.analysis.hook}\n 공식: ${a.analysis.reusable_formula}`).join("\n") || "(없음)"}

[입혀볼 연출 기법 — 우리 장면으로 흉내 낼 수 있는 것, 어울리면 1~2개 적용]
${techniques.map((t) => `- ${t.name} (${t.our_scene}): ${t.how_to_copy}`).join("\n") || "(없음)"}

[최근에 만든 쇼츠 — 겹치지 않게]
${past}
${feedback ? `\n[사장님 수정 요청 — 반드시 반영]\n${feedback}\n\n[직전 대본]\n${JSON.stringify(st.idea)}\n` : ""}
[절대 규칙]
1. 일기에 없는 사장님 경험·숫자·사건을 지어내지 마. 일기 내용은 사장님 말을 다듬어 1인칭으로.
2. 연구·통계 인용 금지. 예외: Assary 외 2020(Molecular Psychiatry) 쌍둥이 연구 — 예민함 차이의 47%가 유전. 그 외 숫자가 꼭 필요하면 쓰지 말고 비유로.
3. image·video·pose 칸은 쓰지 말 것. story 장면은 "emoji"(이모지 1개)를 넣고, 그중 이야기의 핵심 장면 2~3개에는 "art": "삽화 설명" 을 추가 — 채널 캐릭터(나)가 무엇을 하는지, 어디인지, 표정을 구체적으로 한 문장(예: "시끄러운 카페에서 두 손으로 귀를 막고 눈을 질끈 감은 나, 주변 사람들은 흐린 회색 실루엣"). 그림은 자동으로 그려지고, 그 장면 글씨는 화면 왼쪽에 나온다. 실존 인물(위인)은 art 로 그리지 말고 photo 장면으로.
4. 장면 6~9개, 내레이션 합계 250~400자 (약 40~55초). 숫자는 내레이션에서 한글("일곱 번"), 화면 글씨에서 숫자.
5. 모든 cue·at 값은 그 장면 narration 안에 띄어쓰기까지 똑같이 있는 말이어야 함.
6. frame.title 은 2줄, 줄마다 14자 이내. 첫 장면 첫 문장 = 3초 안에 멈추게 하는 훅 (떡상 공식 활용).
7. 마지막은 outro: 댓글로 답하고 싶은 질문. 사주가 나오는 편이면 channel 에 "내 사주 무료로 보기 → 고정 댓글".
8. 화면 글씨에서 **강조**는 형광펜, 줄바꿈은 \\n. 한 화면 글씨는 짧게 (그래픽 칸이 가로 16:9 라서 한 줄 12자 이내, 최대 3줄).
9. 댓글 말풍선: 가운데 장면 2~3곳에 "comments": [{"text": "시청자가 달 법한 공감·질문 한마디(16자 이내)", "at": "그 장면 내레이션 속 단어", "emoji": "😳"}] — 한 장면에 1~2개, 영상 전체 3~5개. 화면에 '예시'라고 자동 표시되니 실제 후기처럼 꾸미지 말 것 (이름·숫자·효과 주장 금지).
10. compare 의 항목(items)은 2개씩, 각 10자 이내. checklist 는 3개, 각 14자 이내.
11. 효과음: 장면마다 "sfx": [{"name": "이름", "ext": "mp3", "cue": "그 장면 내레이션 속 단어"}] 로 0~2개. 같은 소리를 영상에서 두 번 넘게 쓰지 말고 섞어서. 글씨 등장 '휙·뽁' 소리는 자동이니 넣지 말 것.
   쓸 수 있는 효과음: correct(정답 띵동) · wrong(오답 부저) · scratch(레코드 긁힘, 반전 직전) · boing(띠용, 황당) · gasp(헉) · sigh(한숨) · slidewhistle(뚝 떨어짐, 실망) · thud(쿵) · drum(퍽, 충격 한 방) · glitch(지지직, 머릿속 혼란) · pageturn(책장 넘김, 다음 이야기) · bell(띵, 깨달음) · kaching(삑, 체크) · tick(째깍, 시간·기다림) · heartbeat(두근, 불안) · notification(알림, 메시지) · typing(타자) · camera(찰칵) · riser(긴장 고조) · sparkle(반짝, 희망) · ding(딩) · paper(종이) · chime(wav, 마무리)
12. 배경음악 분위기를 "music_mood" 로 하나 골라: ${musicMoods().join(" · ")} (calm 잔잔 · sad 슬픔·여운 · tense 긴장·위험 신호(손절·가스라이팅 편에 잘 맞음) · playful 장난·경쾌 · hopeful 희망·위로)

${load().settings?.skin === "chalk" ? `13. 칠판 스타일 소품: "props": [{"icon": "이름", "at": "그 장면 내레이션 속 단어", "x": 0.2, "y": 0.4, "size": 220, "move": "bob|wiggle|pulse|spin"}] — 장면 뜻에 맞는 손그림 소품이 선으로 그려지며 나타나 계속 살짝 움직임. 쓸 수 있는 아이콘: brain·bulb·phone·battery·heart·clock·lightning·question·exclaim·check·chart·coffee·speech·thought·bed·money·calendar·lock·search·star·people·house·tear·fire. 장면 절반 정도에 1~2개, 글씨·캐릭터와 안 겹치게 빈 쪽(x 0.12~0.22 또는 0.78~0.88).\n` : ""}${load().settings?.skin === "cute" ? `13. 귀여운 스타일: 장면 4~5곳에 "stickers": [{"emoji": "✨", "at": "그 장면 내레이션 속 단어", "x": 0.85, "y": 0.2}] 로 1개씩. 이모지는 ✨ 💡 💭 ❓ ❗ 💦 💕 ⭐ 🎵 중 장면 뜻에 맞게. x·y 는 화면 비율(0~1) — 제목(위 0.15 까지)·자막(아래 0.75 아래)·캐릭터를 피해 귀퉁이 쪽(x 0.12 또는 0.88, y 0.25~0.6).\n` : ""}[쓸 수 있는 장면 종류] photo(위인 사진, 위 위인 편 참고) · hook(lines[{text,cue}], kicker) · statement(text, kicker, sub, cue) · bigNumber(value, prefix, suffix, label, source, cue, kicker) · compare(title, left/right{title, emoji, cue, items[]}) · checklist(title, items[]) · story(emoji, lines[{text,cue}]) · outro(question, cue, channelCue, channel) · pillars · elements(사주 설명, 예시 참고) · roadmap(title, items[])
장면 공통: id("s01"…), narration, comments(규칙 9), keywords[], face(smile·surprised·serious·laugh·worried·kind, 또는 [{at, is}]), gesture(idea·point·think·explain·none, 또는 [{at, is}]), cast(right·left·center·corner·off, 또는 [{at, pos}] — 섞어서 지루하지 않게), musicDrop({at, level:0}) 핵심 문장 1~2곳.

[완성 예시 episode.json — 이 모양 그대로]
${template}

다른 말 없이 JSON 하나만 출력해:
{"music_mood": "규칙 12 중 하나", "idea": {"title": "오늘 영상 한 줄 기획", "why": "왜 이게 뜰 것 같은지 (참고한 공식 포함) 2~3문장", "diary_ids": ["사용한 일기 id"], "techniques": ["적용한 연출 기법 이름"]},
 "episode": { ...예시와 같은 형식, "title" 은 "#shorts" 포함 ... },
 "youtube": {"title": "검색될 키워드를 앞에 둔 제목 (#HSP 등 해시태그 1~2개)", "description": "첫 2줄 요약 + 댓글 질문 + (사주 편이면) 무료 사주 링크 https://ai-production-1a94.up.railway.app/?src=youtube + '경험 정리' 고지 + 해시태그 3개", "tags": ["10~15개"]}}`;
}

function askClaude(st, prompt) {
  const r = run(st, "클로드가 기획·대본 쓰는 중 (1~3분)", CLAUDE, ["-p", "--output-format", "json", "--tools", ""], { input: prompt, cwd: path.join(ROOT, ".tmp"), timeout: 900_000 });
  const out = JSON.parse(r.out.slice(r.out.indexOf("{")));
  if (out.is_error) throw new Error(`클로드 오류: ${String(out.result).slice(0, 300)}`);
  const m = String(out.result).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("클로드 답에서 JSON 을 못 찾았습니다.");
  return JSON.parse(m[0]);
}

function episodeDir(st) {
  return path.join(VIDEO, "public/episodes", `daily-${st.date.slice(2).replace(/-/g, "")}`);
}

// 배경음악: video/public/music/index.json [{ file, mood, title }] 에서 분위기가 맞는 것, 최근 쓴 곡은 피함
function pickMusic(st, mood) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(VIDEO, "public/music/index.json"), "utf8")); } catch {}
  if (!list.length) return "music/ep01-calm.mp3";
  const recent = pastDailies(3).map((d) => d.music);
  const fit = list.filter((m) => m.mood === mood && !recent.includes(m.file));
  const pool = fit.length ? fit : list.filter((m) => !recent.includes(m.file));
  const pick = (pool.length ? pool : list)[Math.floor(Date.parse(st.date) / 864e5) % (pool.length || list.length)];
  st.music = pick.file;
  return pick.file;
}
function musicMoods() {
  try { return [...new Set(JSON.parse(fs.readFileSync(path.join(VIDEO, "public/music/index.json"), "utf8")).map((m) => m.mood))]; } catch { return ["calm"]; }
}

async function script(st, feedback) {
  const look = load().settings?.look || "one";
  const dir = episodeDir(st);
  fs.mkdirSync(dir, { recursive: true });
  let prompt = writingPrompt(st, feedback);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = askClaude(st, prompt);
    const ep = {
      ...res.episode, format: "short", layout: look === "band" ? "band" : "one", castLook: look === "circle" ? "circle" : undefined,
      style: "punchy", pace: { speed: 1.1, trim: true }, presenter: true, skin: load().settings?.skin || undefined,
      music: pickMusic(st, res.music_mood), musicStart: res.episode.scenes?.[1]?.id, musicVolume: 0.14, voice: VOICE,
    };
    ep.frame = { ...(ep.frame || {}), brand: "예민한자립가" };
    const credits = await fillPhotos(st, ep, dir);
    const epFile = path.join(dir, "episode.json");
    fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
    const pre = run(st, `대본 검사 (${attempt}번째, 그림 전)`, NODE, ["scripts/check_episode.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO, allowFail: true });
    if (pre.ok) await fillArt(st, ep, dir); // 검사를 통과한 대본에만 그림을 그린다 (다시 쓰면 그림이 버려지므로)
    fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
    const check = run(st, `대본 검사 (${attempt}번째)`, NODE, ["scripts/check_episode.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO, allowFail: true });
    if (check.ok) {
      const description = credits.length ? `${res.youtube.description}\n\n📷 사진 출처 (Wikimedia Commons)\n${creditLines(credits)}` : res.youtube.description;
      fs.writeFileSync(path.join(dir, "youtube.json"), JSON.stringify({ ...res.youtube, description, altered_content: true, privacy: "private" }, null, 2));
      st.idea = { ...res.idea, narration: ep.scenes.map((s) => s.narration).join("\n"), chars: ep.scenes.reduce((a, s) => a + s.narration.length, 0) };
      st.youtube = res.youtube;
      st.episode = path.relative(ROOT, epFile);
      log(st, `✍️ 기획: ${res.idea.title} (${st.idea.chars}자)`);
      return;
    }
    const problems = check.out.split("\n").filter((l) => l.trim().startsWith("- ")).join("\n");
    log(st, `⚠️ 대본 검사에서 고칠 것 발견 → 다시 쓰기\n${problems}`);
    prompt = `${writingPrompt(st, feedback)}\n\n[직전에 쓴 episode.json 이 검사에서 걸림 — 아래를 고쳐서 다시]\n${problems}\n\n[직전 답]\n${JSON.stringify(res)}`;
  }
  throw new Error("대본 검사를 3번 통과하지 못했습니다.");
}

// 위인 사진 장면: 위키미디어에서 저작권 풀린 사진을 받아 넣고, 제미나이로 얼굴 위치를 찾아 빨간 원 자리로.
// 사진을 못 찾으면 그 장면은 이모지 이야기 장면으로 바꾼다. 돌려주는 값: 설명란에 적을 출처 목록
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
async function fillPhotos(st, ep, dir) {
  // photoPending: 예전에 사진을 못 받아 이모지로 바꿔 둔 장면 → 다시 사진 장면으로
  for (const s of ep.scenes) if (s.photoPending && s.person) { Object.assign(s, { type: "photo" }); delete s.emoji; delete s.photoPending; }
  const scenes = ep.scenes.filter((s) => s.type === "photo" && !s.image);
  if (!scenes.length) return [];
  const imgDir = path.join(dir, "img");
  const credits = [];
  for (const person of [...new Set(scenes.map((s) => s.person).filter(Boolean))]) {
    const mine = scenes.filter((s) => s.person === person);
    let got = [];
    try { got = await fetchPortraits(person, imgDir, mine.length); } catch (e) { log(st, `⚠️ ${person} 사진 받기 실패: ${e.message}`); }
    log(st, `📷 ${person} 사진 ${got.length}장 (${got.map((g) => g.license).join(", ") || "없음"})`);
    for (const [i, s] of mine.entries()) {
      const g = got[i % Math.max(1, got.length)];
      if (!g) continue;
      s.image = path.relative(path.join(VIDEO, "public"), g.file);
      s.aspect = g.aspect;
      if (s.circle) {
        const face = await withTimeout(locateFace(g.file, person).catch(() => null), 45_000);
        Object.assign(s.circle, face || { x: 0.5, y: 0.28, r: 0.16 });
      }
      if (!credits.some((c) => c.file === g.file)) credits.push(g);
    }
  }
  for (const s of ep.scenes) {
    if (s.type === "photo" && !s.image) Object.assign(s, { type: "story", emoji: "📜", photoPending: true });
  }
  return credits;
}

// 이야기 장면 삽화: 장면의 "art"(그림 설명)를 챗GPT 구독(코덱스, tools/gpt_image.mjs)으로 그린다. 한 장 약 1분, 추가 비용 0.
// 캐릭터는 채널 기준 그림을 참고로 넣어 같은 얼굴로. 실패하면 이모지 그대로 둔다.
const CHARACTER_REF = path.join(VIDEO, "public/characters/main/Extract_and_reproduce_ONLY_the_character_from_the_-1790655440530.png");
const ART_STYLE = "16:9 가로 삽화. 기준 그림의 캐릭터(둥근 안경, 부스스한 머리, 검은 선화)를 그대로 그려줘. 캐릭터는 깔끔한 검은 선화(몸 안은 흰색) 그대로, 배경은 부드러운 크림·세이지색 종이 질감 수채화. 글씨·말풍선·자막은 절대 넣지 말 것. 캐릭터와 주요 사물은 화면 오른쪽 절반에, 왼쪽 40%는 글씨가 들어갈 빈 배경으로 비워둘 것. 장면: ";
async function fillArt(st, ep, dir) {
  const scenes = ep.scenes.filter((s) => s.art && !s.image).slice(0, 4);
  for (const [i, s] of scenes.entries()) {
    const out = path.join(dir, "art", `${s.id}.png`);
    if (!fs.existsSync(out)) {
      const r = run(st, `🎨 삽화 ${i + 1}/${scenes.length} 그리는 중 (약 1분): ${s.art.slice(0, 40)}`, NODE,
        ["tools/gpt_image.mjs", ART_STYLE + s.art, `--out=${path.relative(ROOT, out)}`, "--size=1536x1024", `--ref=${path.relative(ROOT, CHARACTER_REF)}`],
        { allowFail: true, timeout: 300_000 });
      if (!r.ok || !fs.existsSync(out)) { log(st, `⚠️ 삽화 실패 → 이모지 그대로 (${r.out.trim().split("\n").pop()})`); continue; }
    }
    Object.assign(s, { image: path.relative(path.join(VIDEO, "public"), out), textSide: "left", motion: s.motion || "zoomIn", focusX: 0.7, cast: "off" });
    delete s.emoji;
  }
}

function markDiaryUsed(st) {
  const db = load();
  for (const d of db.diary || []) {
    d.usedIn = (d.usedIn || []).filter((x) => x !== st.date);
    if (st.idea?.diary_ids?.includes(d.id)) d.usedIn.push(st.date);
  }
  save(db);
}

// ---------- 4. 렌더링 ----------
function render(st, kind) {
  const name = path.basename(episodeDir(st));
  const out = path.join(VIDEO, "out", `${name}_${kind}.mp4`);
  run(st, kind === "draft" ? "목소리 없는 초안 영상 만드는 중 (2~5분)" : "완성 영상 만드는 중 (2~5분)",
    path.join(VIDEO, "node_modules/.bin/remotion"), ["render", "Episode", path.relative(VIDEO, out), `--props=${path.relative(VIDEO, path.join(episodeDir(st), "episode.json"))}`],
    { cwd: VIDEO });
  st[kind] = path.relative(ROOT, out);
  log(st, `🎬 ${kind === "draft" ? "초안" : "완성"} 영상: ${st[kind]}`);
}

function notify(text) {
  spawnSync("osascript", ["-e", `display notification "${text.replace(/"/g, "'")}" with title "예민한자립가 매일 쇼츠"`]);
}

// ---------- 명령 ----------
async function main() {
  if (cmd === "run") {
    const st = begin(flags.date || today(), "running");
    try {
      const topic = load().settings?.topic;
      if (topic && !st.idea) { st.topic = topic; saveSettings({ topic: "", lastTopic: { text: topic, usedOn: st.date } }); log(st, `🎯 사장님 주제: ${topic}`); }
      if (!flags["skip-source"] && !st.sources) await source(st);
      await analyzeSources(st);
      if (!st.idea) { await script(st); markDiaryUsed(st); }
      if (!st.draft) render(st, "draft");
      st.status = "draft_ready";
      log(st, "✅ 초안 완성 — 앱에서 대본 확인 후 [목소리 입히기]를 눌러주세요");
      notify("오늘의 쇼츠 초안이 준비됐어요. 앱에서 확인해 주세요.");
    } catch (e) { fail(st, e); }
  } else if (cmd === "redo") {
    const st = begin(args[0] || today(), "running");
    try {
      Object.assign(st, { draft: null, final: null });
      if (flags.ref) st.refs = [flags.ref];
      if (flags.topic) { st.topic = String(flags.topic); log(st, `🎯 사장님 주제: ${st.topic}`); }
      await script(st, args[1] || "더 좋게 다시 써줘");
      markDiaryUsed(st);
      render(st, "draft");
      st.status = "draft_ready";
      log(st, "✅ 다시 쓴 초안 완성");
    } catch (e) { fail(st, e); }
  } else if (cmd === "photos") {
    // 대본은 그대로 두고 위인 사진만 다시 채우기 (사진 받기가 실패했을 때)
    const st = begin(args[0] || today(), "running");
    try {
      const dir = episodeDir(st);
      const epFile = path.join(dir, "episode.json");
      const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
      for (const s of ep.scenes) if (s.person && s.emoji === "📜" && s.type === "story") s.photoPending = true; // 표시 없이 바뀐 예전 장면
      const credits = await fillPhotos(st, ep, dir);
      await fillArt(st, ep, dir);
      fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
      const yt = JSON.parse(fs.readFileSync(path.join(dir, "youtube.json"), "utf8"));
      if (credits.length && !yt.description.includes("사진 출처")) yt.description += `\n\n📷 사진 출처 (Wikimedia Commons)\n${creditLines(credits)}`;
      fs.writeFileSync(path.join(dir, "youtube.json"), JSON.stringify(yt, null, 2));
      run(st, "대본 검사", NODE, ["scripts/check_episode.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO });
      st.draft = null;
      render(st, "draft");
      st.status = "draft_ready";
      log(st, "✅ 사진 넣은 초안 완성");
    } catch (e) { fail(st, e); }
  } else if (cmd === "voice") {
    const st = begin(args[0] || today(), "voicing");
    try {
      if (!st.episode) throw new Error("대본이 아직 없습니다.");
      const ep = path.join(ROOT, st.episode);
      run(st, `일레븐랩스 천성준 목소리 녹음 (${st.idea?.chars ?? "?"}자 ≈ 크레딧 ${st.idea?.chars ?? "?"})`, NODE, ["tools/elevenlabs.mjs", "narrate", st.episode, "--yes"]);
      run(st, "장면별로 목소리 자르기", NODE, ["scripts/split_voice.mjs", path.relative(VIDEO, ep)], { cwd: VIDEO });
      render(st, "final");
      st.status = "final_ready";
      log(st, "✅ 완성 — 앱에서 보고 [유튜브에 비공개로 올리기]");
      notify("목소리 입힌 완성 영상이 나왔어요.");
    } catch (e) { fail(st, e); }
  } else if (cmd === "upload") {
    const st = begin(args[0] || today(), "uploading");
    try {
      if (!st.final) throw new Error("완성 영상이 없습니다. 먼저 목소리를 입혀주세요.");
      const r = run(st, "유튜브에 비공개로 올리는 중", NODE, ["tools/youtube_upload.mjs", "upload", st.final, path.join(path.dirname(st.episode), "youtube.json"), "--yes"]);
      st.youtubeUrl = r.out.match(/https:\/\/(?:youtu\.be|www\.youtube\.com|studio\.youtube\.com)\/\S+/)?.[0] || null;
      st.status = "uploaded";
      log(st, `✅ 비공개 업로드 완료 ${st.youtubeUrl || ""} — 스튜디오에서 확인 후 공개해주세요`);
    } catch (e) { fail(st, e); }
  } else {
    console.log("사용법: node tools/daily_short.mjs run | redo <날짜> \"고칠 점\" | voice <날짜> | upload <날짜>");
  }
}

await main();
