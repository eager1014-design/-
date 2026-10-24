// 대화로 영상 만들기 (2026-10-24 사장님 요청, 롱폼·숏폼 둘 다): 사장님과 대화하면서 영상을 기획 → 썸네일 → 대본·무료 초안 → (사장님 녹음) → 완성 → 업로드 문구.
// 분담: 참고 링크·사진 보기 = 제미나이(무료), 대화·기획·대본 = 클로드(맥북 구독 claude -p), 그림 = 챗GPT(플러스, tools/gpt_image.mjs), 조립 = video/ 영상 공장.
// 목소리: 사장님이 직접 녹음한 파일을 올리거나, [일레븐랩스로 녹음] 버튼(크레딧, 사장님이 누를 때만).
//
// 앱(server.mjs)은 이 파일의 함수로 프로젝트를 만들고 읽는다. 오래 걸리는 일은 따로 띄워서 돈다:
//   node tools/viral/longform.mjs <일> <프로젝트id>      일 = chat · plan · thumbs(롱폼만) · script · voice · eleven · upload
// 저장: tools/viral/data/longform/<id>.json (깃에 안 올라감), 편 폴더 video/public/episodes/lf-<id>/, 영상 video/out/lf-<id>_*.mp4
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, DATA_DIR, UPLOAD_DIR, GEMINI_MODEL, load, saveUploads, imageParts, isVideo } from "./core.mjs";
import { gemini, watchVideo } from "../ai-bridge/gemini.mjs";
import { SCENES_LIST } from "../../video/scripts/scene-types.mjs";

const DIR = path.join(DATA_DIR, "longform");
const VIDEO = path.join(ROOT, "video");
const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME, ".local/bin/claude");
const NODE = process.execPath;
const ID = /^[a-z0-9]{6,20}$/;
const STEPS = ["chat", "plan", "thumbs", "script", "voice", "eleven", "upload"];
const VOICE = { provider: "elevenlabs", id: "vithIMnhyN3GwRbVmrZt", name: "천성준" };

