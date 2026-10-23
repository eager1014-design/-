// 가게 사장님 고충 듣기 Tool — 구글 시트 "가게 사장님 고충 모음" + 누구나 적는 웹 폼(Apps Script).
// 구글 로그인은 지출 관리와 같은 열쇠(token_finance.json)를 쓴다. 이 파일에 비밀을 적지 말 것.
//
// 사용법:
//   node tools/needs_form.mjs deploy    (처음엔 시트·폼을 만들고, 다음부터는 tools/needs_form/ 고친 것을 같은 주소로 다시 올림)
//   node tools/needs_form.mjs list      (들어온 고충 최근 20건 보기)
// 관리 화면: 떡상 소싱 앱(tools/viral) '고객 고충' 탭이 아래 readNeeds / updateNeed 를 가져다 쓴다
// 주소·ID 는 .env 의 NEEDS_SHEET_ID / NEEDS_SCRIPT_ID / NEEDS_DEPLOYMENT_ID / NEEDS_FORM_URL 에 자동으로 적힌다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const CRED = path.join(ROOT, "credentials.json");
const TOKEN = path.join(ROOT, "token_finance.json");
const APP_DIR = path.join(ROOT, "tools", "needs_form");
const SCRIPT = "https://script.googleapis.com/v1/projects";
// 명령줄에서 돌 때만 바로 끝내고, 앱에서 불러 쓸 때는 오류로 던진다
const IS_CLI = process.argv[1] === fileURLToPath(import.meta.url);
const die = (m) => { if (!IS_CLI) throw new Error(m); console.error(`\n✖ ${m}\n`); process.exit(1); };

function envGet(k) { return process.env[k] || ""; }
function envSet(k, v) {
  let t = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  t = new RegExp(`^${k}=.*$`, "m").test(t) ? t.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${t.replace(/\n?$/, "\n")}${k}=${v}\n`;
  fs.writeFileSync(ENV_PATH, t);
  process.env[k] = v;
}

let cached;
async function accessToken() {
  if (cached) return cached;
  if (!fs.existsSync(TOKEN)) die("구글 로그인이 안 돼 있습니다. `node tools/finance.mjs login` 을 한 번 해주세요.");
  const c = JSON.parse(fs.readFileSync(CRED, "utf8"));
  const { client_id, client_secret } = c.installed || c.web;
  const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN, "utf8"));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!r.ok) die(`구글 열쇠가 만료됐습니다 (7일마다). \`node tools/finance.mjs login\` 으로 다시 로그인해주세요. (${j.error})`);
  return (cached = j.access_token);
}
async function api(url, { method = "GET", body } = {}) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    const t = await r.text();
    const link = t.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"]+/)?.[0];
    if (link) die(`구글 클라우드에서 이 기능이 꺼져 있습니다. 아래 주소에서 '사용'을 누르고 1~2분 뒤 다시 실행하세요.\n${link}`);
    throw new Error(`구글 요청 실패 (${r.status}): ${t.slice(0, 300)}`);
  }
  return r.json();
}

