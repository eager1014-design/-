// 사업 지출 폰 앱 (구글 Apps Script 웹앱). `node tools/finance.mjs app` 으로 올린다.
// 구글 쪽 편집기에서 직접 고치지 말고 tools/finance_app/ 을 고친 뒤 다시 올릴 것 (다시 올리면 덮어씀).
// CONFIG(시트 주소·제미나이 모델·키)는 올릴 때 .env 에서 만들어 Config.gs 로 붙인다. 이 폴더에는 비밀이 없다.

// 원화(대략) 계산식: 모든 줄이 같은 식이라 정렬해도 안 꼬인다. 환율은 "환율" 탭(GOOGLEFINANCE)에서.
const KRW_F = '=IFERROR(INDEX(E:E,ROW())*VLOOKUP(INDEX(F:F,ROW()),\'환율\'!A:B,2,0),"")';
const FIXED_KRW_F = '=IFERROR(INDEX(C:C,ROW())*VLOOKUP(INDEX(D:D,ROW()),\'환율\'!A:B,2,0)/IF(INDEX(F:F,ROW())="매년",12,1),"")';

const CATEGORIES = ["AI 구독", "소프트웨어·구독", "광고·마케팅", "서버·도메인", "장비", "교육·자료", "차량·교통", "통신비", "기타 사업비"];

function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("지출 기록")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1");
}

function tab_(name) {
  return SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(name);
}

function today_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

function ymd_(v) {
  return v instanceof Date ? Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd") : String(v || "");
}

function rows_(name, cols) {
  const sh = tab_(name);
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, cols).getValues().filter((r) => r[0] !== "") : [];
}

// 화면 위쪽 요약: 이번 달 합계, 이번 달 AI 구독, 매달 고정지출, 최근 내역, 고정지출 목록
function overview() {
  const month = today_().slice(0, 7);
  const spend = rows_("지출내역", 11);
  const fixed = rows_("고정지출", 9);
  const thisMonth = spend.filter((r) => ymd_(r[0]).slice(0, 7) === month);
  const sum = (list) => Math.round(list.reduce((s, r) => s + (Number(r[6]) || 0), 0));
  const recent = spend
    .map((r) => ({ date: ymd_(r[0]), vendor: r[1], desc: r[2], amount: r[4], currency: r[5], krw: Math.round(Number(r[6]) || 0) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10);
  const active = fixed.filter((r) => r[7] !== "해지함");
  // 그래프용: 최근 6개월 × 분류 합계 (원화)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM"));
  }
  const byMonth = months.map((m) => {
    const cats = {};
    for (const r of spend) if (ymd_(r[0]).slice(0, 7) === m) cats[r[3]] = (cats[r[3]] || 0) + (Number(r[6]) || 0);
    return { month: m, cats };
  });
  const aiFixed = active
    .filter((r) => r[1] === "AI 구독" && r[7] === "사용중")
    .map((r) => ({ name: r[0], krw: Math.round(Number(r[4]) || 0) }))
    .sort((a, b) => b.krw - a.krw);
  return {
    byMonth,
    aiFixed,
    month,
    monthTotal: sum(thisMonth),
    monthAi: sum(thisMonth.filter((r) => r[3] === "AI 구독")),
    fixedMonthly: Math.round(active.filter((r) => r[7] === "사용중").reduce((s, r) => s + (Number(r[4]) || 0), 0)),
    recent,
    fixed: active.map((r) => ({ name: r[0], amount: r[2], currency: r[3], krw: Math.round(Number(r[4]) || 0), cycle: r[5], status: r[7] })),
    sheetUrl: `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}`,
  };
}

const RULES = `
오늘은 ${"{TODAY}"} (한국 시간). 사장님의 "사업 지출"을 기록하는 비서다.
할 수 있는 일(actions):
- "add": 실제로 쓴 돈 한 건을 지출내역에 추가. 날짜를 말 안 하면 오늘. "어제"·"지난주 금요일" 같은 말은 날짜로 바꾼다.
- "fixed": 매달·매년 나가는 고정지출을 등록하거나 금액·주기를 고친다 (예: "넷플릭스 매달 17000원 나가").
  이 경우 지출내역에는 넣지 않는다. 사장님이 "이번 달 것도 적어줘"라고 하면 add 도 같이.
- "cancel": 고정지출을 해지함으로 바꾼다 (예: "미드저니 해지했어").
규칙:
- category 는 반드시 다음 중 하나: ${CATEGORIES.join(", ")}. AI 서비스(Claude, ChatGPT, Gemini, ElevenLabs, Midjourney, Cursor, Perplexity, Suno, Runway, Kling 등)는 "AI 구독".
- 휴대폰·인터넷 요금(SK텔레콤, SK브로드밴드, KT, LG U+ 등)은 "통신비" (매월 정기).
- 전기차 충전(파워큐브 등)·주유·주차·톨비·택시는 "차량·교통".
- vendor 는 서비스 이름을 짧고 일정하게. 고정지출 목록에 이미 있는 이름이면 그 이름을 그대로 쓴다.
- currency 는 USD, KRW 같은 3글자. 금액에 "원"이면 KRW, "$"·"달러"면 USD. amount 는 숫자만.
- cycle 은 "monthly" | "yearly" | "". recurring 은 정기결제면 true.
- 결제가 아닌 것(광고, 결제 예정 안내, 0원)은 넣지 않는다. 환불은 amount 음수.
- "통신비 나갔어"처럼 금액을 말 안 했는데 고정지출 목록에 있으면 그 금액·통화로 add 한다 (recurring true).
- 같은 정기결제가 "최근 기록"에 이번 주기(매월이면 같은 달)로 이미 있으면, add 는 그대로 넣되 reply 에 "이미 ○월 ○일에 기록돼 있어요"라고 말한다. 시스템이 자동으로 걸러준다.
- 사장님이 "한 번 더 결제됐어", "추가로 나갔어"처럼 같은 달 별도 결제라고 분명히 말할 때만 force 를 true.
- 알아들을 수 없거나 금액을 알 수 없으면 actions 를 비우고 reply 에 무엇이 필요한지 짧게 묻는다.
- reply 는 무엇을 할지 한두 문장 한국어로 (예: "캔바 15,000원을 오늘 날짜로 넣을게요.").
지금 고정지출 목록: {FIXED}
최근 기록(지난달~이번 달): {RECENT}`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["add", "fixed", "cancel"] },
          date: { type: "STRING" }, vendor: { type: "STRING" }, description: { type: "STRING" },
          category: { type: "STRING", enum: CATEGORIES }, amount: { type: "NUMBER" }, currency: { type: "STRING" },
          recurring: { type: "BOOLEAN" }, cycle: { type: "STRING" }, force: { type: "BOOLEAN" },
        },
        required: ["kind", "vendor"],
      },
    },
  },
  required: ["reply", "actions"],
};

