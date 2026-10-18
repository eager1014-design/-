/* 운결 프론트엔드 — 해시 라우팅 SPA (의존성 없음) */
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const S = { me: null, config: null, chart: null };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => n.toLocaleString("ko-KR") + "원";
const fmtDate = (s) => { const d = new Date(s); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

async function api(path, body, method) {
  const r = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || "요청에 실패했습니다."); e.status = r.status; e.data = data; throw e; }
  return data;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
}

function md(src) {
  const lines = esc(src).split("\n");
  let html = "", list = false, para = [];
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const close = () => { if (list) { html += "</ul>"; list = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { flush(); close(); continue; }
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flush(); close(); const n = Math.min(4, Math.max(2, m[1].length)); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if (/^---+$/.test(l.trim())) { flush(); close(); html += "<hr>"; continue; }
    if ((m = l.match(/^&gt;\s?(.*)/))) { flush(); close(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/))) {
      flush(); if (!list) { html += "<ul>"; list = true; }
      const t = m[1].match(/^\[( |x)\]\s*(.*)/i);
      html += t ? `<li class="task">${t[1].trim() ? "☑" : "☐"} ${inline(t[2])}</li>` : `<li>${inline(m[1])}</li>`;
      continue;
    }
    close(); para.push(l.trim());
  }
  flush(); close();
  return html;
}

function loading(msg) {
  return `<div class="loading"><div class="spinner"></div><div class="serif">${esc(msg)}</div></div>`;
}

/* ------------------------------------------------------------ 공통 레이아웃 */
async function refreshMe() {
  S.me = await api("/api/me");
  renderNav();
  return S.me;
}

function renderNav() {
  const nav = $("#nav"), route = location.hash.split("?")[0] || "#/";
  const on = (h) => (route === h ? "on" : "");
  if (S.me?.user) {
    nav.innerHTML = `
      <a class="${on("#/chart")}" href="#/chart">내 사주</a>
      <a class="${on("#/reading")}" href="#/reading">상담 리포트</a>
      <a class="${on("#/counsel")}" href="#/counsel">고민 상담</a>
      <a class="${on("#/daily")}" href="#/daily">오늘의 운</a>
      <a class="${on("#/yearly")}" href="#/yearly">올해 운세</a>
      <a class="${on("#/match")}" href="#/match">궁합</a>
      <a class="${on("#/account")}" href="#/account">내 구독</a>`;
    nav.querySelector("a.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  } else {
    nav.innerHTML = `<a href="#/login">로그인</a><a class="btn" style="padding:7px 14px;color:#fff" href="#/signup">${S.config.trial_days}일 무료체험</a>`;
  }
  // 메뉴가 화면보다 길면 오른쪽을 흐리게 해서 옆으로 밀 수 있음을 알려준다.
  const hint = () => nav.classList.toggle("more", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  nav.onscroll = hint;
  window.onresize = hint;
  hint();
  const vb = $("#verifybar");
  vb.hidden = !(S.me?.user && !S.me.user.email_verified);
  if (!vb.hidden) {
    vb.innerHTML = `📧 <b>${esc(S.me.user.email)}</b>로 보낸 인증 링크를 눌러주세요 (구독하려면 인증이 필요해요) <button class="linkbtn" id="resend">인증 메일 다시 받기</button>`;
    $("#resend").onclick = async () => {
      try { const r = await api("/api/verify/send", {}); toast(r.already ? "이미 인증되었습니다." : "인증 메일을 다시 보냈습니다."); devLink(r); }
      catch (e) { toast(e.message); }
    };
  }
  const bar = $("#trialbar");
  const a = S.me?.access;
  bar.hidden = true; bar.className = "";
  if (!a) return;
  if (a.state === "trial") {
    bar.hidden = false;
    if (a.trial_days_left <= 2) bar.className = "warn";
    bar.innerHTML = `무료체험 <b>D-${a.trial_days_left}</b> · ${fmtDate(a.trial_ends_at)}까지 모든 상담을 무료로 이용하세요 <a href="#/subscribe">구독하고 계속 보기 →</a>`;
  } else if (a.state === "trial_scheduled") {
    bar.hidden = false;
    bar.innerHTML = `무료체험 D-${a.trial_days_left} · ${fmtDate(a.trial_ends_at)}부터 ${esc(a.plan_info?.name || "")}이 시작됩니다`;
  } else if (a.state === "expired" || a.state === "past_due") {
    bar.hidden = false; bar.className = "warn";
    bar.innerHTML = a.state === "past_due" ? `결제에 실패했습니다. 결제수단을 확인해 주세요 <a href="#/subscribe">결제 다시 하기</a>`
      : `${a.subscription_status ? "구독 기간이 끝났습니다" : "무료체험이 종료되었습니다"}. 내 사주의 흐름을 계속 따라가 보세요 <a href="#/subscribe">구독 시작하기</a>`;
  }
}


/* ------------------------------------------------------------ 공통 도우미 */
const AI_CONSENT_TEXT = "[필수] AI 풀이를 위해 입력한 생년월일·상황·고민 내용이 Google(미국)·OpenAI(미국)·Anthropic(미국)의 AI 서버로 전송되는 것(개인정보 국외 이전)에 동의합니다. <a href=\"#/privacy\" target=\"_blank\">자세히</a>";
function engineLabel(e) {
  if (!e || e === "rules") return "기본 해석";
  const name = { gemini: "제미나이", openai: "챗GPT", claude: "Claude" }[e.split(":")[0]] || e;
  return `AI 상담가 (${name})`;
}

function devLink(r) {
  // 메일 모의 모드(개발 환경)에서만 서버가 링크를 돌려준다.
  if (!r?.dev_link) return;
  S.devLink = r.dev_link;
  console.log("메일 링크:", r.dev_link);
  toast("🧪 개발 모드: 메일 대신 링크를 서버 로그와 콘솔에 출력했어요");
}

function calendarHTML(b) {
  const lunar = b.calendar === "lunar";
  return `<div class="seg" style="margin-bottom:6px">
      <label><input type="radio" name="calendar" value="solar" ${lunar ? "" : "checked"}><span>양력</span></label>
      <label><input type="radio" name="calendar" value="lunar" ${lunar ? "checked" : ""}><span>음력</span></label>
    </div>
    <label class="check leap" ${lunar ? "" : "hidden"}><input type="checkbox" name="leap" ${b.leap ? "checked" : ""}> <span>윤달이에요</span></label>`;
}

function bindCalendar(form) {
  const leap = form.querySelector(".leap");
  form.querySelectorAll('input[name="calendar"]').forEach((r) => (r.onchange = () => {
    leap.hidden = form.calendar.value !== "lunar";
    if (leap.hidden) form.leap.checked = false;
  }));
}

/* ------------------------------------------------------------ 페이지 */
const pages = {};

pages["#/"] = () => {
  const c = S.config;
  app.innerHTML = `
  <section class="hero">
    <div class="eyebrow">運 · 結 — 운을 엮어 길을 찾다</div>
    <h1>사주를 '보는' 것이 아니라,<br>내 기운을 <span style="color:var(--accent)">이해하는</span> 상담</h1>
    <p class="lead">생년월일시만으로 정해진 이야기를 듣는 대신, 지금 내가 처한 현실과 고민을 함께 털어놓으세요.
    타고난 기운이 왜 지금 이런 상황을 만드는지 설명하고, 그 기운을 어떻게 써야 할지 방향을 함께 찾습니다.</p>
    <div class="row" style="justify-content:center">
      <a class="btn lg" href="#/signup">${S.config.trial_days}일 무료로 시작하기</a>
      <a class="btn ghost lg" href="#/login">이미 회원이에요</a>
    </div>
    <p class="muted small" style="margin-top:12px">가입 시 결제수단 등록 없음 · 체험 종료 후 자동결제 없음</p>
  </section>

  <section class="grid3 steps" style="margin-top:24px">
    <div class="card"><h3>사주 + 지금의 상황</h3><p class="muted">생년월일시와 함께 요즘의 일, 관계, 마음 상태와 고민을 적어주세요. 같은 사주라도 처한 현실에 따라 풀이가 달라집니다.</p></div>
    <div class="card"><h3>기운을 이해하기</h3><p class="muted">오행·십신·대운이 무엇인지, 내 사주에 어떤 힘이 많고 부족한지 쉬운 비유로 설명합니다. 스스로 사주를 읽을 수 있게 됩니다.</p></div>
    <div class="card"><h3>고민에 맞는 방향</h3><p class="muted">지금의 대운·올해 흐름과 고민을 연결해, 이번 주·이번 달·올해 해볼 수 있는 구체적인 행동을 제시합니다.</p></div>
  </section>

  <section class="card" style="margin-top:28px">
    <h2>이런 분께 필요합니다</h2>
    <div class="grid2">
      <p class="quote">"회사를 계속 다녀야 할지, 지금이 이직할 때인지 모르겠어요."</p>
      <p class="quote">"왜 늘 비슷한 사람과 비슷한 문제로 부딪힐까요?"</p>
      <p class="quote">"사업을 시작하고 싶은데 내가 감당할 수 있는 시기일까요?"</p>
      <p class="quote">"요즘 이유 없이 지치고 방향을 잃은 느낌이에요."</p>
    </div>
  </section>

  <section style="margin-top:28px">
    <h2 class="serif" style="text-align:center">구독하면 매일 함께합니다</h2>
    <div class="grid3" style="margin-top:16px">
      <div class="card"><h3>📜 심층 상담 리포트</h3><p class="muted">한눈에 보는 요약부터 고민의 뿌리, 앞으로의 흐름, 실천 계획까지. 매달 운의 흐름이 바뀌면 새로 갱신됩니다.</p></div>
      <div class="card"><h3>💬 1:1 고민 상담</h3><p class="muted">"이 사람과 계속 일해도 될까요?" 같은 질문을 내 사주를 기억하는 상담가에게 언제든 물어보세요.</p></div>
      <div class="card"><h3>☀️ 오늘의 기운</h3><p class="muted">매일의 일진이 내 사주와 만나 만드는 하루의 흐름과 오늘 할 한 가지 행동.</p></div>
      <div class="card"><h3>🗓 올해·월별 운세</h3><p class="muted">올해의 큰 흐름과 12달 각각의 성격, 좋은 달과 조심할 달을 한눈에.</p></div>
      <div class="card"><h3>💞 궁합</h3><p class="muted">연인·배우자·동료·가족과 서로 끌리는 점, 부딪히는 점, 잘 지내는 법.</p></div>
    </div>
  </section>

  <section id="pricing" style="margin-top:28px">
    <div class="grid2">${Object.entries(c.plans).map(([k, p]) => `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">${p.name}</h3>${k === "yearly" ? '<span class="badge">추천</span>' : ""}</div>
        <div class="price">${won(p.price)} <small>/ ${k === "yearly" ? "년" : "월"}</small></div>
        <p class="muted small">${p.desc}</p>
        <ul class="ticks"><li>처음 ${c.trial_days}일 무료</li><li>심층 리포트 매월 갱신</li><li>고민 상담 하루 20회</li><li>오늘의 기운 매일</li><li>올해·월별 운세, 궁합</li></ul>
        <a class="btn block" href="#/signup">${c.trial_days}일 무료로 시작</a>
      </div>`).join("")}
    </div>
  </section>

  <section class="card" style="margin-top:28px">
    <h2>자주 묻는 질문</h2>
    <details class="learn"><summary>무료체험이 끝나면 자동으로 결제되나요?</summary><p>아니요. 가입할 때 결제수단을 받지 않습니다. 체험 중 직접 구독을 신청한 경우에만, 체험이 끝나는 날 첫 결제가 진행됩니다.</p></details>
    <details class="learn"><summary>음력 생일도 되나요?</summary><p>네. 음력(윤달 포함)으로 입력하면 한국천문연구원 기준으로 양력으로 바꿔 계산합니다. 1920~2050년 생일을 지원합니다.</p></details>
    <details class="learn"><summary>태어난 시간을 몰라도 되나요?</summary><p>네. 시주를 제외한 여섯 글자로 풀이합니다. 다만 시간을 알면 자녀·말년·내면의 성향까지 더 정확하게 볼 수 있습니다.</p></details>
    <details class="learn"><summary>만세력 계산은 정확한가요?</summary><p>절기(입춘·경칩 등)를 천문 계산으로 직접 구하고, 출생 지역의 경도와 한국의 역사적 표준시·서머타임을 반영해 시주를 보정합니다.</p></details>
    <details class="learn"><summary>해지는 어떻게 하나요?</summary><p>'내 구독'에서 버튼 한 번으로 해지할 수 있고, 이미 결제한 기간까지는 계속 이용할 수 있습니다.</p></details>
  </section>`;
};

pages["#/signup"] = () => {
  app.innerHTML = `
  <div class="narrow card">
    <h2>${S.config.trial_days}일 무료체험 시작</h2>
    <p class="muted small">결제수단 없이 바로 시작합니다. 체험 기간에는 모든 상담을 제한 없이 이용할 수 있어요.</p>
    <form id="f">
      ${S.config.invite_required ? '<label>초대 코드</label><input name="invite" required autocomplete="off" placeholder="초대받은 코드를 입력해 주세요">' : ""}
      <label>이름 또는 닉네임</label><input name="name" required maxlength="30" autocomplete="nickname">
      <label>이메일</label><input name="email" type="email" required autocomplete="email">
      <label>비밀번호 (8자 이상)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <label class="check"><input type="checkbox" name="agree"> <span>[필수] <a href="#/terms" target="_blank">이용약관</a>·<a href="#/privacy" target="_blank">개인정보 처리방침</a>에 동의하며, ${S.config.trial_days}일 무료체험은 결제수단 등록 없이 제공되고 체험 종료 후 자동결제되지 않음을 확인했습니다.</span></label>
      <label class="check"><input type="checkbox" name="agree_ai"> <span>${AI_CONSENT_TEXT}</span></label>
      <label class="check"><input type="checkbox" name="marketing"> <span>[선택] 체험 종료 안내 및 월간 운세 소식 받기</span></label>
      <div class="err" id="err"></div>
      <button class="btn block lg">무료체험 시작하기</button>
    </form>
    <p class="small muted" style="text-align:center">이미 계정이 있나요? <a href="#/login">로그인</a></p>
  </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const r = await api("/api/signup", { name: f.get("name"), email: f.get("email"), password: f.get("password"), agree: !!f.get("agree"), agree_ai: !!f.get("agree_ai"), marketing: !!f.get("marketing"), invite: f.get("invite") || "" });
      await refreshMe();
      toast("가입 완료! 인증 메일을 보냈어요.");
      devLink(r);
      location.hash = "#/onboard";
    } catch (err) { $("#err").textContent = err.message; btn.disabled = false; }
  };
};

pages["#/login"] = () => {
  app.innerHTML = `
  <div class="narrow card">
    <h2>로그인</h2>
    <form id="f">
      <label>이메일</label><input name="email" type="email" required autocomplete="email">
      <label>비밀번호</label><input name="password" type="password" required autocomplete="current-password">
      <div class="err" id="err"></div>
      <button class="btn block lg">로그인</button>
    </form>
    <p class="small muted" style="text-align:center"><a href="#/forgot">비밀번호를 잊으셨나요?</a> · 처음이신가요? <a href="#/signup">${S.config.trial_days}일 무료체험</a></p>
  </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/login", { email: f.get("email"), password: f.get("password") });
      await refreshMe();
      location.hash = S.me.profile ? "#/chart" : "#/onboard";
    } catch (err) { $("#err").textContent = err.message; }
  };
};

