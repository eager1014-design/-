// 떡상 소싱의 실제 일 (보관함·유튜브 검색·제미나이 분석·코덱스 대본). 앱(server.mjs)과 매일 일꾼(tools/daily_short.mjs)이 같이 쓴다.
// 키는 프로젝트 맨 위 .env 에서만 읽는다 (YOUTUBE_API_KEY, GEMINI_API_KEY). 이 파일에 키를 적지 말 것.
// 저장: tools/viral/data/library.json (깃에 안 올라감)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, GEMINI_MODEL, gemini, watchVideo, friendlyError } from "../ai-bridge/gemini.mjs";
import { SCENES_LIST } from "../../video/scripts/scene-types.mjs";

export { ROOT, GEMINI_MODEL, friendlyError };

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(HERE, "data");
const LIB = path.join(DATA_DIR, "library.json");
export const CODEX = process.env.CODEX_BIN || path.join(os.homedir(), ".local/bin/codex");

// ---------- 보관함 ----------
export function load() {
  try { return JSON.parse(fs.readFileSync(LIB, "utf8")); } catch { return { items: {} }; }
}
export function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LIB, JSON.stringify(db, null, 2));
}
export function upsert(item) {
  const db = load();
  db.items[item.id] = { ...(db.items[item.id] || {}), ...item, updatedAt: new Date().toISOString() };
  save(db);
  return db.items[item.id];
}