function gemini_(parts) {
  const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent`, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": CONFIG.geminiKey },
    payload: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 429 || code === 503) throw new Error("AI가 잠깐 붐빕니다. 몇 초 뒤 다시 보내주세요.");
  if (code !== 200) throw new Error(`AI 오류 (${code}): ${res.getContentText().slice(0, 150)}`);
  const j = JSON.parse(res.getContentText());
  return JSON.parse(j.candidates[0].content.parts[0].text);
}

function rules_() {
  const names = rows_("고정지출", 9).map((r) => `${r[0]}(${r[2]} ${r[3]}, ${r[5]}, ${r[7]})`).join(", ") || "없음";
  const since = new Date();
  since.setDate(1);
  since.setMonth(since.getMonth() - 1);
  const recent = rows_("지출내역", 11).filter((r) => r[0] >= since)
    .map((r) => `${ymd_(r[0])} ${r[1]} ${r[4]} ${r[5]} (${r[3]}${r[7] ? ", 정기" : ""})`).join("; ") || "없음";
  return RULES.replace("{TODAY}", today_()).replace("{FIXED}", names).replace("{RECENT}", recent);
}

// 이미 기록된 같은 결제를 찾는다.
// 정기결제(고정지출에 있거나 recurring)는 같은 주기(매월=같은 달, 매년=330일 안)에 같은 업체가 있으면 중복.
// 일회성은 같은 업체·같은 금액이 2일 안에 있으면 중복.
function findDup_(a, spend, fixed) {
  const v = String(a.vendor).toLowerCase();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : today_();
  const f = fixed.find((r) => String(r[0]).toLowerCase() === v);
  const yearly = a.cycle === "yearly" || (f && f[5] === "매년");
  const recurring = a.recurring || !!f;
  const t = new Date(date).getTime();
  return spend.find((r) => {
    if (String(r[1]).toLowerCase() !== v) return false;
    const rd = ymd_(r[0]);
    if (recurring && Number(a.amount) > 0) return yearly ? Math.abs(new Date(rd) - t) < 330 * 864e5 : rd.slice(0, 7) === date.slice(0, 7);
    return Number(r[4]) === Number(a.amount) && Math.abs(new Date(rd) - t) <= 2 * 864e5;
  });
}

// 미리보기에 "이미 있음" 표시를 붙이고, 금액을 안 말했으면 고정지출 금액으로 채운다
function annotate_(res) {
  const spend = rows_("지출내역", 11);
  const fixed = rows_("고정지출", 9);
  for (const a of res.actions) {
    if (a.kind !== "add") continue;
    const f = fixed.find((r) => String(r[0]).toLowerCase() === String(a.vendor).toLowerCase());
    if (!a.amount && f) {
      a.amount = Number(f[2]);
      a.currency = f[3];
      a.recurring = true;
      a.cycle = f[5] === "매년" ? "yearly" : "monthly";
      a.category = a.category || f[1];
    }
    const dup = !a.force && findDup_(a, spend, fixed);
    if (dup) a.dup = `${ymd_(dup[0])} ${dup[1]} ${Number(dup[4]).toLocaleString()} ${dup[5]}`;
  }
  return res;
}

// 말로 한 것 → 할 일 미리보기 (아직 시트에 안 씀)
function parseText(text) {
  return annotate_(gemini_([{ text: `${rules_()}\n\n사장님 말: ${text}` }]));
}

// 스샷 → 할 일 미리보기 (아직 시트에 안 씀)
function parseImage(base64, mimeType, note) {
  return annotate_(gemini_([
    { inlineData: { mimeType, data: base64 } },
    { text: `${rules_()}\n\n이 사진은 결제 내역 스크린샷(카드 앱, 문자, 영수증, 앱스토어 구독 화면 등)이다. 보이는 결제를 전부 "add" 로 뽑아라. 연도가 안 보이면 올해로 본다.${note ? `\n사장님 메모: ${note}` : ""}` },
  ]));
}

// 사장님이 "넣기"를 누르면 실제로 시트에 쓴다
function apply(actions) {
  const done = [];
  const spend = tab_("지출내역");
  const fixedTab = tab_("고정지출");
  const fixed = rows_("고정지출", 9);
  const findFixed = (name) => fixed.findIndex((r) => String(r[0]).toLowerCase() === String(name).toLowerCase());
  const cycleKo = (c) => (c === "yearly" ? "매년" : c === "monthly" ? "매월" : "");

  for (const a of actions) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : today_();
    const [y, m, d] = date.split("-").map(Number);
    if (a.kind === "add") {
      if (!a.amount) continue;
      const dup = !a.force && findDup_(a, rows_("지출내역", 11), fixed);
      if (dup) { done.push(`이미 있어서 안 넣음: ${ymd_(dup[0])} ${dup[1]} ${Number(dup[4]).toLocaleString()} ${dup[5]}`); continue; }
      const recurring = a.recurring || findFixed(a.vendor) >= 0;
      spend.appendRow([new Date(y, m - 1, d), a.vendor, a.description || "", a.category || "기타 사업비", a.amount, a.currency || "KRW", KRW_F,
        recurring ? cycleKo(a.cycle) || "매월" : "", "폰 앱", `app:${Utilities.getUuid()}`, a.force ? "같은 주기 추가 결제(사장님 확인)" : ""]);
      done.push(`지출 추가: ${a.vendor} ${Number(a.amount).toLocaleString()} ${a.currency || "KRW"}`);
    } else if (a.kind === "fixed") {
      const i = findFixed(a.vendor);
      const row = [a.vendor, a.category || "소프트웨어·구독", a.amount || "", a.currency || "KRW", FIXED_KRW_F, cycleKo(a.cycle) || "매월",
        a.date ? new Date(y, m - 1, d) : "", "사용중", "폰 앱에서 등록"];
      if (i >= 0) {
        const old = fixed[i];
        row[1] = a.category || old[1];
        row[2] = a.amount || old[2];
        row[3] = a.amount ? a.currency || old[3] : old[3];
        row[6] = a.date ? row[6] : old[6];
        row[8] = old[8];
        fixedTab.getRange(i + 2, 1, 1, 4).setValues([row.slice(0, 4)]);
        fixedTab.getRange(i + 2, 6, 1, 4).setValues([row.slice(5)]);
        done.push(`고정지출 수정: ${a.vendor}`);
      } else {
        fixedTab.appendRow(row);
        fixed.push(row);
        done.push(`고정지출 추가: ${a.vendor}`);
      }
    } else if (a.kind === "cancel") {
      const i = findFixed(a.vendor);
      if (i < 0) { done.push(`고정지출에 "${a.vendor}"이(가) 없어서 그대로 둠`); continue; }
      fixedTab.getRange(i + 2, 8).setValue("해지함");
      done.push(`고정지출 해지: ${a.vendor}`);
    }
  }
  const n = spend.getLastRow() - 1;
  if (n > 1) spend.getRange(2, 1, n, 11).sort({ column: 1, ascending: false });
  SpreadsheetApp.flush();
  return { done, overview: overview() };
}
