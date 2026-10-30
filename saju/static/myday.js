/* 운결 앱 — 내 일정 × 그날 기운 (2026-10-30 사장님: 먼저 사주 → 내 일정을 넣으면 그날 그 일에 맞는 기운).
   처음: 소개 3장 → 생일 → 첫 일정 하나(건너뛰기 가능) → 한 달 운세 달력(날짜 누르면 그날 자세히)·내 일정 + 화면 안내(코치마크). 소개·안내는 메뉴에서 다시 볼 수 있음.
   생일·일정은 이 폰(localStorage)에만. 볼 때마다 /api/myday 로 보내 계산만 받아 온다 (서버 저장 X, AI X).
   7일 무료 체험 배지는 보여 주기만 한다 — 아직 수익화 전이라 잠그지 않음 (구독 4,990원 확정되면 여기서 잠금). */

const KEY = "ungyeol_app";
const TRIAL_DAYS = 7;
const st = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } })();
st.events = st.events || [];
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 이 화면에서만 기억 */ } };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(new Date());
let DATA = null;
let VIEW = todayIso().slice(0, 7);  // 보고 있는 달 'YYYY-MM'
let SEL = todayIso();               // 달력에서 고른 날

const INTRO = [
  { img: "/img/toon2/t3.jpg", title: "일정은 꽉 찼는데<br><em>어느 날이 좋은지</em> 모르겠지?", text: "계약, 면접, 월급날, 데이트… 날은 정해졌는데 마음이 괜히 불안할 때." },
  { img: "/img/toon2/t8.jpg", title: "생일 <em>하나</em>만 줘", text: "네 사주로 날마다 어떤 기운이 들어오는지 계산해 둘게. 태어난 시간은 몰라도 돼." },
  { img: "/img/toon2/c06.jpg", title: "네 운세를<br><em>달력</em>으로 보여 줄게", text: "날마다 좋은 날·조심할 날, 일정을 넣으면 그날 그 일에 맞춰서까지. 7일 동안 무료로 써 봐." },
];

const TOUR = [
  { sel: "#mcal", title: "한 달 운세 달력", text: "노란 점은 좋은 날, 느낌표는 조심할 날이야. 맨 위엔 그달 흐름 한 줄. 옆 화살표로 다른 달도 봐." },
  { sel: "#dayd", title: "그날 자세히", text: "날짜를 누르면 그날 할 것, 조심할 것, 그날 내 일정까지 여기 나와. 처음엔 오늘이야." },
  { sel: "#add-btn", title: "일정 넣기", text: "날짜랑 무슨 일인지만 고르면 돼. 그날 그 일에 맞는지 바로 알려 줄게." },
  { sel: "#trial", title: "7일 무료 체험", text: "지금은 전부 열려 있어. 남은 날이 여기 보여." },
  { sel: "#menu-btn", title: "다시 보고 싶으면", text: "이 안내랑 처음 소개는 메뉴에서 언제든 다시 볼 수 있어." },
];

function show(id) {
  ["onb", "setup", "first", "main"].forEach((s) => ($("#" + s).hidden = s !== id));
  $("#bar").hidden = id === "onb";
  const again = document.querySelector(".coach-again");
  if (again) again.hidden = id !== "main";  // 화면 안내는 메인 화면에서만
  window.scrollTo(0, 0);
}

/* 1. 온보딩: 소개 3장 */
function intro(then) {
  let i = 0;
  show("onb");
  const box = $("#onb");
  const draw = () => {
    const s = INTRO[i], last = i === INTRO.length - 1;
    box.innerHTML = `<div class="slide"><img src="${s.img}" alt=""><h1>${s.title}</h1><p>${s.text}</p></div>
      <div class="dots3" aria-hidden="true">${INTRO.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      <div class="onb-row">${last ? "" : '<button class="btn ghost" type="button" data-skip>건너뛰기</button>'}
        <button class="btn" type="button" data-next>${last ? "시작하기" : "다음"}</button></div>`;
    box.querySelector("[data-next]").onclick = () => (last ? end() : (i++, draw()));
    box.querySelector("[data-skip]")?.addEventListener("click", end);
    box.querySelector("[data-next]").focus({ preventScroll: true });
  };
  const end = () => { st.onboarded = true; save(); then(); };
  // 휴대폰에서 옆으로 밀어도 넘어가게
  let x0 = null;
  box.ontouchstart = (e) => (x0 = e.touches[0].clientX);
  box.ontouchend = (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (dx < -50) (i < INTRO.length - 1 ? (i++, draw()) : end());
    else if (dx > 50 && i > 0) (i--, draw());
  };
  draw();
}

