// 사업 지출 관리 Tool — 지메일 영수증 + 결제 스샷을 읽어서 구글 시트 "사업 지출 관리"에 정리한다.
// 읽기는 제미나이(.env 의 GEMINI_API_KEY), 저장은 구글 시트. 이 파일에 비밀을 적지 말 것.
// 인증: 맨 위 폴더 credentials.json(유튜브와 같은 OAuth 클라이언트) → 로그인하면 token_finance.json 생성(.gitignore 처리).
// 시트·스샷 폴더 주소는 .env 의 FINANCE_SHEET_ID / FINANCE_SHOTS_FOLDER_ID 에 자동으로 적힌다.
//
// 사용법:
//   node tools/finance.mjs login                  (처음 한 번 — 브라우저에서 사장님이 허락)
//   node tools/finance.mjs setup                  (시트 + 드라이브 "지출_스샷" 폴더 만들기, 이미 있으면 주소만 보여줌)
//   node tools/finance.mjs scan [--months 12]     (지메일에서 영수증 몇 통인지만 보여줌 — 무료)
//   node tools/finance.mjs scan [--months 12] --yes   (제미나이로 읽어서 시트에 추가 — 유료, 아주 적음)
//   node tools/finance.mjs scan --since 2026-09-01 [--yes] (개월 대신 이 날짜부터)
//   node tools/finance.mjs shots                  (스샷 폴더에 새 사진 몇 장인지만 보여줌 — 무료)
//   node tools/finance.mjs shots --yes            (새 스샷을 읽어서 시트에 추가 — 유료)
//   node tools/finance.mjs summary                (시트 내용을 업체별·월별로 요약해서 출력 — 무료)
//   node tools/finance.mjs app                    (폰 앱 tools/finance_app/ 을 올리거나 고친 것 다시 올리기 — 주소는 그대로)
// 같은 메일·같은 스샷은 "원본ID" 칸으로 걸러서 두 번 들어가지 않는다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { gemini, GEMINI_MODEL, friendlyError, ROOT } from "./ai-bridge/gemini.mjs";

const CRED = path.join(ROOT, "credentials.json");
const TOKEN = path.join(ROOT, "token_finance.json");
const ENV_PATH = path.join(ROOT, ".env");
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",   // 영수증 메일 읽기만
  "https://www.googleapis.com/auth/spreadsheets",      // 시트 쓰기
  "https://www.googleapis.com/auth/drive.file",        // 시트·폴더 만들기
  "https://www.googleapis.com/auth/drive.readonly",    // 사장님이 올린 스샷 읽기
  "https://www.googleapis.com/auth/script.projects",   // 폰 앱(Apps Script) 올리기
  "https://www.googleapis.com/auth/script.deployments",
].join(" ");

const CATEGORIES = ["AI 구독", "소프트웨어·구독", "광고·마케팅", "서버·도메인", "장비", "교육·자료", "차량·교통", "통신비", "기타 사업비"];
const HEAD = ["날짜", "업체", "내용", "분류", "금액", "통화", "원화(대략)", "정기결제", "출처", "원본ID", "메모"];
const FIXED_HEAD = ["이름", "분류", "금액", "통화", "월 원화(대략)", "주기", "최근 결제일", "상태", "메모"];
const SHEET_TITLE = "사업 지출 관리";
const MAIL_QUERY = [
  "receipt", "invoice", "영수증", "결제", "청구", "구독", "subscription", "\"payment\"", "\"your order\"",
  "from:anthropic.com", "from:openai.com", "from:elevenlabs.io", "from:payments-noreply@google.com", "from:no_reply@email.apple.com", "SK텔레콤", "SKT", "\"T world\"", "SK브로드밴드",
].join(" OR ");
// 제미나이 플래시 요금 어림값(1백만 토큰당 약 0.5달러). 미리보기용.
const USD_PER_MTOK = 0.5;

const die = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

// ───────── 구글 로그인 (tools/youtube_upload.mjs 와 같은 방식) ─────────
function client() {
  if (!fs.existsSync(CRED)) die("credentials.json 이 없습니다. 구글 클라우드에서 OAuth 클라이언트(데스크톱 앱)를 만들어 맨 위 폴더에 넣어주세요.");
  const c = JSON.parse(fs.readFileSync(CRED, "utf8"));
  return c.installed || c.web;
}

async function tokenRequest(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok) throw new Error(`구글 로그인 실패: ${j.error_description || j.error}`);
  return j;
}