pages["#/onboard"] = () => {
  if (!needLogin()) return;
  const p = S.me.profile || { birth: { gender: "", city: "서울" }, situation: {} };
  const b = p.birth, s = p.situation, c = S.config;
  const yNow = new Date().getFullYear();
  const opt = (from, to, sel, fmt = (x) => x) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((v) => `<option value="${v}" ${v == sel ? "selected" : ""}>${fmt(v)}</option>`).join("");
  const branchName = ["자시(23~01)", "축시(01~03)", "인시(03~05)", "묘시(05~07)", "진시(07~09)", "사시(09~11)", "오시(11~13)", "미시(13~15)", "신시(15~17)", "유시(17~19)", "술시(19~21)", "해시(21~23)"];
  app.innerHTML = `
  <div class="narrow">
    <h1 style="font-size:28px">나의 사주와 지금의 이야기</h1>
    <p class="muted">같은 사주라도 지금 어떤 현실 속에 있는지에 따라 풀이가 달라집니다. 편하게, 구체적으로 적어주세요. 입력한 내용은 나만 볼 수 있어요.</p>
    <form id="f">
    <div class="card">
      <h3>1. 태어난 정보</h3>
      ${calendarHTML(b)}
      <div class="grid3" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div><label>년</label><select name="year">${opt(1920, yNow, b.year || 1990)}</select></div>
        <div><label>월</label><select name="month">${opt(1, 12, b.month || 1)}</select></div>
        <div><label>일</label><select name="day">${opt(1, 31, b.day || 1)}</select></div>
      </div>
      <div class="grid3" style="grid-template-columns:2fr 1fr;gap:8px">
        <div><label>태어난 시</label><select name="hour"><option value="unknown">모름</option>${opt(0, 23, b.hour ?? "x", (h) => `${String(h).padStart(2, "0")}시 · ${branchName[Math.floor((h + 1) / 2) % 12].split("(")[0]}`)}</select></div>
        <div><label>분</label><select name="minute">${opt(0, 59, b.minute || 0, (m) => String(m).padStart(2, "0"))}</select></div>
      </div>
      <label>성별 <span class="muted small">(대운의 방향 계산에 사용)</span></label>
      <div class="seg">
        <label><input type="radio" name="gender" value="female" ${b.gender === "female" ? "checked" : ""}><span>여성</span></label>
        <label><input type="radio" name="gender" value="male" ${b.gender === "male" ? "checked" : ""}><span>남성</span></label>
      </div>
      <label>태어난 지역 <span class="muted small">(경도에 따라 시간 보정)</span></label>
      <select name="city">${c.cities.map((x) => `<option ${x === b.city ? "selected" : ""}>${x}</option>`).join("")}</select>
    </div>
    <div class="card">
      <h3>2. 지금의 나</h3>
      <label>하는 일 / 현재 상태</label>
      <input name="job" value="${esc(s.job)}" placeholder="예: 7년차 마케터, 이직 준비 중 / 대학원생 / 육아휴직 중">
      <label>가장 큰 고민 분야</label>
      <div class="seg">${Object.entries(c.concerns).map(([k, v]) => `<label><input type="radio" name="concern" value="${k}" ${s.concern === k ? "checked" : ""}><span>${v}</span></label>`).join("")}</div>
      <label>지금 처한 상황과 고민을 자세히 적어주세요</label>
      <textarea name="story" placeholder="예: 3년 다닌 회사에서 새 팀장이 온 뒤로 계속 부딪히고 있어요. 하던 일은 좋아하는데 인정받지 못하는 느낌이라 퇴사를 고민 중입니다. 모아둔 돈은 6개월 정도 버틸 수 있는데, 프리랜서로 독립할지 다른 회사로 옮길지 결정을 못 하고 있어요.">${esc(s.story)}</textarea>
      <label>요즘 마음 상태 <span class="muted small">(선택)</span></label>
      <input name="mood" value="${esc(s.mood)}" placeholder="예: 불안하고 잠을 설침 / 의욕이 없음 / 설레지만 두려움">
      <label>어떻게 되고 싶나요? <span class="muted small">(선택)</span></label>
      <input name="goal" value="${esc(s.goal)}" placeholder="예: 1년 안에 안정적으로 독립하고 싶다">
      <div class="err" id="err"></div>
      ${S.me.user.ai_consent ? "" : `<label class="check"><input type="checkbox" name="ai_consent"> <span>${AI_CONSENT_TEXT}</span></label>`}
      <button class="btn block lg">내 사주 풀어보기</button>
    </div>
    </form>
  </div>`;
  bindCalendar($("#f"));
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.gender) return ($("#err").textContent = "성별을 선택해 주세요.");
    if (!f.concern) return ($("#err").textContent = "고민 분야를 선택해 주세요.");
    try {
      await api("/api/profile", {
        birth: { year: f.year, month: f.month, day: f.day, calendar: f.calendar, leap: !!f.leap, hour: f.hour, minute: f.minute, gender: f.gender, city: f.city },
        situation: { job: f.job, concern: f.concern, story: f.story, mood: f.mood, goal: f.goal },
        ai_consent: !!f.ai_consent,
      });
      S.chart = null;
      await refreshMe();
      location.hash = "#/chart";
    } catch (err) { $("#err").textContent = err.message; }
  };
};