/* 2. 생일 */
function setup() {
  show("setup");
  $("#birth-box").innerHTML = birthFields("me");
  let pre = st.birth;
  if (!pre) try { pre = JSON.parse(sessionStorage.getItem("ungyeol_birth") || "null"); } catch (e) { /* 없음 */ }
  if (pre?.year) {  // 첫 화면·상담실에서 넣었던 생일이 있으면 채워 둔다
    $("#me-y").value = pre.year; $("#me-m").value = pre.month; $("#me-d").value = pre.day;
    $("#me-h").value = pre.hour ?? ""; $("#me-min").value = pre.minute || "";
    const cal = pre.calendar === "lunar" ? (pre.leap ? "leap" : "lunar") : "solar";
    document.querySelector(`input[name="me-cal"][value="${cal}"]`).checked = true;
    const g = document.querySelector(`input[name="me-g"][value="${pre.gender}"]`);
    if (g) g.checked = true;
  }
  $("#setup-go").onclick = async () => {
    const b = readBirth("me"), y = +b.year, m = +b.month, d = +b.day;
    const err = $("#setup-err");
    if (!(y >= 1920 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { err.textContent = "태어난 해·월·일을 숫자로 적어 줘."; return; }
    if (!b.gender) { err.textContent = "성별을 골라 줘."; return; }
    err.textContent = "";
    st.birth = b;
    st.started = st.started || todayIso();
    try { await fetchData(); } catch (e) { err.textContent = e.message; st.birth = null; return; }
    save();
    if (!st.events.length && !st.askedFirst) firstEvent();
    else openMain();
  };
}

/* 2-1. 첫 일정 하나: 빈 화면부터 보지 않게, 생일 다음에 바로 하나 넣어 결과를 보여 준다 (사장님 2026-10-30) */
function firstEvent() {
  show("first");
  st.askedFirst = true;
  save();
  $("#f-kinds").innerHTML = DATA.kinds.map((k) => `<label><input type="radio" name="f-kind" value="${esc(k.key)}"><span>${esc(k.label)}</span></label>`).join("");
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));  // 다가오는 토요일 (오늘이 토요일이면 오늘)
  $("#f-date").value = iso(d);
  $("#f-date").min = todayIso();
  $("#f-kinds").onchange = () => ($("#f-err").textContent = "");
  $("#f-go").onclick = async () => {
    const kind = document.querySelector('input[name="f-kind"]:checked')?.value, date = $("#f-date").value;
    if (!kind) { $("#f-err").textContent = "무슨 일인지 하나 골라 줘."; return; }
    if (!date) { $("#f-err").textContent = "날짜를 골라 줘."; return; }
    st.events.push({ id: Date.now().toString(36), date, kind, memo: "" });
    save();
    VIEW = date.slice(0, 7);
    SEL = date;
    try { await load(); } catch (e) { $("#f-err").textContent = e.message; }
  };
  $("#f-skip").onclick = openMain;
}

/* 3. 메인: 오늘 · 이번 주 · 내 일정 */
async function fetchData() {
  DATA = await api("/api/myday", { birth: st.birth, month: VIEW, events: st.events.map(({ id, date, kind }) => ({ id, date, kind })) });
}
async function load() {
  await fetchData();
  openMain();
}
function openMain() {
  show("main");
  render();
  setTimeout(() => coach("app", TOUR), 500);  // 처음 한 번만 (coach 가 알아서 확인)
}

function render() {
  monthView();
  dayDetail();
  trial();
  events();
  $("#calbtns").innerHTML = calButtons(DATA.cal);
}

