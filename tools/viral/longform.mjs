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
import { ROOT, DATA_DIR, UPLOAD_DIR, GEMINI_MODEL, load, save, saveUploads, imageParts, isVideo } from "./core.mjs";
import { gemini, watchVideo } from "../ai-bridge/gemini.mjs";
import { SOUND_RULES, pickSections } from "./sound_rules.mjs";
import { fillPhotos, creditLines } from "../commons.mjs";
import { ensureSajuOutro, OUTRO_ASK, PINNED_ASK, withSaju } from "../saju_pin.mjs";
import { BRIDGE_RULE, FORECAST_ASK, SELL_ASK, SELL_RULES } from "../sell_plan.mjs";
import { AREA_LIST, recentList, TOPIC_AREAS } from "../topic_mix.mjs";
import { SCENES_LIST } from "../../video/scripts/scene-types.mjs";

const DIR = path.join(DATA_DIR, "longform");
const VIDEO = path.join(ROOT, "video");
const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME, ".local/bin/claude");
const NODE = process.execPath;
const ID = /^[a-z0-9]{6,20}$/;
const STEPS = ["chat", "plan", "thumbs", "script", "voice", "eleven", "upload", "publish", "next", "comment", "shorts"];
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
export function postMessage(id, { text = "", links = "", files = [], step = "chat", titleIdx, thumbIdx }) {
  const p = getProject(id);
  if (p.busy) throw new Error(`지금 '${p.busy}' 하는 중이에요. 끝나고 다시 보내주세요.`);
  if (!STEPS.includes(step)) throw new Error("모르는 단계입니다.");
  const urls = String(links).split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  const saved = saveUploads(files);
  if (!String(text).trim() && !urls.length && !saved.length && step === "chat") throw new Error("말이나 링크, 파일을 넣어주세요.");
  if (step === "thumbs" && p.format === "short") throw new Error("쇼츠 표지는 컴퓨터에서 못 바꿔요. 올린 뒤 휴대폰 유튜브 앱에서 장면을 고르세요.");
  if (step === "publish") {
    if (!p.final) throw new Error("완성본이 먼저 있어야 해요 (녹음 올리기 또는 일레븐랩스).");
    p.pick = { title: Number(titleIdx) || 0, thumb: Number(thumbIdx) || 0 };
  }
  if (step === "shorts" && !(p.format !== "short" && p.final)) throw new Error("롱폼 완성본(목소리 입힌 영상)이 있어야 숏폼을 잘라낼 수 있어요.");
  if (step === "comment" && !(p.youtubeUrl && p.youtube?.pinned)) throw new Error("유튜브에 올린 뒤, 업로드 문구(고정 댓글)가 있어야 달 수 있어요.");
  // 대화창에 녹음 파일을 올려도 대본이 있으면 바로 목소리 맞추기로 (2026-10-27: 대화로 올린 녹음이 처리되지 않고 멈춰 있었음)
  if (step === "chat" && p.episode && saved.some((f) => /\.(mp3|m4a|wav)$/i.test(f))) step = "voice";
  const hasRec = saved.some((f) => /\.(mp3|m4a|wav)$/i.test(f)) || p.messages.some((m) => (m.files || []).some((f) => /\.(mp3|m4a|wav)$/i.test(f)));
  if (step === "voice" && !hasRec) throw new Error("녹음 파일(mp3·m4a·wav)을 올려주세요.");
  for (const u of urls) p.refs.push({ url: u, at: new Date().toISOString() });
  for (const f of saved) p.refs.push({ file: f, at: new Date().toISOString() });
  if (String(text).trim() || urls.length || saved.length) p.messages.push({ role: "me", text: String(text).trim(), links: urls, files: saved, step, at: new Date().toISOString() });
  p.busy = { chat: "답 쓰는 중", plan: "기획안 만드는 중", thumbs: "썸네일 그리는 중", script: "대본·초안 만드는 중", voice: "목소리 맞추는 중", eleven: "일레븐랩스 녹음 중", upload: "업로드 문구 쓰는 중", publish: "유튜브에 올리는 중", next: "다음 편 여는 중", comment: "고정 댓글 다는 중", shorts: "숏폼 뽑는 중" }[step];
  p.ask = null;
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

// 보관함(떡상 영상 분석)·연출 기법을 영상 만들기에도 (2026-10-26 사장님 OK). 보관함은 대부분 쇼츠라
// 롱폼엔 주제·제목·훅·연출만 가져오고, 쇼츠의 길이·속도·구성은 안 가져온다. 3분 넘는 롱폼 분석만 구성까지.
export function libraryNotes(p) {
  const db = load();
  const cut = (s, n = 160) => String(s || "").replace(/\s+/g, " ").slice(0, n);
  const long = p.format !== "short";
  const items = Object.values(db.items || {}).filter((x) => x.analysis).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 6);
  const techniques = Object.values(db.techniques || {}).filter((t) => t.status === "auto" || t.status === "done").slice(-12);
  if (!items.length && !techniques.length) return "";
  const lines = items.map((x) => {
    const isLong = (x.duration || 0) >= 180;
    const a = x.analysis;
    return `■ ${cut(x.title, 80)} (${isLong ? "롱폼" : "쇼츠"}, 조회 ${x.views ?? "?"}) — 왜 떴나: ${cut(a.one_line)} / 훅: ${cut(a.hook)} / 공식: ${cut(a.reusable_formula)}${!long || isLong ? ` / 구성: ${cut(typeof a.structure === "string" ? a.structure : JSON.stringify(a.structure), 240)}` : ""}`;
  });
  return `[보관함 — 사장님이 모은 떡상 영상 분석]${long ? " 롱폼엔 주제·제목·썸네일 문구·첫 15초 훅·연출만 참고. 쇼츠의 길이·장면 속도·구성은 따라 하지 말 것 (롱폼 분석만 구성 참고)." : ""} 내용·대사는 베끼지 말고 공식만.
${lines.join("\n")}
${techniques.length ? `[연출 기법 — 자동 적용 목록, 장면에 맞으면 섞어 쓰기]\n${techniques.map((t) => `- ${t.name} (${t.our_scene}): ${cut(t.how_to_copy, 120)}`).join("\n")}\n` : ""}`;
}