function needLogin() {
  if (!S.me?.user) { location.hash = "#/login"; return false; }
  return true;
}
function needProfile() {
  if (!needLogin()) return false;
  if (!S.me.profile) { location.hash = "#/onboard"; return false; }
  return true;
}
async function getChart() {
  if (!S.chart) S.chart = await api("/api/chart");
  return S.chart;
}

function pillarHTML(p, isDay) {
  return `<div class="pillar ${isDay ? "me" : ""}">
    <div class="lab">${p.label}</div>
    <div class="god">${esc(p.stem_god)}</div>
    <div class="char stem e-${p.stem_element}">${p.hanja[0]}</div>
    <div class="char e-${p.branch_element}">${p.hanja[1]}</div>
    <div class="god">${esc(p.branch_god)}</div>
    <div class="serif" style="font-size:14px">${p.ko}</div>
    <div class="hidden-stems">${p.hidden.map((h) => h.stem.slice(0, 1)).join("·")}</div>
  </div>`;
}

pages["#/chart"] = async () => {
  if (!needProfile()) return;
  app.innerHTML = loading("만세력을 펼치는 중…");
  const d = await getChart();
  const ch = d.chart, lk = d.luck, dm = d.day_master_info;
  const order = ch.order;
  const els = ch.elements, maxE = Math.max(...Object.values(els), 1);
  const g = ch.ten_god_groups;
  const rels = ch.relations.map((r) => `<span class="chip ${r.type === "충" ? "clash" : "harm"}">${esc(r.text)} · ${r.between.join("-")}</span>`).join("") || '<span class="muted small">두드러진 합·충 없음 — 비교적 안정된 구조</span>';
  const sals = ch.shinsal.map((s) => `<details class="learn"><summary>${s.name} <span class="muted small">(${s.pillar})</span></summary><p>${esc(d.shinsal_info[s.name])}</p></details>`).join("");
  const curAge = lk.age;
  const sel = (x) => (x.relations.length ? x.relations.map((r) => r.text).join(", ") : "");

  app.innerHTML = `
  <div class="row" style="justify-content:space-between;margin-bottom:12px">
    <div><h1 style="font-size:28px;margin:0">${esc(S.me.user.name)}님의 사주 원국</h1>
    <p class="muted small" style="margin:4px 0 0">${d.birth?.calendar === "lunar" ? `음력 ${d.birth.year}.${d.birth.month}.${d.birth.day}${d.birth.leap ? "(윤달)" : ""} → ` : ""}양력 ${ch.input.year}.${ch.input.month}.${ch.input.day} ${ch.input.time_known ? `${String(ch.input.hour).padStart(2, "0")}:${String(ch.input.minute).padStart(2, "0")}` : "(시간 모름)"} · ${ch.input.gender === "male" ? "남" : "여"} · ${esc(ch.input.city)} · 시간보정 ${ch.time_correction_min}분 · ${ch.animal}띠</p></div>
    <a class="btn ghost" href="#/onboard">정보 수정</a>
  </div>

  <div class="card">
    <div class="pillars" style="--n:${order.length}">${order.map((k) => pillarHTML(ch.pillars[k], k === "day")).join("")}</div>
    <details class="learn" style="margin-top:16px"><summary>📖 이 표는 어떻게 읽나요?</summary>
      <p>사주(四柱)는 태어난 <b>년·월·일·시</b> 네 기둥, 팔자(八字)는 각 기둥의 위 글자(천간)와 아래 글자(지지)를 합친 여덟 글자입니다.
      금색 테두리의 <b>일주 천간</b>이 바로 '나'이고, 나머지 일곱 글자는 나를 둘러싼 환경과 관계입니다. 글자 위아래의 작은 글씨(비견·정관 등)는 '나'와 그 글자의 관계를 뜻하는 <b>십신</b>입니다.
      색은 오행을 뜻합니다: <span class="t-목">■목</span> <span class="t-화">■화</span> <span class="t-토">■토</span> <span class="t-금">■금</span> <span class="t-수">■수</span></p>
      <p>년주는 조상·어린 시절, 월주는 부모·사회 환경(가장 힘이 셈), 일주는 나와 배우자, 시주는 자녀·말년·내면을 상징합니다.</p></details>
  </div>

  <div class="card">
    <span class="badge">일간 · 나의 본질</span>
    <h2 style="margin-top:8px"><span class="t-${ch.day_master.element}">${ch.day_master.hanja}</span> ${ch.day_master.ko}${ch.day_master.element} — ${esc(dm.image)}</h2>
    <p>${esc(dm.nature)}</p>
    <div class="grid2"><div><b>타고난 강점</b><p class="muted">${esc(dm.strength)}</p></div><div><b>주의할 그림자</b><p class="muted">${esc(dm.shadow)}</p></div></div>
  </div>

  <div class="grid2" style="margin-top:20px">
    <div class="card">
      <h3>오행의 균형</h3>
      <div class="bars">${Object.entries(els).map(([k, v]) => `<div class="bar"><span class="t-${k}"><b>${k}</b></span><div class="track"><div class="fill e-${k}" style="width:${(v / maxE) * 100}%"></div></div><span class="small muted">${v}</span></div>`).join("")}</div>
      <div class="explain">${Object.entries(els).filter(([, v]) => v >= 3 || v < 0.8).map(([k, v]) => `<p><b class="t-${k}">${k}(${d.element_info[k].meaning})</b> ${v >= 3 ? "많음 — " + d.element_info[k].excess : "부족 — " + d.element_info[k].lack}</p>`).join("") || "<p>오행이 비교적 고르게 분포되어 있습니다.</p>"}</div>
    </div>
    <div class="card">
      <h3>신강·신약과 용신</h3>
      <p style="font-size:20px" class="serif"><b>${ch.strength}</b> · 용신 <b class="t-${ch.yongsin}">${ch.yongsin}</b> · 기신 <span class="t-${ch.gisin}">${ch.gisin}</span></p>
      <div class="explain">
        <p><b>신강/신약</b>은 나(일간)를 돕는 기운이 사주에 얼마나 있는지입니다. 강하면 에너지를 밖으로 써야(일·표현·재물) 편안하고, 약하면 배움·휴식·조력자로 채워야 편안합니다.</p>
        <p><b>용신 ${ch.yongsin}</b>은 내 사주의 균형을 잡아주는 '약' 같은 기운입니다. ${esc(d.element_info[ch.yongsin].boost)}.</p>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:20px">
    <h3>다섯 가지 힘 — 십신 분포</h3>
    <div class="bars">${Object.entries(g).map(([k, v]) => `<div class="bar"><b>${k}</b><div class="track"><div class="fill" style="width:${(v / 4) * 100}%;background:var(--gold)"></div></div><span class="small muted">${v}</span></div>`).join("")}</div>
    <div class="explain">${Object.entries(g).map(([k, v]) => `<p><b>${k}</b> (${d.group_info[k]}) — ${v === 0 ? "없음: 후천적으로 배우고 채워가는 영역" : v >= 3 ? "많음: 삶의 핵심 테마" : "적당함"}</p>`).join("")}</div>
    ${Object.keys(ch.ten_god_counts).map((k) => `<details class="learn"><summary>${k} · ${esc(d.ten_god_info[k].key)} ×${ch.ten_god_counts[k]}</summary><p>👍 ${esc(d.ten_god_info[k].plus)}<br>⚠️ ${esc(d.ten_god_info[k].minus)}<br>🏠 ${esc(d.ten_god_info[k].life)}</p></details>`).join("")}
  </div>

  <div class="card">
    <h3>합·충과 신살</h3>
    <p class="small muted">충(沖)은 부딪혀 움직이는 기운(변화·이동), 합(合)은 끌어당겨 묶이는 기운(인연·협력)입니다.</p>
    <div>${rels}</div>
    ${sals}
  </div>

  <div class="card">
    <h3>대운 — 10년마다 바뀌는 인생의 계절 <span class="muted small">(${ch.daeun_forward ? "순행" : "역행"}, ${ch.daeun_start_age}대운)</span></h3>
    <div class="daeun">${ch.daeun.map((x, i) => { const nx = ch.daeun[i + 1]; const now = x.age <= curAge && (!nx || nx.age > curAge); return `<div class="d ${now ? "now" : ""}"><div class="muted">${x.age}세</div><b><span class="t-${x.stem_element}">${x.hanja[0]}</span><span class="t-${x.branch_element}">${x.hanja[1]}</span></b><div>${x.stem_god}</div><div class="muted">${x.branch_god}</div></div>`; }).join("")}</div>
  </div>

  <div class="card">
    <h3>지금 나를 둘러싼 운의 환경</h3>
    <div class="grid2">
      ${lk.daeun ? `<div><span class="badge red">현재 대운</span> <b class="serif">${lk.daeun.ko}(${lk.daeun.hanja})</b> ${lk.daeun.age}세~<p class="small">${esc(d.luck_god_info[lk.daeun.stem_god])}</p>${sel(lk.daeun) ? `<span class="chip clash">${sel(lk.daeun)}</span>` : ""}</div>` : ""}
      <div><span class="badge red">${lk.year.year}년 세운</span> <b class="serif">${lk.year.ko}(${lk.year.hanja})</b> ${lk.year.stem_god}·${lk.year.branch_god}<p class="small">${esc(d.luck_god_info[lk.year.stem_god])}</p>${sel(lk.year) ? `<span class="chip clash">${sel(lk.year)}</span>` : ""}</div>
      <div><span class="badge gray">이번 달</span> <b class="serif">${lk.month.ko}(${lk.month.hanja})</b> ${lk.month.stem_god}·${lk.month.branch_god}</div>
      <div><span class="badge gray">오늘</span> <b class="serif">${lk.day.ko}(${lk.day.hanja})</b> ${lk.day.stem_god}·${lk.day.branch_god}</div>
    </div>
  </div>

  <div class="card" style="text-align:center">
    <h2>이 기운이 지금 나의 고민과 어떻게 연결될까요?</h2>
    <p class="muted">원국과 현재 운, 그리고 적어주신 상황을 함께 읽어 고민의 뿌리와 나아갈 방향을 풀어드립니다.</p>
    <a class="btn lg" href="#/reading">심층 상담 리포트 받기</a>
  </div>`;
};