// ---------- 유튜브 (무료 한도: 하루 10,000점, 검색 1번 ≈ 100점) ----------
const YT = "https://www.googleapis.com/youtube/v3";
async function yt(endpoint, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("유튜브 키가 없습니다. .env 의 YOUTUBE_API_KEY 를 넣어주세요.");
  const url = new URL(`${YT}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const reason = data?.error?.errors?.[0]?.reason || "";
  if (/quotaExceeded|dailyLimitExceeded/.test(reason)) throw new Error("오늘 유튜브 무료 한도를 다 썼습니다. 오후 4~5시쯤 다시 채워집니다 (요금 없음).");
  if (endpoint === "commentThreads" && /commentsDisabled/.test(reason)) return { items: [] };
  throw new Error(`유튜브 오류 (${res.status} ${reason}): ${data?.error?.message || res.statusText}`);
}

const seconds = (iso = "") => {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

async function ytDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") });
    for (const v of d.items || []) {
      const dur = seconds(v.contentDetails?.duration);
      out.push({
        id: `yt:${v.id}`, platform: "youtube", url: dur <= 180 ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
        title: v.snippet.title, author: v.snippet.channelTitle, publishedAt: v.snippet.publishedAt,
        thumb: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url,
        caption: v.snippet.description?.slice(0, 1500) || "",
        views: v.statistics.viewCount == null ? null : +v.statistics.viewCount,
        likes: v.statistics.likeCount == null ? null : +v.statistics.likeCount,      // 좋아요 숨긴 영상은 null
        comments: v.statistics.commentCount == null ? null : +v.statistics.commentCount,
        duration: dur,
      });
    }
  }
  return out;
}

const SINCE_DAYS = { week: 7, month: 30, quarter: 90, year: 365 };

export async function searchYoutube({ keyword, shorts = true, since = "quarter", min = {}, pages = 2 }) {
  const ids = [];
  let pageToken;
  const publishedAfter = SINCE_DAYS[since] ? new Date(Date.now() - SINCE_DAYS[since] * 864e5).toISOString() : undefined;
  for (let p = 0; p < Math.min(pages, 4); p++) {
    const d = await yt("search", {
      part: "snippet", type: "video", q: keyword, maxResults: 50, order: "viewCount",
      regionCode: "KR", relevanceLanguage: "ko", videoDuration: shorts ? "short" : undefined, publishedAfter, pageToken,
    });
    ids.push(...(d.items || []).map((x) => x.id.videoId).filter(Boolean));
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  let videos = await ytDetails([...new Set(ids)]);
  if (shorts) videos = videos.filter((v) => v.duration > 0 && v.duration <= 180);
  const checked = videos.length;
  const pass = (v) => (v.views ?? 0) >= (min.views ?? 0) && (v.likes ?? 0) >= (min.likes ?? 0) && (v.comments ?? 0) >= (min.comments ?? 0);
  const hits = videos.filter(pass).sort((a, b) => b.views - a.views);
  return { checked, hits, quotaUsed: pages * 100 + Math.ceil(ids.length / 50) };
}

async function topComments(videoId, n = 20) {
  const d = await yt("commentThreads", { part: "snippet", videoId, order: "relevance", maxResults: n, textFormat: "plainText" });
  return (d.items || []).map((c) => {
    const s = c.snippet.topLevelComment.snippet;
    return { text: s.textDisplay.slice(0, 300), likes: s.likeCount };
  });
}

// ---------- 링크 붙여넣기 (틱톡·인스타·스레드·유튜브) ----------
export function detect(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/instagram\.com/.test(url)) return "instagram";
  if (/threads\.(net|com)/.test(url)) return "threads";
  return "other";
}

export async function addLink({ url, text = "", views, likes, comments }) {
  url = String(url || "").trim();
  if (!/^https?:\/\//.test(url)) throw new Error("링크를 https:// 로 시작하게 붙여넣어 주세요.");
  const platform = detect(url);
  const num = (x) => (x === "" || x == null ? null : Number(String(x).replace(/[^\d]/g, "")));
  if (platform === "youtube") {
    const vid = url.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{11})/)?.[1];
    if (!vid) throw new Error("유튜브 영상 ID를 찾을 수 없습니다.");
    const [v] = await ytDetails([vid]);
    if (!v) throw new Error("영상을 찾을 수 없습니다 (비공개이거나 삭제됨).");
    return upsert({ ...v, text, source: "link" });
  }
  let meta = {};
  if (platform === "tiktok") {
    // 틱톡 공개 oEmbed — 제목·작성자·썸네일만 준다 (숫자는 없음)
    meta = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
  }
  const id = `${platform}:${url.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").slice(-2).join("/")}`;
  return upsert({
    id, platform, url, source: "link",
    title: meta.title || text.split("\n")[0].slice(0, 80) || url,
    author: meta.author_name || "", thumb: meta.thumbnail_url || "",
    caption: "", text, views: num(views), likes: num(likes), comments: num(comments),
  });
}

// ---------- 분석 (제미나이) ----------
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    one_line: { type: "string", description: "이 콘텐츠가 뜬 이유 한 문장" },
    hook: { type: "string", description: "첫 1~3초(또는 첫 줄)에 무엇을 보여주고 말했는지, 왜 멈추게 되는지" },
    structure: { type: "array", items: { type: "object", properties: { part: { type: "string" }, what: { type: "string" } }, required: ["part", "what"] }, description: "구간별 흐름 (예: 0-3초 훅, 3-15초 문제 제기...)" },
    why_viral: { type: "array", items: { type: "string" }, description: "떡상 요인 3~5개 (감정, 공감, 정보, 반전, 논쟁 등)" },
    comment_reaction: { type: "string", description: "댓글에서 사람들이 무엇에 반응했는지" },
    format: { type: "string", description: "편집·화면·자막·목소리·음악 등 형식 특징" },
    reusable_formula: { type: "string", description: "다른 주제에 그대로 써먹을 수 있는 공식 (빈칸 템플릿 형태)" },
    caution: { type: "string", description: "따라 할 때 주의할 점 (저작권, 과장, 그대로 베끼면 안 되는 부분)" },
    techniques: {
      type: "array", description: "따라 해볼 만한 모션그래픽·편집 기법 2~4개 (글씨 등장 방식, 전환, 확대, 효과음 타이밍, 화면 구성 등 — 내용 말고 연출만)",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "기법 이름 (짧게, 예: '단어마다 튀어나오는 큰 자막')" },
          what: { type: "string", description: "화면에서 정확히 무슨 일이 일어나는지 (몇 초에, 어떻게 움직이는지)" },
          why: { type: "string", description: "왜 효과가 있는지" },
          our_scene: { type: "string", enum: [...SCENES_LIST, "new"], description: "우리 장면 종류 중 이걸 흉내 낼 수 있는 것. 지금 장면으로 안 되면 new" },
          how_to_copy: { type: "string", description: "우리 영상에 입히는 방법 (our_scene 이 new 면 새로 만들어야 할 기능 설명)" },
        },
        required: ["name", "what", "our_scene", "how_to_copy"],
      },
    },
  },
  required: ["one_line", "hook", "structure", "why_viral", "format", "reusable_formula"],
};