// 일기장도 영상 만들기에 (2026-10-27 사장님: "일기장에 쓴 것들이 롱폼 영상 만들기에도 영향을"):
// 아직 영상에 안 쓴 일기 + 이 프로젝트가 이미 쓴 일기를 보여주고, 기획안에서 고른 일기는 '영상에 씀'(lf-<id>)으로 표시
function diaryNotes(p) {
  const diary = load().diary || [];
  const tag = `lf-${p.id}`;
  const pick = diary.filter((d) => d.usedIn?.includes(tag) || !d.usedIn?.length).slice(-8);
  if (!pick.length) return "";
  return `[사장님 일기장 — 사장님의 진짜 이야기. 주제·첫 문장·사례로 쓰면 좋음. 일기에 없는 경험·숫자는 지어내지 말 것. 앱 사용 요청·지시만 적힌 일기는 무시]
${pick.map((d) => `(${d.id}, ${d.at.slice(0, 10)}${d.usedIn?.length ? `, 영상에 씀: ${d.usedIn.join(",")}` : ""}) ${d.text.replace(/\s+/g, " ").slice(0, 600)}${d.photoNote ? ` [사진: ${d.photoNote.slice(0, 200)}]` : ""}`).join("\n")}
`;
}
function markDiary(p, ids = []) {
  const db = load();
  const tag = `lf-${p.id}`;
  for (const d of db.diary || []) {
    d.usedIn = (d.usedIn || []).filter((x) => x !== tag);
    if (ids.includes(d.id)) d.usedIn.push(tag);
  }
  save(db);
}