function paywallHTML(acc, teaser) {
  return `<div class="card">
    ${teaser ? `<div class="md locked">${teaser}</div>` : ""}
    <div class="paywall">
      <h2>${acc && acc.subscription_status ? "구독 기간이 끝났어요" : "무료체험이 종료되었어요"}</h2>
      <p class="muted">지금의 고민이 어떤 기운에서 비롯되었는지, 앞으로 어떤 흐름이 오는지 계속 함께 보세요.</p>
      <a class="btn lg" href="#/subscribe">구독하고 이어보기</a>
      <p class="small muted">${won(S.config.plans.monthly.price)}/월 · 언제든 해지</p>
    </div></div>`;
}

pages["#/reading"] = async (q) => {
  if (!needProfile()) return;
  app.innerHTML = `<div class="card">${loading("사주와 지금의 이야기를 함께 읽고 있습니다… (1~2분 걸려요)")}</div>`;
  try {
    const r = await api("/api/reading", { refresh: q.get("refresh") === "1" });
    app.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h1 style="font-size:28px;margin:0">${esc(S.me.user.name)}님의 상담 리포트</h1>
        <span class="muted small">${fmtDate(r.created_at)} 작성 · ${engineLabel(r.engine)}</span>
      </div>
      <article class="card md">${md(r.markdown)}</article>
      <div class="card row" style="justify-content:space-between">
        <div><b>더 궁금한 점이 있나요?</b><div class="muted small">리포트를 바탕으로 구체적인 질문을 이어가 보세요.</div></div>
        <div class="row"><a class="btn ghost" href="#/reading?refresh=1">다시 풀이</a><a class="btn" href="#/counsel">고민 상담하기</a></div>
      </div>`;
  } catch (e) {
    if (e.status === 402) {
      const d = await getChart();
      const dm = d.day_master_info, ch = d.chart;
      app.innerHTML = paywallHTML(e.data.access, md(`## 1. 나의 타고난 기운\n\n${S.me.user.name}님은 **${ch.day_master.ko}${ch.day_master.element} 일간 — ${dm.image}**입니다. ${dm.nature}\n\n${ch.strength} 사주로, 용신은 **${ch.yongsin}**입니다. 지금 ${d.luck.year.year}년은 ${d.luck.year.stem_god}의 해로…`));
    } else app.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
};

