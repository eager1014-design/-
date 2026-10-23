// 가게 사장님 고충 듣기 (구글 Apps Script 웹앱). `node tools/needs_form.mjs deploy` 로 올린다.
// 누구나(로그인 없이) 열어서 적을 수 있고, 내용은 천성준 사장님 구글 시트 "가게 사장님 고충 모음"에 한 줄씩 쌓인다.
// 구글 편집기에서 직접 고치지 말고 tools/needs_form/ 을 고친 뒤 다시 올릴 것 (다시 올리면 덮어씀).
// CONFIG(시트 주소)는 올릴 때 .env 에서 만들어 Config.gs 로 붙인다.

const HEAD = ["접수 시각", "업종", "귀찮은 일(고른 것)", "구체적으로", "일주일에 쓰는 시간", "한 달에 낼 수 있는 돈", "가게 이름", "연락처", "개인정보 동의", "처리 상태", "메모"];

function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("가게의 제일 귀찮은 일")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function sheet_() {
  const sh = SpreadsheetApp.openById(CONFIG.sheetId).getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(HEAD);
  return sh;
}

const clip_ = (v, n) => String(v == null ? "" : v).replace(/^[=+\-@]/, "'$&").slice(0, n); // 시트 수식 주입 막기

// 폼에서 부르는 함수. 같은 사람이 마구 누르는 것과 자동 스팸(숨은 칸)을 막는다.
function submit(f) {
  if (!f || f.website) return { ok: true }; // 숨은 칸이 채워져 있으면 로봇 → 조용히 무시
  const tasks = [].concat(f.tasks || []).map(String).slice(0, 20);
  const detail = String(f.detail || "").trim();
  if (!tasks.length && !detail) throw new Error("귀찮은 일을 하나 이상 고르거나 적어주세요.");
  const contact = String(f.contact || "").trim();
  if (contact && !f.consent) throw new Error("연락처를 남기시려면 개인정보 수집에 동의해 주세요.");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get("count") || 0);
    if (n > 60) throw new Error("잠시 뒤 다시 보내주세요.");
    cache.put("count", String(n + 1), 600); // 10분에 60건까지
    sheet_().appendRow([
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      clip_(f.industry, 40), clip_(tasks.join(", "), 500), clip_(detail, 2000),
      clip_(f.hours, 30), clip_(f.budget, 30), clip_(f.shop, 60), clip_(contact, 80),
      contact ? "동의 " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd") : "",
      "새로 들어옴", "",
    ]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}
