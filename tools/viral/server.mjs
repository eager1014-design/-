// 떡상 소싱 앱 — 인기 콘텐츠를 찾고(유튜브 자동, 틱톡·인스타·스레드는 링크 붙여넣기),
// 제미나이로 왜 떴는지 분석하고, 챗GPT 구독(코덱스)으로 새 대본을 쓴다. 맥북에서만 돈다.
//
// 실행: node tools/viral/server.mjs   (또는 tools/viral_start.command 더블클릭) → http://localhost:4600
// 실제 일은 core.mjs, 매일 쇼츠는 tools/daily_short.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { HERE, DATA_DIR, CODEX, ROOT, GEMINI_MODEL, friendlyError, load, save, upsert, searchYoutube, addLink, analyze, writeScript,
  setTechnique, addDiary, deleteDiary, addReference, saveSettings, UPLOAD_DIR } from "./core.mjs";

import { readNeeds, updateNeed, NEED_STATUSES } from "../needs_form.mjs";
import { listIdeas, verifyIdea, setIdea, deleteIdea } from "./ideas.mjs";
import { listProjects, getProject, createProject, postMessage, deleteProject } from "./longform.mjs";

const PORT = Number(process.env.VIRAL_PORT || 4600);

// ---------- 폰에서 볼 때 비밀번호 ----------
// 맥북 안(localhost)에서는 그냥 열리고, 폰(같은 와이파이·터널)에서는 .env 의 VIRAL_PASSWORD 로 한 번 로그인 → 90일 쿠키.
// 일기·크레딧·업로드 버튼이 있으므로 비밀번호가 없으면 폰 접속 자체를 막는다.
const PASSWORD = (process.env.VIRAL_PASSWORD || "").trim();
const TOKEN = PASSWORD && crypto.createHmac("sha256", PASSWORD).update("viral-app").digest("hex");
let fails = []; // 비밀번호 틀린 시각들
const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) && !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"];
const authed = (req) => isLocal(req) || (TOKEN && (req.headers.cookie || "").split(/;\s*/).includes(`viral_auth=${TOKEN}`));
const LOGIN_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>떡상 소싱</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;font:16px -apple-system,sans-serif}form{background:#fff;padding:28px;border-radius:16px;width:min(320px,90vw);box-shadow:0 4px 20px #0001}
input,button{width:100%;box-sizing:border-box;font:inherit;padding:12px;border-radius:10px;border:1px solid #ddd;margin-top:10px}button{background:#e5484d;color:#fff;border:0;font-weight:600}</style></head>
<body><form method="post" action="/login"><b>🔥 떡상 소싱</b><input type="password" name="pw" placeholder="비밀번호" autofocus><button>들어가기</button></form></body></html>`;
const DAILY_DIR = path.join(DATA_DIR, "daily");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dailyList() {
  if (!fs.existsSync(DAILY_DIR)) return [];
  return fs.readdirSync(DAILY_DIR).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 30)
    .map((f) => JSON.parse(fs.readFileSync(path.join(DAILY_DIR, f), "utf8")));
}

// 매일 쇼츠 일꾼을 뒤에서 돌린다 (몇 분 걸림). 화면은 상태 파일을 다시 읽어서 진행 상황을 본다.
function startDaily(cmd, date, extra = []) {
  if (!DATE.test(date || "")) throw new Error("날짜가 이상합니다.");
  const p = spawn(process.execPath, [path.join(ROOT, "tools/daily_short.mjs"), cmd, ...(cmd === "run" ? [`--date=${date}`] : [date]), ...extra],
    { cwd: ROOT, detached: true, stdio: ["ignore", fs.openSync(path.join(ROOT, ".tmp/daily_short.out"), "a"), fs.openSync(path.join(ROOT, ".tmp/daily_short.out"), "a")] });
  p.unref();
  return { ok: true };
}

// video/out 안의 mp4 를 브라우저에서 재생 (앞뒤로 넘기기 되게 Range 지원)
function sendVideo(req, res, rel) {
  const file = path.resolve(ROOT, rel || "");
  if (!file.startsWith(path.join(ROOT, "video/out") + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (!m) { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": size, "Accept-Ranges": "bytes" }); return fs.createReadStream(file).pipe(res); }
  const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
  res.writeHead(206, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
  fs.createReadStream(file, { start, end }).pipe(res);
}

// ---------- 웹 서버 ----------
const routes = {
  "GET /api/library": async () => Object.values(load().items).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
  "GET /api/status": async () => ({
    youtube: !!process.env.YOUTUBE_API_KEY, gemini: !!process.env.GEMINI_API_KEY, geminiModel: GEMINI_MODEL, codex: fs.existsSync(CODEX),
  }),
  "POST /api/search": async (b) => {
    if (!b.keyword?.trim()) throw new Error("키워드를 넣어주세요.");
    return searchYoutube({ ...b, keyword: b.keyword.trim() });
  },
  "POST /api/save": async (b) => upsert({ ...b.item, source: "search" }),
  "POST /api/link": async (b) => addLink(b),
  "POST /api/analyze": async (b) => analyze(b.id),
  "POST /api/script": async (b) => writeScript(b.id, b),
  "POST /api/delete": async (b) => { const db = load(); delete db.items[b.id]; save(db); return { ok: true }; },
  // 일기장
  "GET /api/diary": async () => (load().diary || []).slice().reverse(),
  "POST /api/diary": async (b) => addDiary(b.text, b.files, b.links),
  "POST /api/reference": async (b) => addReference(b),
  "GET /api/settings": async () => load().settings || {},
  // 오늘 주제: 적어두면 다음 새벽 5시에 그 주제로. now=true 면 오늘 영상을 바로 그 주제로 (다시) 만든다
  "POST /api/topic": async (b) => {
    const text = String(b.text || "").trim().slice(0, 1000);
    if (!b.now) return saveSettings({ topic: text });
    if (!text) throw new Error("주제를 적어주세요.");
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    if (fs.existsSync(path.join(DAILY_DIR, `${today}.json`))) {
      saveSettings({ topic: "" });
      return startDaily("redo", today, ["사장님이 정한 주제로 새로 기획", `--topic=${text}`]);
    }
    saveSettings({ topic: text });
    return startDaily("run", today);
  },
  "POST /api/settings": async (b) => saveSettings({
    ...(b.look !== undefined ? { look: ["title", "full", "one", "circle", "band"].includes(b.look) ? b.look : "title" } : {}),
    ...(b.skin !== undefined ? { skin: ["cute", "chalk"].includes(b.skin) ? b.skin : "" } : {}), // 글씨·색: "" 기본 | cute 귀여운 | chalk 칠판(진한 파랑+네온+움직이는 소품)
  }),
  "POST /api/diary/delete": async (b) => { deleteDiary(b.id); return { ok: true }; },
  // 연출 기법
  "GET /api/techniques": async () => Object.values(load().techniques || {}).sort((a, b) => (b.at || "").localeCompare(a.at || "")),
  "POST /api/technique": async (b) => setTechnique(b.id, b.status),
  // 고객 고충 (포트폴리오 → 구글 폼 → 시트 "가게 사장님 고충 모음")
  "GET /api/needs": async () => ({ items: (await readNeeds()).reverse(), statuses: NEED_STATUSES,
    sheet: process.env.NEEDS_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.NEEDS_SHEET_ID}` : "" }),
  "POST /api/needs/update": async (b) => updateNeed(Number(b.row), { status: b.status, memo: b.memo }),
  // 아이디어 검증 (링크 → 주장·과장·판정 → 2시간 실험 1개)
  "GET /api/ideas": async () => listIdeas(),
  "POST /api/ideas/verify": async (b) => verifyIdea(b),
  "POST /api/ideas/update": async (b) => setIdea(b.id, b),
  "POST /api/ideas/delete": async (b) => { deleteIdea(b.id); return { ok: true }; },
  // 롱폼 (대화하며 기획 → 썸네일 → 대본·초안 → 사장님 녹음 → 완성 → 업로드 문구). 오래 걸리는 일은 longform.mjs 가 따로 떠서 함
  "GET /api/longform": async () => listProjects(),
  "POST /api/longform/new": async (b) => {
    const p = createProject(b);
    return (b.brief || b.links || b.files?.length) ? postMessage(p.id, { text: b.brief, links: b.links, files: b.files, step: "chat" }) : p;
  },
  "POST /api/longform/get": async (b) => getProject(b.id),
  "POST /api/longform/send": async (b) => postMessage(b.id, b),
  "POST /api/longform/delete": async (b) => { deleteProject(b.id); return { ok: true }; },
  // 매일 쇼츠
  "GET /api/daily": async () => dailyList(),
  "POST /api/daily/run": async (b) => startDaily("run", b.date),
  "POST /api/daily/redo": async (b) => startDaily("redo", b.date, [String(b.feedback || "더 좋게 다시 써줘").slice(0, 2000), ...(b.ref ? [`--ref=${b.ref}`] : [])]),
  "POST /api/daily/voice": async (b) => startDaily("voice", b.date),
  "POST /api/daily/upload": async (b) => startDaily("upload", b.date),
  "POST /api/daily/comment": async (b) => startDaily("comment", b.date),
};

