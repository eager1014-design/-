// 매일 쇼츠 일꾼 — 예민한자립가. 사장님 일기 + 떡상 쇼츠 연출 분석 → 대본(episode.json) → 목소리 없는 초안 영상.
// 목소리(일레븐랩스, 크레딧)와 업로드는 사장님이 앱(tools/viral)에서 버튼을 눌렀을 때만 한다.
//
// 사용법:
//   node tools/daily_short.mjs run [--date=2026-10-24] [--skip-source]   새벽 5시 자동 (launchd) — 소싱·분석·대본·초안
//   node tools/daily_short.mjs redo <날짜> "고칠 점" [--ref=<보관함 id>]     대본 다시 쓰기 + 초안 (--ref: 사장님이 고른 참고 자료를 가장 크게 따름)
//   node tools/daily_short.mjs photos <날짜>                              대본은 그대로, 위인 사진·삽화만 다시 채우기 + 초안
//   node tools/daily_short.mjs voice <날짜>                               일레븐랩스 천성준 녹음 → 장면 자르기 → 완성 영상 (크레딧 사용)
//   node tools/daily_short.mjs upload <날짜>                              유튜브에 비공개로 올리기
//   node tools/daily_short.mjs comment <날짜>                             고정 댓글(사주 추천) 달기 — 공개 후
//
// 비용: 소싱(유튜브 무료 한도 300점) · 분석(제미나이, 쇼츠 1개 ≈ 2만 토큰 × 3) · 대본(클로드 구독, 추가 0원) · 렌더(무료)
// 상태: tools/viral/data/daily/<날짜>.json — 앱이 이 파일을 읽어 화면에 보여준다.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, DATA_DIR, load, save, upsert, searchYoutube, analyze, saveSettings } from "./viral/core.mjs";
import { fillPhotos as fillPhotosIn, creditLines } from "./commons.mjs";
import { SOUND_RULES, pickSections } from "./viral/sound_rules.mjs";
import { ensureSajuOutro, OUTRO_ASK, PINNED_ASK, withSaju } from "./saju_pin.mjs";
import { AREA_LIST, pickArea, recentList, TOPIC_AREAS } from "./topic_mix.mjs";

const DAILY_DIR = path.join(DATA_DIR, "daily");
const VIDEO = path.join(ROOT, "video");
const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME, ".local/bin/claude");
const NODE = process.execPath;
const VOICE = { provider: "elevenlabs", id: "vithIMnhyN3GwRbVmrZt", name: "천성준" };
// 2026-10-23 주제 조사 (쇼츠 24개 주제 × 50개, 최근 3달 떡상 수): 손절·가스라이팅·사주 궁합·직장 인간관계·회피형이 강하고
// 번아웃·생각 많은·착한아이·혼자가 편한·연락 불안 같은 '자기 돌봄' 주제는 떡상 0개 → 소싱 키워드도 강한 쪽으로
// 2026-10-26 사장님 "폭넓게" → 돈·뇌·습관·가족·심리 실험·위인까지 넓힘
const DEFAULT_KEYWORDS = ["손절해야 하는 사람", "가스라이팅", "사주 궁합", "직장 인간관계", "회피형 연애", "돈 심리학", "소비 습관 심리", "뇌과학 상식", "심리 실험", "습관 심리학", "맏이 특징", "자존감 낮은 사람", "철학자 명언", "예민한 사람", "나르시시스트"];
const PEOPLE_GUIDE = `[철학자·심리학자·위인 편 — 사장님 시리즈 (쇼펜하우어·칼 융·니체·에픽테토스·반 고흐 등, 하루 한 명 천천히)]
- 틀: 위인의 실제 삶의 장면(사진) → 그가 남긴 생각(관계·돈·일·고독·삶의 태도 등 무엇이든) → 지금 우리의 고민에 주는 의미 → 오늘 할 한 가지. (2026-10-28 에픽테토스 편으로 구독자 증가 — 사진+삽화 조합이 잘 먹힘)
- 사진 장면 "type": "photo" 를 2~3개: {"person": "영문 전체 이름(위키백과 표기, 예: Arthur Schopenhauer)", "name": "한글 이름", "years": "1788–1860", "lines": [{text, cue}], "circle": {"at": "그 사람을 가리키는 순간의 단어"}}. 사진·얼굴 위치는 자동으로 채워지니 image·x·y 쓰지 말 것.
- 사실만: 생몰년·잘 알려진 일화·명언은 확실한 것만. 명언은 원문이 확실치 않으면 직접 인용("~라고 했다") 대신 "~라는 생각을 남겼어요" 처럼 뜻만. 지어낸 일화·가짜 명언 절대 금지. 설명란에 출처 책 이름(예: 쇼펜하우어 『소품과 부록』)을 적을 것.
- 위인을 HSP 라고 단정하지 말 것 ("~였다는 기록이 있어요" 처럼 알려진 성향만).`;