async function login() {
  const { client_id, client_secret } = client();
  const got = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      const c = u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(c ? "<h2>연결 완료! 이 창은 닫으셔도 됩니다.</h2>" : `<h2>연결 실패: ${u.searchParams.get("error")}</h2>`);
      srv.close();
      c ? resolve({ c, port: srv.port }) : reject(new Error(`허락이 안 됐습니다: ${u.searchParams.get("error")}`));
    });
    srv.listen(0, "127.0.0.1", () => {
      srv.port = srv.address().port;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id, redirect_uri: `http://127.0.0.1:${srv.port}`, response_type: "code",
        scope: SCOPES, access_type: "offline", prompt: "consent",
      });
      console.log(`\n브라우저에서 구글 계정을 고르고 '허용'을 눌러주세요. (체크박스가 있으면 전부 체크)\n(창이 안 뜨면 이 주소를 여세요)\n${auth}\n`);
      spawn("open", [auth.toString()], { stdio: "ignore" }).on("error", () => {});
    });
  });
  const t = await tokenRequest({
    code: got.c, client_id, client_secret, redirect_uri: `http://127.0.0.1:${got.port}`, grant_type: "authorization_code",
  });
  if (!t.refresh_token) die("오래 쓰는 열쇠(refresh_token)를 못 받았습니다. 다시 login 해주세요.");
  const missing = SCOPES.split(" ").filter((s) => !t.scope?.includes(s));
  if (missing.length) die(`허락 화면에서 빠진 항목이 있습니다: ${missing.join(", ")} — 다시 login 해서 전부 체크해주세요.`);
  fs.writeFileSync(TOKEN, JSON.stringify({ refresh_token: t.refresh_token }, null, 2), { mode: 0o600 });
  console.log("로그인 완료. 다음: node tools/finance.mjs setup");
}

let cachedToken;
async function accessToken() {
  if (cachedToken) return cachedToken;
  if (!fs.existsSync(TOKEN)) die("아직 로그인 안 됨. 터미널에서 `node tools/finance.mjs login` 을 한 번 실행해주세요.");
  const { client_id, client_secret } = client();
  const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN, "utf8"));
  try {
    cachedToken = (await tokenRequest({ client_id, client_secret, refresh_token, grant_type: "refresh_token" })).access_token;
    return cachedToken;
  } catch (e) {
    // 구글 "테스트" 상태 앱은 7일마다 열쇠가 만료된다
    die(`${e.message} — 열쇠가 만료됐습니다. \`node tools/finance.mjs login\` 으로 다시 로그인해주세요.`);
  }
}

async function api(url, { method = "GET", body, raw } = {}) {
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    // 구글 클라우드에서 해당 API를 안 켰을 때: 켜는 주소를 그대로 보여준다
    const link = t.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"]+/)?.[0];
    if (link) die(`구글 클라우드에서 이 기능이 꺼져 있습니다. 아래 주소에서 '사용' 버튼을 누르고 1~2분 뒤 다시 실행하세요.\n${link}`);
    throw new Error(`구글 요청 실패 (${r.status}): ${t.slice(0, 300)}`);
  }
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

