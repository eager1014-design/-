/* 운결 — 사장님 관리 화면: 신청 목록 → 입금 확인 → 풀이 만들기·고치기 */
const app = $("#app");
let CFG = null;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
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
    if ((m = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/))) { flush(); if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(m[1])}</li>`; continue; }
    close(); para.push(l.trim());
  }
  flush(); close();
  return html;
}

const CH_LABEL = { threads: "스레드", instagram: "인스타", daangn: "당근" };
const fmt = (s) => (s ? s.replace("T", " ").slice(5, 16) : "");
const stBadge = (o) => `<span class="st st-${o.status}">${esc(o.status_label)}</span>`;
const birthText = (b, pet) => b ? `${b.calendar === "lunar" ? "음력" + (b.leap ? "(윤)" : "") : "양력"} ${b.year}.${b.month}.${b.day} `
  + `${b.hour == null ? "시간 모름" : b.hour + "시 " + (b.minute || 0) + "분"} · ${b.gender === "female" ? (pet ? "암컷" : "여") : (pet ? "수컷" : "남")}` : "";

/* ------------------------------------------------------------ 로그인 */
function renderLogin(msg) {
  app.innerHTML = `
    <div class="narrow card">
      <h2>사장님 로그인</h2>
      ${msg ? `<p class="note">${esc(msg)}</p>` : ""}
      <form id="lf">
        <label for="le">이메일</label><input id="le" type="email" autocomplete="username">
        <label for="lp">비밀번호</label><input id="lp" type="password" autocomplete="current-password">
        <div class="spacer"></div><button class="btn block">로그인</button>
        <p class="err" id="lerr"></p>
      </form>
      <p class="muted small">처음이세요? <a href="#/signup">사장님 계정 만들기</a> · 비밀번호를 잊으셨으면 신입(Claude)에게 '비밀번호 재설정 링크'를 부탁하세요.</p>
    </div>`;
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/login", { email: $("#le").value.trim(), password: $("#lp").value });
      route();
    } catch (x) { $("#lerr").textContent = x.message; }
  };
}

/* ------------------------------------------------------------ 사장님 가입 · 비밀번호 새로 정하기 */
function renderSignup() {
  app.innerHTML = `
    <div class="narrow card">
      <h2>사장님 계정 만들기</h2>
      <p class="muted small">사장님 이메일(서버 설정 ADMIN_EMAIL)만 가입됩니다. 비밀번호는 꼭 메모해 두세요.</p>
      <form id="sf">
        <label for="se">이메일</label><input id="se" type="email" autocomplete="username">
        <label for="sn">이름</label><input id="sn" maxlength="30" value="사장님">
        <label for="sp">비밀번호 (8자 이상)</label><input id="sp" type="password" autocomplete="new-password">
        <label for="sp2">비밀번호 한 번 더</label><input id="sp2" type="password" autocomplete="new-password">
        <div class="spacer"></div><button class="btn block">가입하고 들어가기</button>
        <p class="err" id="serr"></p>
      </form>
      <p class="muted small"><a href="#/">← 로그인으로</a></p>
    </div>`;
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    if ($("#sp").value !== $("#sp2").value) return ($("#serr").textContent = "비밀번호가 서로 달라요.");
    try {
      await api("/api/signup", { email: $("#se").value.trim(), name: $("#sn").value.trim() || "사장님", password: $("#sp").value,
        agree: true, agree_ai: true });
      location.hash = "#/"; route();
    } catch (x) { $("#serr").textContent = x.message; }
  };
}

function renderReset(token) {
  app.innerHTML = `
    <div class="narrow card">
      <h2>새 비밀번호 정하기</h2>
      <form id="rf">
        <label for="rp">새 비밀번호 (8자 이상)</label><input id="rp" type="password" autocomplete="new-password">
        <label for="rp2">한 번 더</label><input id="rp2" type="password" autocomplete="new-password">
        <div class="spacer"></div><button class="btn block">바꾸고 들어가기</button>
        <p class="err" id="rerr"></p>
      </form>
    </div>`;
  $("#rf").onsubmit = async (e) => {
    e.preventDefault();
    if ($("#rp").value !== $("#rp2").value) return ($("#rerr").textContent = "비밀번호가 서로 달라요.");
    try {
      await api("/api/password/reset", { token, password: $("#rp").value });
      toast("비밀번호를 바꿨어요"); location.hash = "#/"; route();
    } catch (x) { $("#rerr").textContent = x.message; }
  };
}

/* ------------------------------------------------------------ 목록 */
async function renderList(status) {
  const r = await api("/api/admin/orders" + (status ? `?status=${status}` : ""));
  CFG = r;
  const tabs = [["", "전체"]].concat(Object.entries(r.status));
  app.innerHTML = `
    <div class="topline">
      <h2 style="margin:0">신청 목록</h2>
      <a class="btn" href="#/new">+ 손님 직접 입력</a>
    </div>
    ${setupNotes(r)}
    <div class="tabs">${tabs.map(([k, v]) => `<button data-s="${k}" class="${(status || "") === k ? "on" : ""}">${esc(v)}</button>`).join("")}</div>
    <div class="card" style="padding:8px 12px">
      ${r.orders.length ? `<table>
        <thead><tr><th>상태</th><th>이름</th><th>상품</th><th class="hide-sm">금액</th><th class="hide-sm">신청번호</th><th>신청 시각</th></tr></thead>
        <tbody>${r.orders.map((o) => `<tr data-id="${o.id}">
          <td>${stBadge(o)}</td><td><b>${esc(o.name)}</b><br><span class="muted small">${esc(o.email)}</span></td>
          <td>${esc(o.product_label)}</td><td class="hide-sm">${o.amount ? won(o.amount) : '<span class="badge">무료</span>'}</td><td class="hide-sm">${esc(o.code)}</td>
          <td class="small">${fmt(o.created_at)}<br><span class="muted">${o.source === "manual" ? "직접 입력" : o.channel ? (CH_LABEL[o.channel] || esc(o.channel)) + "에서" : "직접 방문"}</span></td></tr>`).join("")}</tbody>
      </table>` : `<p class="muted" style="padding:16px">아직 신청이 없습니다.</p>`}
    </div>`;
  app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => (location.hash = b.dataset.s ? `#/?status=${b.dataset.s}` : "#/")));
  app.querySelectorAll("tbody tr").forEach((tr) => (tr.onclick = () => (location.hash = `#/order?id=${tr.dataset.id}`)));
}