// 주제 고르는 법 — 2026-10-23 조사(관계·손절이 강함)를 '말하는 방식'으로만 남기고, 영역은 넓게 돌린다 (2026-10-26 사장님: "비슷한 주제만, 폭넓게")
const topicGuide = (area) => `[주제 고르는 법 — 반드시 따를 것]
- ★ 오늘의 주제 영역: **${area.name}** (예: ${area.ex}). 일기가 있으면 일기 이야기를 이 영역과 엮거나, 일기에 더 맞는 다른 영역을 써도 됨. 단 아래 '최근에 만든 영상'과 같은 영역·비슷한 주제(예: 연락 빈도·거리 두기·손절을 또)는 금지.
- 영역 목록(idea.area 에 key 로 적기): ${AREA_LIST}
- 뜨는 '말하는 방식'은 어느 영역에나 씌울 수 있음: ① "~한 사람만 하는 행동"(시청자를 콕 집는 정체성 호출) ② 위험 신호·피해야 할 것 ③ 통념을 깨는 반전("돈이 많아서가 아닙니다") ④ 숫자 리스트(3가지) ⑤ "이 말을 기억하세요"
- 안 뜨는 방식: '내 마음 돌보기'만 하는 위로 → 위로는 끝에 한 줄만. 첫 문장은 구체적인 상황·행동으로. HSP(예민함)에 묶이지 말 것 — 예민함은 여러 주제 중 하나일 뿐.`;
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
  const past = recentList(st.idea?.title); // 매일 쇼츠 + 영상 만들기 둘 다
  const area = TOPIC_AREAS.find((a) => a.key === st.area) || pickArea(Number(st.date.replace(/-/g, "")));
  st.area = area.key;
  const template = JSON.stringify(stripAudio(JSON.parse(fs.readFileSync(TEMPLATE_EP, "utf8"))), null, 1);
  const diaryText = fresh.length
    ? `[사장님 일기 — 아직 영상에 안 쓴 것]\n${fresh.map((d) => `(${d.id}, ${d.at.slice(0, 10)})\n${d.text}${d.photoNote ? `\n[붙인 사진 내용] ${d.photoNote}` : ""}${d.links ? `\n[붙인 링크] ${d.links}` : ""}`).join("\n\n")}\n\n[예전에 쓴 일기 — 맥락 참고용, 같은 이야기 반복 금지]\n${older.map((d) => d.text.slice(0, 300)).join("\n---\n") || "(없음)"}`
    : `[사장님 일기] 오늘은 새 일기가 없습니다. → 위 '오늘의 주제 영역'으로 기획하세요. 사장님 개인 경험은 지어내지 말고, 시청자의 상황을 묘사하는 2인칭으로.`;

  return `너는 유튜브 채널 "예민한자립가"의 쇼츠 기획자 겸 대본 작가야. 오늘 올릴 세로 쇼츠 1편을 기획하고, 우리 영상 공장이 바로 렌더링할 수 있는 episode.json 을 써.

[채널]
- 시청자: 관계·일·돈·연애에 지친 2030 누구나 (예민한 사람도 그중 일부). 채널 주인(사장님)은 퇴사 7번, 이혼, 빚을 겪고 다시 일어서는 중인 사람. 말투는 차분하고 담백한 존댓말 내레이션 (목소리 = 사장님 복제 목소리).
- 채널 정체성 (사장님 2026-10-28): **예민한 사람이 알려주는 (쉬운) 심리학.** 주제는 누구에게나 해당되는 심리학, 시선·말투는 예민한 사람의 섬세한 관찰.
- 시리즈 방향 (2026-10-28 사장님: "HSP에 국한하지 말고 다양하게"): 심리학·철학자·위인·연애·관계·돈·습관·뇌·사주 등 폭넓게. HSP·예민함은 가끔만, 매번 끼워 넣지 말 것. 사주는 과학처럼 말하지 않는다 ("~래요", "사주에서는 ~라고 봐요").
- 사장님이 "맨날 같은 얘기(퇴사 7번)"를 지겨워함 → 일기의 새 이야기를 중심으로.

${st.topic ? `[★ 사장님이 정한 오늘 주제 — 반드시 이 주제로. 아래 '주제 고르는 법'보다 우선]\n${st.topic}\n\n` : ""}${topicGuide(area)}

${PEOPLE_GUIDE}

${diaryText}

[오늘 참고하는 떡상 쇼츠 분석 — 공식·훅 방식만 빌리고 내용·문장은 베끼지 말 것]
${st.refs?.length ? "(첫 번째 자료는 사장님이 직접 고른 참고 자료 — 이 구조·연출을 가장 크게 따를 것)\n" : ""}${analyses.map((a) => `■ ${a.title} (조회 ${a.views}, 좋아요 ${a.likes})\n 왜 떴나: ${a.analysis.one_line}\n 훅: ${a.analysis.hook}\n 공식: ${a.analysis.reusable_formula}`).join("\n") || "(없음)"}

[입혀볼 연출 기법 — 우리 장면으로 흉내 낼 수 있는 것, 어울리면 1~2개 적용]
${techniques.map((t) => `- ${t.name} (${t.our_scene}): ${t.how_to_copy}`).join("\n") || "(없음)"}

[최근에 만든 영상 — 주제·영역 겹치지 않게]
${past}
${feedback ? `\n[사장님 수정 요청 — 반드시 반영]\n${feedback}\n\n[직전 대본]\n${JSON.stringify(st.idea)}\n` : ""}
[절대 규칙]
1. 일기에 없는 사장님 경험·숫자·사건을 지어내지 마. 일기 내용은 사장님 말을 다듬어 1인칭으로.
2. 연구·통계 인용 금지. 예외: Assary 외 2020(Molecular Psychiatry) 쌍둥이 연구 — 예민함 차이의 47%가 유전. 그 외 숫자가 꼭 필요하면 쓰지 말고 비유로.
3. image·video·pose 칸은 쓰지 말 것. 이모지는 쓰지 말 것(화면에 안 나옴 — 사장님 2026-10-28 "짜쳐 보인다"). 그림 없는 story 에는 "icon": 손그림 아이콘 1개(battery·bed·brain·bulb·calendar·chart·check·clock·coffee·exclaim·fire·heart·house·lightning·lock·money·people·phone·question·search·speech·star·tear·thought 중 뜻이 맞는 것, 없으면 생략). 이야기의 핵심 장면 4~6개에는 "art": "삽화 설명" 을 추가 — 채널 캐릭터(나)가 무엇을 하는지, 어디인지, 표정을 구체적으로 한 문장(예: "시끄러운 카페에서 두 손으로 귀를 막고 눈을 질끈 감은 나, 주변 사람들은 흐린 회색 실루엣"). 그림은 자동으로 그려지고, 그 장면 글씨는 화면 왼쪽에 나온다. 실존 인물(위인)은 art 로 그리지 말고 photo 장면으로. 감정이 확 바뀌는 story 장면 1곳에는 art 대신 "drawFace": "smile|surprised|serious|laugh|worried|kind", "cast": "off" — 내 캐릭터 얼굴이 크게 그려지고 그 아래 lines 글씨.
4. 장면 10~14개 — 장면 하나에 1~2문장(3초 안팎마다 화면이 바뀌게, 레퍼런스 평균 2.6초), 짧은 단문·해요체, 내레이션 합계 250~400자 (약 40~55초). 숫자는 내레이션에서 한글("일곱 번"), 화면 글씨에서 숫자.
5. 모든 cue·at 값은 그 장면 narration 안에 띄어쓰기까지 똑같이 있는 말이어야 함.
6. ${(load().settings?.look || "title") === "full" ? "frame 칸은 쓰지 말 것 — 화면은 늘 세로 한 화면(위 고정 제목·분할 없음). 제목 역할은 첫 장면 hook 이 함" : "frame.title 은 2줄, 줄마다 14자 이내"}. 첫 장면 첫 문장 = 3초 안에 멈추게 하는 훅 (떡상 공식 활용).
7. 마지막은 outro: 댓글로 답하고 싶은 질문. ${OUTRO_ASK}
8. 화면 글씨에서 **강조**는 형광펜, 줄바꿈은 \\n. 한 화면 글씨는 짧게 (그래픽 칸이 가로 16:9 라서 한 줄 12자 이내, 최대 3줄).
9. 댓글 말풍선: 가운데 장면 2~3곳에 "comments": [{"text": "시청자가 달 법한 공감·질문 한마디(16자 이내)", "at": "그 장면 내레이션 속 단어"}] — 한 장면에 1~2개, 영상 전체 3~5개. 화면에 '예시'라고 자동 표시되니 실제 후기처럼 꾸미지 말 것 (이름·숫자·효과 주장 금지).
10. compare 의 항목(items)은 2개씩, 각 10자 이내. checklist 는 3개, 각 14자 이내.
11~12. ${SOUND_RULES("쇼츠는 2구간: 훅 tense 또는 sad → 마무리 hopeful 등, 내용에 맞게")}

13. 손그림 소품 (모든 스킨): "props": [{"icon": "이름", "at": "그 장면 내레이션 속 단어", "x": 0.2, "y": 0.4, "size": 220, "move": "bob|wiggle|pulse|spin"}] — 장면 뜻에 맞는 손그림 소품이 선으로 그려지며 나타나 계속 살짝 움직임. 쓸 수 있는 아이콘: brain·bulb·phone·battery·heart·clock·lightning·question·exclaim·check·chart·coffee·speech·thought·bed·money·calendar·lock·search·star·people·house·tear·fire. 장면 절반 정도에 1~2개, 글씨·캐릭터와 안 겹치게 빈 쪽(x 0.12~0.22 또는 0.78~0.88).\n[쓸 수 있는 장면 종류] photo(위인 사진, 위 위인 편 참고) · hook(lines[{text,cue}], kicker) · statement(text, kicker, sub, cue) · bigNumber(value, prefix, suffix, label, source, cue, kicker) · compare(title, left/right{title, icon, cue, items[]}) · checklist(title, items[]) · story(emoji, lines[{text,cue}]) · outro(question, cue, channelCue, channel) · pillars · elements(사주 설명, 예시 참고) · roadmap(title, items[])
장면 공통: id("s01"…), narration, comments(규칙 9), keywords[], face(smile·surprised·serious·laugh·worried·kind, 또는 [{at, is}]), gesture(idea·point·think·explain·none, 또는 [{at, is}]), cast(right·left·center·corner·off, 또는 [{at, pos}] — 섞어서 지루하지 않게), musicDrop({at, level:0}) 핵심 문장 1~2곳.

[완성 예시 episode.json — 이 모양 그대로]
${template}

다른 말 없이 JSON 하나만 출력해:
{"music_plan": [{"from": "s01", "mood": "tense"}, {"from": "마무리 쪽 장면 id", "mood": "hopeful"}], "idea": {"title": "오늘 영상 한 줄 기획", "area": "영역 key", "why": "왜 이게 뜰 것 같은지 (참고한 공식 포함) 2~3문장", "diary_ids": ["사용한 일기 id"], "techniques": ["적용한 연출 기법 이름"]},
 "episode": { ...예시와 같은 형식, "title" 은 "#shorts" 포함 ... },
 "youtube": {"title": "검색될 키워드를 앞에 둔 제목 (주제에 맞는 해시태그 1~2개, #HSP 는 예민함 편일 때만)", "description": "첫 2줄 요약 + 댓글 질문 + (사주 편이면) 무료 사주 링크 https://ai-production-1a94.up.railway.app/?src=youtube + '경험 정리' 고지 + 해시태그 3개", "tags": ["10~15개"], "pinned": "${PINNED_ASK}"}}`;
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
  const recent = pastDailies(3).flatMap((d) => [].concat(d.music || []));
  const fit = list.filter((m) => m.mood === mood && !recent.includes(m.file));
  const pool = fit.length ? fit : list.filter((m) => !recent.includes(m.file));
  const pick = (pool.length ? pool : list)[Math.floor(Date.parse(st.date) / 864e5) % (pool.length || list.length)];
  st.music = pick.file;
  return pick.file;
}
function pickMusicSections(st, plan, scenes) {
  const recent = pastDailies(3).flatMap((d) => [].concat(d.music || []));
  const secs = pickSections(plan, scenes, recent, Math.floor(Date.parse(st.date) / 864e5));
  st.music = secs.map((x) => x.file);
  return secs;
}
function musicMoods() {
  try { return [...new Set(JSON.parse(fs.readFileSync(path.join(VIDEO, "public/music/index.json"), "utf8")).map((m) => m.mood))]; } catch { return ["calm"]; }
}

