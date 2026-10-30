/* 운결 운세 달력 (/app) — 운결 사이트 아래 메뉴의 '달력' (2026-10-30 사장님: 사주 · 상담 · 달력을 한 사이트 메뉴로).
   생일(사이트 어디서든 한 번 넣으면 공용, form.js loadBirth) → 한 달 운세 달력(날짜 누르면 그날 자세히)·내 일정.
   처음 안내는 소개 장(온보딩) 대신 화면을 짚어 주는 코치마크만 (사장님: "온보딩보다는 코치마크").
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
const birth = () => loadBirth() || st.birth;  // 예전 앱에만 저장된 생일도 씀

const TOUR = [
  { sel: "#mcal", title: "한 달 운세 달력", text: "노란 점은 좋은 날, 느낌표는 조심할 날이야. 맨 위엔 그달 흐름 한 줄. 옆 화살표로 다른 달도 봐." },
  { sel: "#dayd", title: "그날 깊게 보기", text: "날짜를 누르면 그날 어떤 기운이 들어오는지 자세히 풀어 줄게. 할 것·조심할 것, 일·돈·사람·몸, 행운 포인트, 그날 내 일정까지. 처음엔 오늘이야." },
  { sel: "#add-btn", title: "일정 넣기", text: "계약, 면접, 데이트… 날짜랑 무슨 일인지만 고르면 그날 그 일에 맞는지 알려 줄게." },
  { sel: "#trial", title: "7일 무료 체험", text: "지금은 전부 열려 있어. 남은 날이 여기 보여." },
  NAV_STEP,
];

function show(id) {
  ["setup", "main"].forEach((s) => ($("#" + s).hidden = s !== id));
  const again = document.querySelector(".coach-again");
  if (again) again.hidden = id !== "main";  // 화면 안내는 달력 화면에서만
  window.scrollTo(0, 0);
}

/* 1. 생일 (사이트에서 이미 넣었으면 건너뜀) */
function setup() {
  show("setup");
  $("#birth-box").innerHTML = birthFields("me");
  fillBirth("me", birth());
  $("#setup-go").onclick = async () => {
    const b = readBirth("me"), y = +b.year, m = +b.month, d = +b.day;
    const err = $("#setup-err");
    if (!(y >= 1920 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { err.textContent = "태어난 해·월·일을 숫자로 적어 줘."; return; }
    if (!b.gender) { err.textContent = "성별을 골라 줘."; return; }
    err.textContent = "";
    const old = birth();
    saveBirth(b);
    try { await load(); } catch (e) { err.textContent = e.message; if (old) saveBirth(old); return; }
  };
}

/* 3. 메인: 오늘 · 이번 주 · 내 일정 */
async function fetchData() {
  DATA = await api("/api/myday", { birth: birth(), month: VIEW, events: st.events.map(({ id, date, kind }) => ({ id, date, kind })) });
}
async function load() {
  await fetchData();
  st.started = st.started || todayIso();
  save();
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
    <p class="core">${esc(d.deep.core)}</p>
    ${d.deep.under ? `<p class="under">${esc(d.deep.under)}</p>` : ""}
    <div class="dogrid"><div><h4>할 것</h4><p>${esc(d.do)}</p></div><div><h4>조심할 것</h4><p>${esc(d.dont)}</p></div></div>
    <h4>분야별로 보면</h4>
    <dl class="areas">${d.deep.areas.map((a) => `<div><dt>${esc(a.k)}</dt><dd>${esc(a.v)}</dd></div>`).join("")}</dl>
    <h4>너의 다섯 기운으로 보면</h4><p>${esc(d.deep.element)}</p>
    ${d.deep.links.length ? `<h4>삶의 어느 부분이 움직이나</h4>${d.deep.links.map((l) => `<p>· ${esc(l)}</p>`).join("")}` : ""}
    <h4>행운 포인트</h4><p>${esc(d.deep.lucky)}</p>
    <p class="small muted note">재미로 보는 참고용이야. 중요한 결정은 네 판단이 먼저야.</p>
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
  if (act === "birth") setup();
  if (act === "clear" && confirm("일정을 모두 지울까? 되돌릴 수 없어.")) { st.events = []; save(); load(); }
});
coachAgain(() => coach("app", TOUR, true));

/* 시작 */
if (birth()) load().catch(() => setup());
else setup();