function setupNotes(r) {
  const notes = [];
  if (!r.bank) notes.push("입금 계좌(BANK_ACCOUNT)가 아직 설정되지 않았어요. 손님에게 계좌 대신 '메일로 안내'라고 보입니다.");
  if (r.mail_mode !== "smtp") notes.push("메일 설정(SMTP)이 아직 없어서, 메일은 실제로 나가지 않고 서버 기록에만 남습니다.");
  if (!r.ai.length) notes.push("AI가 꺼져 있어요. '풀이 만들기'는 기본(규칙) 풀이로 만들어집니다.");
  return notes.map((n) => `<p class="note">⚠️ ${esc(n)}</p>`).join("");
}

/* ------------------------------------------------------------ 상세 */
async function renderOrder(id) {
  if (!CFG) CFG = await api("/api/admin/orders");
  const { order: o, chart_text } = await api(`/api/admin/order?id=${id}`);
  if (["mac_wait", "mac_running"].includes(o.gen_state)) CFG = await api("/api/admin/orders");  // 맥북 켜짐 여부 새로 확인
  const s = o.situation || {}, p = o.partner;
  app.innerHTML = `
    <p><a href="#/">← 목록</a></p>
    <div class="topline">
      <h2 style="margin:0">${esc(o.name)}님 · ${esc(o.product_label)} ${stBadge(o)}</h2>
      <div class="row">
        ${o.status === "pending" ? `<button class="btn" data-st="paid">입금 확인</button>` : ""}
        ${o.status === "paid" || o.status === "pending" ? "" : `<button class="btn ghost" data-st="paid">입금 확인 상태로</button>`}
        ${o.status !== "canceled" ? `<button class="btn ghost" data-st="canceled">취소</button>` : `<button class="btn ghost" data-st="pending">취소 되돌리기</button>`}
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3>손님 정보</h3>
        <dl class="info">
          <dt>신청번호</dt><dd>${esc(o.code)}</dd>
          <dt>이메일</dt><dd>${esc(o.email)}</dd>
          <dt>금액</dt><dd>${o.amount ? won(o.amount) : "무료 (첫 1회)"}</dd>
          <dt>생년월일</dt><dd>${esc(birthText(o.birth))}</dd>
          ${p ? `<dt>${p.kind === "pet" ? "우리 아이" : "상대방"}</dt><dd>${esc(p.name)} (${esc(p.relation)}) · ${esc(birthText(p.birth, p.kind === "pet"))}</dd>` : ""}
          <dt>신청</dt><dd>${fmt(o.created_at)}${o.paid_at ? ` · 입금확인 ${fmt(o.paid_at)}` : ""}${o.sent_at ? ` · 발송 ${fmt(o.sent_at)}` : ""}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>고민</h3>
        <dl class="info">
          <dt>분야</dt><dd>${esc(CFG.concerns[s.concern] || "-")}</dd>
          <dt>하는 일</dt><dd>${esc(s.job || "-")}</dd>
          <dt>${o.product === "counsel" ? "질문" : "상황"}</dt><dd>${esc(s.story)}</dd>
          <dt>바라는 것</dt><dd>${esc(s.goal || "-")}</dd>
        </dl>
        <label for="note">메모 (사장님만 봄)</label>
        <textarea id="note" style="min-height:60px">${esc(o.note || "")}</textarea>
      </div>
    </div>
    <details class="card" style="margin-top:20px"><summary>사주 계산 결과 보기</summary><pre class="chart">${esc(chart_text)}</pre></details>
    ${CFG.products[o.product]?.subscription ? `<div class="card" style="margin-top:20px">
      <h3>월 구독 신청</h3>
      <p>${o.status === "pending" ? `입금을 확인하고 <b>입금 확인</b>을 누르면 30일 구독이 시작돼요. 매일 아침 ${esc(String(7))}시에 '오늘의 흐름' 메일이 자동으로 나가요 (이미 구독 중이면 30일 연장).`
        : `구독이 시작됐어요. ${esc(o.note || "")} · 관리는 <a href="#/subs">구독</a> 메뉴에서.`}</p>
    </div>` : `<div class="card" style="margin-top:20px">
      <div class="topline">
        <h3 style="margin:0">풀이 ${o.engine ? `<span class="muted small">(${esc(o.engine)})</span>` : ""}</h3>
        <div class="row">
          ${o.content ? `<button class="btn ghost" id="pdf">PDF 미리보기</button><button class="btn" id="send">${o.status === "sent" ? "다시 보내기" : "손님에게 보내기"}</button>` : ""}
          <button class="btn ${CFG.mac_online ? "" : "ghost"}" id="genmac" title="맥북의 챗GPT 구독으로 · 0원">💻 맥북 챗GPT로 ${o.content ? "다시 " : ""}만들기</button>
          <button class="btn ghost" id="gen" title="서버의 제미나이로 · 1건 수십 원">서버 AI로 ${o.content ? "다시 " : ""}만들기</button>
          <button class="btn" id="save" ${o.content ? "" : "disabled"}>저장</button>
        </div>
      </div>
      ${o.gen_state === "running" ? `<p class="note">⏳ 풀이를 쓰는 중… <b id="genprog">${esc(o.gen_progress || "")}</b> 장 완료 (긴 리포트는 1~3분). 이 화면을 닫아도 계속 진행돼요.</p>` : ""}
      ${o.gen_state === "mac_wait" || o.gen_state === "mac_running" ? `<p class="note">💻 ${esc(o.gen_progress || "")}${o.gen_state === "mac_wait" && !CFG.mac_online ? " — 맥북이 꺼져 있어요. 맥북을 켜면 바로 시작해요." : " (1~3분, 이 화면을 닫아도 계속 진행돼요)"}
        <button class="btn ghost" id="maccancel" style="padding:3px 10px;font-size:13px;margin-left:6px">취소</button></p>` : ""}
      ${o.gen_state === "error" ? `<p class="err">풀이 만들기가 중단됐어요: ${esc(o.gen_progress || "")} — 다시 만들어 주세요.</p>` : ""}
      ${o.content ? `<div class="editor">
        <textarea id="content" aria-label="풀이 내용">${esc(o.content)}</textarea>
        <div class="preview" id="preview">${md(o.content)}</div>
      </div>` : `<p class="muted">아직 풀이가 없습니다. ${o.status === "pending" ? "입금을 확인한 뒤 " : ""}'풀이 만들기'를 눌러 주세요.</p>`}
      <p class="err" id="oerr"></p>
      ${o.content ? `<p class="muted small">고친 내용은 '저장'을 눌러야 PDF에 들어갑니다. 미리보기·보내기를 누르면 자동으로 저장돼요.</p>` : ""}
    </div>`}`;

  app.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    await api("/api/admin/order/status", { id: o.id, status: b.dataset.st, note: $("#note").value });
    toast("상태를 바꿨어요"); renderOrder(o.id);
  }));
  $("#note").onchange = () => api("/api/admin/order/status", { id: o.id, status: o.status, note: $("#note").value }).then(() => toast("메모 저장"));
  const ta = $("#content");
  if (ta) {
    ta.oninput = () => { $("#preview").innerHTML = md(ta.value); $("#save").textContent = "저장 *"; };
    const save = async () => {
      await api("/api/admin/order/save", { id: o.id, content: ta.value });
      $("#save").textContent = "저장";
    };
    $("#save").onclick = async () => { await save(); toast("저장했어요"); };
    $("#pdf").onclick = async () => {
      const w = window.open("about:blank", "_blank");  // 팝업 차단을 피하려고 클릭 순간에 창부터 연다
      await save();
      w.location = `/api/admin/order/pdf?id=${o.id}&t=${Date.now()}`;
    };
    $("#send").onclick = async () => {
      const again = o.status === "sent";
      const mock = CFG.mail_mode !== "smtp" ? "\n\n⚠️ 메일 설정이 아직 없어 실제로는 보내지지 않습니다(기록만 남음)." : "";
      if (!confirm(`${o.name}님(${o.email})에게 PDF를 ${again ? "다시 " : ""}보낼까요?${mock}`)) return;
      const b = $("#send");
      b.disabled = true; b.textContent = "보내는 중…";
      try {
        await save();
        await api("/api/admin/order/send", { id: o.id, resend: again });
        toast(CFG.mail_mode === "smtp" ? "보냈어요!" : "기록만 남겼어요 (메일 설정 필요)");
        renderOrder(o.id);
      } catch (x) { $("#oerr").textContent = x.message; b.disabled = false; b.textContent = "다시 시도"; }
    };
  }
  const busy = ["running", "mac_wait", "mac_running"].includes(o.gen_state);
  if (busy) {
    $("#gen").disabled = true; $("#genmac").disabled = true; $("#gen").textContent = "만드는 중…";
    clearTimeout(renderOrder.poll);
    renderOrder.poll = setTimeout(() => { if (location.hash === `#/order?id=${o.id}`) renderOrder(o.id); }, 3000);
  }
  if (CFG.products[o.product]?.subscription) return;  // 구독 신청은 풀이 버튼이 없음
  $("#maccancel")?.addEventListener("click", async () => {
    await api("/api/admin/jobs/update", { id: o.id, state: "error", error: "사장님이 취소" }); renderOrder(o.id);
  });
  $("#genmac").onclick = async () => {
    if (o.content && !confirm("지금 풀이를 지우고 맥북 챗GPT로 새로 만들까요? 고친 내용도 사라집니다.")) return;
    try {
      await api("/api/admin/order/generate", { id: o.id, overwrite: true, engine: "mac" });
      toast(CFG.mac_online ? "맥북이 곧 쓰기 시작해요" : "맥북을 켜면 바로 시작해요"); renderOrder(o.id);
    } catch (x) { $("#oerr").textContent = x.message; }
  };
  $("#gen").onclick = async () => {
    const n = (CFG.products[o.product]?.chapters || []).length || 1;
    const paid = CFG.ai.length ? `AI(${CFG.ai[0]})로 ${n}개 장을 나눠 씁니다. 유료 호출 ${n}회(합쳐서 수십 원 수준)입니다.` : "기본(규칙) 풀이로 만듭니다.";
    if (o.content && !confirm("지금 풀이를 지우고 새로 만들까요? 고친 내용도 사라집니다.\n\n" + paid)) return;
    if (!o.content && CFG.ai.length && !confirm(paid + "\n계속할까요?")) return;
    const b = $("#gen");
    b.disabled = true; b.textContent = "시작하는 중…";
    try {
      await api("/api/admin/order/generate", { id: o.id, overwrite: true });
      toast("풀이를 쓰기 시작했어요. 다 되면 이 화면에 나타나요."); renderOrder(o.id);
    } catch (x) { $("#oerr").textContent = x.message; b.disabled = false; b.textContent = "다시 시도"; }
  };
}