async function script(st, feedback) {
  const look = load().settings?.look || "title";
  const dir = episodeDir(st);
  fs.mkdirSync(dir, { recursive: true });
  let prompt = writingPrompt(st, feedback);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = askClaude(st, prompt);
    const ep = {
      // title(기본, 2026-10-24 사장님): 위 고정 제목은 꼭 + 그 아래는 나누지 않은 한 무대 (frame + presenter, layout 없음)
      // full = 고정 제목도 없는 세로 한 화면. one·band = 예전 가로 칸 방식(제목 아래가 둘로 나뉘어 작아 보여 사장님이 싫어함)
      ...res.episode, format: "short", layout: ["title", "full"].includes(look) ? undefined : look === "band" ? "band" : "one", castLook: look === "circle" ? "circle" : undefined,
      // 말 1.3배 = 레퍼런스(Grabity) 1초 6.8자에 맞춤 (2026-10-24)
      style: "punchy", pace: { speed: 1.3, trim: true }, presenter: true, skin: load().settings?.skin || undefined,
      // 소리 원칙(sound_rules.mjs): 효과음은 대본이 고른 것만(soundPlan), 배경음악은 흐름 구간마다 (BGM 0.25)
      soundPlan: true, voice: VOICE,
      ...(res.music_plan?.length
        ? { musicSections: pickMusicSections(st, res.music_plan, res.episode.scenes || []) }
        : { music: pickMusic(st, res.music_mood || "calm"), musicStart: res.episode.scenes?.[1]?.id }),
    };
    ensureSajuOutro(ep); // 모든 영상 마지막에 사주 안내 한 문장 (사장님 2026-10-27)
    if (look === "full") delete ep.frame;
    else ep.frame = { ...(ep.frame || {}), brand: "예민한자립가" };
    const credits = await fillPhotosIn(ep, dir, (m) => log(st, m));
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
      if (TOPIC_AREAS.some((a) => a.key === res.idea.area)) st.area = res.idea.area;
      st.youtube = { ...res.youtube, pinned: withSaju("") }; // 쇼츠 고정 댓글은 사주 안내만 (사장님 2026-10-27)
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

// 이야기 장면 삽화: 장면의 "art"(그림 설명)를 챗GPT 구독(코덱스, tools/gpt_image.mjs)으로 그린다. 한 장 약 1분, 추가 비용 0.
// 캐릭터는 채널 기준 그림을 참고로 넣어 같은 얼굴로. 실패하면 이모지 그대로 둔다.
// 2026-10-24 새 캐릭터(동그란 머리+동그란 안경 졸라맨) + 칠판 스타일(완전 검정 바탕 흰 선)
const CHARACTER_REF = path.join(VIDEO, "public/characters/round/ref_sheet.png");
const ART_STYLE_OLD = "16:9 가로 삽화. 기준 그림의 캐릭터(둥근 안경, 부스스한 머리, 검은 선화)를 그대로 그려줘. 캐릭터는 깔끔한 검은 선화(몸 안은 흰색) 그대로, 배경은 부드러운 크림·세이지색 종이 질감 수채화. 글씨·말풍선·자막은 절대 넣지 말 것. 캐릭터와 주요 사물은 화면 오른쪽 절반에, 왼쪽 40%는 글씨가 들어갈 빈 배경으로 비워둘 것. 장면: ";
const ART_STYLE_CHALK = "16:9 가로 삽화. 배경은 완전한 검정(#000000) 단색. 모든 선은 굵고 둥근 흰색 손그림 두들, 아주 단순하게, 포인트 색은 노랑 하나만. 사람은 기준 그림의 캐릭터(동그란 머리, 정수리 머리카락 두세 가닥, 큰 동그란 안경, 막대 팔다리)로, 다른 사람도 같은 막대 사람 그림체로. 그림자·질감·그라데이션·글씨·말풍선 없이. 캐릭터와 주요 사물은 화면 오른쪽 절반에, 왼쪽 40%는 글씨가 들어갈 빈 검정으로 비워둘 것. 장면: ";
const artStyle = () => (load().settings?.skin === "chalk" ? ART_STYLE_CHALK : ART_STYLE_OLD);
async function fillArt(st, ep, dir) {
  for (const s of ep.scenes) if (s.drawFace) ["smile", "surprised", "serious", "laugh", "worried", "kind"].includes(s.drawFace) ? (s.cast = "off") : delete s.drawFace; // 있는 표정만
  const scenes = ep.scenes.filter((s) => s.art && !s.image).slice(0, 6); // 이모지 대신 그림을 더 (2026-10-28)
  const tall = !ep.layout; // 한 무대 쇼츠(title·full): 세로 그림을 무대 가득 (가로 그림은 가운데만 잘려 보임)
  for (const [i, s] of scenes.entries()) {
    const out = path.join(dir, "art", `${s.id}.png`);
    if (!fs.existsSync(out)) {
      const r = run(st, `🎨 삽화 ${i + 1}/${scenes.length} 그리는 중 (약 1분): ${s.art.slice(0, 40)}`, NODE,
        ["tools/gpt_image.mjs", (tall ? artStyle().replace("16:9 가로 삽화.", "9:16 세로 삽화.").replace("캐릭터와 주요 사물은 화면 오른쪽 절반에, 왼쪽 40%는 글씨가 들어갈 빈 배경으로 비워둘 것", "캐릭터와 주요 사물은 화면 아래쪽 60%에, 위쪽 35%는 글씨가 들어갈 빈 배경으로 비워둘 것").replace("왼쪽 40%는 글씨가 들어갈 빈 검정으로 비워둘 것", "위쪽 35%는 글씨가 들어갈 빈 검정으로 비워둘 것").replace("화면 오른쪽 절반에", "화면 아래쪽 60%에") : artStyle()) + s.art, `--out=${path.relative(ROOT, out)}`, `--size=${tall ? "1024x1536" : "1536x1024"}`, `--ref=${path.relative(ROOT, CHARACTER_REF)}`],
        { allowFail: true, timeout: 300_000 });
      if (!r.ok || !fs.existsSync(out)) { log(st, `⚠️ 삽화 실패 → 이모지 그대로 (${r.out.trim().split("\n").pop()})`); continue; }
    }
    Object.assign(s, { image: path.relative(path.join(VIDEO, "public"), out), textSide: tall ? "center" : "left", motion: s.motion || "zoomIn", focusX: tall ? 0.5 : 0.7, cast: "off", draw: true }); // 연필로 그려지듯 나타남 (2026-10-27)
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
      const credits = await fillPhotosIn(ep, dir, (m) => log(st, m));
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
  } else if (cmd === "comment") {
    // 고정 댓글 달기 — 사장님이 앱에서 버튼을 누를 때만. 공개된 영상에만 달리고, '고정'은 스튜디오에서 사장님이
    const st = readState(args[0] || today());
    try {
      if (!st?.youtubeUrl) throw new Error("유튜브에 먼저 올려야 해요.");
      const f = path.join(path.dirname(path.join(ROOT, st.episode)), "pinned.txt");
      fs.writeFileSync(f, withSaju(st.youtube?.pinned));
      const r = run(st, "📌 고정 댓글 다는 중", NODE, ["tools/youtube_upload.mjs", "comment", st.youtubeUrl, f, "--yes"]);
      st.commentUrl = r.out.match(/https:\/\/www\.youtube\.com\/watch\S+/)?.[0] || null;
      log(st, "✅ 고정 댓글 달림 — 스튜디오 → 댓글 → ⋮ → '고정'을 눌러주세요");
    } catch (e) { st.error = String(e.message); log(st, `❌ ${st.error}`); }
  } else {
    console.log("사용법: node tools/daily_short.mjs run | redo <날짜> \"고칠 점\" | voice <날짜> | upload <날짜> | comment <날짜>");
  }
}

await main();