/* 한 달 운세 달력: 일요일부터, 날마다 좋음(노란 점)·조심(!)·내 일정 */
const WD = "일월화수목금토";
const short = (label) => label.split("·")[0].split("(")[0].trim();
function monthView() {
  const M = DATA.month, today = todayIso(), byDate = {};
  DATA.events.forEach((e) => (byDate[e.date] = byDate[e.date] || []).push(e));
  $("#m-title").textContent = `${M.year}년 ${M.month}월`;
  $("#m-flow").textContent = M.flow ? `${M.month}월 흐름 — ${M.flow}` : "";
  const lead = (M.days[0].dow + 1) % 7;  // 파이썬 요일(월=0) → 일요일 시작 칸
  $("#m-grid").innerHTML = [...WD].map((w, k) => `<div class="wd${k ? "" : " sun"}">${w}</div>`).join("")
    + "<div></div>".repeat(lead)
    + M.days.map((d) => {
      const evs = byDate[d.date] || [], cls = ["cell", d.past && "past", d.date === today && "today", d.date === SEL && "sel", (d.dow + 1) % 7 === 0 && "sun"].filter(Boolean).join(" ");
      const mk = d.fit === "좋음" ? '<i class="dot good"></i>' : d.fit === "조심" ? '<i class="dot care">!</i>' : "";
      const ev = evs.length ? `<span class="evt">${esc(short(evs[0].kind_label))}${evs.length > 1 ? " +" + (evs.length - 1) : ""}</span>` : "";
      return `<button type="button" class="${cls}" data-d="${d.date}" aria-label="${d.month || M.month}월 ${d.n}일 ${d.fit}${evs.length ? ", 일정 " + evs.length + "개" : ""}"><span class="n">${d.n}</span><span class="mk">${mk}</span>${ev}</button>`;
    }).join("");
  $("#m-grid").querySelectorAll(".cell").forEach((c) => (c.onclick = () => {
    SEL = c.dataset.d;
    monthView();
    dayDetail();
    $("#dayd").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}

function dayDetail() {
  const d = DATA.month.days.find((x) => x.date === SEL) || DATA.month.days[0];
  const dt = new Date(d.date + "T00:00"), label = `${dt.getMonth() + 1}/${dt.getDate()}(${WD[dt.getDay()]})`;
  const evs = DATA.events.filter((e) => e.date === d.date);
  $("#dayd").innerHTML = `<p class="kicker">${d.date === todayIso() ? "오늘 · " : ""}${label}</p>
    <p class="big">${esc(d.title)}<span class="fit ${esc(d.fit)}">${esc(d.fit)}</span></p>
    <h4>할 것</h4><p>${esc(d.do)}</p>
    <h4>조심할 것</h4><p>${esc(d.dont)}</p>
    ${evs.map((e) => `<div class="dayev"><div class="top"><b>${esc(e.kind_label)}</b><span class="fit ${esc(e.fit)}">${esc(e.fit)}</span></div><p>${esc(e.tip)}</p>
      ${e.better.length ? `<p class="small muted">고를 수 있다면 ${e.better.map((b) => esc(b.day)).join(", ")}이 더 좋아.</p>` : ""}</div>`).join("")}
    ${d.past ? "" : '<button class="btn ghost addday" type="button" id="add-day">+ 이날 일정 넣기</button>'}`;
  $("#add-day")?.addEventListener("click", () => openAdd(d.date));
}

async function goMonth(step) {
  const [y, m] = VIEW.split("-").map(Number), d = new Date(y, m - 1 + step, 1);
  VIEW = iso(d).slice(0, 7);
  SEL = VIEW === todayIso().slice(0, 7) ? todayIso() : `${VIEW}-01`;
  try { await fetchData(); render(); } catch (e) { alert(e.message); }
}
$("#m-prev").onclick = () => goMonth(-1);
$("#m-next").onclick = () => goMonth(1);

function trial() {
  const used = Math.floor((new Date(todayIso()) - new Date(st.started || todayIso())) / 864e5) + 1;
  $("#trial").textContent = used <= TRIAL_DAYS ? `무료 체험 ${used}/${TRIAL_DAYS}일` : "체험 끝 · 지금은 무료";
}

function events() {
  const box = $("#events"), memo = Object.fromEntries(st.events.map((e) => [e.id, e.memo]));
  if (!DATA.events.length) {
    box.innerHTML = `<div class="card empty">아직 일정이 없어.<br>다음 월급날이나 약속 하나 넣어 봐 — 그날 기운을 바로 알려 줄게.</div>`;
    return;
  }
  const today = todayIso();
  box.innerHTML = DATA.events.map((e) => `
    <article class="card ev${e.date < today ? " past" : ""}" data-id="${esc(e.id)}">
      <div class="top"><span class="when">${esc(e.day)}</span><span class="what">${esc(e.kind_label)}${memo[e.id] ? " · " + esc(memo[e.id]) : ""}</span>
        <span class="fit ${esc(e.fit)}">${esc(e.fit)}</span></div>
      <p class="tip">${esc(e.tip)}</p>
      <ul>${e.why.map((w) => `<li>${esc(w)}</li>`).join("")}<li>${esc(e.title)} — ${esc(e.mood)}</li></ul>
      ${e.better.length ? `<div class="better">날짜를 고를 수 있다면 <b>${e.better.map((b) => esc(b.day)).join(", ")}</b>이 이 일엔 더 좋아.<br>
        ${e.better.map((b) => `<button class="chipbtn" type="button" data-move="${esc(b.date)}">${esc(b.day)}로 옮기기</button>`).join("")}</div>` : ""}
      <div class="acts"><button class="linkish" type="button" data-del>지우기</button></div>
    </article>`).join("");
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const id = b.closest(".ev").dataset.id;
    st.events = st.events.filter((x) => x.id !== id);
    save(); load();
  }));
  box.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => {
    const ev = st.events.find((x) => x.id === b.closest(".ev").dataset.id);
    if (ev) { ev.date = b.dataset.move; save(); load(); }
  }));
}