/* ------------------------------------------------------------ 직접 입력 */
async function renderNew() {
  if (!CFG) CFG = await api("/api/admin/orders");
  app.innerHTML = `
    <p><a href="#/">← 목록</a></p>
    <form class="card narrow" id="nf">
      <h2>손님 직접 입력</h2>
      <p class="muted small">카톡·DM 등으로 따로 받은 손님. 저장하면 '입금 확인' 상태로 들어갑니다.</p>
      <label for="product">상품</label>
      <select id="product">${Object.entries(CFG.products).filter(([, p]) => !p.hidden).map(([k, p]) => `<option value="${k}">${esc(p.label)} · ${won(p.price)}</option>`).join("")}</select>
      <label for="name">이름</label><input id="name" maxlength="20">
      <label for="email">받을 이메일</label><input id="email" type="email">
      ${birthFields("me")}
      <fieldset id="pbox" hidden style="margin-top:18px"></fieldset>
      <label for="concern">분야</label>
      <select id="concern">${Object.entries(CFG.concerns).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
      <label for="job">하는 일</label><input id="job">
      <label for="story">상황·질문</label><textarea id="story"></textarea>
      <label for="goal">바라는 것</label><input id="goal">
      <div class="spacer"></div><button class="btn block">저장</button>
      <p class="err" id="nerr"></p>
    </form>`;
  let shown = null;
  const sync = () => {
    const need = CFG.products[$("#product").value].partner;
    $("#pbox").hidden = !need;
    if (need && need !== shown) { $("#pbox").innerHTML = partnerFields(need); shown = need; }
  };
  $("#product").onchange = sync; sync();
  $("#nf").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      product: $("#product").value, name: $("#name").value, email: $("#email").value, birth: readBirth("me"),
      situation: { concern: $("#concern").value, job: $("#job").value, story: $("#story").value, goal: $("#goal").value },
    };
    if (CFG.products[body.product].partner) body.partner = { name: $("#p-name").value, relation: $("#p-rel").value, birth: readBirth("p") };
    try {
      const r = await api("/api/admin/order/create", body);
      location.hash = `#/order?id=${r.order.id}`;
    } catch (x) { $("#nerr").textContent = x.message; }
  };
}

