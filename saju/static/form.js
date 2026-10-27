/* 운결 — 공용 입력 도구 (신청서·사장님 화면이 함께 씀) */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => (n ? n.toLocaleString("ko-KR") + "원" : "무료");

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || "요청에 실패했습니다. 잠시 후 다시 시도해 주세요."); e.status = r.status; e.data = data; throw e; }
  return data;
}

const HOURS = ["자시 23~01", "축시 01~03", "인시 03~05", "묘시 05~07", "진시 07~09", "사시 09~11",
  "오시 11~13", "미시 13~15", "신시 15~17", "유시 17~19", "술시 19~21", "해시 21~23"];

/* 생년월일 입력칸 묶음 (내 정보·상대방 정보 공용) */
function birthFields(prefix, pet) {
  const hourOpts = ['<option value="">모름</option>']
    .concat(Array.from({ length: 24 }, (_, h) => `<option value="${h}">${h}시 (${HOURS[Math.floor(((h + 1) % 24) / 2)].split(" ")[0]})</option>`))
    .join("");
  return `
    <label>${pet ? "생일 (모르면 데려온 날)" : "생년월일"}</label>
    <div class="seg" style="margin-bottom:8px">
      <label><input type="radio" name="${prefix}-cal" value="solar" checked><span>양력</span></label>
      <label><input type="radio" name="${prefix}-cal" value="lunar"><span>음력</span></label>
      <label><input type="radio" name="${prefix}-cal" value="leap"><span>음력 윤달</span></label>
    </div>
    <div class="birth">
      <input id="${prefix}-y" inputmode="numeric" maxlength="4" placeholder="년 (1995)" aria-label="태어난 해">
      <input id="${prefix}-m" inputmode="numeric" maxlength="2" placeholder="월" aria-label="월">
      <input id="${prefix}-d" inputmode="numeric" maxlength="2" placeholder="일" aria-label="일">
    </div>
    <div class="birth2">
      <div><label for="${prefix}-h">태어난 시간</label><select id="${prefix}-h">${hourOpts}</select></div>
      <div><label for="${prefix}-min">분 <span class="muted small">(알면)</span></label><input id="${prefix}-min" inputmode="numeric" maxlength="2" placeholder="0"></div>
    </div>
    <label>성별</label>
    <div class="seg">
      <label><input type="radio" name="${prefix}-g" value="female"><span>${pet ? "암컷" : "여성"}</span></label>
      <label><input type="radio" name="${prefix}-g" value="male"><span>${pet ? "수컷" : "남성"}</span></label>
    </div>`;
}

function readBirth(prefix) {
  const cal = document.querySelector(`input[name="${prefix}-cal"]:checked`)?.value || "solar";
  return {
    year: $(`#${prefix}-y`).value.trim(), month: $(`#${prefix}-m`).value.trim(), day: $(`#${prefix}-d`).value.trim(),
    calendar: cal === "solar" ? "solar" : "lunar", leap: cal === "leap",
    hour: $(`#${prefix}-h`).value, minute: $(`#${prefix}-min`).value.trim() || 0,
    gender: document.querySelector(`input[name="${prefix}-g"]:checked`)?.value,
  };
}

/* 상대방·반려동물 입력칸 (상품의 partner 값에 따라) */
function partnerFields(need) {
  if (need === "pet") return `
    <legend>우리 아이 정보</legend>
    <div class="birth2">
      <div><label for="p-name">이름</label><input id="p-name" maxlength="20" placeholder="예) 콩이"></div>
      <div><label for="p-rel">종류</label><select id="p-rel"><option>강아지</option><option>고양이</option><option>그 밖의 반려동물</option></select></div>
    </div>
    ${birthFields("p", true)}`;
  if (need === "gift") return `
    <legend>선물 받을 사람 정보</legend>
    <div class="birth2">
      <div><label for="p-name">받는 분 이름(별명 가능)</label><input id="p-name" maxlength="20" placeholder="예) 민지"></div>
      <div><label for="p-rel">나와의 관계</label>
        <select id="p-rel"><option>연인</option><option>배우자</option><option>친구</option><option>가족</option><option>직장 동료</option></select></div>
    </div>
    ${birthFields("p")}`;
  return `
    <legend>상대방 정보${need === "optional" ? ' <span class="muted small">(알면 더 정확해요 · 선택)</span>' : ""}</legend>
    <div class="birth2">
      <div><label for="p-name">상대 이름(별명 가능)</label><input id="p-name" maxlength="20"></div>
      <div><label for="p-rel">관계</label>
        <select id="p-rel"><option>연인</option><option>전 연인</option><option>썸</option><option>배우자</option><option>친구</option><option>직장 동료</option><option>가족</option></select></div>
    </div>
    ${birthFields("p")}`;
}

/* 페이지 넘김 (첫 화면·상담실 공용): 막을 내리고 → 바꾸고 → 막을 올린다. 다른 주소로 갈 때는 막을 내린 채로 이동 */
function turnPage(title, swap) {
  let c = document.querySelector(".curtain");
  if (!c) {
    c = document.createElement("div");
    c.className = "curtain";
    c.innerHTML = '<div class="cseal">運</div><p class="ctitle"></p>';
    document.body.appendChild(c);
  }
  c.querySelector(".ctitle").textContent = title || "";
  requestAnimationFrame(() => c.classList.add("on"));
  return new Promise((done) => setTimeout(() => {
    if (typeof swap === "string") { location.href = swap; return; }  // 다음 페이지에서 막이 올라감
    const el = swap && swap();
    window.scrollTo(0, 0);
    if (el) { el.classList.remove("page-in"); void el.offsetWidth; el.classList.add("page-in"); }
    setTimeout(() => { c.classList.remove("on"); done(); }, 650);
  }, 750));
}