async function deploy() {
  let sheetId = envGet("NEEDS_SHEET_ID");
  if (!sheetId) {
    const s = await api("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", body: { properties: { title: "가게 사장님 고충 모음", locale: "ko_KR", timeZone: "Asia/Seoul" }, sheets: [{ properties: { title: "고충", gridProperties: { frozenRowCount: 1 } } }] } });
    sheetId = s.spreadsheetId;
    envSet("NEEDS_SHEET_ID", sheetId);
    console.log(`📄 시트를 만들었습니다: https://docs.google.com/spreadsheets/d/${sheetId}`);
  }
  const files = [
    { name: "appsscript", type: "JSON", source: fs.readFileSync(path.join(APP_DIR, "appsscript.json"), "utf8") },
    { name: "Code", type: "SERVER_JS", source: fs.readFileSync(path.join(APP_DIR, "Code.gs"), "utf8") },
    { name: "Config", type: "SERVER_JS", source: `const CONFIG = ${JSON.stringify({ sheetId })};\n` },
    { name: "index", type: "HTML", source: fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8") },
  ];
  let scriptId = envGet("NEEDS_SCRIPT_ID");
  if (!scriptId) {
    scriptId = (await api(SCRIPT, { method: "POST", body: { title: "가게 고충 듣기" } })).scriptId;
    envSet("NEEDS_SCRIPT_ID", scriptId);
  }
  await api(`${SCRIPT}/${scriptId}/content`, { method: "PUT", body: { files } });
  const { versionNumber } = await api(`${SCRIPT}/${scriptId}/versions`, { method: "POST", body: { description: new Date().toISOString() } });
  const deploymentConfig = { versionNumber, manifestFileName: "appsscript", description: "가게 고충 듣기" };
  let depId = envGet("NEEDS_DEPLOYMENT_ID");
  const dep = depId
    ? await api(`${SCRIPT}/${scriptId}/deployments/${depId}`, { method: "PUT", body: { deploymentConfig } })
    : await api(`${SCRIPT}/${scriptId}/deployments`, { method: "POST", body: deploymentConfig });
  if (!depId) envSet("NEEDS_DEPLOYMENT_ID", (depId = dep.deploymentId));
  const url = dep.entryPoints?.find((e) => e.entryPointType === "WEB_APP")?.webApp?.url;
  if (url) envSet("NEEDS_FORM_URL", url);
  console.log(`\n✅ 고충 폼을 올렸습니다 (버전 ${versionNumber}).\n폼 주소: ${url}\n시트: https://docs.google.com/spreadsheets/d/${sheetId}\n편집기(처음 한 번 권한 허락): https://script.google.com/d/${scriptId}/edit\n`);
}

async function list() {
  const id = envGet("NEEDS_SHEET_ID") || die("아직 시트가 없습니다. 먼저 deploy");
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:K1000`);
  const rows = (v.values || []).slice(1);
  console.log(`\n들어온 고충 ${rows.length}건 (최근 20건)\n`);
  for (const r of rows.slice(-20).reverse()) console.log(`- ${r[0]} [${r[1] || "?"}] ${r[2] || ""}${r[3] ? ` — ${r[3].slice(0, 80)}` : ""} (${r[4] || "?"}, ${r[5] || "?"})`);
}

// ── 관리 화면용 ──
export const NEED_STATUSES = ["새로 들어옴", "연락함", "미팅 잡음", "만드는 중", "완료", "보류"];
const COLS = ["at", "industry", "tasks", "detail", "hours", "budget", "shop", "contact", "consent", "status", "memo"];

// 시트의 모든 고충 (row = 시트 줄 번호, 2부터)
export async function readNeeds() {
  const id = envGet("NEEDS_SHEET_ID") || die("아직 고충 시트가 없습니다 (needs_form.mjs deploy).");
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:K2000`);
  return (v.values || []).slice(1).map((r, i) => ({ row: i + 2, ...Object.fromEntries(COLS.map((c, j) => [c, r[j] || ""])) }));
}

// 처리 상태·메모 고치기 (J·K 칸만)
export async function updateNeed(row, { status, memo }) {
  const id = envGet("NEEDS_SHEET_ID");
  if (!Number.isInteger(row) || row < 2) throw new Error("줄 번호가 이상합니다.");
  if (!NEED_STATUSES.includes(status)) throw new Error("모르는 처리 상태입니다.");
  const clean = String(memo || "").replace(/^[=+\-@]/, "'$&").slice(0, 2000);
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/J${row}:K${row}?valueInputOption=RAW`, { method: "PUT", body: { values: [[status, clean]] } });
  return { row, status, memo: clean };
}

if (IS_CLI) {
  const cmd = process.argv[2];
  const run = { deploy, list }[cmd];
  if (!run) die("사용법: node tools/needs_form.mjs deploy | list");
  run().catch((e) => die(e.message));
}