pages["#/counsel"] = async () => {
  if (!needProfile()) return;
  const acc = S.me.access;
  if (!acc.has_access) { app.innerHTML = paywallHTML(acc); return; }
  const hist = (await api("/api/readings")).readings.filter((r) => r.kind === "counsel").reverse();
  const concern = S.me.profile.situation.concern;
  const sugg = {
    career: ["지금 퇴사해도 괜찮은 시기인가요?", "저에게 맞는 일의 형태는 무엇인가요?", "상사와의 갈등을 어떻게 풀어야 할까요?"],
    money: ["올해 투자보다 저축이 맞을까요?", "사업을 시작하기 좋은 시기는 언제인가요?", "돈이 자꾸 새는 이유가 사주에 있나요?"],
    love: ["지금 만나는 사람과 잘 맞을까요?", "제 연애가 늘 비슷하게 끝나는 이유는요?", "결혼운이 들어오는 시기는 언제인가요?"],
    relation: ["가족과의 갈등을 어떻게 바라봐야 할까요?", "저는 어떤 사람과 잘 맞나요?", "관계에서 제가 반복하는 패턴은요?"],
    health: ["요즘 지치는 이유를 기운으로 설명해 주세요", "제게 맞는 휴식과 운동은 무엇인가요?", "스트레스를 어떻게 다스리면 좋을까요?"],
    study: ["시험운이 좋은 시기는 언제인가요?", "제게 맞는 공부 방법은요?", "진학과 취업 중 어느 쪽이 맞을까요?"],
    change: ["이사·이직을 하기 좋은 시기는요?", "지금 변화를 주는 게 맞을까요?", "제게 좋은 방향(지역)이 있나요?"],
  }[concern] || [];
  app.innerHTML = `
    <h1 style="font-size:28px">고민 상담</h1>
    <p class="muted">${esc(S.me.user.name)}님의 사주와 지금의 상황을 기억하는 상담가에게 무엇이든 물어보세요.</p>
    <div class="card chat" id="chat">${hist.length ? "" : '<p class="muted">첫 질문을 남겨보세요. 사주 근거와 함께 오늘 해볼 수 있는 행동까지 알려드립니다.</p>'}${hist.map((h) => `<div class="msg q"><span>${esc(h.question)}</span></div><div class="msg a md">${md(h.content)}</div>`).join("")}</div>
    <div class="card">
      <form id="f"><textarea name="q" style="min-height:90px" placeholder="예: 팀장님과 계속 부딪히는데, 제 사주에서 보면 어떤 기운 때문인가요? 어떻게 대처하면 좋을까요?"></textarea>
      <div class="suggest">${sugg.map((s) => `<button type="button" class="btn ghost small" style="padding:6px 12px;font-size:13px">${s}</button>`).join("")}</div>
      <div class="err" id="err"></div><button class="btn block">상담 요청</button></form>
    </div>`;
  const chat = $("#chat");
  chat.lastElementChild?.scrollIntoView?.({ block: "end" });
  app.querySelectorAll(".suggest button").forEach((b) => (b.onclick = () => ($("#f").q.value = b.textContent)));
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim(); if (!q) return;
    const btn = e.target.querySelector("button.block"); btn.disabled = true;
    if (!hist.length) chat.innerHTML = "";
    chat.insertAdjacentHTML("beforeend", `<div class="msg q"><span>${esc(q)}</span></div><div class="msg a" id="pending">${loading("기운을 살피는 중…")}</div>`);
    $("#pending").scrollIntoView({ block: "center" });
    e.target.q.value = "";
    try {
      const r = await api("/api/counsel", { question: q });
      const p = $("#pending"); p.id = ""; p.classList.add("md"); p.innerHTML = md(r.markdown);
      $("#err").textContent = `오늘 남은 상담 ${r.remaining}회`;
      hist.push(1);
    } catch (err) { $("#pending").remove(); $("#err").textContent = err.message; }
    btn.disabled = false;
  };
};