function analysisPrompt(item, comments) {
  const stats = `조회수 ${item.views ?? "?"}, 좋아요 ${item.likes ?? "?"}, 댓글 ${item.comments ?? "?"}`;
  const cm = comments?.length ? `\n\n[인기 댓글]\n${comments.map((c) => `- (${c.likes}👍) ${c.text}`).join("\n")}` : "";
  const body = (item.text ? `\n\n[본문/자막]\n${item.text.slice(0, 6000)}` : "")
    + (item.request ? `\n\n[사장님이 따라 하고 싶은 연출 — 이 부분을 가장 자세히 분석하고, techniques 첫 번째에 이것을 넣어]\n${item.request}` : "");
  const cap = item.caption ? `\n\n[설명란]\n${item.caption.slice(0, 1000)}` : "";
  return `너는 숏폼·SNS 콘텐츠 분석가야. 아래 콘텐츠가 왜 떴는지 한국어로 분석해. 추측은 추측이라고 표시해.
techniques 에는 내용이 아니라 모션그래픽·편집 연출만 적어. 우리 영상 공장 장면 종류: hook(첫 문장들), statement(한 문장 강조), roadmap(순서 예고), chapter(챕터 화면), bigNumber(큰 숫자), citation(논문 카드), compare(비교), checklist(체크 목록), bars(막대 차트), story(그림/이모지 + 글), outro(마무리 질문), pillars·elements(사주 설명), dialogue(두 캐릭터 대화 말풍선). 모든 장면에 말하는 캐릭터·굵은 노란 키워드 자막·튀어나오는 등장·효과음·하단 댓글 말풍선(comments)이 이미 있다.
플랫폼: ${item.platform} / 제목: ${item.title} / 작성자: ${item.author} / ${stats}${cap}${body}${cm}`;
}

// 긴 영상은 일부만 본다 (영상 1초 ≈ 300토큰): 요청에 "1분 20초"·"1:20" 같은 시간이 있으면 그 앞 30초~뒤 60초, 아니면 앞 150초
function clipFor(item) {
  if (!item.duration || item.duration <= 180) return undefined;
  const m = (item.request || "").match(/(\d+)\s*분\s*(\d+)?\s*초?|(\d+):(\d{2})/);
  const t = m ? (m[1] ? +m[1] * 60 + (+m[2] || 0) : +m[3] * 60 + +m[4]) : null;
  return t != null ? { start: Math.max(0, t - 30), end: Math.min(item.duration, t + 60) } : { start: 0, end: 150 };
}

export async function analyze(id) {
  const item = load().items[id];
  if (!item) throw new Error("보관함에 없는 항목입니다. 먼저 저장해주세요.");
  let comments = [];
  let result;
  if (item.platform === "youtube") {
    comments = await topComments(id.slice(3)).catch(() => []);
    result = await watchVideo(item.url, analysisPrompt(item, comments), { schema: ANALYSIS_SCHEMA, clip: clipFor(item) });
  } else if (item.files?.some(isVideo)) {
    // 사장님이 올린 화면 녹화·영상 파일 → 제미나이가 직접 본다
    result = await watchVideo(path.join(ROOT, item.files.find(isVideo)), analysisPrompt(item, []), { schema: ANALYSIS_SCHEMA });
  } else {
    if (!item.text && !item.files?.length) throw new Error("틱톡·인스타·스레드는 영상을 직접 못 봅니다. 글이나 자막을 붙여넣거나, 스크린샷·화면 녹화를 올려주세요.");
    const res = await gemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [...imageParts(item.files), { text: analysisPrompt(item, []) + (item.files?.length ? "\n\n(첨부한 스크린샷은 그 영상의 장면들이다. 화면 구성·글씨·색·배치·움직임의 흔적을 보고 연출을 분석해)" : "") }] }],
      config: { responseMimeType: "application/json", responseSchema: ANALYSIS_SCHEMA },
    });
    result = { text: res.text ?? "", tokens: res.usageMetadata?.totalTokenCount ?? null };
  }
  let analysis;
  try { analysis = JSON.parse(result.text); } catch { analysis = { one_line: result.text }; }
  addTechniques(id, analysis.techniques);
  return upsert({ id, analysis, topComments: comments, analysisTokens: result.tokens });
}