// ---------- 저장 ----------
const file = (id) => {
  if (!ID.test(id || "")) throw new Error("프로젝트 번호가 이상합니다.");
  return path.join(DIR, `${id}.json`);
};
export function getProject(id) {
  if (!fs.existsSync(file(id))) throw new Error("없는 롱폼입니다.");
  return JSON.parse(fs.readFileSync(file(id), "utf8"));
}
function saveProject(p) {
  fs.mkdirSync(DIR, { recursive: true });
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(file(p.id), JSON.stringify(p, null, 2));
  return p;
}
export function listProjects() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))
    .map(({ id, title, format, updatedAt, busy, stage }) => ({ id, title, format, updatedAt, busy, stage }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
const epDir = (p) => path.join(VIDEO, "public/episodes", `lf-${p.id}`);
const rel = (abs) => path.relative(ROOT, abs);

// ---------- 앱에서 바로 하는 일 (빠름) ----------
export function createProject({ title = "", brief = "", channel = "예민한자립가", format = "long" }) {
  if (!String(title).trim() && !String(brief).trim()) throw new Error("가제나 '이번엔 이런 느낌으로'를 적어주세요.");
  const id = Date.now().toString(36);
  return saveProject({ id, title: String(title).trim() || "제목 없음", brief: String(brief).trim(), channel, format: format === "short" ? "short" : "long", createdAt: new Date().toISOString(), messages: [], refs: [], stage: "대화", busy: null, log: [] });
}

// 사장님 말 + 링크 여러 개 + 파일 여러 개 → 저장하고, 답(또는 단계 실행)은 따로 띄운다
export function postMessage(id, { text = "", links = "", files = [], step = "chat" }) {
  const p = getProject(id);
  if (p.busy) throw new Error(`지금 '${p.busy}' 하는 중이에요. 끝나고 다시 보내주세요.`);
  if (!STEPS.includes(step)) throw new Error("모르는 단계입니다.");
  const urls = String(links).split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  const saved = saveUploads(files);
  if (!String(text).trim() && !urls.length && !saved.length && step === "chat") throw new Error("말이나 링크, 파일을 넣어주세요.");
  if (step === "thumbs" && p.format === "short") throw new Error("쇼츠 표지는 컴퓨터에서 못 바꿔요. 올린 뒤 휴대폰 유튜브 앱에서 장면을 고르세요.");
  if (step === "voice" && !saved.some((f) => /\.(mp3|m4a|wav)$/i.test(f))) throw new Error("녹음 파일(mp3·m4a·wav)을 올려주세요.");
  for (const u of urls) p.refs.push({ url: u, at: new Date().toISOString() });
  for (const f of saved) p.refs.push({ file: f, at: new Date().toISOString() });
  if (String(text).trim() || urls.length || saved.length) p.messages.push({ role: "me", text: String(text).trim(), links: urls, files: saved, step, at: new Date().toISOString() });
  p.busy = { chat: "답 쓰는 중", plan: "기획안 만드는 중", thumbs: "썸네일 그리는 중", script: "대본·초안 만드는 중", voice: "목소리 맞추는 중", eleven: "일레븐랩스 녹음 중", upload: "업로드 문구 쓰는 중" }[step];
  p.log = [];
  saveProject(p);
  const out = fs.openSync(path.join(ROOT, ".tmp/longform.out"), "a");
  spawn(NODE, [fileURLToPath(import.meta.url), step, id], { cwd: ROOT, detached: true, stdio: ["ignore", out, out] }).unref();
  return p;
}

export function deleteProject(id) {
  fs.rmSync(file(id), { force: true });
}

// ---------- 일꾼 (따로 떠서 도는 부분) ----------
function log(p, line) {
  p.log = [...(p.log || []), `${new Date().toTimeString().slice(0, 8)} ${line}`].slice(-40);
  saveProject(p);
  console.log(`[lf ${p.id}] ${line}`);
}
function run(p, label, bin, argv, opts = {}) {
  log(p, `▶ ${label}`);
  const r = spawnSync(bin, argv, { cwd: opts.cwd || ROOT, encoding: "utf8", timeout: opts.timeout || 3600_000, input: opts.input, maxBuffer: 64 << 20 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${label} 실패: ${out.trim().split("\n").slice(-6).join(" / ")}`);
  return { ok: r.status === 0, out };
}

// 참고 자료: 유튜브는 제미나이가 직접 보고, 사진은 제미나이가 읽는다. 한 번 본 것은 다시 안 본다 (무료 한도 아끼기)
async function readRefs(p) {
  const ask = "한국어로 15줄 이내: 이 자료의 구성(훅·순서·길이), 화면 연출(글꼴·색·그림체·배치·움직임), 말투, 우리가 따라 할 만한 점과 피할 점. 내용·대사를 베끼지 말고 뼈대만.";
  for (const r of p.refs) {
    if (r.summary || r.failed) continue;
    try {
      if (r.url && /youtu\.?be/.test(r.url)) {
        log(p, `👀 제미나이가 영상 보는 중: ${r.url}`);
        r.summary = (await watchVideo(r.url, ask, { clip: { start: 0, end: 240 } })).text;
      } else if (r.file && isVideo(r.file)) {
        log(p, `👀 제미나이가 올린 영상 보는 중`);
        r.summary = (await watchVideo(path.join(ROOT, r.file), ask)).text;
      } else if (r.file && imageParts([r.file]).length) {
        log(p, `👀 제미나이가 사진 보는 중`);
        const res = await gemini().models.generateContent({ model: GEMINI_MODEL, contents: [{ role: "user", parts: [...imageParts([r.file]), { text: ask }] }] });
        r.summary = res.text ?? "";
      } else if (r.url) r.summary = "(유튜브가 아닌 링크라 내용은 못 봤음 — 사장님 메모로 판단)";
    } catch (e) {
      r.failed = String(e.message).slice(0, 200);
      log(p, `⚠ 참고 자료를 못 봤어요 (${r.failed.slice(0, 80)}) — 나머지로 진행`);
    }
    saveProject(p);
  }
}

function context(p) {
  const refs = p.refs.filter((r) => r.summary).map((r, i) => `[참고 ${i + 1}] ${r.url || path.basename(r.file)}\n${r.summary}`).join("\n\n");
  const talk = p.messages.slice(-20).map((m) => `${m.role === "me" ? "사장님" : "클로드"}: ${m.text}${m.links?.length ? ` (링크 ${m.links.join(" ")})` : ""}${m.files?.length ? ` (파일 ${m.files.length}개)` : ""}`).join("\n");
  const kind = p.format === "short" ? "세로 쇼츠 1080×1920 (40~60초)" : "가로 롱폼 1920×1080 (보통 6~10분)";
  return `[${p.format === "short" ? "숏폼" : "롱폼"} 프로젝트] 가제: ${p.title} / 채널: ${p.channel} / ${kind}
[사장님이 처음 말한 느낌] ${p.brief || "(없음)"}
${p.plan ? `[지금 기획안]\n${JSON.stringify(p.plan, null, 1)}\n` : ""}${refs ? `[참고 자료 — 제미나이가 본 요약]\n${refs}\n` : ""}[지금까지 대화]\n${talk || "(아직 없음)"}

[원칙] 사장님은 코드를 모르는 1인 사업가. 쉬운 말로, 짧게. 듣기 좋은 말만 하지 말고 약점도 근거와 함께 (사장님 요청).
사장님 경험은 대화·메모에 있는 것만 쓰고 지어내지 않는다. 연구·숫자는 확실한 것만, 모르면 '확인 필요'. 다른 유튜버의 문장·화면을 베끼지 않는다.
목소리는 사장님이 직접 녹음하거나 사장님 복제 목소리(일레븐랩스)로 넣는다.`;
}

function askClaude(p, prompt) {
  const r = run(p, "클로드가 생각하는 중 (1~3분)", CLAUDE, ["-p", "--output-format", "json", "--tools", ""], { input: prompt, cwd: path.join(ROOT, ".tmp"), timeout: 900_000 });
  const out = JSON.parse(r.out.slice(r.out.indexOf("{")));
  if (out.is_error) throw new Error(`클로드 오류: ${String(out.result).slice(0, 300)}`);
  const m = String(out.result).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("클로드 답에서 JSON 을 못 찾았습니다.");
  return JSON.parse(m[0]);
}
const say = (p, text, extra = {}) => p.messages.push({ role: "claude", text, at: new Date().toISOString(), ...extra });

// ① 대화
async function chat(p) {
  const r = askClaude(p, `${context(p)}

사장님의 마지막 말에 답해. 기획을 같이 다듬는 대화다: 질문이 필요하면 1~2개만, 제안은 구체적으로(제목·첫 문장·구성 예시).
기획이 충분히 모였으면 "[기획안 만들기] 버튼을 눌러주세요"라고 안내해.
JSON 하나만: {"reply": "답 (10줄 이내)"}`);
  say(p, r.reply);
}

// ② 기획안: 제목 후보·훅·챕터·썸네일 아이디어 3개
async function plan(p) {
  if (p.format === "short") return planShort(p);
  const r = askClaude(p, `${context(p)}

롱폼 기획안을 만들어. JSON 하나만:
{"reply": "사장님께 한두 줄 + 고민할 점 한 줄",
 "plan": {"titles": ["제목 후보 3개, 핵심 키워드를 앞에, 40자 이내"], "hook": "첫 10초에 할 말", "length": "예상 길이(분)",
   "chapters": [{"title": "챕터 이름", "points": ["다룰 내용 2~4개"]}],
   "thumbnails": [{"type": "물건비유|VS대결|반응|글씨만", "lines": ["첫 줄", "둘째 줄(선택)"], "bg": "black|white", "layout": "top|bottom|text", "art": "그릴 것 한 문장 (글씨만이면 빈 문자열)", "note": "손글씨 메모 한 줄(선택, 10자 이내, 예: (하버드대 교수))"}]}}
${THUMB_RULES}`);
  p.plan = r.plan;
  p.stage = "기획안";
  say(p, r.reply);
}

async function planShort(p) {
  const r = askClaude(p, `${context(p)}

쇼츠 기획안을 만들어. JSON 하나만:
{"reply": "사장님께 한두 줄 + 고민할 점 한 줄",
 "plan": {"titles": ["화면 위 제목 2줄 후보 3개 — 각 '첫 줄 / 둘째 줄', 줄마다 14자 이내"], "hook": "첫 3초에 할 말", "length": "예상 길이(초)",
   "chapters": [{"title": "흐름 단계(훅·전개·반전·마무리 등)", "points": ["화면에 나올 것·할 말 1~3개"]}]}}`);
  p.plan = r.plan;
  p.stage = "기획안";
  say(p, r.reply);
}

// 썸네일 공식 — 레퍼런스 채널 Grabity 분석 (video/public/episodes/_refs/grabity.md, 2026-10-24 사장님: "썸네일이 가장 중요, 단순하게, 캐릭터는 안 나와도 됨")
const THUMB_RULES = `[썸네일 규칙 — 레퍼런스 분석에서]
- 시안 4개를 서로 다른 type 으로: 물건비유(누구나 0.5초에 아는 소품 하나: 뇌·침대·폰·황금알 등) / VS대결(두 가지 비교) / 반응(사람이나 동물이 상황에 반응) / 글씨만.
- 글씨: 1~2줄, 줄마다 6자 안팎(최대 8자). 도발·반전·금지형이 잘 됨("억지로 하지 마세요", "이거부터 키우세요"). **노랑** !!빨강!! 표시, 나머지 흰색. 한 줄에 색은 하나만.
- 썸네일 글씨와 영상 제목은 절대 같은 말 금지: 썸네일 = 감정 자극, 제목 = 설명·근거(예: '자제력의 심리학 (뇌가 갈망하도록 속이는 법)').
- 학술 용어·추상어 금지(조회수 낮았던 패턴). 그림은 하나만, 단순하게. 캐릭터는 넣지 않아도 됨.
- note 는 위트 있는 손글씨 한 줄(선택). bg 는 시안끼리 섞어서.`;
const DOODLE = "굵은 검은 선 손그림 두들, 아주 단순하게, 색은 한두 가지 단색만(노랑·연두·하늘 중), 그림자·질감·글씨 없이, 가운데 큼직하게 하나";

// 챗GPT 그림의 빈 여백을 잘라서 썸네일에서 그림이 크게 보이게 (바탕색과 다른 픽셀 영역 + 여백 4%)
function trimImage(img, dark) {
  spawnSync("python3", ["-c", `
import sys
from PIL import Image, ImageChops
im = Image.open(sys.argv[1]).convert("RGB")
bg = Image.new("RGB", im.size, (0, 0, 0) if sys.argv[2] == "1" else (255, 255, 255))
diff = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 40 else 0)
bb = diff.getbbox()
if bb:
    m = int(max(im.size) * 0.04)
    im.crop((max(0, bb[0] - m), max(0, bb[1] - m), min(im.width, bb[2] + m), min(im.height, bb[3] + m))).save(sys.argv[1])
`, img, dark ? "1" : "0"]);
}

// ③ 썸네일 4개: 챗GPT가 손그림 → 영상 공장이 굵은 글씨를 얹음 (style bold)
async function thumbs(p) {
  if (!p.plan?.thumbnails?.length) throw new Error("기획안이 먼저 있어야 해요. [기획안 만들기]를 눌러주세요.");
  const dir = epDir(p);
  fs.mkdirSync(path.join(dir, "img"), { recursive: true });
  const outDir = path.join(UPLOAD_DIR, `lf-${p.id}`);
  fs.mkdirSync(outDir, { recursive: true });
  const made = [];
  const list = p.plan.thumbnails.slice(0, 4);
  for (const [i, t] of list.entries()) {
    const img = path.join(dir, "img", `thumb${i + 1}.png`);
    const dark = t.bg !== "white";
    const wantArt = t.layout !== "text" && t.art;
    const g = wantArt ? run(p, `🎨 챗GPT가 썸네일 그림 ${i + 1}/${list.length} 그리는 중 (1분 안팎)`, NODE, [path.join(ROOT, "tools/gpt_image.mjs"), `${t.art}. ${DOODLE}, 배경은 완전한 ${dark ? "검정(#000000), 선은 흰색 또는 검정 테두리에 흰 채움" : "흰색(#FFFFFF)"}, 가로로 넓은 구도`, `--out=${img}`, "--size=1536x1024"], { allowFail: true, timeout: 600_000 }) : { ok: false };
    if (g.ok && fs.existsSync(img)) trimImage(img, dark);
    const props = { format: "long", style: "bold", bg: t.bg, lines: t.lines, note: t.note, layout: g.ok && fs.existsSync(img) ? t.layout || "top" : "text", ...(g.ok && fs.existsSync(img) ? { image: path.relative(path.join(VIDEO, "public"), img) } : {}) };
    const pf = path.join(dir, `thumb${i + 1}.json`);
    fs.writeFileSync(pf, JSON.stringify({ thumbnail: props }, null, 2)); // 썸네일 틀은 upload.json 모양({ thumbnail: … })을 받는다
    const png = path.join(outDir, `thumb${i + 1}_${Date.now()}.png`);
    run(p, `🖼 썸네일 ${i + 1} 글씨 얹는 중`, "npx", ["remotion", "still", "Thumbnail", png, `--props=${pf}`], { cwd: VIDEO });
    made.push(rel(png));
    if (wantArt && !g.ok) log(p, `⚠ 그림 ${i + 1}을 못 그려서 글씨만으로 (챗GPT 한도나 로그인 확인)`);
  }
  p.thumbs = made;
  p.stage = "썸네일";
  say(p, `썸네일 시안 ${made.length}개예요 (${list.map((t) => t.type).join(" · ")}). 마음에 드는 번호와 고칠 점을 말씀해 주세요. 다시 그리려면 말을 적고 [썸네일 다시]를 누르세요.`, { images: made });
}

// ④ 대본 + 무료 초안 (목소리 없이 글자 수로 길이 어림)
const SCENE_GUIDE = `[장면 종류 — 이것만] ${SCENES_LIST.filter((t) => !["dialogue", "photo", "screen"].includes(t)).join(" · ")}
hook(lines[{text,cue}], kicker) · statement(text, kicker, sub, cue) · roadmap(title, items[]) · chapter(number, title, sub) · bigNumber(value, prefix, suffix, label, source, cue — 실제 숫자만)
citation(authors, year, title, journal, finding, cue, findingCue — 확인된 논문만) · compare(title, left{title,emoji,cue,items[]}, right{…}) · checklist(title, items[])
bars(title, bars[{label,value}], unit, source — 실제 데이터만) · story(emoji, lines[] — 그림 대신 이모지, 핵심 장면 3~4곳에 "art": "삽화 설명") · outro(question, cue, channel, channelCue)
pillars·elements = 사주 설명 장면 (사주 편일 때만)
공통: id("s01"…), narration(필수, 사장님이 그대로 읽을 문장), keywords[], face(smile·surprised·serious·laugh·worried·kind), gesture(idea·point·think·explain·none), cast(right·left·center·corner·off)
소품: "props": [{"icon": "이름", "at": "그 장면 내레이션 속 단어", "x": 0.2, "y": 0.4, "size": 220, "move": "bob|wiggle|pulse|spin"}] — 장면 뜻에 맞는 손그림 소품이 선으로 그려지며 나타나 계속 살짝 움직임. 쓸 수 있는 아이콘: brain·bulb·phone·battery·heart·clock·lightning·question·exclaim·check·chart·coffee·speech·thought·bed·money·calendar·lock·search·star·people·house·tear·fire. 장면 절반 정도에 1~2개, 글씨·캐릭터와 안 겹치게 빈 쪽(x 0.12~0.22 또는 0.78~0.88).
규칙: cue·at 은 그 장면 narration 안에 띄어쓰기까지 똑같이 있는 말. 화면 글씨 **강조**=형광펜, 줄바꿈 \\n, 숫자는 내레이션에서 한글("일곱 번")·화면에서 숫자.`;

const SHORT_RULES = `[쇼츠 규칙] 장면 10~14개(장면 하나에 1~2문장, 3초 안팎마다 화면이 바뀌게), 내레이션 합계 250~400자. "frame": {"title": ["첫 줄", "둘째 줄"]} (위에 고정되는 제목, 줄마다 14자 이내). 제목 아래는 나누지 않은 한 화면. 첫 장면 첫 문장 = 3초 안에 멈추게 하는 훅.
화면 글씨는 짧게 (한 줄 12자 이내). compare 항목 2개씩 10자 이내, checklist 3개 14자 이내. 끝은 outro(댓글로 답하고 싶은 질문).
가운데 장면 2~3곳에 "comments": [{"text": "시청자가 달 법한 한마디 16자 이내", "at": "그 장면 내레이션 속 단어", "emoji": "😳"}] (화면에 '예시' 표시됨, 실제 후기처럼 꾸미지 말 것).`;

async function script(p) {
  if (!p.plan) throw new Error("기획안이 먼저 있어야 해요.");
  const short = p.format === "short";
  const dir = epDir(p);
  fs.mkdirSync(dir, { recursive: true });
  const epFile = path.join(dir, "episode.json");
  let feedback = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = askClaude(p, `${context(p)}

기획안대로 ${short ? "쇼츠" : "롱폼"} 대본을 episode.json 으로 써. 사장님 목소리로 읽을 문장이니 입말로.
${SCENE_GUIDE}
${short ? SHORT_RULES : "챕터마다 chapter 장면으로 시작, 처음은 hook, 끝은 outro. 장면 하나에 1~2문장(3초 안팎마다 화면이 바뀌게 — 레퍼런스 평균 2.6초), 그래서 장면 40~80개. 짧은 단문·해요체."}${p.episode ? `\n[지난 대본 — 사장님 말대로 고쳐서 다시]\n${JSON.stringify(p.episode.scenes.map((s) => [s.id, s.type, s.narration]))}` : ""}${feedback ? `\n[대본 검사에서 나온 문제 — 고쳐서 다시]\n${feedback}` : ""}
JSON 하나만: {"reply": "사장님께 두세 줄 (어떻게 썼는지, 고민할 점)", "episode": {"title": "…", "chapters": ["챕터 이름 짧게"], "scenes": [ … ]}}`);
    const skin = load().settings?.skin || undefined; // 앱 '오늘의 영상'에서 고른 글씨·색
    const ep = short
      ? { ...r.episode, format: "short", style: "punchy", pace: { speed: 1.3, trim: true }, presenter: true, skin, frame: { ...(r.episode.frame || {}), brand: p.channel.split(" (")[0] } } // 위 고정 제목 + 아래 한 무대 (나누지 않음)
      : { ...r.episode, format: "long", style: "calm", presenter: true, captions: true, skin, pace: { speed: 1.3, trim: true } };
    fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
    const check = run(p, `대본 검사 (${attempt}번째)`, NODE, ["scripts/check_episode.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO, allowFail: true });
    if (check.ok) {
      p.episode = ep;
      say(p, r.reply);
      break;
    }
    feedback = check.out.slice(-2000);
    if (attempt === 3) throw new Error("대본 검사를 세 번 다 통과 못 했어요. 대화로 방향을 조금 바꿔서 다시 눌러주세요.");
  }
  await sceneArt(p, dir, epFile);
  const out = path.join(VIDEO, "out", `lf-${p.id}_draft.mp4`);
  run(p, "🎬 목소리 없는 초안 영상 만드는 중 (몇 분)", "npx", ["remotion", "render", "Episode", out, `--props=${path.relative(VIDEO, epFile)}`], { cwd: VIDEO });
  p.draft = rel(out);
  p.stage = "초안";
  say(p, "목소리 없는 초안이에요. 장면 순서·화면 글씨를 보시고 고칠 점을 말씀해 주세요. 괜찮으면 아래 '녹음용 대본'을 읽어 녹음한 파일을 올려주세요.", { video: p.draft });
}

// 대본의 "art" 장면을 챗GPT 삽화로 (최대 4장, 실패하면 이모지 그대로)
async function sceneArt(p, dir, epFile) {
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
  const charRef = path.join(VIDEO, "public/characters/round/ref_sheet.png"); // 새 캐릭터 (2026-10-24)
  let n = 0;
  for (const s of ep.scenes) {
    if (!s.art || s.image || n >= 4) continue;
    n++;
    const img = path.join(dir, "img", `${s.id}.png`);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    const g = run(p, `🎨 챗GPT 삽화 ${n} (${s.id})`, NODE, [path.join(ROOT, "tools/gpt_image.mjs"), `${s.art}. 배경은 완전한 검정 단색, 굵고 둥근 흰색 손그림 두들, 노랑 포인트 하나, 사람은 기준 그림의 동그란 안경 막대 캐릭터, 16:9, 그림자·글씨 없이, 왼쪽 40% 비움`, `--out=${img}`, "--size=1536x1024", ...(fs.existsSync(charRef) ? [`--ref=${charRef}`] : [])], { allowFail: true, timeout: 600_000 });
    if (g.ok && fs.existsSync(img)) Object.assign(s, { image: path.relative(path.join(VIDEO, "public"), img), textSide: "left", cast: "off" });
  }
  fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
  p.episode = ep;
}

// ⑤ 사장님 녹음 → 장면별로 자르기(받아쓰기) → 완성
async function voice(p) {
  const rec = [...p.messages].reverse().flatMap((m) => m.files || []).find((f) => /\.(mp3|m4a|wav)$/i.test(f));
  if (!rec || !p.episode) throw new Error("대본과 녹음 파일이 둘 다 있어야 해요.");
  const dir = epDir(p);
  const epFile = path.join(dir, "episode.json");
  if (path.extname(rec).toLowerCase() !== ".mp3") throw new Error("지금은 mp3 녹음만 맞출 수 있어요. 휴대폰 녹음 앱에서 mp3로 저장해 올려주세요.");
  fs.copyFileSync(path.join(ROOT, rec), path.join(dir, "voice_full.mp3"));
  finish(p, epFile);
}

// 일레븐랩스 천성준 목소리로 녹음 (크레딧 — 사장님이 버튼을 눌렀을 때만)
async function eleven(p) {
  if (!p.episode) throw new Error("대본이 먼저 있어야 해요.");
  const epFile = path.join(epDir(p), "episode.json");
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
  ep.voice = VOICE;
  fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
  const chars = ep.scenes.reduce((n, s) => n + (s.narration || "").length, 0);
  run(p, `🎙 일레븐랩스 천성준 목소리 녹음 (${chars}자 ≈ 크레딧 ${chars})`, NODE, ["tools/elevenlabs.mjs", "narrate", path.relative(ROOT, epFile), "--yes"], { timeout: 900_000 });
  finish(p, epFile);
}

function finish(p, epFile) {
  run(p, "✂️ 녹음을 장면별로 자르는 중 (받아쓰기, 몇 분)", NODE, ["scripts/split_voice.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO, timeout: 3600_000 });
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
  ep.pace = ep.pace || { speed: 1.3, trim: true };
  p.episode = ep;
  fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
  const out = path.join(VIDEO, "out", `lf-${p.id}_final.mp4`);
  run(p, "🎬 완성본 만드는 중 (몇 분)", "npx", ["remotion", "render", "Episode", out, `--props=${path.relative(VIDEO, epFile)}`], { cwd: VIDEO });
  p.final = rel(out);
  p.stage = "완성";
  say(p, "목소리를 입힌 완성본이에요. 말과 화면이 어긋나는 곳이 있으면 몇 분 몇 초인지 알려주세요.", { video: p.final });
}

// ⑥ 업로드 문구
async function upload(p) {
  const r = askClaude(p, `${context(p)}
${p.episode ? `[대본]\n${p.episode.scenes.map((s) => s.narration).join(" ").slice(0, 6000)}` : ""}

유튜브 ${p.format === "short" ? "쇼츠" : ""} 업로드 문구를 써.${p.format === "short" ? " 쇼츠는 챕터 시간 없이." : ""} JSON 하나만:
{"reply": "한두 줄", "youtube": {"titles": ["제목 후보 3개, 100자 이내, 핵심 키워드 앞"], "description": "설명란 (첫 2줄에 키워드, 챕터 시간은 '0:00 들어가며' 형식으로 대략, 댓글 질문 1개, 해시태그 3개)", "tags": ["태그 10개 이내"]}}`);
  p.youtube = r.youtube;
  say(p, r.reply);
}

const JOBS = { chat, plan, thumbs, script, voice, eleven, upload };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [step, id] = process.argv.slice(2);
  const p = getProject(id);
  try {
    if (!JOBS[step]) throw new Error(`모르는 일: ${step}`);
    if (!["voice", "eleven"].includes(step)) await readRefs(p);
    await JOBS[step](p);
    log(p, "✅ 끝");
  } catch (e) {
    say(p, `⚠ 문제가 생겼어요: ${String(e.message).slice(0, 400)}`);
    log(p, `❌ ${e.message}`);
  } finally {
    p.busy = null;
    saveProject(p);
  }
}