/* ------------------------------------------------------------ 구독 */
async function renderSubs() {
  const r = await api("/api/admin/subs");
  const label = { active: "받는 중", expired: "기간 끝", stopped: "손님이 그만 받음", paused: "멈춤" };
  app.innerHTML = `
    <div class="topline"><h2 style="margin:0">매일 아침 구독 <span class="muted small">받는 중 ${r.active}명</span></h2>
      <button class="btn ghost" id="sendnow">오늘 것 지금 보내기</button></div>
    ${r.mail_mode !== "smtp" ? `<p class="note">⚠️ 메일 설정(SMTP)이 없어서 아침 메일이 실제로 나가지 않아요. Gmail 앱 비밀번호를 넣어야 구독이 동작합니다.</p>` : ""}
    <p class="muted small">매일 아침 ${r.send_hour}시 이후에 자동 발송 · 손님이 신청 → 신청 목록에서 '입금 확인' → 30일 시작/연장 · 끝나기 3일 전부터 메일에 연장 안내</p>
    <div class="card" style="padding:8px 12px">
      ${r.subs.length ? `<table><thead><tr><th>상태</th><th>이름</th><th>기간</th><th class="hide-sm">보낸 메일</th><th></th></tr></thead><tbody>
        ${r.subs.map((s) => `<tr><td><span class="st ${s.status === "active" ? "st-writing" : "st-sent"}">${esc(label[s.status] || s.status)}</span></td>
          <td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.email)}</span></td>
          <td class="small">${esc(s.starts_on)} ~<br><b>${esc(s.ends_on)}</b></td>
          <td class="hide-sm small">${s.sent_count || 0}통${s.last_sent ? `<br><span class="muted">${esc(s.last_sent)}</span>` : ""}</td>
          <td class="small"><button class="btn ghost" style="padding:4px 10px;font-size:13px" data-sub="${s.id}" data-act="extend">+30일</button>
            ${s.status === "active" ? `<button class="btn ghost" style="padding:4px 10px;font-size:13px" data-sub="${s.id}" data-act="pause">멈춤</button>`
              : s.status === "paused" ? `<button class="btn ghost" style="padding:4px 10px;font-size:13px" data-sub="${s.id}" data-act="resume">다시</button>` : ""}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted" style="padding:16px">아직 구독자가 없어요.</p>`}
    </div>`;
  $("#sendnow").onclick = async () => {
    if (!confirm("오늘 아직 못 받은 구독자에게 지금 '오늘의 흐름'을 보낼까요? (AI 호출: 구독자 1명당 1회)")) return;
    const x = await api("/api/admin/subs/send-now", {}); toast(`${x.sent}명에게 보냈어요`); renderSubs();
  };
  app.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.act === "extend" && !confirm("30일 연장할까요? (입금 확인한 경우)")) return;
    await api("/api/admin/subs/update", { id: +b.dataset.sub, action: b.dataset.act });
    toast("바꿨어요"); renderSubs();
  }));
}

/* ------------------------------------------------------------ 홍보 센터 */
let PROMO_CH = "threads";

async function renderPromo(check) {
  const r = await api("/api/admin/promo" + (check ? "?check=1" : ""));
  const ch = r.channels[PROMO_CH];
  const drafts = r.drafts.filter((d) => d.channel === PROMO_CH);
  const posted = r.posted.filter((d) => d.channel === PROMO_CH);
  const th = r.threads;
  const stats = r.stats.length ? r.stats.map((s) => `<tr><td>${s.ch === "direct" ? "직접 방문" : esc(CH_LABEL[s.ch] || s.ch)}</td><td>${s.n}건</td><td>${won(s.paid || 0)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">아직 신청이 없습니다.</td></tr>`;
  app.innerHTML = `
    <div class="topline"><h2 style="margin:0">홍보 센터</h2></div>
    <div class="grid2">
      <div class="card">
        <h3>어디서 손님이 오나요</h3>
        <table><thead><tr><th>채널</th><th>신청</th><th>입금 확인 금액</th></tr></thead><tbody>${stats}</tbody></table>
      </div>
      <div class="card">
        <h3>채널별 신청서 링크</h3>
        <p class="muted small">각 채널 프로필·글에는 그 채널 링크를 쓰세요. 그래야 어디서 왔는지 집계돼요.</p>
        ${Object.entries(r.links).map(([k, l]) => `<label>${esc(r.channels[k].label)}</label><div class="linkbox">${esc(l)}</div>`).join("")}
      </div>
    </div>
    <details class="card" style="margin-top:20px" ${r.refs ? "" : "open"}>
      <summary><b>참고할 인기 글</b> <span class="muted small">— 스레드에서 반응 좋은 사주 글을 여기 붙여넣으면, AI가 구조와 첫 줄 방식을 따라 써요 (문장은 안 베껴요)</span></summary>
      <textarea id="refs" style="min-height:160px;margin-top:10px" placeholder="좋아요 많은 글을 통째로 붙여넣으세요. 글 사이는 빈 줄 두 개로 구분.">${esc(r.refs)}</textarea>
      <button class="btn ghost" id="refsave" style="margin-top:8px">참고 글 저장</button>
    </details>
    <div class="spacer"></div>
    <div class="tabs">${Object.entries(r.channels).map(([k, c]) => `<button data-ch="${k}" class="${k === PROMO_CH ? "on" : ""}">${esc(c.label)}</button>`).join("")}</div>
    ${PROMO_CH === "threads" ? `<p class="note">${th.configured
      ? (th.username ? `✅ 스레드 연결됨: @${esc(th.username)}` : th.error ? `⚠️ ${esc(th.error)}` : `스레드 토큰이 설정돼 있어요. <a href="#" id="thcheck">연결 확인</a>`)
      : "⚠️ 스레드 연결(THREADS_ACCESS_TOKEN)이 아직 없어요. 지금은 글을 만들고 복사해서 직접 올릴 수 있고, 연결하면 '승인하고 올리기'로 바로 게시됩니다."}</p>`
      : `<p class="note">${esc(ch.label)}은(는) 자동 게시가 안 돼요. '복사'를 눌러 앱에 붙여넣고, 올린 뒤 '올렸어요'를 눌러 기록하세요.</p>`}
    ${PROMO_CH === "threads" ? `
    <div class="card" style="margin:12px 0;padding:14px 18px">
      <label class="check" style="margin:0"><input type="checkbox" id="auto" ${r.auto.on ? "checked" : ""}>
        <span><b>매일 아침 ${r.auto.hour}시에 스레드 글 후보 5개 자동으로 만들기</b><br>
        <span class="muted small">사장님은 아침에 골라서 '예약'만 누르면, ${r.auto.times.join(" · ")} 에 하나씩 자동으로 올라가요.${r.ai.length ? " AI 호출 하루 1회(몇 원)." : ""} 서버가 켜져 있어야 동작합니다.</span></span></label>
      ${r.scheduled.length ? `<h3 style="margin:14px 0 6px">예약된 글 ${r.scheduled.length}개</h3><table><tbody>${r.scheduled.map((p) => `
        <tr><td class="small" style="width:120px"><b>${fmt(p.scheduled_at)}</b></td><td class="small">${esc(p.text.slice(0, 70))}…</td>
        <td><button class="btn ghost" style="padding:4px 10px;font-size:13px" data-unsched="${p.id}">예약 취소</button></td></tr>`).join("")}</tbody></table>` : ""}
    </div>` : ""}
    <div class="row" style="margin:12px 0">
      <select id="theme" style="width:auto"><option value="">주제 골고루</option>
        <optgroup label="글 주제">${Object.entries(r.themes).map(([k, t]) => `<option value="${k}">${esc(t.split(" (")[0])}</option>`).join("")}</optgroup>
        <optgroup label="상품 홍보 시리즈">${Object.entries(r.products).map(([k, p]) => `<option value="product:${k}">${esc(p.label)} 시리즈</option>`).join("")}</optgroup>
      </select>
      <button class="btn" id="gen">${esc(ch.label)} 글 후보 5개 만들기</button>
      <span class="muted small">${r.ai.length ? `AI ${esc(r.ai[0])} · 유료 호출 1회` : "AI 꺼짐 → 기본 글"}</span>
    </div>
    <p class="err" id="perr"></p>
    <div class="drafts">${drafts.map((d) => `
      <div class="card" data-id="${d.id}">
        <div class="row" style="justify-content:space-between"><span class="badge gray">${esc(d.theme?.startsWith("product:") ? (r.products[d.theme.slice(8)]?.label || "") + " 시리즈" : (r.themes[d.theme] || d.theme || "").split(" (")[0] || "글")}</span><span class="muted small">${fmt(d.created_at)}</span></div>
        <textarea>${esc(d.text)}</textarea>
        <div class="count"></div>
        ${d.error ? `<p class="err">${esc(d.error)}</p>` : ""}
        <div class="row">
          ${PROMO_CH === "threads" && th.configured ? `<button class="btn" data-act="schedule">예약하기</button><button class="btn ghost" data-act="post">지금 올리기</button>` : `<button class="btn" data-act="copy">복사</button><button class="btn ghost" data-act="post">올렸어요</button>`}
          <button class="btn ghost" data-act="discard">버리기</button>
        </div>
      </div>`).join("") || `<p class="muted">글 후보가 없어요. 위 버튼으로 만들어 보세요.</p>`}</div>
    ${posted.length ? `<div class="spacer"></div><h3>올린 글</h3><div class="card" style="padding:8px 12px"><table><tbody>${posted.map((p) => `
      <tr><td class="small" style="width:110px">${fmt(p.posted_at)}</td><td class="small">${esc(p.text.slice(0, 90))}…</td>
      <td class="small">${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">보기</a>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}`;

  app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { PROMO_CH = b.dataset.ch; renderPromo(); }));
  $("#auto")?.addEventListener("change", async (e) => {
    await api("/api/admin/promo/auto", { on: e.target.checked });
    toast(e.target.checked ? "매일 아침 글 후보를 만들어 둘게요" : "자동 글 후보를 껐어요");
  });
  app.querySelectorAll("[data-unsched]").forEach((b) => (b.onclick = async () => {
    await api("/api/admin/promo/unschedule", { id: +b.dataset.unsched }); toast("예약을 취소했어요 (후보로 돌아감)"); renderPromo();
  }));
  $("#refsave").onclick = async () => { await api("/api/admin/promo/refs", { refs: $("#refs").value }); toast("참고 글 저장했어요"); };
  $("#thcheck")?.addEventListener("click", (e) => { e.preventDefault(); renderPromo(true); });
  $("#gen").onclick = async () => {
    if (r.ai.length && !confirm(`AI(${r.ai[0]})로 ${ch.label} 글 후보 5개를 만듭니다. 유료 호출 1회(몇 원 수준)입니다. 계속할까요?`)) return;
    const b = $("#gen");
    b.disabled = true; b.textContent = "만드는 중… (최대 1분)";
    try { await api("/api/admin/promo/generate", { channel: PROMO_CH, n: 5, theme: $("#theme").value }); renderPromo(); }
    catch (x) { $("#perr").textContent = x.message; b.disabled = false; b.textContent = "다시 시도"; }
  };
  app.querySelectorAll(".drafts .card[data-id]").forEach((card) => {
    const id = +card.dataset.id, ta = card.querySelector("textarea"), cnt = card.querySelector(".count");
    const count = () => { cnt.textContent = `${ta.value.length} / ${ch.limit}자`; cnt.classList.toggle("over", ta.value.length > ch.limit); };
    count();
    ta.oninput = count;
    ta.onchange = () => api("/api/admin/promo/save", { id, text: ta.value });
    card.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      try {
        if (act === "copy") {
          await navigator.clipboard.writeText(ta.value.replace(/^\[카드\].*$/gm, "").trim());
          toast("복사했어요. 앱에 붙여넣으세요"); return;
        }
        if (act === "discard") { await api("/api/admin/promo/discard", { id }); return renderPromo(); }
        if (act === "schedule") {
          if (ta.value.length > ch.limit) return toast(`${ch.limit}자를 넘었어요`);
          const r2 = await api("/api/admin/promo/post", { id, text: ta.value, schedule: true });
          toast(`${fmt(r2.post.scheduled_at)}에 올라가요`); return renderPromo();
        }
        if (ta.value.length > ch.limit) return toast(`${ch.limit}자를 넘었어요`);
        const auto = PROMO_CH === "threads" && th.configured;
        if (auto && !confirm("스레드에 바로 올리고, 첫 댓글로 신청서 링크를 답니다. 올릴까요?")) return;
        b.disabled = true; b.textContent = auto ? "올리는 중…" : "기록 중…";
        await api("/api/admin/promo/post", { id, text: ta.value });
        toast(auto ? "스레드에 올렸어요!" : "올린 글로 기록했어요"); renderPromo();
      } catch (x) { toast(x.message); b.disabled = false; }
    }));
  });
}

/* ------------------------------------------------------------ 라우터 */
async function route() {
  const [h, qs] = (location.hash || "#/").split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  if (h === "#/signup") return renderSignup();
  if (h === "#/reset") return renderReset(q.token);
  try {
    if (h === "#/order") await renderOrder(q.id);
    else if (h === "#/new") await renderNew();
    else if (h === "#/promo") await renderPromo();
    else if (h === "#/subs") await renderSubs();
    else await renderList(q.status);
    $("#logout").hidden = false;
  } catch (x) {
    if (x.status === 401) return renderLogin();
    if (x.status === 403) return renderLogin("이 계정은 사장님 계정이 아닙니다. 사장님 이메일로 로그인해 주세요.");
    app.innerHTML = `<div class="card"><p class="err">${esc(x.message)}</p></div>`;
  }
}

$("#logout").onclick = async () => { await api("/api/logout", {}); location.hash = "#/"; renderLogin(); };
window.addEventListener("hashchange", route);
route();