http.createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": `${type}; charset=utf-8` });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };
  if (!authed(req)) {
    if (req.method === "POST" && req.url === "/login") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const pw = new URLSearchParams(raw).get("pw") || "";
      // 인터넷(터널)으로 열려 있으므로: 15분 동안 5번 틀리면 그 15분은 누구도 로그인 못 함 (6자리 비밀번호 무작위 대입 막기)
      fails = fails.filter((t) => Date.now() - t < 15 * 60e3);
      if (fails.length >= 5) return send(429, "비밀번호를 여러 번 틀려서 15분 동안 잠겼습니다. 잠시 뒤 다시 해주세요.", "text/html");
      if (TOKEN && pw.length === PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(PASSWORD))) {
        res.writeHead(302, { "Set-Cookie": `viral_auth=${TOKEN}; Max-Age=7776000; Path=/; HttpOnly; SameSite=Lax${req.headers["cf-connecting-ip"] ? "; Secure" : ""}`, Location: "/" });
        return res.end();
      }
      fails.push(Date.now());
      console.error(`⚠️ 비밀번호 틀림 (${req.headers["cf-connecting-ip"] || req.socket.remoteAddress}) — 15분 안에 ${fails.length}번째`);
      await new Promise((r) => setTimeout(r, 1500)); // 비밀번호 마구 넣어보기 늦추기
    }
    if (req.url.startsWith("/api/")) return send(401, { error: "로그인이 필요합니다. 새로고침해주세요." });
    return send(PASSWORD ? 200 : 403, PASSWORD ? LOGIN_PAGE : "폰 접속은 .env 에 VIRAL_PASSWORD 를 정해야 열립니다.", "text/html");
  }
  if (req.method === "GET" && req.url.startsWith("/video?")) return sendVideo(req, res, new URL(req.url, "http://x").searchParams.get("p"));
  if (req.method === "GET" && req.url.startsWith("/upload?")) {
    const file = path.resolve(ROOT, new URL(req.url, "http://x").searchParams.get("p") || "");
    if (!file.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(file)) return send(404, { error: "없는 파일" });
    res.writeHead(200, { "Content-Type": { ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime" }[path.extname(file).toLowerCase()] || "image/jpeg" });
    return fs.createReadStream(file).pipe(res);
  }
  const route = routes[`${req.method} ${req.url.split("?")[0]}`];
  if (!route) {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) return send(200, fs.readFileSync(path.join(HERE, "index.html"), "utf8"), "text/html");
    return send(404, { error: "없는 주소" });
  }
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    send(200, await route(raw ? JSON.parse(raw) : {}));
  } catch (e) {
    const m = /GEMINI|제미나이|quota|RESOURCE_EXHAUSTED|429|503/i.test(String(e?.message)) ? friendlyError(e) : e.message;
    console.error("❌", m);
    send(400, { error: m });
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ 떡상 소싱 앱이 켜졌습니다 → http://localhost:${PORT}\n   (끄려면 이 창에서 Ctrl+C)\n   프로젝트 폴더: ${ROOT}`);
});