pages["#/daily"] = async () => {
  if (!needProfile()) return;
  if (!S.me.access.has_access) { app.innerHTML = paywallHTML(S.me.access); return; }
  app.innerHTML = `<div class="card">${loading("오늘의 일진을 살피는 중…")}</div>`;
  try {
    const r = await api("/api/daily");
    const d = r.day;
    app.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="muted">${r.today.replace(/-/g, ".")}</div>
        <div class="pillars" style="--n:1;max-width:120px;margin:10px auto"><div class="pillar"><div class="lab">오늘의 일진</div>
          <div class="char e-${d.stem_element}">${d.hanja[0]}</div><div class="char e-${d.branch_element}">${d.hanja[1]}</div><div class="serif">${d.ko}</div></div></div>
        <p>나에게는 <b>${d.stem_god}·${d.branch_god}</b>의 날</p>
      </div>
      <article class="card md">${md(r.markdown)}</article>
      <p class="muted small" style="text-align:center">오늘의 기운은 매일 자정에 새로 열립니다. 내일도 찾아와 주세요.</p>`;
  } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
};

pages["#/subscribe"] = (q) => {
  if (!needLogin()) return;
  const c = S.config, a = S.me.access;
  let plan = "yearly";
  const inTrial = a.state === "trial";
  const fail = q.get("fail");
  app.innerHTML = `
    <div class="narrow">
      <h1 style="font-size:28px">구독하고 계속 함께하기</h1>
      ${fail ? `<div class="card err" style="margin-bottom:16px">${esc(fail)}</div>` : ""}
      <p class="muted">${inTrial ? `지금 등록해도 <b>${fmtDate(a.trial_ends_at)}까지는 무료</b>이고, 체험이 끝나는 날 첫 결제가 진행됩니다. 그 전에 해지하면 비용이 청구되지 않아요.` : "결제 즉시 모든 상담이 다시 열립니다."}</p>
      <div class="grid2" id="plans">${Object.entries(c.plans).map(([k, p]) => `
        <div class="card plan ${k === plan ? "sel" : ""}" data-k="${k}">
          <div class="row" style="justify-content:space-between"><b>${p.name}</b>${k === "yearly" ? '<span class="badge">33% 할인</span>' : ""}</div>
          <div class="price">${won(p.price)}<small> / ${k === "yearly" ? "년" : "월"}</small></div>
          <div class="muted small">${p.desc}</div>
        </div>`).join("")}</div>
      <div class="card">
        <ul class="ticks"><li>심층 상담 리포트 (매월 운 흐름에 맞춰 갱신)</li><li>1:1 고민 상담 하루 20회</li><li>매일 오늘의 기운</li><li>올해·월별 운세, 궁합 (하루 10회)</li><li>상담 기록 보관</li></ul>
        <label class="check"><input type="checkbox" id="agree"> <span>[필수] 선택한 요금제가 ${inTrial ? "체험 종료일부터 " : ""}매 결제주기마다 자동결제되며, '내 구독'에서 언제든 해지할 수 있음을 확인했습니다.</span></label>
        <div class="err" id="err"></div>
        <button class="btn block lg" id="go">${inTrial ? "결제수단 등록 (체험 종료 후 결제)" : "구독 시작하기"}</button>
        ${c.mode === "mock" ? '<p class="small muted" style="text-align:center">🧪 개발 모드: 결제 키가 설정되지 않아 실제 결제 없이 시뮬레이션됩니다.</p>' : ""}
      </div>
    </div>`;
  app.querySelectorAll(".plan").forEach((el) => (el.onclick = () => {
    plan = el.dataset.k; app.querySelectorAll(".plan").forEach((x) => x.classList.toggle("sel", x === el));
  }));
  $("#go").onclick = async () => {
    if (!$("#agree").checked) return ($("#err").textContent = "자동결제 안내에 동의해 주세요.");
    const btn = $("#go"); btn.disabled = true;
    try {
      const prep = await api("/api/billing/prepare", { plan });
      if (prep.mode === "mock") {
        if (!confirm(`[결제 시뮬레이션]\n${c.plans[plan].name} ${won(c.plans[plan].price)}\n테스트 카드(4330-****-****-1234)로 등록합니다.`)) { btn.disabled = false; return; }
        const r = await api("/api/billing/mock-register", { plan, customerKey: prep.customerKey });
        await refreshMe();
        toast(r.charged ? `${won(r.charged)} 결제가 완료되었습니다.` : `등록 완료! ${fmtDate(r.next_billing)}에 첫 결제가 진행됩니다.`);
        location.hash = "#/account";
      } else {
        await loadScript("https://js.tosspayments.com/v2/standard");
        const tp = window.TossPayments(prep.clientKey);
        const payment = tp.payment({ customerKey: prep.customerKey });
        await payment.requestBillingAuth({ method: "CARD", successUrl: prep.successUrl, failUrl: prep.failUrl, customerEmail: prep.customerEmail, customerName: prep.customerName });
      }
    } catch (err) {
      $("#err").innerHTML = esc(err.message) + (err.data?.need_verify ? ` <button class="linkbtn" id="rs">인증 메일 다시 받기</button>` : "");
      const rs = $("#rs");
      if (rs) rs.onclick = async () => { const r = await api("/api/verify/send", {}); toast("인증 메일을 보냈습니다."); devLink(r); };
      btn.disabled = false;
    }
  };
};

function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("결제 모듈을 불러오지 못했습니다."));
    document.head.appendChild(s);
  });
}

pages["#/account"] = async (q) => {
  if (!needLogin()) return;
  await refreshMe();
  const a = S.me.access, u = S.me.user, c = S.config;
  if (q.get("welcome")) toast("구독이 등록되었습니다. 함께해 주셔서 감사합니다!");
  const label = { trial: "무료체험 중", trial_scheduled: "무료체험 중 · 구독 예약됨", active: "구독 중", canceled_active: "해지 예정", expired: "이용 종료", past_due: "결제 실패" }[a.state];
  const history = (await api("/api/readings")).readings;
  app.innerHTML = `
    <div class="narrow">
      <h1 style="font-size:28px">내 구독</h1>
      <div class="card">
        <div class="row" style="justify-content:space-between"><b>${esc(u.name)}</b><span class="badge ${a.has_access ? "" : "red"}">${label}</span></div>
        <p class="muted small">${esc(u.email)} · 가입 ${fmtDate(u.created_at)}</p>
        ${a.state === "trial" ? `<p>무료체험 종료: <b>${fmtDate(a.trial_ends_at)}</b> (D-${a.trial_days_left})</p><a class="btn block" href="#/subscribe">구독 등록하기</a>` : ""}
        ${a.state === "trial_scheduled" ? `<p>${esc(a.plan_info.name)} · 첫 결제 예정일 <b>${fmtDate(a.current_period_end)}</b> (${won(a.plan_info.price)})<br><span class="muted small">결제수단: ${esc(a.card_info)}</span></p>` : ""}
        ${a.state === "active" ? `<p>${esc(a.plan_info.name)} · 다음 결제일 <b>${fmtDate(a.current_period_end)}</b> (${won(a.plan_info.price)})<br><span class="muted small">결제수단: ${esc(a.card_info)}</span></p>` : ""}
        ${a.state === "canceled_active" ? `<p>${fmtDate(a.current_period_end)}까지 이용할 수 있으며 이후 자동결제되지 않습니다.</p><button class="btn block" id="resume">구독 다시 이어가기</button>` : ""}
        ${a.state === "expired" || a.state === "past_due" ? `<a class="btn block" href="#/subscribe">구독 시작하기</a>` : ""}
        ${a.subscription_status === "active" ? `<button class="btn ghost block" id="cancel" style="margin-top:10px">구독 해지</button>` : ""}
      </div>
      <div class="card">
        <h3>상담 기록</h3>
        ${history.length ? history.slice(0, 20).map((h) => `<details class="learn"><summary>${{ full: "📜 상담 리포트", counsel: "💬 " + esc((h.question || "").slice(0, 40)), daily: "☀️ 오늘의 기운", yearly: "🗓 " + esc(h.question || "올해 운세"), match: "💞 " + esc(h.question || "궁합") }[h.kind] || esc(h.kind)} <span class="muted small">${fmtDate(h.created_at)}</span></summary><div class="md">${md(h.content)}</div></details>`).join("") : '<p class="muted">아직 기록이 없습니다.</p>'}
      </div>
      <div class="card row" style="justify-content:space-between">
        <a class="btn ghost" href="#/onboard">사주·상황 정보 수정</a>
        <button class="btn ghost" id="logout">로그아웃</button>
      </div>
      <div class="card">
        <details class="learn"><summary class="muted small">회원 탈퇴</summary>
          <p class="small">탈퇴하면 사주 정보, 적어주신 고민, 모든 상담 기록이 <b>즉시 삭제되고 되돌릴 수 없어요.</b> 구독 중이라면 자동결제도 멈춥니다. (결제 기록만 전자상거래법에 따라 5년간 보관돼요.)</p>
          <input type="password" id="delpw" placeholder="비밀번호 확인" autocomplete="current-password">
          <div class="err" id="delerr"></div>
          <button class="btn ghost block" id="delbtn" style="color:var(--accent)">탈퇴하고 모든 정보 삭제</button>
        </details>
      </div>
      ${c.mode === "mock" ? `<div class="card"><b>🧪 개발자 도구</b><p class="muted small">무료체험/결제 기간이 끝난 상황을 즉시 재현합니다(결제 수단이 있으면 갱신 결제가 시뮬레이션됩니다).</p><button class="btn ghost" id="expire">체험·결제기간 종료 시뮬레이션</button></div>` : ""}
    </div>`;
  $("#logout").onclick = async () => { await api("/api/logout", {}); S.me = null; S.chart = null; await refreshMe(); location.hash = "#/"; };
  $("#delbtn").onclick = async () => {
    if (!confirm("정말 탈퇴할까요? 모든 사주·상담 기록이 즉시 삭제되고 되돌릴 수 없습니다.")) return;
    try {
      await api("/api/account/delete", { password: $("#delpw").value });
      S.me = null; S.chart = null; await refreshMe();
      toast("탈퇴가 완료되었습니다. 그동안 함께해 주셔서 감사합니다.");
      location.hash = "#/";
    } catch (e) { $("#delerr").textContent = e.message; }
  };
  const cancel = $("#cancel");
  if (cancel) cancel.onclick = async () => {
    if (!confirm("구독을 해지할까요? 남은 기간까지는 계속 이용할 수 있습니다.")) return;
    await api("/api/billing/cancel", {}); toast("해지되었습니다."); route();
  };
  const resume = $("#resume");
  if (resume) resume.onclick = async () => { await api("/api/billing/resume", {}); toast("구독이 다시 이어집니다."); route(); };
  const ex = $("#expire");
  if (ex) ex.onclick = async () => { await api("/api/dev/expire-trial", {}); S.chart = null; toast("기간 종료를 시뮬레이션했습니다."); route(); };
};

pages["#/yearly"] = async (q) => {
  if (!needProfile()) return;
  if (!S.me.access.has_access) { app.innerHTML = paywallHTML(S.me.access); return; }
  app.innerHTML = `<div class="card">${loading("열두 달의 흐름을 펼치는 중… (1~2분 걸려요)")}</div>`;
  try {
    const year = q.get("year") || "";
    const r = await api(`/api/yearly?year=${encodeURIComponent(year)}${q.get("refresh") === "1" ? "&refresh=1" : ""}`);
    const cur = r.current_year;
    app.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h1 style="font-size:28px;margin:0">${r.year}년 운세</h1>
        <div class="seg" style="max-width:240px">
          <label><input type="radio" name="y" value="${cur}" ${r.year === cur ? "checked" : ""}><span>${cur}년</span></label>
          <label><input type="radio" name="y" value="${cur + 1}" ${r.year === cur + 1 ? "checked" : ""}><span>${cur + 1}년</span></label>
        </div>
      </div>
      <div class="card">
        <div class="months">${r.months.map((m) => `
          <div class="mo ${m.clash ? "clash" : m.yongsin_hit ? "good" : ""}">
            <div class="muted small">${m.solar_month}월 · ${m.jie} ${m.start.slice(5).replace("-", "/")}~</div>
            <b class="serif"><span class="t-${m.stem_element}">${m.hanja[0]}</span><span class="t-${m.branch_element}">${m.hanja[1]}</span></b>
            <div class="small">${esc(m.stem_god)}</div>
            ${m.clash ? '<span class="chip clash">조심</span>' : m.yongsin_hit ? '<span class="chip harm">기회</span>' : ""}
          </div>`).join("")}</div>
        <p class="muted small" style="margin:10px 0 0">사주의 한 달은 1일이 아니라 절기(입춘·경칩…)에 바뀝니다. <span class="t-목">기회</span>는 균형을 맞춰주는 기운이 들어오는 달, <span class="t-화">조심</span>은 내 사주와 부딪히는 달이에요.</p>
      </div>
      <article class="card md">${md(r.markdown)}</article>
      <div class="card row" style="justify-content:space-between">
        <span class="muted small">${fmtDate(r.created_at)} 작성 · ${engineLabel(r.engine)}</span>
        <a class="btn ghost" href="#/yearly?year=${r.year}&refresh=1">다시 풀이</a>
      </div>`;
    app.querySelectorAll('input[name="y"]').forEach((el) => (el.onchange = () => (location.hash = `#/yearly?year=${el.value}`)));
  } catch (e) {
    if (e.status === 402) app.innerHTML = paywallHTML(e.data.access);
    else app.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
};

pages["#/match"] = async () => {
  if (!needProfile()) return;
  if (!S.me.access.has_access) { app.innerHTML = paywallHTML(S.me.access); return; }
  const c = S.config, yNow = new Date().getFullYear();
  const opt = (from, to, sel, fmt = (x) => x) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((v) => `<option value="${v}" ${v == sel ? "selected" : ""}>${fmt(v)}</option>`).join("");
  const past = (await api("/api/readings")).readings.filter((r) => r.kind === "match");
  app.innerHTML = `
    <div class="narrow">
      <h1 style="font-size:28px">궁합</h1>
      <p class="muted">상대방의 생일을 알려주세요. 두 사주가 서로 끌리는 점, 부딪히는 점, 잘 지내는 법을 풀어드려요.</p>
      <form id="f" class="card">
        <label>상대방 이름(닉네임)</label><input name="name" maxlength="20" placeholder="예: 민수" required>
        <label>관계</label>
        <div class="seg">${["연인", "배우자", "썸·소개", "친구", "동료·상사", "가족"].map((x, i) => `<label><input type="radio" name="relation" value="${x}" ${i === 0 ? "checked" : ""}><span>${x}</span></label>`).join("")}</div>
        <label>상대방 생일</label>
        ${calendarHTML({})}
        <div class="grid3" style="grid-template-columns:repeat(3,1fr);gap:8px">
          <div><label>년</label><select name="year">${opt(1920, yNow, 1990)}</select></div>
          <div><label>월</label><select name="month">${opt(1, 12, 1)}</select></div>
          <div><label>일</label><select name="day">${opt(1, 31, 1)}</select></div>
        </div>
        <div class="grid3" style="grid-template-columns:2fr 1fr;gap:8px">
          <div><label>태어난 시</label><select name="hour"><option value="unknown">모름</option>${opt(0, 23, "x", (h) => String(h).padStart(2, "0") + "시")}</select></div>
          <div><label>분</label><select name="minute">${opt(0, 59, 0, (m) => String(m).padStart(2, "0"))}</select></div>
        </div>
        <label>성별</label>
        <div class="seg">
          <label><input type="radio" name="gender" value="female"><span>여성</span></label>
          <label><input type="radio" name="gender" value="male"><span>남성</span></label>
        </div>
        <label>태어난 지역</label>
        <select name="city">${c.cities.map((x) => `<option>${x}</option>`).join("")}</select>
        <div class="err" id="err"></div>
        <button class="btn block lg">궁합 보기</button>
      </form>
      <div id="result"></div>
      ${past.length ? `<div class="card"><h3>지난 궁합</h3>${past.slice(0, 10).map((h) => `<details class="learn"><summary>💞 ${esc(h.question)} <span class="muted small">${fmtDate(h.created_at)}</span></summary><div class="md">${md(h.content)}</div></details>`).join("")}</div>` : ""}
    </div>`;
  const form = $("#f");
  bindCalendar(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (!f.gender) return ($("#err").textContent = "상대방 성별을 선택해 주세요.");
    const btn = form.querySelector("button.block"); btn.disabled = true; $("#err").textContent = "";
    $("#result").innerHTML = `<div class="card">${loading("두 사람의 기운을 함께 읽는 중… (1~2분 걸려요)")}</div>`;
    $("#result").scrollIntoView({ block: "start" });
    try {
      const r = await api("/api/match", {
        relation: f.relation,
        partner: { name: f.name, year: f.year, month: f.month, day: f.day, calendar: f.calendar, leap: !!f.leap, hour: f.hour, minute: f.minute, gender: f.gender, city: f.city },
      });
      $("#result").innerHTML = `
        ${r.score ? `<div class="card" style="text-align:center"><div class="muted small">${esc(S.me.user.name)} × ${esc(r.partner_name)}</div><div class="score">${r.score}<small>점</small></div><div class="muted small">참고용 점수예요. 관계는 두 사람이 만들어 갑니다.</div></div>` : ""}
        <article class="card md">${md(r.markdown)}</article>
        <div class="card" style="text-align:center">
          <button class="btn lg" id="mkcard">📸 인스타 스토리용 카드 만들기</button>
          <div id="cardout"></div>
        </div>
        <p class="muted small" style="text-align:center">${fmtDate(r.created_at)} · ${engineLabel(r.engine)}</p>`;
      $("#mkcard").onclick = () => showMatchCard({ me: S.me.user.name, partner: r.partner_name, score: r.score, relation: r.relation, line: summaryLine(r.markdown) });
    } catch (err) { $("#result").innerHTML = ""; $("#err").textContent = err.message; }
    btn.disabled = false;
  };
};

pages["#/forgot"] = () => {
  app.innerHTML = `
  <div class="narrow card">
    <h2>비밀번호 찾기</h2>
    <p class="muted small">가입한 이메일을 입력하면 비밀번호를 다시 정할 수 있는 링크를 보내드려요. 링크는 1시간 동안 한 번만 쓸 수 있어요.</p>
    <form id="f">
      <label>이메일</label><input name="email" type="email" required autocomplete="email">
      <div class="err" id="err"></div>
      <button class="btn block lg">재설정 링크 받기</button>
    </form>
    <p class="small muted" style="text-align:center"><a href="#/login">로그인으로 돌아가기</a></p>
  </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      const r = await api("/api/password/forgot", { email: new FormData(e.target).get("email") });
      e.target.outerHTML = `<p>${esc(r.message)}</p><p class="muted small">메일이 안 보이면 스팸함도 확인해 주세요.</p>`;
      devLink(r);
    } catch (err) { $("#err").textContent = err.message; btn.disabled = false; }
  };
};

pages["#/reset"] = (q) => {
  const token = q.get("token") || "";
  app.innerHTML = `
  <div class="narrow card">
    <h2>새 비밀번호 정하기</h2>
    <form id="f">
      <label>새 비밀번호 (8자 이상)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <label>한 번 더 입력</label><input name="password2" type="password" minlength="8" required autocomplete="new-password">
      <div class="err" id="err"></div>
      <button class="btn block lg">비밀번호 바꾸기</button>
    </form>
  </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get("password") !== f.get("password2")) return ($("#err").textContent = "두 비밀번호가 서로 달라요.");
    try {
      await api("/api/password/reset", { token, password: f.get("password") });
      await refreshMe();
      toast("비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 풀렸습니다.");
      location.hash = S.me.profile ? "#/chart" : "#/onboard";
    } catch (err) { $("#err").innerHTML = `${esc(err.message)} <a href="#/forgot">다시 요청하기</a>`; }
  };
};