// ---------- 사장님이 올린 파일 (스크린샷·화면 녹화) ----------
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".heic": "image/heic", ".gif": "image/gif" };
export const isVideo = (f) => /\.(mp4|mov|webm|m4v)$/i.test(f);
const isImage = (f) => !!IMAGE_TYPES[path.extname(f).toLowerCase()];

// 브라우저에서 받은 파일 [{ name, data(base64) }] → uploads 폴더에 저장, 프로젝트 기준 경로 목록을 돌려준다
export function saveUploads(files = []) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return files.map((f, i) => {
    const ext = path.extname(f.name || "").toLowerCase();
    // ext 는 ".png" 처럼 점으로 시작 → extname(".png") 이 "" 라 isImage 가 늘 거짓이던 버그 (2026-10-24, 사진이 하나도 안 올라갔음)
    if (!IMAGE_TYPES[ext] && !isVideo(ext) && !/^\.(mp3|m4a|wav)$/.test(ext)) throw new Error(`사진(png·jpg)·영상(mp4·mov)·녹음(mp3)만 올릴 수 있어요: ${f.name}`);
    const file = path.join(UPLOAD_DIR, `${Date.now()}-${i}${ext}`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    return path.relative(ROOT, file);
  });
}
export function imageParts(files = []) {
  return files.filter(isImage).slice(0, 8).map((f) => ({
    inlineData: { mimeType: IMAGE_TYPES[path.extname(f).toLowerCase()], data: fs.readFileSync(path.join(ROOT, f)).toString("base64") },
  }));
}

// 연출 참고 자료 추가: 링크(유튜브는 영상을 직접 봄) 또는 스크린샷·화면 녹화 → 보관함에 넣고 바로 분석 → 연출 기법에 쌓임
// request: true → 사장님의 '연출 요청' (설명한 연출을 중심으로 분석하고, 새 기능이 필요한 기법은 바로 '만들 차례'로)
export async function addReference({ url = "", files = [], note = "", request = false }) {
  const saved = saveUploads(files);
  let item;
  if (url.trim() && !saved.length) {
    item = await addLink({ url, text: request ? "" : note });
    if (request) item = upsert({ id: item.id, request: note, source: "request" });
  } else if (saved.length) {
    const id = `ref:${Date.now()}`;
    item = upsert({
      id, platform: url ? detect(url) : "screenshot", url: url || "", source: request ? "request" : "reference", files: saved,
      text: request ? "" : note, request: request ? note : undefined,
      title: note.split("\n")[0].slice(0, 60) || `참고 자료 ${new Date().toLocaleDateString("ko-KR")}`,
      thumb: saved.find(isImage) ? `/upload?p=${encodeURIComponent(saved.find(isImage))}` : "",
    });
  } else throw new Error("링크를 붙여넣거나 스크린샷·화면 녹화를 올려주세요.");
  const done = await analyze(item.id);
  if (request) {
    const db = load();
    for (const t of Object.values(db.techniques || {})) if (t.from === item.id && t.status === "candidate") t.status = "liked";
    save(db);
  }
  return done;
}

// 일기에 붙은 사진 → 제미나이가 글로 옮겨 둔다 (대본 쓰는 클로드는 그림을 못 보므로)
async function describeImages(files) {
  const parts = imageParts(files);
  if (!parts.length) return "";
  const res = await gemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [...parts, { text: "사장님이 일기에 붙인 사진·캡처다. 무엇이 보이는지(대화 내용이면 누가 무슨 말을 했는지) 한국어로 사실만 자세히 옮겨 적어. 추측은 하지 마." }] }],
  });
  return res.text ?? "";
}

// ---------- 연출 기법 모음 ----------
// status: auto(지금 장면으로 됨 → 매일 영상에 자동으로 씀) / candidate(새 기능 필요) / liked(사장님 👍 → 클로드가 만들 차례) / skip(안 씀)
function addTechniques(fromId, list = []) {
  if (!list?.length) return;
  const db = load();
  db.techniques ||= {};
  for (const t of list) {
    const key = `${fromId}#${t.name}`;
    if (db.techniques[key]) continue;
    db.techniques[key] = { ...t, id: key, from: fromId, status: t.our_scene === "new" ? "candidate" : "auto", at: new Date().toISOString() };
  }
  save(db);
}
export function saveSettings(patch) {
  const db = load();
  db.settings = { ...(db.settings || {}), ...patch };
  save(db);
  return db.settings;
}
export function setTechnique(id, status) {
  const db = load();
  if (!db.techniques?.[id]) throw new Error("없는 기법입니다.");
  db.techniques[id].status = status;
  save(db);
  return db.techniques[id];
}