// ───────── .env 에 시트·폴더 주소 기억 ─────────
function envGet(k) {
  if (!fs.existsSync(ENV_PATH)) return "";
  return fs.readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() || "";
}
function envSet(k, v) {
  let t = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  if (new RegExp(`^${k}=`, "m").test(t)) t = t.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
  else {
    if (t && !t.endsWith("\n")) t += "\n";
    if (!t.includes("# 사업 지출 관리")) t += "\n# 사업 지출 관리 (tools/finance.mjs) — 비밀 아님, 시트·폴더 주소 기억용\n";
    t += `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, t);
}

// ───────── 시트 만들기 ─────────
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
async function setup() {
  let sheetId = envGet("FINANCE_SHEET_ID");
  if (!sheetId) {
    const s = await api(SHEETS, {
      method: "POST",
      body: {
        properties: { title: SHEET_TITLE, locale: "ko_KR", timeZone: "Asia/Seoul" },
        sheets: [
          { properties: { title: "월별요약", index: 0 } },
          { properties: { title: "지출내역", index: 1, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: "고정지출", index: 2, gridProperties: { frozenRowCount: 1 } } },
        ],
      },
    });
    sheetId = s.spreadsheetId;
    await api(`${SHEETS}/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: {
        valueInputOption: "USER_ENTERED",
        data: [
          { range: "지출내역!A1", values: [HEAD] },
          { range: "고정지출!A1", values: [FIXED_HEAD] },
          { range: "월별요약!A1", values: [
            ["월별 · 분류별 합계 (원화, 대략)"],
            [`=IFERROR(QUERY({ARRAYFORMULA(IF(지출내역!A2:A="",,TEXT(지출내역!A2:A,"yyyy-mm"))),지출내역!D2:D,지출내역!G2:G},"select Col1, sum(Col3) where Col1 is not null group by Col1 pivot Col2 order by Col1 desc",0),"아직 내역 없음")`],
          ] },
          { range: "월별요약!L1", values: [
            ["AI 구독 · 업체별 합계"],
            [`=IFERROR(QUERY(지출내역!A2:G,"select B, sum(G), count(B), max(A) where D='AI 구독' group by B order by sum(G) desc label sum(G) '원화 합계', count(B) '결제 횟수', max(A) '최근 결제'",0),"아직 내역 없음")`],
          ] },
          { range: "월별요약!L20", values: [
            ["지금 매달 나가는 고정지출 (원화, 대략)"],
            [`=SUMIFS(고정지출!E2:E,고정지출!H2:H,"사용중")`],
          ] },
        ],
      },
    });
    envSet("FINANCE_SHEET_ID", sheetId);
    console.log("시트를 만들었습니다.");
  }
  await ensureRates(sheetId);
  await formatSheet(sheetId); // 분류 목록이 바뀌면 시트의 고르기 칸도 같이 바뀐다
  let folderId = envGet("FINANCE_SHOTS_FOLDER_ID");
  if (!folderId) {
    const f = await api("https://www.googleapis.com/drive/v3/files", {
      method: "POST", body: { name: "지출_스샷", mimeType: "application/vnd.google-apps.folder" },
    });
    folderId = f.id;
    envSet("FINANCE_SHOTS_FOLDER_ID", folderId);
    console.log("드라이브에 '지출_스샷' 폴더를 만들었습니다.");
  }
  console.log(`\n시트:  https://docs.google.com/spreadsheets/d/${sheetId}`);
  console.log(`스샷 폴더:  https://drive.google.com/drive/folders/${folderId}\n`);
}