pages["#/verify"] = async (q) => {
  app.innerHTML = `<div class="narrow card">${loading("이메일을 인증하는 중…")}</div>`;
  try {
    await api("/api/verify", { token: q.get("token") || "" });
    if (S.me?.user) await refreshMe();
    app.innerHTML = `<div class="narrow card" style="text-align:center"><h2>이메일 인증 완료 ✅</h2><p class="muted">이제 구독을 포함한 모든 기능을 이용할 수 있어요.</p><a class="btn" href="${S.me?.user ? "#/chart" : "#/login"}">${S.me?.user ? "내 사주 보기" : "로그인하기"}</a></div>`;
  } catch (e) { app.innerHTML = `<div class="narrow card err">${esc(e.message)}</div>`; }
};

/* ------------------------------------------------------------ 궁합 공유 카드 */
function summaryLine(markdown) {
  // '## 한 줄 요약' 바로 아래 첫 문장을 카드 문구로 쓴다.
  const m = markdown.match(/##\s*한 줄 요약\s*\n+([^\n]+)/);
  return (m ? m[1] : "").replace(/\*\*/g, "").replace(/\s*—\s*참고 점수.*$/, "").trim();
}

function wrapText(ctx, text, maxWidth) {
  const lines = []; let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) { lines.push(cur); cur = ch.trimStart(); }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function drawMatchCard({ me, partner, score, relation, line }) {
  await document.fonts.ready;
  const W = 1080, H = 1920, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  // 카드 색은 화면 테마와 무관하게 고정(공유 이미지는 늘 같은 모습이어야 함)
  const BG = "#f6f1e7", PAPER = "#fffdf8", INK = "#1f1b16", SUB = "#7a7064", ACCENT = "#9c2f22", GOLD = "#b88a3b";
  x.fillStyle = BG; x.fillRect(0, 0, W, H);
  x.fillStyle = PAPER; x.strokeStyle = GOLD; x.lineWidth = 4;
  x.beginPath(); x.roundRect(80, 220, W - 160, 1440, 48); x.fill(); x.stroke();
  x.textAlign = "center";
  x.fillStyle = ACCENT; x.font = '700 44px "Noto Serif KR", serif'; x.fillText("運結 · 궁합", W / 2, 160);
  x.fillStyle = SUB; x.font = '500 40px "Noto Sans KR", sans-serif'; x.fillText(relation ? `${relation} 궁합` : "두 사람의 궁합", W / 2, 360);
  x.fillStyle = INK; x.font = '700 76px "Noto Serif KR", serif';
  const names = `${me}  ×  ${partner}`;
  const nameSize = Math.min(76, Math.floor(76 * 820 / Math.max(x.measureText(names).width, 1)));
  x.font = `700 ${nameSize}px "Noto Serif KR", serif`; x.fillText(names, W / 2, 480);
  x.fillStyle = ACCENT; x.font = '700 300px "Noto Serif KR", serif'; x.fillText(String(score ?? "—"), W / 2 - 40, 860);
  x.font = '700 80px "Noto Serif KR", serif'; x.fillText("점", W / 2 + (score >= 100 ? 300 : 230), 860);
  x.strokeStyle = "#e6dccb"; x.lineWidth = 2; x.beginPath(); x.moveTo(200, 960); x.lineTo(W - 200, 960); x.stroke();
  x.fillStyle = INK; x.font = '500 52px "Noto Sans KR", sans-serif';
  const lines = wrapText(x, line || "서로 다른 기운이 만나 만드는 이야기", 760).slice(0, 5);
  const top = 1250 - ((lines.length - 1) * 78) / 2;  // 구분선과 안내 문구 사이 가운데
  lines.forEach((l, i) => x.fillText(l, W / 2, top + i * 78));
  x.fillStyle = SUB; x.font = '400 34px "Noto Sans KR", sans-serif';
  x.fillText("참고용 점수예요. 관계는 두 사람이 만들어 갑니다.", W / 2, 1580);
  x.fillStyle = INK; x.font = '700 46px "Noto Sans KR", sans-serif'; x.fillText("나도 궁합 보기 →", W / 2, 1780);
  x.fillStyle = SUB; x.font = '400 36px "Noto Sans KR", sans-serif'; x.fillText(location.host, W / 2, 1840);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

async function showMatchCard(info) {
  const out = $("#cardout"), btn = $("#mkcard");
  btn.disabled = true;
  const blob = await drawMatchCard(info);
  const url = URL.createObjectURL(blob);
  const file = new File([blob], `운결_궁합_${info.partner}.png`, { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  out.innerHTML = `<img src="${url}" alt="궁합 공유 카드" class="sharecard">
    <div class="row" style="justify-content:center;margin-top:12px">
      ${canShare ? '<button class="btn" id="sharebtn">공유하기</button>' : ""}
      <a class="btn ghost" href="${url}" download="${esc(file.name)}">이미지 저장</a>
    </div>
    <p class="muted small">저장한 이미지를 인스타 스토리에 올려보세요.</p>`;
  const sb = $("#sharebtn");
  if (sb) sb.onclick = () => navigator.share({ files: [file], title: "운결 궁합" }).catch(() => {});
  btn.disabled = false;
}


/* ------------------------------------------------------------ 약관 · 개인정보 처리방침 (초안) */
// ⚠️ 초안입니다. [대괄호] 부분을 채우고, 실제 판매 전 전문가(변호사·개인정보 컨설팅) 검토를 받으세요.
const COMPANY = { name: "[상호]", ceo: "[대표자 이름]", bizno: "[사업자등록번호]", mailorder: "[통신판매업 신고번호]",
  address: "[사업장 주소]", email: "[문의 이메일]", privacyOfficer: "[개인정보 보호책임자 이름·연락처]", effective: "[시행일 YYYY-MM-DD]" };

pages["#/privacy"] = () => {
  const c = COMPANY;
  app.innerHTML = `<article class="narrow card md legal">${md(`## 개인정보 처리방침
${c.name}(이하 '회사')는 '운결' 서비스 이용자의 개인정보를 소중히 다루며, 개인정보 보호법에 따라 다음과 같이 처리합니다. 시행일: ${c.effective}

### 1. 수집하는 항목과 목적
- **회원 관리**: 이메일, 이름(닉네임), 비밀번호(복원할 수 없는 형태로 저장) — 본인 확인, 로그인, 공지
- **사주 풀이**: 생년월일·태어난 시각·성별·태어난 지역(양력/음력), 직업·고민 분야·상황과 고민 내용·마음 상태·원하는 결과 — 사주 계산과 맞춤 풀이
- **궁합**: 상대방의 이름(닉네임)·생년월일·시각·성별·지역 — 궁합 풀이. *상대방 정보는 이용자가 입력한 범위에서만 사용하며, 상대방의 동의를 받고 입력해 주세요.*
- **결제(구독 시)**: 결제수단 정보는 회사가 아닌 토스페이먼츠가 보관하며, 회사는 카드사명·카드번호 일부만 보관
- **자동 수집**: 접속 IP, 접속 시각(보안·부정이용 방지 목적)

### 2. 보유 기간
- 회원 탈퇴 시 **즉시 삭제**합니다(사주·고민·상담 기록 포함).
- 단, 관계 법령에 따라 보관: 계약·청약철회, 대금결제 및 재화 공급 기록 5년, 소비자 불만·분쟁 처리 기록 3년(전자상거래법), 접속 기록 3개월(통신비밀보호법).

### 3. 개인정보 처리 위탁 및 국외 이전
AI 풀이를 위해 아래 업체에 정보를 전송합니다. 전송된 정보는 풀이 생성에만 쓰이며, 각 업체의 API 약관상 AI 학습에 사용되지 않는 유료 API를 사용합니다. [업체별 데이터 보관 정책 확인 후 기재]

- **이전 항목**: 사주 계산 결과, 상황·고민 내용, 이름(닉네임), 궁합 상대의 이름과 사주
- **이전 시기·방법**: 풀이를 요청할 때마다 암호화 통신(HTTPS)으로 전송
- **이전받는 자(국가)**: Google LLC — Gemini API(미국, 기본) / OpenAI, L.L.C.(미국, 장애 시 대체) / Anthropic, PBC(미국, 장애 시 대체)
- **목적**: AI 풀이 생성
- **보유 기간**: [업체별 API 데이터 보관 정책 확인 후 기재]

- 결제 처리: (주)비바리퍼블리카(토스페이먼츠) — 국내
- 이메일 발송: [메일 발송 업체명] — [국가]
- 서버 운영: [호스팅 업체명] — [국가]

국외 이전을 원하지 않으면 동의하지 않을 수 있으나, 이 경우 AI 풀이 서비스를 제공할 수 없습니다.

### 4. 이용자의 권리
언제든지 내 정보 조회·수정('내 구독 → 사주·상황 정보 수정'), 삭제·탈퇴('내 구독 → 회원 탈퇴')를 할 수 있습니다. 그 밖의 요청은 아래 연락처로 해주세요.

### 5. 파기 방법
전자적 파일은 복구할 수 없는 방법으로 삭제합니다.

### 6. 안전성 확보 조치
비밀번호 일방향 암호화 저장, 로그인 시도 제한, 암호화 통신(HTTPS), 접근 권한 최소화, 접속 기록 보관.

### 7. 개인정보 보호책임자
${c.privacyOfficer} · ${c.email}

권익 침해 상담: 개인정보침해신고센터(국번없이 118), 개인정보분쟁조정위원회(1833-6972)`)}</article>`;
};

pages["#/terms"] = () => {
  const c = COMPANY;
  app.innerHTML = `<article class="narrow card md legal">${md(`## 이용약관
시행일: ${c.effective}

### 제1조 (목적)
이 약관은 ${c.name}(이하 '회사')가 제공하는 사주 상담 서비스 '운결'의 이용 조건과 절차를 정합니다.

### 제2조 (서비스의 성격)
운결은 명리학을 바탕으로 자기 이해와 방향 설정을 돕는 **참고용 콘텐츠**입니다. 의료·법률·투자·심리 치료 등 전문 자문을 대신하지 않으며, 중요한 결정은 해당 분야 전문가와 상의해야 합니다. 풀이 결과는 AI가 생성하며 사실과 다를 수 있습니다.

### 제3조 (무료체험)
가입 즉시 ${S.config.trial_days}일 무료체험이 시작되며 결제수단을 받지 않습니다. 체험 종료 후 자동결제되지 않습니다.

### 제4조 (구독과 자동결제)
1. 이용자가 결제수단을 등록하고 요금제를 선택하면 매 결제주기마다 자동결제됩니다.
2. 체험 중 등록한 경우 체험 종료일에 첫 결제가 진행됩니다.
3. 회사는 자동결제 전 [N]일 전에 결제 예정일과 금액을 이메일로 안내합니다.
4. 가격을 변경할 때는 시행 [30]일 전에 알리고, 동의하지 않으면 해지할 수 있습니다.

### 제5조 (해지와 환불)
1. '내 구독'에서 언제든 해지할 수 있으며, 해지해도 이미 결제한 기간까지는 이용할 수 있습니다.
2. 결제 후 7일 이내이고 유료 기능을 이용하지 않은 경우 전액 환불합니다. [환불 기준 확정 필요 — 전자상거래법·콘텐츠이용자보호지침 검토]

### 제6조 (이용자의 의무)
타인의 정보를 동의 없이 입력하거나, 서비스를 부정한 목적으로 이용해서는 안 됩니다.

### 제7조 (사업자 정보)
상호 ${c.name} · 대표 ${c.ceo} · 사업자등록번호 ${c.bizno} · 통신판매업 신고 ${c.mailorder} · ${c.address} · ${c.email}`)}</article>`;
};

/* ------------------------------------------------------------ 라우터 */
async function route() {
  const [h, qs] = (location.hash || "#/").split("?");
  const q = new URLSearchParams(qs || "");
  const fn = pages[h] || pages["#/"];
  if (h === "#/" && S.me?.user) { location.hash = S.me.profile ? "#/chart" : "#/onboard"; return; }
  renderNav();
  window.scrollTo(0, 0);
  try { await fn(q); } catch (e) {
    if (e.status === 401) { await refreshMe(); location.hash = "#/login"; }
    else app.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
}

(async () => {
  S.config = await api("/api/config");
  await refreshMe();
  window.addEventListener("hashchange", route);
  route();
})();