function context(p) {
  const refs = p.refs.filter((r) => r.summary).map((r, i) => `[참고 ${i + 1}] ${r.url || path.basename(r.file)}\n${r.summary}`).join("\n\n");
  const talk = p.messages.slice(-20).map((m) => `${m.role === "me" ? "사장님" : "클로드"}: ${m.text}${m.links?.length ? ` (링크 ${m.links.join(" ")})` : ""}${m.files?.length ? ` (파일 ${m.files.length}개)` : ""}`).join("\n");
  const kind = p.format === "short" ? "세로 쇼츠 1080×1920 (40~60초)" : "가로 롱폼 1920×1080 (보통 6~10분)";
  return `[${p.format === "short" ? "숏폼" : "롱폼"} 프로젝트] 가제: ${p.title} / 채널: ${p.channel} / ${kind}
[사장님이 처음 말한 느낌] ${p.brief || "(없음)"}
${p.parent ? `[원본 롱폼 「${p.parent.title}」에서 뽑은 쇼츠 — 이 구간의 내용·표현을 살려서, 롱폼을 안 본 사람도 이해되게 40~55초로]\n${p.parent.segment}\n` : ""}${p.plan ? `[지금 기획안]\n${JSON.stringify(p.plan, null, 1)}\n` : ""}${refs ? `[참고 자료 — 제미나이가 본 요약 (사장님이 이번에 직접 준 자료라 보관함보다 우선)]\n${refs}\n` : ""}${diaryNotes(p)}${libraryNotes(p)}[최근에 만든 영상 — 사장님이 "비슷한 주제만 나온다"고 함. 주제를 제안할 땐 이것과 겹치지 않게, 영역을 넓게 (${AREA_LIST})]\n${recentList(p.plan?.titles?.[0])}\n[지금까지 대화]\n${talk || "(아직 없음)"}

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

// ① 대화 — 사장님은 말만 하면 된다 (2026-10-26 사장님: "필요한 버튼만, 대화 형식으로 영상을 만들어내는 채팅"):
// 클로드가 말뜻을 보고 다음 단계를 바로 돌린다. 크레딧·바깥으로 나가는 일(일레븐랩스 녹음·유튜브 올리기)은 버튼만 띄운다.
const AUTO = { plan: "기획안 만드는 중", thumbs: "썸네일 그리는 중", script: "대본·초안 만드는 중", upload: "업로드 문구 쓰는 중", shorts: "숏폼 뽑는 중" };
const ready = (p, step) => ({ plan: true, thumbs: p.format !== "short" && !!p.plan, script: !!p.plan, upload: !!p.episode, shorts: p.format !== "short" && !!p.final }[step]);
function state(p) {
  const has = (x, a, b) => (x ? `${a} 있음` : `${a} ${b || "없음"}`);
  return `[지금 상태] ${[has(p.plan, "기획안"), p.format === "short" ? "" : has(p.thumbs, "썸네일"), has(p.episode, "대본·초안"), has(p.final, "완성본(목소리)"), has(p.youtube, "업로드 문구"), p.youtubeUrl ? `유튜브 올림 ${p.youtubeUrl}` : "유튜브 안 올림"].filter(Boolean).join(" / ")}${p.prev ? `\n[이전 편] ${p.prev.title} — ${p.prev.summary}` : ""}`;
}

async function chat(p) {
  const r = askClaude(p, `${context(p)}
${state(p)}

사장님의 마지막 말에 답해. 영상을 같이 만드는 대화다: 질문이 필요하면 1~2개만, 제안은 구체적으로(제목·첫 문장·구성 예시).
"do" = 사장님이 다음 단계를 원하거나 동의했으면 그 일 하나 (고칠 점을 말하면 그 단계를 다시 하는 것도 포함):
  plan(기획안) · thumbs(롱폼 썸네일, 기획안 있어야) · script(대본+무료 초안, 기획안 있어야) · upload(업로드 문구·고정 댓글, 대본 있어야)
  · next(이 영상에 이어지는 다음 편을 새로 시작 — 사장님이 '다음 편', '이어서', '다음 이야기'라고 할 때)
  · shorts(롱폼 완성본이 있을 때 롱폼 영상을 잘라 숏폼 3개 만들기 — '쇼츠로', '숏폼 만들어') · ""(그냥 대화).
  기획이 아직 모자라면 do 는 비우고 질문만.
"ask" = 일레븐랩스 녹음(크레딧)·유튜브 올리기·고정 댓글 달기를 원하면 직접 하지 말고 "eleven" · "publish" · "comment" (화면에 확인 버튼이 뜬다).
do 가 있으면 reply 는 "○○ 바로 시작할게요" 한두 줄로 짧게.
JSON 하나만: {"reply": "답 (10줄 이내)", "do": "", "ask": "", "title": "지금 가제가 '제목 없음'이면 짧은 가제, 아니면 빈 문자열"}`);
  say(p, r.reply);
  if (r.title && p.title === "제목 없음") p.title = String(r.title).slice(0, 40);
  p.ask = ["eleven", "publish", "comment"].includes(r.ask) ? r.ask : null;
  if (r.do === "next") return next(p);
  if (AUTO[r.do] && ready(p, r.do)) {
    p.busy = AUTO[r.do];
    saveProject(p);
    await JOBS[r.do](p);
  }
}

// 다음 편: 이 영상의 이야기를 이어받는 새 프로젝트를 열고, 사장님 마지막 말로 대화를 시작한다
async function next(p) {
  const last = [...p.messages].reverse().find((m) => m.role === "me")?.text || "";
  const summary = [p.plan?.hook, ...(p.plan?.chapters || []).map((c) => c.title)].filter(Boolean).join(" / ").slice(0, 400);
  const n = createProject({ title: "제목 없음", brief: `「${p.title}」 다음 편${last ? ` — 사장님 말: ${last}` : ""}`, channel: p.channel, format: p.format });
  n.prev = { id: p.id, title: p.title, summary, url: p.youtubeUrl || null };
  saveProject(n);
  postMessage(n.id, { text: last || `「${p.title}」에 이어지는 다음 편을 만들고 싶어요.`, step: "chat" });
  say(p, `다음 편을 새로 열었어요. 위 목록의 새 영상에서 이어서 이야기해요.`, { open: n.id });
}

// 롱폼 → 숏폼 (2026-10-27 사장님: "롱폼을 만들면 그 롱폼을 토대로, 롱폼에서 영상을 따와서 숏폼을 만들자 + 업로드 버튼"):
// 클로드가 완성된 롱폼에서 따로 떼어도 통하는 구간 3개(35~55초)를 고르면, 그 장면들을 사장님 녹음 그대로 세로 쇼츠로 다시 그리고
// (위 고정 제목 + 끝에 '고정 댓글' 안내 카드), 업로드 문구·고정 댓글까지 써 둔다 → 숏폼 화면의 다음 버튼 = 유튜브에 올리기
async function sceneSeconds(scenes, pace) {
  const T = await import(path.join(VIDEO, "src/timing.js"));
  const { FPS } = await import(path.join(VIDEO, "src/theme.js"));
  return T.applyPace(scenes, pace).map((x) => T.sceneFrames(x) / FPS);
}

async function shorts(p) {
  if (p.format === "short" || !p.episode) throw new Error("숏폼은 롱폼 대본이 생긴 뒤에 뽑을 수 있어요.");
  if (!p.final || !p.episode.scenes.some((x) => x.audio)) throw new Error("롱폼 완성본(목소리 입힌 영상)이 있어야 잘라낼 수 있어요. 녹음 파일을 올리거나 일레븐랩스로 먼저 완성해 주세요.");
  const secs = await sceneSeconds(p.episode.scenes, p.episode.pace);
  const lines = p.episode.scenes.map((x, i) => `${x.id} (${secs[i].toFixed(1)}초)${x.image || x.drawFace ? " [그림]" : ""} ${x.narration}`).join("\n").slice(0, 14000);
  const r = askClaude(p, `${context(p)}

[롱폼 완성본 — 장면 id (들리는 길이) 읽는 문장]
${lines}

이 롱폼에서 그대로 잘라 쓸 쇼츠 구간 3개를 골라. 문장은 바꿀 수 없다(이미 녹음됨) — 그래서 구간의 첫 장면 첫 문장이 스스로 훅이 되는 곳에서 시작할 것.
조건: 이어진 장면들, 합계 35~55초, [그림] 장면이 2개 이상 들어간 구간을 우선, 앞뒤 맥락 없이도 이해되는 하나의 이야기, 셋은 서로 다른 감정·각도(찔림 / 웃음 / 써먹을 팁 등), 서로 겹치지 않게.
JSON 하나만: {"reply": "사장님께 두세 줄: 어떤 기준으로 골랐는지", "shorts": [{"title": "화면 위 고정 제목 '첫 줄 / 둘째 줄' (줄마다 14자 이내)", "from": "시작 장면 id", "to": "끝 장면 id", "angle": "감정·각도 한 줄"}]}`);
  const ids = new Map(p.episode.scenes.map((x, i) => [x.id, i]));
  const skin = p.episode.skin || load().settings?.skin || undefined;
  const made = [];
  for (const sh of (r.shorts || []).slice(0, 3)) {
    const a = ids.get(sh.from), b0 = ids.get(sh.to);
    if (a == null || b0 == null || b0 < a) { log(p, `⚠ 구간 ${sh.from}~${sh.to} 이 이상해서 건너뜀`); continue; }
    // 58초를 넘으면 뒤 장면부터 덜어낸다 (끝 안내 카드 3.5초 포함)
    let b = b0;
    while (b > a && secs.slice(a, b + 1).reduce((x, y) => x + y, 0) > 54.5) b--;
    const picked = JSON.parse(JSON.stringify(p.episode.scenes.slice(a, b + 1))).map((x) => {
      delete x.musicDrop; delete x.musicMute; delete x.pauseBefore; // 롱폼 음악 연출은 빼고
      delete x.punch; // 가운데 큰 강조 자막은 일반 자막과 같은 높이라 겹침 → 쇼츠에선 자막만 (2026-10-27)
      if (x.cast === "corner" || (x.cast === "off" && !x.image && !x.drawFace)) x.cast = "right"; // 그림·표정 장면은 캐릭터를 겹치지 않음
      return x;
    });
    const [l1, l2] = String(sh.title || "").split("/").map((t) => t.trim().slice(0, 14));
    const n = createProject({ title: [l1, l2].filter(Boolean).join(" ") || "롱폼에서 뽑은 쇼츠", brief: `롱폼 「${p.title}」에서 잘라 만든 쇼츠 — ${sh.angle || ""}`, channel: p.channel, format: "short" });
    const segment = picked.map((x) => x.narration).join(" ");
    n.photoCredits = (p.photoCredits || []).filter((c) => picked.some((x) => x.image === path.relative(path.join(VIDEO, "public"), c.file)));
    n.parent = { id: p.id, title: p.title, url: p.youtubeUrl || null, from: sh.from, to: picked.at(-1).id, segment };
    n.plan = { titles: [`${l1 || ""} / ${l2 || ""}`], hook: picked[0].narration, length: "", chapters: [{ title: "롱폼 구간", points: [`${sh.from}~${picked.at(-1).id}`, sh.angle || ""] }] };
    const end = { id: "end", type: "statement", text: "내 기질 궁금하면\n**고정 댓글** 링크", narration: "내 기질이 궁금하면 고정 댓글 링크를 한번 보세요.", holdSeconds: 3.5, cast: "right", face: "smile", gesture: "point" };
    const ep = { title: n.title, format: "short", style: "punchy", pace: p.episode.pace || { speed: 1.3, trim: true }, presenter: true, skin, captions: true, soundPlan: true,
      frame: { title: [l1 || "", l2 || ""].filter(Boolean), brand: p.channel.split(" (")[0], captionLift: 0.37 }, scenes: [...picked, end] }; // 자막은 비교 카드 아래·안전 영역(y≤1399) 안으로
    ep.musicSections = pickSections([{ from: picked[0].id, mood: "calm" }], ep.scenes, [], Date.now() % 97);
    const dir = epDir(n);
    fs.mkdirSync(dir, { recursive: true });
    const epFile = path.join(dir, "episode.json");
    fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
    n.episode = ep;
    saveProject(n);
    const out = path.join(VIDEO, "out", `lf-${n.id}_final.mp4`);
    run(p, `✂️ 숏폼 ${made.length + 1} 만드는 중 (${sh.from}~${picked.at(-1).id}, 몇 분)`, "npx", ["remotion", "render", "Episode", out, `--props=${path.relative(VIDEO, epFile)}`], { cwd: VIDEO });
    n.final = rel(out);
    n.stage = "완성";
    say(n, `롱폼 「${p.title}」의 ${sh.from}~${picked.at(-1).id} 구간을 사장님 목소리 그대로 세로로 다시 만들었어요 (${(secs.slice(a, b + 1).reduce((x, y) => x + y, 0) + 3.5).toFixed(0)}초 안팎). 끝에 '고정 댓글' 안내 카드를 붙였어요.`, { video: n.final });
    try { await upload(n); } catch (e) { say(n, `⚠ 업로드 문구를 못 썼어요: ${String(e.message).slice(0, 200)} — [업로드 문구] 버튼을 눌러 주세요.`); }
    saveProject(n);
    made.push(n.id);
  }
  p.shortsMade = [...(p.shortsMade || []), ...made];
  say(p, `${r.reply}\n\n숏폼 ${made.length}개를 롱폼에서 잘라 만들었어요. 업로드 문구·고정 댓글까지 써 뒀으니, 아래에서 열어 확인하고 [유튜브에 올리기]만 누르면 돼요.`, { opens: made });
}

// ② 기획안: 제목 후보·훅·챕터·썸네일 아이디어 3개
async function plan(p) {
  if (p.format === "short") return planShort(p);
  const r = askClaude(p, `${context(p)}

롱폼 기획안을 만들어. 먼저 '무엇을 파는가'(sell)를 정하고, 제목·훅·썸네일을 그 약속에 맞춰.
${SELL_RULES}
JSON 하나만:
{"reply": "사장님께 한두 줄(무엇을 누구에게 파는지 + 주 감정) + 고민할 점(sell.risk) 한 줄",
 "plan": {"area": "주제 영역 key 하나", "diary_ids": ["기획에 쓴 일기 id (없으면 빈 배열)"], ${SELL_ASK}, "titles": ["제목 후보 3개, 핵심 키워드를 앞에, 40자 이내"], "hook": "첫 10초에 할 말", "length": "예상 길이(분)",
   "chapters": [{"title": "챕터 이름", "points": ["다룰 내용 2~4개"]}],
   "thumbnails": [{"type": "물건비유|VS대결|반응|글씨만", "lines": ["첫 줄", "둘째 줄(선택)"], "bg": "black|white", "layout": "top|bottom|text", "art": "그릴 것 한 문장 (글씨만이면 빈 문자열)", "note": "손글씨 메모 한 줄(선택, 10자 이내, 예: (하버드대 교수))"}]}}
${THUMB_RULES}`);
  p.plan = r.plan;
  if (TOPIC_AREAS.some((a) => a.key === r.plan?.area)) p.area = r.plan.area;
  markDiary(p, r.plan?.diary_ids || []);
  p.stage = "기획안";
  say(p, r.reply);
}

async function planShort(p) {
  const r = askClaude(p, `${context(p)}

쇼츠 기획안을 만들어. 먼저 '무엇을 파는가'(sell)를 정하고, 제목·훅을 그 약속에 맞춰.
${SELL_RULES}
JSON 하나만:
{"reply": "사장님께 한두 줄(무엇을 누구에게 파는지 + 주 감정) + 고민할 점(sell.risk) 한 줄",
 "plan": {"area": "주제 영역 key 하나", "diary_ids": ["기획에 쓴 일기 id (없으면 빈 배열)"], ${SELL_ASK}, "titles": ["화면 위 제목 2줄 후보 3개 — 각 '첫 줄 / 둘째 줄', 줄마다 14자 이내"], "hook": "첫 3초에 할 말", "length": "예상 길이(초)",
   "chapters": [{"title": "흐름 단계(훅·전개·반전·마무리 등)", "points": ["화면에 나올 것·할 말 1~3개"]}]}}`);
  p.plan = r.plan;
  if (TOPIC_AREAS.some((a) => a.key === r.plan?.area)) p.area = r.plan.area;
  markDiary(p, r.plan?.diary_ids || []);
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
const SCENE_GUIDE = `[장면 종류 — 이것만] ${SCENES_LIST.filter((t) => !["dialogue", "screen"].includes(t)).join(" · ")}
hook(lines[{text,cue}], kicker) · statement(text, kicker, sub, cue) · roadmap(title, items[]) · chapter(number, title, sub) · bigNumber(value, prefix, suffix, label, source, cue — 실제 숫자만)
citation(authors, year, title, journal, finding, cue, findingCue — 확인된 논문만) · compare(title, left{title,emoji,cue,items[]}, right{…}) · checklist(title, items[])
bars(title, bars[{label,value}], unit, source — 실제 데이터만) · story(emoji, lines[] — 그림 대신 이모지. 롱폼은 대략 5장면마다 1곳(10~12곳), 쇼츠는 2~3곳에 "art": "삽화 설명 한 문장 — 채널 캐릭터(나)가 무엇을 하는지·어디인지·표정, 비교라면 왼쪽/오른쪽 대비로" — 그림이 연필로 그려지듯 나타남)
story 표정 그리기: 감정이 확 바뀌는 순간 2~3곳(쇼츠 1곳)에 "drawFace": "smile|surprised|serious|laugh|worried|kind", "cast": "off" — 내 캐릭터 얼굴이 크게 그려지고 옆에 lines 글씨 (art 와 같이 쓰지 말 것)
photo(실존 철학자·심리학자·위인을 말할 때만, 롱폼 2~4개 / 쇼츠 1~2개): {"person": "영문 전체 이름(위키백과 표기, 예: Arthur Schopenhauer)", "name": "한글 이름", "years": "1788–1860", "lines": [{text, cue}], "circle": {"at": "그 사람을 가리키는 순간의 단어"}} — 무료 사진이 자동으로 들어감. image·x·y 쓰지 말 것. 실존 인물은 art 로 그리지 말 것 · outro(question, cue, channel, channelCue)
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
${SOUND_RULES(short ? "쇼츠는 2구간" : "롱폼은 4구간: 오프닝·훅 tense → 과거 고백 sad → 깨달음·전환 playful → 다짐·마무리 hopeful (내용에 맞게 조정)")}
${p.plan?.sell ? `[이 영상이 파는 것] ${JSON.stringify(p.plan.sell)}\n썸네일·제목의 약속(promise)을 첫 15초 안에 지키고, 주 감정(emotion)을 끝까지 유지하고, 보고 나서 남는 것(value)을 한 문장으로 꼭 말할 것.\n` : ""}${BRIDGE_RULE}
${OUTRO_ASK}
${short ? SHORT_RULES : "챕터마다 chapter 장면으로 시작, 처음은 hook, 끝은 outro. 장면 하나에 1~2문장(3초 안팎마다 화면이 바뀌게 — 레퍼런스 평균 2.6초), 그래서 장면 40~80개. 짧은 단문·해요체."}${p.episode ? `\n[지난 대본 — 사장님 말대로 고쳐서 다시]\n${JSON.stringify(p.episode.scenes.map((s) => [s.id, s.type, s.narration]))}` : ""}${feedback ? `\n[대본 검사에서 나온 문제 — 고쳐서 다시]\n${feedback}` : ""}
영상 길이·녹음 여부는 reply 에 쓰지 말 것(모르는 사실 — 프로그램이 실제 값으로 붙임).
JSON 하나만: {"reply": "사장님께 두세 줄 (어떻게 썼는지, 고민할 점) + 마지막 줄에 '소리: BGM 구간 n개 / 효과음 n개 / 강조 자막 n개'", "music_plan": [{"from": "장면 id", "mood": "tense"}], "episode": {"title": "…", "chapters": ["챕터 이름 짧게"], "scenes": [ … ]}}`);
    const skin = load().settings?.skin || undefined; // 앱 '오늘의 영상'에서 고른 글씨·색
    const ep = short
      ? { ...r.episode, format: "short", style: "punchy", pace: { speed: 1.3, trim: true }, presenter: true, skin, frame: { ...(r.episode.frame || {}), brand: p.channel.split(" (")[0] } } // 위 고정 제목 + 아래 한 무대 (나누지 않음)
      : { ...r.episode, format: "long", style: "calm", presenter: true, captions: true, skin, pace: { speed: 1.3, trim: true } };
    ensureSajuOutro(ep); // 모든 영상 마지막에 사주 안내 한 문장 (사장님 2026-10-27)
    ep.soundPlan = true; // 효과음은 대본이 고른 것만 (sound_rules.mjs)
    ep.musicSections = pickSections(r.music_plan, ep.scenes || [], [], Date.now() % 97);
    const credits = await fillPhotos(ep, dir, (m) => log(p, m)); // 위인 사진 (위키미디어 무료, 못 받으면 이모지 장면으로)
    fs.writeFileSync(epFile, JSON.stringify(ep, null, 2));
    const check = run(p, `대본 검사 (${attempt}번째)`, NODE, ["scripts/check_episode.mjs", path.relative(VIDEO, epFile)], { cwd: VIDEO, allowFail: true });
    if (check.ok) {
      p.episode = ep;
      p.photoCredits = credits;
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
  const ch = await realChapters(p);
  say(p, `실제 초안 길이: ${ch.mmss ? ch.mmss(ch.total) : "?"} (목소리 없는 초안 기준 — 사장님 녹음 속도에 따라 달라져요)`);
  p.stage = "초안";
  say(p, "목소리 없는 초안이에요. 장면 순서·화면 글씨를 보시고 고칠 점을 말씀해 주세요. 괜찮으면 아래 '녹음용 대본'을 읽어 녹음한 파일을 올려주세요.", { video: p.draft });
}

// 대본의 "art" 장면을 챗GPT 삽화로 (최대 12장 — 2026-10-27 사장님: 그림 더 자주, 연필로 그려지듯. 실패하면 이모지 그대로)
async function sceneArt(p, dir, epFile) {
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
  const charRef = path.join(VIDEO, "public/characters/round/ref_sheet.png"); // 새 캐릭터 (2026-10-24)
  let n = 0;
  for (const s of ep.scenes) {
    if (s.drawFace) { // 표정 그리기 장면: 있는 표정만, 화면 진행자와 겹치지 않게
      if (["smile", "surprised", "serious", "laugh", "worried", "kind"].includes(s.drawFace)) s.cast = "off";
      else delete s.drawFace;
    }
    if (!s.art || s.image || n >= 12) continue;
    n++;
    const img = path.join(dir, "img", `${s.id}.png`);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    const g = run(p, `🎨 챗GPT 삽화 ${n} (${s.id})`, NODE, [path.join(ROOT, "tools/gpt_image.mjs"), `${s.art}. 배경은 완전한 검정 단색, 굵고 둥근 흰색 손그림 두들, 노랑 포인트 하나, 사람은 기준 그림의 동그란 안경 막대 캐릭터, 16:9, 그림자·글씨 없이, 왼쪽 40% 비움`, `--out=${img}`, "--size=1536x1024", ...(fs.existsSync(charRef) ? [`--ref=${charRef}`] : [])], { allowFail: true, timeout: 600_000 });
    if (g.ok && fs.existsSync(img)) Object.assign(s, { image: path.relative(path.join(VIDEO, "public"), img), textSide: "left", cast: "off", draw: true, drawBg: "#000000" });
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
// 챕터 시간은 클로드가 짐작하지 않고 실제 영상 장면 시간으로 계산 (2026-10-24: 4분 영상인데 5분짜리 챕터를 지어냈음)
// 완성본(목소리·속도 적용)이 있으면 그 episode.json, 없으면 초안 기준 — 영상 공장과 같은 계산(applyPace·sceneFrames·전환 겹침)
async function realChapters(p) {
  const epFile = path.join(epDir(p), "episode.json");
  if (!fs.existsSync(epFile)) return { total: 0, chapters: [] };
  const T = await import(path.join(VIDEO, "src/timing.js"));
  const { TRANSITION_FRAMES, FPS } = await import(path.join(VIDEO, "src/theme.js"));
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
  const scenes = T.applyPace(ep.scenes, ep.pace);
  let f = 0;
  const chapters = [];
  scenes.forEach((s, i) => {
    if (s.type === "chapter") chapters.push({ sec: Math.floor(f / FPS), title: s.title || ep.chapters?.[chapters.length] || `챕터 ${chapters.length + 1}` });
    f += T.sceneFrames(s) - (i < scenes.length - 1 ? TRANSITION_FRAMES : 0);
  });
  const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  if (!chapters.length || chapters[0].sec > 0) chapters.unshift({ sec: 0, title: "들어가며" });
  return { total: Math.round(f / FPS), voiced: scenes.every((s) => s.audio), lines: chapters.map((c) => `${mmss(c.sec)} ${c.title}`), mmss };
}

// 고정 댓글 = 영상 이야기 + 운결 사주 추천 (2026-10-26 사장님: "고정댓글에 사주 한번 보라는 추천 메시지 꼭")
// 유튜브는 댓글 고정을 프로그램(API)으로 열어 두지 않음 → 사장님이 공개 후 붙여넣고 ⋮ → '고정'
async function upload(p) {
  const ch = p.format === "short" ? null : await realChapters(p);
  const r = askClaude(p, `${context(p)}
${p.episode ? `[대본]\n${p.episode.scenes.map((s) => s.narration).join(" ").slice(0, 6000)}` : ""}

유튜브 ${p.format === "short" ? "쇼츠" : ""} 업로드 문구를 써.${p.format === "short" ? " 쇼츠는 챕터 시간 없이." : ""} JSON 하나만:
{"reply": "한두 줄", "youtube": {"titles": ["제목 후보 3개, 100자 이내, 핵심 키워드 앞"], "description": "설명란 (첫 2줄에 키워드, 댓글 질문 1개, 해시태그 3개. 챕터 시간·영상 길이는 쓰지 말 것 — 프로그램이 실제 시간으로 붙임)", "tags": ["태그 10개 이내"],
  "pinned": "${PINNED_ASK}"},
 ${FORECAST_ASK}}
forecast 는 사장님만 보는 '올리기 전 예측'이다. 기획안 sell 과 실제 대본·썸네일 문구를 비교해서, 약속을 지키는지·감정이 하나인지·운결 연결이 자연스러운지 냉정하게.`);
  p.youtube = r.youtube;
  p.forecast = r.forecast || null;
  // 쇼츠: 설명란·고정 댓글의 링크는 눌리지 않아 롱폼 링크는 빼고, 고정 댓글은 사주 안내만 (사장님 2026-10-27)
  if (p.format === "short") p.youtube.description = p.youtube.description.split("\n").filter((l) => !(p.parent?.url && l.includes(p.parent.url))).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  p.youtube.pinned = withSaju(p.format === "short" ? "" : p.youtube.pinned);
  if (p.photoCredits?.length) p.youtube.description += `\n\n📷 사진 출처 (Wikimedia Commons)\n${creditLines(p.photoCredits)}`; // CC BY 사진은 출처 표기가 조건
  // 챕터: 실제 장면 시간으로 계산해 설명란에 붙인다 (유튜브 규칙: 0:00 부터, 3개 이상)
  let chNote = "";
  if (ch?.lines?.length >= 3) {
    p.youtube.description = p.youtube.description.replace(/\n*(\d+:\d{2}.*\n?)+/g, "\n").trim() + "\n\n" + ch.lines.join("\n");
    chNote = `\n챕터 시간은 실제 영상 길이(${ch.mmss(ch.total)}) 기준으로 계산해 넣었어요${ch.voiced ? "" : " — 아직 목소리를 안 입힌 초안 기준이라, 완성본을 만든 뒤 [⑤ 업로드 문구]를 한 번 더 누르면 정확해져요"}.`;
  }
  const ab = abKit(p);
  const fc = p.forecast;
  const fcText = fc ? `\n\n🔮 올리기 전 예측 (등급 ${fc.grade || "?"})\n· 누를 이유/안 누를 이유: ${fc.click}\n· 나갈 지점: ${fc.drop}\n· 운결 연결: ${fc.saju}${fc.fix?.length ? `\n· 고치면 좋을 것: ${[].concat(fc.fix).join(" / ")}` : ""}\n(숫자 예측은 안 해요 — 올린 뒤 실제 숫자로 맞춰 봐요)` : "";
  say(p, r.reply + chNote + fcText + (ab ? `\n\nA/B 테스트용 썸네일 3장·제목 3개를 바탕화면 '${path.basename(ab)}' 폴더에 넣어 뒀어요.` : ""));
}

// 유튜브 스튜디오 'A/B 테스팅'(제목·썸네일 3개 비교)용 묶음 — 유튜브가 이 기능을 프로그램(API)으로는 열어 두지 않아서,
// 사장님이 스튜디오에서 끌어다 놓기만 하면 되게 바탕화면 폴더에 썸네일 3장(jpg 1280×720)과 제목 3개(txt)를 만들어 둔다 (2026-10-24)
function abKit(p) {
  if (!p.youtube?.titles?.length) return null;
  const safe = (p.title || p.id).replace(/[\\/:*?"<>|]/g, "").slice(0, 30).trim();
  const dir = path.join(process.env.HOME, "Desktop", `AB테스트_${safe}`);
  fs.mkdirSync(dir, { recursive: true });
  const titles = p.youtube.titles.slice(0, 3);
  fs.writeFileSync(path.join(dir, "제목3개.txt"), titles.map((t, i) => `제목 ${i + 1}: ${t}`).join("\n\n") + "\n");
  if (p.youtube.pinned) fs.writeFileSync(path.join(dir, "고정댓글.txt"), p.youtube.pinned + "\n");
  for (const [i, th] of (p.format !== "short" ? p.thumbs || [] : []).slice(0, 3).entries()) {
    run(p, `A/B 썸네일 ${i + 1} 만드는 중`, "npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", path.join(ROOT, th), "-vf", "scale=1280:720", "-q:v", "3", path.join(dir, `썸네일${i + 1}.jpg`)], { cwd: VIDEO, allowFail: true });
  }
  p.abDir = dir;
  return dir;
}

// ⑦ 유튜브에 비공개로 올리기 — 사장님이 고른 제목·썸네일로. 공개는 사장님이 스튜디오에서 (매일 쇼츠와 같은 규칙)
async function publish(p) {
  if (!p.youtube) await upload(p); // 업로드 문구가 아직 없으면 먼저 쓰고 (제목은 첫 번째 후보)
  const dir = epDir(p);
  const meta = {
    title: p.youtube.titles[p.pick?.title || 0] || p.youtube.titles[0],
    description: p.youtube.description,
    tags: p.youtube.tags,
    privacy: "private",
    altered_content: Boolean(p.episode?.voice?.provider === "elevenlabs"), // 복제 목소리를 쓰면 '합성 콘텐츠: 예' (사장님 결정 2026-10-19)
  };
  const th = p.format !== "short" && p.thumbs?.[p.pick?.thumb || 0];
  if (th) {
    const small = path.join(dir, "thumb_upload.jpg"); // 유튜브 썸네일은 2MB 이하 → jpg 로
    run(p, "썸네일 줄이는 중", "npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", path.join(ROOT, th), "-vf", "scale=1280:720", "-q:v", "3", small], { cwd: VIDEO });
    meta.thumbnail = small;
  }
  if (!p.abDir) abKit(p);
  const mf = path.join(dir, "youtube.json");
  fs.writeFileSync(mf, JSON.stringify(meta, null, 2));
  const r = run(p, "📤 유튜브에 비공개로 올리는 중 (몇 분)", NODE, ["tools/youtube_upload.mjs", "upload", path.join(ROOT, p.final), mf, "--yes"], { timeout: 3600_000 });
  p.youtubeUrl = r.out.match(/https:\/\/(?:youtu\.be|www\.youtube\.com|studio\.youtube\.com)\/\S+/)?.[0] || null;
  p.stage = "올림(비공개)";
  p.youtube.pinned = withSaju(p.youtube.pinned);
  say(p, `유튜브에 비공개로 올렸어요: "${meta.title}"${p.youtubeUrl ? `\n${p.youtubeUrl}` : ""}\n\n📌 고정 댓글: 공개로 바꾼 뒤 영상 댓글 칸에 위 '고정 댓글'을 [복사]해서 달고, 댓글 옆 ⋮ → '고정'을 누르세요 (유튜브가 고정은 프로그램으로 못 하게 막아 둬서 이것만 손으로).\n\nA/B 테스트 하는 법: 스튜디오 → 이 영상 '세부정보' → 썸네일 아래 [A/B 테스팅] → '제목과 썸네일' → 바탕화면 '${path.basename(p.abDir || "")}' 폴더의 썸네일1~3을 끌어다 놓고, 제목3개.txt 에서 제목을 복사해 붙여넣기 → 공개로 바꾸면 테스트 시작.`);
}

// ⑧ 고정 댓글 달기 — 사장님이 버튼을 누를 때만 (공개된 영상에만 달림). 고정은 스튜디오에서 사장님이
async function comment(p) {
  const f = path.join(epDir(p), "pinned.txt");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, p.youtube.pinned);
  const r = run(p, "📌 고정 댓글 다는 중", NODE, ["tools/youtube_upload.mjs", "comment", p.youtubeUrl, f, "--yes"], { timeout: 120_000 });
  p.commentUrl = r.out.match(/https:\/\/www\.youtube\.com\/watch\S+/)?.[0] || null;
  say(p, `고정 댓글을 달았어요${p.commentUrl ? `: ${p.commentUrl}` : ""}\n마지막 한 가지만: 스튜디오 → 댓글 → 이 댓글 옆 ⋮ → '고정'을 눌러주세요 (유튜브가 고정은 프로그램으로 못 하게 막아 뒀어요).`);
}

const JOBS = { comment, chat, plan, thumbs, script, voice, eleven, upload, publish, next, shorts };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [step, id] = process.argv.slice(2);
  const p = getProject(id);
  try {
    if (!JOBS[step]) throw new Error(`모르는 일: ${step}`);
    if (!["voice", "eleven", "publish", "next", "comment", "shorts"].includes(step)) await readRefs(p);
    await JOBS[step](p);
    log(p, "✅ 끝");
  } catch (e) {
    say(p, `⚠ 문제가 생겼어요: ${String(e.message).slice(0, 400)}${/열쇠|만료|invalid_grant|login|권한/i.test(e.message) ? "\n(유튜브 열쇠가 7일마다 만료돼요 — 작업 창의 클로드에게 '유튜브 다시 로그인'이라고 말씀해 주세요)" : ""}`);
    log(p, `❌ ${e.message}`);
  } finally {
    p.busy = null;
    saveProject(p);
  }
}