async function formatSheet(sheetId) {
  const meta = await api(`${SHEETS}/${sheetId}?fields=sheets.properties`);
  const id = Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const bold = (sheet) => ({
    repeatCell: { range: { sheetId: id[sheet], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" },
  });
  const num = (sheet, col, pattern, type = "NUMBER") => ({
    repeatCell: { range: { sheetId: id[sheet], startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: "userEnteredFormat.numberFormat" },
  });
  const pick = (sheet, col, values) => ({
    setDataValidation: {
      range: { sheetId: id[sheet], startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: { condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
    },
  });
  await api(`${SHEETS}/${sheetId}:batchUpdate`, {
    method: "POST",
    body: { requests: [
      bold("지출내역"), bold("고정지출"),
      { repeatCell: { range: { sheetId: id["월별요약"], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } }, fields: "userEnteredFormat.textFormat" } },
      num("지출내역", 0, "yyyy-mm-dd", "DATE"), num("고정지출", 6, "yyyy-mm-dd", "DATE"),
      num("지출내역", 4, "#,##0.##"), num("지출내역", 6, "#,##0"), num("고정지출", 2, "#,##0.##"), num("고정지출", 4, "#,##0"),
      pick("지출내역", 3, CATEGORIES), pick("고정지출", 1, CATEGORIES),
      pick("고정지출", 5, ["매월", "매년"]), pick("고정지출", 7, ["사용중", "해지함", "확인필요"]),
      { autoResizeDimensions: { dimensions: { sheetId: id["지출내역"], dimension: "COLUMNS", startIndex: 0, endIndex: HEAD.length } } },
    ] },
  });
}

function sheetIdOrDie() {
  const id = envGet("FINANCE_SHEET_ID");
  if (!id) die("시트가 아직 없습니다. 먼저 `node tools/finance.mjs setup` 을 실행해주세요.");
  return id;
}

async function readTab(sheetId, tab) {
  // 숫자는 숫자 그대로, 날짜는 칸 모양(yyyy-mm-dd) 그대로 받는다
  const r = await api(`${SHEETS}/${sheetId}/values/${encodeURIComponent(`${tab}!A2:K`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
  return r.values || [];
}

// 원화(대략): "환율" 탭의 오늘 환율로 바꾼다 (결제 당시 환율과 조금 다를 수 있음).
// 모든 줄이 같은 식이라 날짜순 정렬해도 안 꼬인다. 폰 앱(tools/finance_app/Code.gs)도 같은 식을 쓴다.
const KRW_F = `=IFERROR(INDEX(E:E,ROW())*VLOOKUP(INDEX(F:F,ROW()),'환율'!A:B,2,0),"")`;
const FIXED_KRW_F = `=IFERROR(INDEX(C:C,ROW())*VLOOKUP(INDEX(D:D,ROW()),'환율'!A:B,2,0)/IF(INDEX(F:F,ROW())="매년",12,1),"")`;
const CURRENCIES = ["USD", "EUR", "JPY", "GBP", "CNY", "HKD", "SGD", "AUD", "CAD", "TWD"];

// "환율" 탭이 없으면 만들고, 원화 칸을 모두 같은 식으로 맞춘다 (여러 번 해도 안전)
async function ensureRates(sheetId) {
  const meta = await api(`${SHEETS}/${sheetId}?fields=sheets.properties`);
  if (!meta.sheets.some((s) => s.properties.title === "환율")) {
    await api(`${SHEETS}/${sheetId}:batchUpdate`, { method: "POST", body: { requests: [{ addSheet: { properties: { title: "환율", index: 3 } } }] } });
  }
  const spend = (await readTab(sheetId, "지출내역")).length;
  const fixed = (await readTab(sheetId, "고정지출")).length;
  const data = [{ range: "환율!A1", values: [["통화", "원화 환율(오늘)"], ["KRW", 1], ...CURRENCIES.map((c) => [c, `=GOOGLEFINANCE("CURRENCY:${c}KRW")`])] }];
  if (spend) data.push({ range: `지출내역!G2:G${spend + 1}`, values: Array.from({ length: spend }, () => [KRW_F]) });
  if (fixed) data.push({ range: `고정지출!E2:E${fixed + 1}`, values: Array.from({ length: fixed }, () => [FIXED_KRW_F]) });
  await api(`${SHEETS}/${sheetId}/values:batchUpdate`, { method: "POST", body: { valueInputOption: "USER_ENTERED", data } });
}

async function appendItems(sheetId, items) {
  const existing = await readTab(sheetId, "지출내역");
  const seen = new Set(existing.map((r) => r[9]).filter(Boolean));
  const fresh = items.filter((it) => !seen.has(it.ref));
  if (!fresh.length) return 0;
  // 이미 있는 결제면 "중복 의심" 표시만 하고 넣는다 (폰 앱에 먼저 적은 것과 메일 영수증이 겹칠 때 등)
  // 정기결제: 같은 업체가 같은 달에 있으면 / 일회성: 같은 업체·같은 금액이 2일 안에 있으면 (폰 앱 findDup_ 과 같은 기준)
  const all = existing.map((r) => ({ date: r[0], vendor: r[1], amount: Number(r[4]), recurring: !!r[7] }));
  const start = existing.length + 2;
  const rows = fresh.map((it, i) => {
    const dup = all.find((o) => o.vendor?.toLowerCase() === it.vendor.toLowerCase() && (
      (it.recurring || o.recurring) && it.amount > 0 && it.cycle !== "yearly"
        ? String(o.date).slice(0, 7) === it.date.slice(0, 7)
        : o.amount === it.amount && Math.abs(new Date(o.date) - new Date(it.date)) <= 2 * 864e5));
    all.push(it);
    return [it.date, it.vendor, it.description, it.category, it.amount, it.currency, KRW_F,
      it.recurring ? (it.cycle === "yearly" ? "매년" : "매월") : "", it.source, it.ref, dup ? "중복 의심 — 확인" : ""];
  });
  await api(`${SHEETS}/${sheetId}/values/${encodeURIComponent(`지출내역!A${start}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT", body: { values: rows },
  });
  await sortByDate(sheetId);
  await updateFixed(sheetId);
  return rows.length;
}

async function sortByDate(sheetId) {
  const meta = await api(`${SHEETS}/${sheetId}?fields=sheets.properties`);
  const tab = meta.sheets.find((s) => s.properties.title === "지출내역").properties.sheetId;
  await api(`${SHEETS}/${sheetId}:batchUpdate`, {
    method: "POST",
    body: { requests: [{ sortRange: { range: { sheetId: tab, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length }, sortSpecs: [{ dimensionIndex: 0, sortOrder: "DESCENDING" }] } }] },
  });
}

// 정기결제로 보이는 업체를 "고정지출" 탭에 추가한다. 사장님이 고친 줄은 건드리지 않고, 없는 업체만 새로 넣는다.
async function updateFixed(sheetId) {
  const rows = await readTab(sheetId, "지출내역");
  const fixed = await readTab(sheetId, "고정지출");
  const known = new Set(fixed.map((r) => r[0]?.toLowerCase()));
  const latest = new Map();
  for (const r of rows) {
    if (!r[7] || !r[1] || !(Number(r[4]) > 0)) continue;
    const k = r[1].toLowerCase();
    if (!latest.has(k) || r[0] > latest.get(k)[0]) latest.set(k, r);
  }
  const add = [...latest.values()].filter((r) => !known.has(r[1].toLowerCase()));
  if (!add.length) return;
  const start = fixed.length + 2;
  const values = add.map((r, i) => {
    const row = start + i;
    const old = (Date.now() - new Date(r[0])) / 864e5 > (r[7] === "매년" ? 400 : 40);
    return [r[1], r[3], Number(r[4]), r[5],
      FIXED_KRW_F,
      r[7], r[0], old ? "확인필요" : "사용중", old ? "최근 결제가 오래됨 — 해지했는지 확인" : ""];
  });
  await api(`${SHEETS}/${sheetId}/values/${encodeURIComponent(`고정지출!A${start}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT", body: { values },
  });
}

// ───────── 제미나이로 영수증 읽기 ─────────
const ITEM_RULES = `
규칙:
- "실제로 돈이 빠져나간 결제"만 적는다. 결제 예정 안내, 체험 시작, 0원 결제, 광고 메일, 배송 안내, 비밀번호 메일은 빼고 빈 목록.
- 환불이면 amount 를 음수로.
- 휴대폰·인터넷 요금(SK텔레콤, SK브로드밴드, KT, LG U+ 등)은 "통신비", recurring true, cycle "monthly". 통신사 "이용요금 청구서/요금 안내"는 자동이체로 빠지므로 결제 예정 안내라도 청구 금액을 청구서 날짜로 넣는다.
- 전기차 충전(파워큐브 등)·주유·주차·톨비·택시는 "차량·교통" (사장님 차비, 사업 지출로 넣음).
- 사업 지출이 아니라 명백한 개인 생활비(음식 배달, 옷, 생필품 등)는 뺀다. 애매하면 넣는다.
- category 는 반드시 다음 중 하나: ${CATEGORIES.join(", ")}.
  AI 서비스(Claude/Anthropic, ChatGPT/OpenAI, Gemini/Google AI·Google One AI, ElevenLabs, Midjourney, Cursor, Perplexity, Suno, Runway, Higgsfield, Kling 등)는 "AI 구독".
- vendor 는 서비스 이름을 짧고 일정하게 (예: "Anthropic(Claude)", "OpenAI(ChatGPT)", "Google(Gemini)", "ElevenLabs"). 같은 서비스는 항상 같은 이름.
  "코리아"·"(주)" 같은 회사 꼬리는 뺀다. 결제대행사(이니시스, KCP, 토스페이먼츠 등)가 아니라 실제 가게·서비스 이름을 쓴다.
  아래 "이미 쓰는 업체 이름"에 같은 곳이 있으면 반드시 그 이름 그대로.
- description 은 요금제·내용을 짧게 (예: "Claude Max 월 구독", "API 크레딧 충전").
- date 는 결제일 YYYY-MM-DD. currency 는 USD, KRW 같은 3글자. amount 는 숫자만(세금 포함 최종 금액).
- recurring 은 매달·매년 자동으로 나가는 구독이면 true, 일회성 충전·구매면 false. cycle 은 "monthly" | "yearly" | "".`;

const ITEM_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      ref: { type: "STRING" },
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING" }, vendor: { type: "STRING" }, description: { type: "STRING" },
            category: { type: "STRING", enum: CATEGORIES }, amount: { type: "NUMBER" }, currency: { type: "STRING" },
            recurring: { type: "BOOLEAN" }, cycle: { type: "STRING" },
          },
          required: ["date", "vendor", "description", "category", "amount", "currency", "recurring", "cycle"],
        },
      },
    },
    required: ["ref", "items"],
  },
};

let spentTokens = 0;
async function askGemini(parts) {
  const ai = gemini();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json", responseSchema: ITEM_SCHEMA },
      });
      spentTokens += res.usageMetadata?.totalTokenCount ?? 0;
      return JSON.parse(res.text);
    } catch (e) {
      // 잠깐 붐빌 때(503·429)는 30초 쉬고 한 번 더. 이 경우 요금은 나가지 않는다.
      if (attempt < 2 && !/limit: 0|PerDay/i.test(e.message) && /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(e.message)) {
        process.stdout.write("붐벼서 30초 뒤 다시 … ");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      die(friendlyError(e));
    }
  }
}

function clean(list, source) {
  const out = [];
  for (const g of list || []) for (const it of g.items || []) {
    if (!it.amount || !/^\d{4}-\d{2}-\d{2}$/.test(it.date) || !/^[A-Z]{3}$/.test(it.currency)) continue;
    out.push({ ...it, ref: `${g.ref}${(g.items.length > 1) ? `#${g.items.indexOf(it) + 1}` : ""}`, source });
  }
  return out;
}

// ───────── 지메일 ─────────
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function listMail(months, since) {
  const ids = [];
  let pageToken = "";
  const when = since ? `after:${since.replaceAll("-", "/")}` : `newer_than:${months}m`;
  const qs = `${when} -in:spam -in:trash (${MAIL_QUERY})`;
  do {
    const r = await api(`${GMAIL}/messages?${new URLSearchParams({ q: qs, maxResults: "500", ...(pageToken ? { pageToken } : {}) })}`);
    ids.push(...(r.messages || []).map((m) => m.id));
    pageToken = r.nextPageToken || "";
  } while (pageToken && ids.length < 2000);
  return ids;
}

function header(msg, name) {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || "";
}

function bodyText(part) {
  const dec = (d) => Buffer.from(d, "base64url").toString("utf8");
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return dec(part.body.data);
  const subs = part.parts || [];
  const plain = subs.map(bodyText).filter(Boolean).join("\n");
  if (plain) return plain;
  if (part.mimeType === "text/html" && part.body?.data)
    return dec(part.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ");
  return "";
}

// 시트에 이미 있는 업체 이름 — 제미나이가 같은 곳을 다른 이름으로 쓰지 않게 알려준다
async function knownVendors(sheetId) {
  const names = [...(await readTab(sheetId, "지출내역")).map((r) => r[1]), ...(await readTab(sheetId, "고정지출")).map((r) => r[0])];
  return `\n이미 쓰는 업체 이름: ${[...new Set(names.filter(Boolean))].join(", ") || "없음"}`;
}

async function scan(months, yes, since) {
  const sheetId = sheetIdOrDie();
  console.log(`지메일에서 ${since ? `${since} 부터` : `최근 ${months}개월`} 영수증·결제 메일을 찾는 중…`);
  const ids = await listMail(months, since);
  const seen = new Set((await readTab(sheetId, "지출내역")).map((r) => String(r[9] || "").split("#")[0]));
  const done = new Set(readDone("gmail"));
  const todo = ids.filter((id) => !seen.has(`gmail:${id}`) && !done.has(id));
  console.log(`찾은 메일 ${ids.length}통 · 이미 처리한 것 빼고 새로 읽을 것 ${todo.length}통`);
  if (!todo.length) return;
  // 메일 1통 ≈ 1,500토큰 어림
  const est = (todo.length * 1500 / 1e6) * USD_PER_MTOK;
  if (!yes) {
    const senders = {};
    for (const id of todo.slice(0, 300)) {
      const m = await api(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From`);
      const f = header(m, "from").replace(/.*<|>.*/g, "").split("@")[1] || "?";
      senders[f] = (senders[f] || 0) + 1;
    }
    console.log("\n많이 보낸 곳 (상위 15):");
    for (const [k, v] of Object.entries(senders).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v}통  ${k}`);
    console.log(`\n제미나이로 읽는 예상 비용: 약 $${est.toFixed(2)} (약 ${Math.ceil(est * 1450)}원)`);
    console.log("실제로 읽어서 시트에 넣으려면 끝에 --yes 를 붙여 다시 실행하세요.\n");
    return;
  }
  let added = 0;
  // 무료 등급은 하루 20번이라 한 번에 25통씩 묶어서 보낸다 (20번 × 25통 = 하루 500통)
  for (let i = 0; i < todo.length; i += 25) {
    const batch = todo.slice(i, i + 25);
    const parts = [{ text: `아래는 지메일 메일 ${batch.length}통이다. 메일마다 결제 내역을 뽑아라. 각 결과의 ref 는 메일 머리의 ref 값을 그대로.\n${ITEM_RULES}${await knownVendors(sheetId)}` }];
    for (const id of batch) {
      const m = await api(`${GMAIL}/messages/${id}?format=full`);
      const text = bodyText(m.payload).replace(/\s+/g, " ").slice(0, 5000);
      parts.push({ text: `\n=== ref: gmail:${id}\n보낸이: ${header(m, "from")}\n날짜: ${header(m, "date")}\n제목: ${header(m, "subject")}\n본문: ${text}` });
    }
    const items = clean(await askGemini(parts), "지메일");
    added += await appendItems(sheetId, items);
    markDone("gmail", batch);
    process.stdout.write(`\r읽는 중 ${Math.min(i + 25, todo.length)}/${todo.length} · 시트에 추가 ${added}건`);
  }
  console.log(`\n\n완료: ${added}건 추가 · 제미나이 사용 ${spentTokens.toLocaleString()}토큰 (약 $${(spentTokens / 1e6 * USD_PER_MTOK).toFixed(2)})`);
  console.log(`시트: https://docs.google.com/spreadsheets/d/${sheetId}\n`);
}

// 결제가 아니었던 메일도 다시 읽지 않도록 처리한 ID를 기억한다 (.tmp — 지워도 시트에 든 건 안 겹침, 비용만 다시 듦)
const DONE_DIR = path.join(ROOT, ".tmp", "finance");
function readDone(kind) {
  const f = path.join(DONE_DIR, `${kind}_done.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
}
function markDone(kind, ids) {
  fs.mkdirSync(DONE_DIR, { recursive: true });
  fs.appendFileSync(path.join(DONE_DIR, `${kind}_done.txt`), ids.join("\n") + "\n");
}

// ───────── 스샷 (드라이브 "지출_스샷" 폴더) ─────────
async function shots(yes) {
  const sheetId = sheetIdOrDie();
  const folder = envGet("FINANCE_SHOTS_FOLDER_ID");
  if (!folder) die("스샷 폴더가 아직 없습니다. 먼저 `node tools/finance.mjs setup` 을 실행해주세요.");
  const r = await api(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
    q: `'${folder}' in parents and trashed=false and (mimeType contains 'image/' or mimeType='application/pdf')`,
    fields: "files(id,name,mimeType,createdTime)", pageSize: "200", orderBy: "createdTime",
  })}`);
  const seen = new Set((await readTab(sheetId, "지출내역")).map((x) => String(x[9] || "").split("#")[0]));
  const done = new Set(readDone("drive"));
  const todo = (r.files || []).filter((f) => !seen.has(`drive:${f.id}`) && !done.has(f.id));
  console.log(`스샷 폴더: 전체 ${(r.files || []).length}장 · 새로 읽을 것 ${todo.length}장`);
  if (!todo.length) return;
  if (!yes) {
    console.log(`예상 비용: 약 $${(todo.length * 2000 / 1e6 * USD_PER_MTOK).toFixed(3)} — 실제로 읽으려면 --yes 를 붙이세요.`);
    return;
  }
  let added = 0;
  for (const f of todo) {
    const data = await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { raw: true });
    if (data.length > 15 * 1024 * 1024) { console.log(`  건너뜀(15MB 초과): ${f.name}`); continue; }
    const items = clean(await askGemini([
      { inlineData: { mimeType: f.mimeType, data: data.toString("base64") } },
      { text: `이 사진은 결제 내역 스크린샷(카드 앱 내역, 문자, 영수증, 앱스토어 구독 화면 등)이다. 보이는 결제를 전부 뽑아라. ref 는 "drive:${f.id}" 하나로, 그 안 items 에 결제들을 넣는다. 연도가 안 보이면 ${f.createdTime.slice(0, 4)}년으로 본다.\n${ITEM_RULES}${await knownVendors(sheetId)}` },
    ]), "스샷");
    added += await appendItems(sheetId, items);
    markDone("drive", [f.id]);
    console.log(`  ${f.name}: ${items.length}건`);
  }
  console.log(`\n완료: ${added}건 추가 · 제미나이 사용 ${spentTokens.toLocaleString()}토큰`);
}

// ───────── 요약 (무료, 시트만 읽음) ─────────
async function summary() {
  const sheetId = sheetIdOrDie();
  const r = await api(`${SHEETS}/${sheetId}/values/${encodeURIComponent("지출내역!A2:K")}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
  const rows = r.values || [];
  if (!rows.length) return console.log("아직 내역이 없습니다.");
  const krw = (x) => Number(x[6]) || 0;
  const by = (keyFn, filter = () => true) => {
    const m = {};
    for (const x of rows.filter(filter)) { const k = keyFn(x); m[k] = (m[k] || 0) + krw(x); }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const won = (n) => `${Math.round(n).toLocaleString()}원`;
  console.log(`\n전체 ${rows.length}건 · 합계 ${won(rows.reduce((s, x) => s + krw(x), 0))}`);
  console.log("\n[분류별]"); for (const [k, v] of by((x) => x[3])) console.log(`  ${k}: ${won(v)}`);
  console.log("\n[AI 구독 · 업체별]"); for (const [k, v] of by((x) => x[1], (x) => x[3] === "AI 구독")) console.log(`  ${k}: ${won(v)}`);
  console.log("\n[월별 AI 구독]"); for (const [k, v] of by((x) => String(x[0]).slice(0, 7), (x) => x[3] === "AI 구독").sort((a, b) => b[0].localeCompare(a[0]))) console.log(`  ${k}: ${won(v)}`);
  const dups = rows.filter((x) => x[10]);
  if (dups.length) console.log(`\n확인 필요 ${dups.length}건 (메모 칸 참고)`);
  console.log();
}

// ───────── 폰 앱 올리기 (구글 Apps Script 웹앱) ─────────
// tools/finance_app/ 의 파일 + .env 에서 만든 Config.gs 를 사장님 계정의 Apps Script 프로젝트에 올린다.
// 처음엔 새로 만들고, 그다음부터는 같은 주소를 유지한 채 내용만 바꾼다.
const SCRIPT = "https://script.googleapis.com/v1/projects";
const APP_DIR = path.join(ROOT, "tools", "finance_app");

async function app() {
  const sheetId = sheetIdOrDie();
  await ensureRates(sheetId);
  if (!process.env.GEMINI_API_KEY) die("GEMINI_API_KEY 가 .env 에 없습니다.");
  // 무료 등급 제미나이는 모델마다 하루 20번. 폰 앱은 메일 읽기(GEMINI_MODEL)와 다른 모델을 써서 한도를 나눠 쓰지 않게 한다.
  const config = { sheetId, model: process.env.FINANCE_APP_MODEL || "gemini-3.5-flash", geminiKey: process.env.GEMINI_API_KEY };
  const files = [
    { name: "appsscript", type: "JSON", source: fs.readFileSync(path.join(APP_DIR, "appsscript.json"), "utf8") },
    { name: "Code", type: "SERVER_JS", source: fs.readFileSync(path.join(APP_DIR, "Code.gs"), "utf8") },
    // 키는 사장님 계정의 비공개 Apps Script 프로젝트 안에만 들어간다 (이 컴퓨터의 폴더·git 에는 안 남음)
    { name: "Config", type: "SERVER_JS", source: `const CONFIG = ${JSON.stringify(config)};\n` },
    { name: "index", type: "HTML", source: fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8") },
  ];
  let scriptId = envGet("FINANCE_APP_SCRIPT_ID");
  if (!scriptId) {
    try {
      scriptId = (await api(SCRIPT, { method: "POST", body: { title: "사업 지출 앱" } })).scriptId;
    } catch (e) {
      if (/User has not enabled the Apps Script API/i.test(e.message))
        die("Apps Script 사용 설정이 꺼져 있습니다. 아래 주소에서 'Google Apps Script API'를 '사용'으로 바꾸고 1~2분 뒤 다시 실행하세요.\nhttps://script.google.com/home/usersettings");
      throw e;
    }
    envSet("FINANCE_APP_SCRIPT_ID", scriptId);
  }
  await api(`${SCRIPT}/${scriptId}/content`, { method: "PUT", body: { files } });
  const { versionNumber } = await api(`${SCRIPT}/${scriptId}/versions`, { method: "POST", body: { description: new Date().toISOString() } });
  const deploymentConfig = { versionNumber, manifestFileName: "appsscript", description: "사업 지출 앱" };
  let depId = envGet("FINANCE_APP_DEPLOYMENT_ID");
  const dep = depId
    ? await api(`${SCRIPT}/${scriptId}/deployments/${depId}`, { method: "PUT", body: { deploymentConfig } })
    : await api(`${SCRIPT}/${scriptId}/deployments`, { method: "POST", body: deploymentConfig });
  if (!depId) envSet("FINANCE_APP_DEPLOYMENT_ID", (depId = dep.deploymentId));
  const url = dep.entryPoints?.find((e) => e.entryPointType === "WEB_APP")?.webApp?.url;
  console.log(`\n폰 앱을 올렸습니다 (버전 ${versionNumber}).\n주소: ${url}\n처음 열 때 구글이 권한 허락을 한 번 묻습니다.\n`);
}

// ───────── 실행 ─────────
const [cmd, ...rest] = process.argv.slice(2);
const yes = rest.includes("--yes");
const opt = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
const months = Number(opt("--months")) || 12;
const since = opt("--since");
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) die("--since 는 2026-09-01 처럼 적어주세요.");
const run = { login, setup, scan: () => scan(months, yes, since), shots: () => shots(yes), summary, app }[cmd];
if (!run) die("사용법: node tools/finance.mjs login | setup | scan [--months 12 | --since 2026-09-01] [--yes] | shots [--yes] | summary | app");
run().catch((e) => die(e.message));