// ---------- 일기장 (사장님 이야기 → 매일 쇼츠 아이디어) ----------
export async function addDiary(text, files = [], links = "") {
  text = String(text || "").trim();
  if (!text && !files.length) throw new Error("일기 내용을 써주세요.");
  const saved = saveUploads(files);
  const photoNote = saved.length ? await describeImages(saved).catch((e) => `(사진 읽기 실패: ${friendlyError(e)})`) : "";
  const db = load();
  db.diary ||= [];
  const entry = { id: `d${Date.now()}`, text, files: saved, photoNote, links: String(links || "").trim(), at: new Date().toISOString(), usedIn: [] };
  db.diary.push(entry);
  save(db);
  return entry;
}
export function deleteDiary(id) {
  const db = load();
  db.diary = (db.diary || []).filter((d) => d.id !== id);
  save(db);
}

// ---------- 대본 (챗GPT 구독 = 코덱스, 추가 비용 0) ----------
export function codex(prompt) {
  if (!fs.existsSync(CODEX)) throw new Error("코덱스(챗GPT 구독 프로그램)가 이 맥북에 없습니다: " + CODEX);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "viral-"));
  const out = path.join(tmp, "answer.txt");
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o", out];
  if (process.env.CODEX_MODEL) args.push("-m", process.env.CODEX_MODEL);
  return new Promise((resolve, reject) => {
    const p = spawn(CODEX, [...args, "-"], { cwd: tmp });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill(), 240_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      const text = fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "";
      fs.rmSync(tmp, { recursive: true, force: true });
      if (text) resolve(text);
      else if (/login|auth|401/i.test(err)) reject(new Error("코덱스 로그인이 풀렸습니다. 터미널에서 'codex login' 을 한 번 해주세요."));
      else if (/usage limit|rate limit/i.test(err)) reject(new Error("챗GPT 구독 사용 한도에 걸렸습니다. 잠시 뒤 다시 해주세요."));
      else reject(new Error(`코덱스가 답을 못 했습니다 (종료 ${code}): ${err.slice(-300)}`));
    });
    p.stdin.end(prompt);
  });
}

function scriptPrompt(item, { topic, length = "60", tone = "" }) {
  const a = item.analysis || {};
  return `너는 한국 숏폼(쇼츠·릴스·틱톡) 대본 작가야. 아래 '떡상 콘텐츠 분석'의 공식만 빌려서, 완전히 새로운 대본을 써.
원본의 문장·사례·고유한 아이디어를 그대로 베끼지 마 (저작권). 구조·리듬·훅 방식만 참고해.
없는 통계·가짜 후기·가짜 경험담을 사실처럼 쓰지 마. 숫자가 필요하면 "(확인 필요)"라고 표시해.

[원본 정보] ${item.platform} / ${item.title} / 조회수 ${item.views ?? "?"} 좋아요 ${item.likes ?? "?"} 댓글 ${item.comments ?? "?"}
[떡상 분석]
${JSON.stringify(a, null, 2)}

[내가 만들 주제] ${topic || "원본과 같은 분야에서 겹치지 않는 새 각도로"}
[길이] 약 ${length}초
${tone ? `[말투·분위기] ${tone}\n` : ""}
아래 형식 그대로, 마크다운으로만 답해:

## 제목 후보
1. / 2. / 3.

## 첫 3초 훅
(화면에 뜨는 큰 글씨 + 첫 마디)

## 대본
| 시간 | 화면 | 내레이션 | 자막 |
(3~5초 단위로)

## 마무리 한마디 (댓글 유도)

## 설명란 / 해시태그

## 원본에서 빌린 공식
(한두 줄)`;
}

export async function writeScript(id, opts) {
  const item = load().items[id];
  if (!item) throw new Error("보관함에 없는 항목입니다.");
  if (!item.analysis) throw new Error("먼저 '분석'을 해주세요. 분석을 바탕으로 대본을 씁니다.");
  const text = await codex(scriptPrompt(item, opts));
  const scripts = [...(item.scripts || []), { topic: opts.topic || "", length: opts.length, text, at: new Date().toISOString() }];
  return upsert({ id, scripts });
}

