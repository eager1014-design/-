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

/* 첫 방문 안내 (코치마크, 2026-10-30 사장님) — 첫 화면 무료 풀이·운결 앱 공용: 볼 곳을 하나씩 밝혀 짚어 준다.
   한 번 보면(건너뛰어도) 이 브라우저에선 저절로는 안 뜸. Esc·건너뛰기로 언제든 닫힘.
   again=true 면 본 적 있어도 다시 보여 준다 ('안내 다시 보기' 버튼, 사장님 2026-10-30). */
function coach(key, steps, again) {
  if (!again) try { if (localStorage.getItem("coach:" + key)) return; } catch (e) { return; }
  if (document.querySelector(".coach")) return;
  const list = steps.filter((s) => document.querySelector(s.sel)?.offsetParent);
  if (!list.length) return;
  let i = 0;
  const veil = document.createElement("div");
  veil.className = "coach";
  veil.innerHTML = `<div class="coach-hole"></div><div class="coach-tip" role="dialog" aria-modal="true" aria-labelledby="coachT"></div>`;
  document.body.appendChild(veil);
  const hole = veil.querySelector(".coach-hole"), tip = veil.querySelector(".coach-tip");
  const onKey = (e) => { if (e.key === "Escape") done(); };
  function done() {
    veil.remove();
    removeEventListener("resize", show);
    removeEventListener("keydown", onKey);
    try { localStorage.setItem("coach:" + key, "1"); } catch (e) { /* 다음에 또 보일 뿐 */ }
  }
  function show() {
    const s = list[i], el = document.querySelector(s.sel);
    if (!el) return done();
    const tall = el.offsetHeight > innerHeight * 0.55; // 화면보다 긴 곳은 위에 맞추고 안내는 화면 아래에
    el.scrollIntoView({ block: tall ? "start" : "center" });
    const r = el.getBoundingClientRect(), p = 8;
    Object.assign(hole.style, { left: `${r.left - p}px`, top: `${Math.max(4, r.top - p)}px`, width: `${r.width + p * 2}px`, height: `${Math.min(r.height + p * 2, innerHeight - 8)}px` });
    tip.innerHTML = `<div class="small muted">${i + 1} / ${list.length}</div><b id="coachT">${s.title}</b><p>${s.text}</p>
      <div class="coach-row"><button type="button" class="linkbtn" data-skip>건너뛰기</button><button type="button" class="btn" data-next>${i === list.length - 1 ? "알겠어" : "다음"}</button></div>`;
    const below = r.bottom + tip.offsetHeight + 20 < innerHeight;
    Object.assign(tip.style, { left: `${Math.max(12, Math.min(r.left, innerWidth - tip.offsetWidth - 12))}px`, top: `${tall ? innerHeight - tip.offsetHeight - 12 : below ? Math.min(r.bottom + 16, innerHeight - tip.offsetHeight - 12) : Math.max(12, r.top - tip.offsetHeight - 16)}px` });
    tip.querySelector("[data-next]").onclick = () => (++i < list.length ? show() : done());
    tip.querySelector("[data-skip]").onclick = done;
    tip.querySelector("[data-next]").focus({ preventScroll: true });
  }
  addEventListener("resize", show);
  addEventListener("keydown", onKey);
  show();
}

/* 오른쪽 아래 동그란 '?' = 안내 다시 보기 (한 화면에 하나, 글자 버튼은 카드 글씨를 가려서 작게) */
function coachAgain(run) {
  let b = document.querySelector(".coach-again");
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "coach-again";
    b.textContent = "?";
    b.title = "안내 다시 보기";
    b.setAttribute("aria-label", "안내 다시 보기");
    document.body.appendChild(b);
  }
  b.onclick = run;
}

/* 운세 달력 버튼 (첫 화면·운결 앱 공용, 2026-10-30).
   구글 캘린더는 폰에서 주소로 달력을 추가할 수 없다 (눌러도 구글 달력만 열리고 아무것도 안 생김 — 사장님 제보).
   그래서 폰에서 '구글'을 누르면 안내를 펼친다: 주소 복사 → 컴퓨터에서 한 번 추가 → 안드로이드는 앱에서 동기화 켜기.
   아이폰 기본 달력은 webcal:// 로 폰에서 바로 구독된다. 컴퓨터에서는 구글 링크로 바로 추가. */
const IS_PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function calButtons(token) {
  const url = `${location.origin}/cal/${token}.ics`, webcal = url.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return `<div class="calbtns">
      ${/Android/i.test(navigator.userAgent) ? "" : `<a class="btn" href="${webcal}">아이폰 달력에 넣기</a>`}
      <a class="btn ghost" target="_blank" rel="noopener" href="${google}" data-gcal>구글 달력에 넣기</a></div>
    <div class="calhelp" hidden>
      <p><b>구글 달력은 폰에서는 바로 못 넣어.</b> 컴퓨터에서 한 번만 넣으면 폰 구글 캘린더에도 떠.</p>
      <ol>
        <li>아래 <b>주소 복사</b>를 눌러서 카톡 '나와의 채팅' 같은 데 붙여 둬.</li>
        <li>컴퓨터에서 <b>calendar.google.com</b> → 왼쪽 <b>다른 캘린더</b> 옆 <b>+</b> → <b>URL로 추가</b> → 주소 붙여넣기 → 캘린더 추가.</li>
        <li>안드로이드 폰이면: 구글 캘린더 앱 → 메뉴 → <b>설정</b> → <b>운결 운세 달력</b> → <b>동기화</b> 켜기.</li>
      </ol>
      <div class="calurl"><code>${esc(url)}</code><button type="button" class="btn" data-calcopy="${esc(url)}">주소 복사</button></div>
      <p class="small muted">처음 뜨기까지 몇 분에서 몇 시간 걸릴 수 있어. 그 뒤로는 구글이 알아서 새로 받아 와.</p>
    </div>`;
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-gcal]");
  if (g && IS_PHONE) {
    e.preventDefault();
    const help = g.closest(".calbtns").nextElementSibling;
    help.hidden = !help.hidden;
    if (!help.hidden) help.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const c = e.target.closest("[data-calcopy]");
  if (c) {
    const done = () => { c.textContent = "복사했어"; setTimeout(() => (c.textContent = "주소 복사"), 1800); };
    const pick = () => { const r = document.createRange(); r.selectNodeContents(c.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); c.textContent = "길게 눌러 복사"; };
    try { navigator.clipboard.writeText(c.dataset.calcopy).then(done, pick); } catch (err) { pick(); }
  }
});