/* 일정 넣기 */
function openSheet(id) { const s = $("#" + id); s.hidden = false; s.querySelector("button, input")?.focus(); }
function closeSheet(id) { $("#" + id).hidden = true; }
document.querySelectorAll(".sheet").forEach((s) => {
  s.addEventListener("click", (e) => { if (e.target === s || e.target.closest("[data-close]")) s.hidden = true; });
});
addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true)); });

$("#add-btn").onclick = () => openAdd(todayIso());
function openAdd(date) {
  $("#ev-date").value = date < todayIso() ? todayIso() : date;
  $("#ev-date").min = todayIso();
  $("#ev-memo").value = "";
  $("#add-err").textContent = "";
  $("#ev-kinds").innerHTML = DATA.kinds.map((k) => `<label><input type="radio" name="ev-kind" value="${esc(k.key)}"><span>${esc(k.label)}</span></label>`).join("");
  openSheet("add-sheet");
}
$("#add-save").onclick = async () => {
  const date = $("#ev-date").value, kind = document.querySelector('input[name="ev-kind"]:checked')?.value;
  if (!date) { $("#add-err").textContent = "날짜를 골라 줘."; return; }
  if (!kind) { $("#add-err").textContent = "무슨 일인지 골라 줘."; return; }
  if (st.events.length >= 60) { $("#add-err").textContent = "일정은 60개까지야. 지난 일정을 조금 지워 줘."; return; }
  st.events.push({ id: Date.now().toString(36), date, kind, memo: $("#ev-memo").value.trim().slice(0, 30) });
  save();
  closeSheet("add-sheet");
  VIEW = date.slice(0, 7);  // 넣은 날이 있는 달로 가서 그날을 보여 준다
  SEL = date;
  await load();
  $("#dayd").scrollIntoView({ behavior: "smooth", block: "center" });
};

/* 메뉴: 안내·소개 다시 보기, 생일 바꾸기, 지우기 */
$("#menu-btn").onclick = () => openSheet("menu");
$("#menu").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  closeSheet("menu");
  if (act === "tour") coach("app", TOUR, true);
  if (act === "intro") intro(() => (st.birth ? load() : setup()));
  if (act === "birth") setup();
  if (act === "clear" && confirm("일정을 모두 지울까? 되돌릴 수 없어.")) { st.events = []; save(); load(); }
});
coachAgain(() => coach("app", TOUR, true));

/* 시작 */
if (!st.onboarded) intro(() => (st.birth ? load() : setup()));
else if (st.birth) load().catch(() => setup());
else setup();
