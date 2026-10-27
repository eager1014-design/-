/* 운결 — 도령의 상담실: 도령이 하나씩 묻고, 손님이 답하면, 네 사주로 그 자리에서 상담한다.
   상담은 무료이고 다 보여준다. 달마다의 흐름·구체적인 방법은 PDF로 (처음이면 1개 무료, 결제, 친구가 와서 사주를 보면 기본 리포트 무료). */

const VID = (() => {  // 방문자번호 (이 폰에만 저장, 개인정보 아님) — 첫 화면과 같은 값
  try {
    let v = localStorage.getItem("ungyeol_vid");
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("") + "x1"; localStorage.setItem("ungyeol_vid", v); }
    return v;
  } catch (e) { return ""; }
})();
const INV = (() => {  // 친구가 보낸 링크(?inv=)로 왔으면 기억
  const q = new URLSearchParams(location.search).get("inv");
  try { if (q) localStorage.setItem("ungyeol_inv", q); return q || localStorage.getItem("ungyeol_inv") || ""; }
  catch (e) { return q || ""; }
})();

/* 도령 목소리: 첫 화면에서 소리를 켜고 왔으면, 장면마다 static/voice/<id>.mp3 를 튼다 (파일이 없으면 조용히 넘어감) */
const VOICE_OFF = true; // 2026-10-27: 대사가 바뀌어 예전 녹음과 안 맞음 → 새로 녹음하기 전까지 끔
const VOICE = {
  on: (() => { try { return sessionStorage.getItem("ungyeol_sound") === "1"; } catch (e) { return false; } })(),
  cur: null, last: null, pending: null,
  play(id) {
    if (!id || VOICE_OFF) return;
    this.last = id;
    if (!this.on) return;
    if (this.cur) this.cur.pause();
    const a = (this.cur = new Audio(`/voice/${id}.mp3`));
    // 휴대폰은 화면을 한 번 누르기 전엔 소리를 막는다 → 막히면 기억해 뒀다가 처음 누를 때 튼다
    a.play().then(() => (this.pending = null)).catch((e) => { if (e.name === "NotAllowedError") this.pending = id; });
  },
  set(on) {
    this.on = on;
    try { sessionStorage.setItem("ungyeol_sound", on ? "1" : "0"); } catch (e) { /* 괜찮음 */ }
    const b = $("#snd");
    b.textContent = on ? "🔊" : "🔇"; b.setAttribute("aria-label", on ? "목소리 끄기" : "목소리 켜기");
    if (!on && this.cur) this.cur.pause();
    if (on) this.play(this.last);
  },
};
addEventListener("pointerdown", () => { if (VOICE.pending) { const id = VOICE.pending; VOICE.pending = null; VOICE.play(id); } }, true);

const S = { topic: null, birth: null, answers: {}, partner: null, story: "" };
let CFG = null;
let FRIEND = { ready: false };  // 친구가 내 링크로 와서 사주를 봤는지 (할인·무료 PDF)
const AVA = '<img src="/img/toon2/ava.jpg" alt="" class="ava">';
const chat = () => $("#chat");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const down = (el) => el.scrollIntoView({ behavior: "smooth", block: "end" });

/* 카톡처럼: 도령은 동그란 프로필 + 말풍선. 이어서 말하면 프로필·이름은 첫 말풍선에만 (2026-10-27 사장님: 큰 그림 빼기) */
const doryLine = (text) => `<div class="msg">${AVA}<div class="body"><p class="who">운결 도령</p><div class="say">${esc(text)}</div></div></div>`;

async function dory(text, title, voice) {
  VOICE.play(voice);
  const prev = chat().lastElementChild;
  const w = document.createElement("div");
  w.className = "msg wait" + (prev?.classList.contains("dory") ? " cont" : "");
  w.innerHTML = `${AVA}<div class="body"><p class="who">운결 도령</p><div class="say"><span class="dots"></span></div></div>`;
  chat().appendChild(w);
  down(w);
  await wait(Math.min(400 + text.length * 8, 1100));
  w.classList.remove("wait");
  w.classList.add("dory");
  w.querySelector(".say").innerHTML = (title ? `<h3>${esc(title)}</h3>` : "") + esc(text);
  down(w);
  return w;
}
function me(text) {
  const m = document.createElement("div");
  m.className = "msg me";
  m.innerHTML = `<div class="say">${esc(text)}</div>`;
  chat().appendChild(m);
  return m;
}
function answerBox(html) {
  const a = document.createElement("div");
  a.className = "ans";
  a.innerHTML = html;
  chat().appendChild(a);
  down(a);
  return a;
}
/* 고를 것들을 보여주고, 하나 누르면 내 말풍선으로 바꾼다 */
function pick(opts) {
  return new Promise((done) => {
    const a = answerBox(`<div class="chips">${opts.map((o, i) => `<label class="chip"><input type="radio" name="pk" value="${i}"><span>${esc(o.label || o)}</span></label>`).join("")}</div>`);
    a.querySelectorAll("input").forEach((el) => (el.onchange = () => {
      const o = opts[+el.value];
      a.remove();
      me(o.label || o);
      done(o.value ?? o);
    }));
  });
}

const birthText = (b) => `${b.year}년 ${b.month}월 ${b.day}일 (${b.calendar === "lunar" ? "음력" : "양력"}) · ${b.gender === "female" ? "여" : "남"}`;

async function askBirth() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("ungyeol_birth") || "null"); } catch (e) { /* 없음 */ }
  if (saved?.year) {
    await dory(`네가 태어난 날은 ${birthText(saved)}. 그대로 보면 되겠지?`);
    if (await pick([{ label: "그래, 맞다", value: true }, { label: "다시 적을게", value: false }])) return saved;
  } else {
    await dory("먼저 생일 알려 줘. 태어난 시간은 몰라도 돼.", "", "c02");
  }
  return new Promise((done) => {
    const a = answerBox(`<div class="qcard">${birthFields("me")}<button class="btn block" id="b-go">다음</button><p class="err" id="b-err"></p></div>`);
    a.querySelector("#b-go").onclick = () => {
      const b = readBirth("me");
      const y = +b.year, m = +b.month, d = +b.day;
      if (!(y >= 1920 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { a.querySelector("#b-err").textContent = "태어난 해·월·일을 숫자로 적어라."; return; }
      if (!b.gender) { a.querySelector("#b-err").textContent = "성별을 골라라."; return; }
      try { sessionStorage.setItem("ungyeol_birth", JSON.stringify(b)); } catch (e) { /* 괜찮음 */ }
      a.remove();
      me(birthText(b));
      done(b);
    };
  });
}

async function askPartner(need) {
  const pet = need === "pet";
  await dory(pet ? "그 아이 이름이랑 생일 알려 줘. 생일 모르면 데려온 날도 괜찮아."
    : need === "required" ? "그 사람 생일도 알려 줘. 둘을 나란히 놓고 볼게."
    : "그 사람 생일 알아? 알면 훨씬 정확해. 모르면 넘겨도 돼.");
  return new Promise((done) => {
    const a = answerBox(`<div class="qcard">
      <label for="p-name">${pet ? "아이 이름" : "그 사람 이름 (별명도 된다)"}</label><input id="p-name" maxlength="20">
      ${birthFields("p", pet)}
      <div class="row"><button class="btn" id="p-go" style="flex:1">다음</button>${need === "optional" ? '<button class="btn ghost" id="p-skip">몰라서 넘길게</button>' : ""}</div>
      <p class="err" id="p-err"></p></div>`);
    a.querySelector("#p-skip")?.addEventListener("click", () => { a.remove(); me("생년월일은 모른다"); done(null); });
    a.querySelector("#p-go").onclick = () => {
      const b = readBirth("p");
      if (!(+b.year >= 1900 && +b.month >= 1 && +b.month <= 12 && +b.day >= 1 && +b.day <= 31)) { a.querySelector("#p-err").textContent = "해·월·일을 숫자로 적어라."; return; }
      if (!b.gender) b.gender = "female";  // 성별을 안 고르면 계산만을 위해 기본값
      const name = a.querySelector("#p-name").value.trim();
      a.remove();
      me(`${name || (pet ? "우리 아이" : "그 사람")} · ${b.year}년 ${b.month}월 ${b.day}일`);
      done({ name, birth: b });
    };
  });
}

async function askStory(t) {
  await dory("이제 네 이야기 해 봐. 한 줄이면 돼.", "", "c03");
  await dory(t.story);
  return new Promise((done) => {
    const a = answerBox(`<textarea id="s-text" maxlength="500" placeholder="편하게 적어라. 길게 써도 된다."></textarea>
      <label class="check small"><input type="checkbox" id="s-ok" checked> <span>상담을 위해 AI(구글 Gemini, 미국)에 생년월일·고민을 보내는 것에 동의해요. 상담 내용은 저장하지 않아요.</span></label>
      <button class="btn block" id="s-go">도령에게 상담받기 · 무료</button><p class="err" id="s-err"></p>`);
    a.querySelector("#s-go").onclick = () => {
      const story = a.querySelector("#s-text").value.trim();
      if (story.length < 5) { a.querySelector("#s-err").textContent = "한 줄이라도 적어 줘. 그래야 네 고민에 맞게 답할 수 있어."; return; }
      if (!a.querySelector("#s-ok").checked) { a.querySelector("#s-err").textContent = "동의해야 상담해줄 수 있다."; return; }
      a.remove();
      me(story);
      done(story);
    };
  });
}

async function start() {
  CFG = await api("/api/consult/config");
  const topics = CFG.topics;
  await dory("어서 와. 오늘은 뭐가 궁금해?", "", "c01");
  const want = new URLSearchParams(location.search).get("t");
  if (topics[want]) { me(topics[want].label); S.topic = want; }
  else S.topic = await pick(Object.entries(topics).map(([k, t]) => ({ label: t.label, value: k })));
  const t = topics[S.topic];
  S.birth = await askBirth();
  for (const q of t.q) {
    await dory(q.ask);
    S.answers[q.id] = await pick(q.opts);
  }
  if (t.partner) S.partner = await askPartner(t.partner);
  S.story = await askStory(t);
  await runConsult();
}

async function runConsult() {
  await dory("좋아, 네 설명서 펼쳐 볼게. 조금만 기다려. 길면 30초야.", "", "c04");
  const w = document.createElement("div");
  w.className = "msg wait cont";
  w.innerHTML = `${AVA}<div class="body"><div class="say"><span class="dots"></span></div></div>`;
  chat().appendChild(w);
  down(w);
  let r;
  try {
    r = await api("/api/consult", { topic: S.topic, birth: S.birth, answers: S.answers, partner: S.partner, story: S.story,
      consent: true, inv: INV, vid: VID });
  } catch (x) {
    w.remove();
    await dory(x.message);
    const a = answerBox('<button class="btn">다시 해보기</button>');
    a.querySelector("button").onclick = () => { a.remove(); runConsult(); };
    return;
  }
  w.remove();
  const sec = Object.fromEntries(r.sections.map((s) => [s.id, s]));
  await dory(sec.core.text, sec.core.title);
  await dory(sec.do.text, sec.do.title);
  // 더 깊이: 진짜 이유와 움직일 때 — 잠그지 않고 말풍선으로 다 보여준다. 그다음은 PDF로
  await dory(sec.why.text, "이 고민이 반복되는 진짜 이유");
  await dory(sec.when.text, "움직일 때");
  await wait(600);
  // PDF 미리 읽기: 받을 PDF의 앞 장을 이 사람 사주로 조금, 나머지는 제목만 (잠그지 않음)
  if (r.preview?.length) {
    const pv = document.createElement("div");
    pv.className = "peek";
    pv.innerHTML = `<p class="kicker">📄 PDF 미리 읽기 · ${esc(r.label)} · 약 ${r.pages}쪽</p>
      ${r.preview.map((c, i) => `<div class="pch"><span class="pno2">${i + 1}장</span><b>${esc(c.t)}</b><p>${esc(c.text)}</p></div>`).join("")}
      ${r.rest.map((x, i) => `<div class="pch more"><span class="pno2">${r.preview.length + i + 1}장</span><b>${esc(x.t)}</b>
        <span class="pchars">약 ${(Math.round(x.chars / 100) * 100).toLocaleString("ko-KR")}자</span>
        <p>${esc(x.what)}</p>${x.hint ? `<p class="hint">✦ ${esc(x.hint)}</p>` : ""}</div>`).join("")}
      <p class="peeknote">전부 약 ${Math.round(r.total_chars / 1000)}천 자. 오직 네 생년월일과 네가 방금 한 말로 쓴다. 표지에 네 이름, 끝에 도령의 서명.</p>`;
    chat().appendChild(pv);
    down(pv);
    await wait(1400);
  }
  await dory("여기까지가 오늘 상담이야. 달마다 언제 움직이고 언제 쉴지, 뭘 어떻게 할지는 네 이름으로 PDF에 자세히 적어 줄게.", "", "c05");
  const a = answerBox('<button class="nextbtn" id="to-pdf">넷째 장 · PDF로 받기 →</button>');
  a.querySelector("#to-pdf").onclick = () => turnPage("넷째 장 · 네 이름으로 쓴 PDF", () => {
    $(".room-head").hidden = true; $("#chat").hidden = true; $("#page-pdf").hidden = false;
    if (!$("#pdfbox").children.length) offer();
    setTimeout(() => VOICE.play("c06"), 900);  // 친구에게 보내라
    return $("#page-pdf");
  });
}

/* PDF 받기: 친구에게 보내고 무료로, 또는 바로 결제 */
function offer() {
  const p = CFG.products[S.topic];
  const t = CFG.topics[S.topic];
  const link = `${location.origin}/?inv=${VID}`;
  const box = document.createElement("div");
  box.className = "offer";
  box.innerHTML = `<h3>📄 ${esc(t.label)} PDF · 약 ${p.pages}쪽</h3>
    ${p.toc?.length ? `<details class="toc"><summary>PDF에 들어가는 것 보기 · ${p.toc.length}개 장</summary><ol>${p.toc.map((c) => `<li><b>${esc(c.t)}</b><span>${esc(c.d)}</span></li>`).join("")}</ol></details>` : ""}
    ${CFG.free_first ? `<div class="way gift" id="w-first">
      <p style="margin:0">🎁 <b>처음이라면, 이 PDF는 무료로 보내 줄게.</b></p>
      <p class="muted small" style="margin:6px 0 0">이름과 이메일만 적어라. 1인 1회 (이메일·이름+생년월일 기준). 받고 나서 마음에 들면 친구에게 알려줘라.</p>
      <button class="btn" id="first-go">PDF 무료로 받기</button>
    </div>
    <p class="muted small" style="margin:14px 0 6px">하나 더 받고 싶다면 —</p>` : ""}
    <div class="way gift" id="w-gift">
      ${doryLine("친구한테 여기 보내 줘. 친구가 와서 자기 사주를 보면, 더 깊은 풀이를 PDF로 보내 줄게.")}
      <p style="margin:10px 0 0">💌 <b>친구에게 이 사이트를 보내면, ${esc(CFG.products.full?.label || "내 사주 기본 리포트")}(${won(CFG.products.full?.price || 9900)})를 PDF로 무료로 보내주마.</b></p>
      <p class="muted small" style="margin:6px 0 0">친구가 네 링크로 들어와 <b>자기 사주를 보면</b>, 이 화면에 'PDF 무료로 받기'가 열린다. (1인 1회 · 이 폰에서. 위에서 먼저 신청했다면 친구가 오는 순간 메일로 자동으로 보내준다)</p>
      <div class="linkline" id="g-link">${esc(link)}</div>
      <div class="row">${navigator.share ? '<button class="btn" id="g-share" style="flex:1">친구에게 보내기</button>' : ""}<button class="btn ghost" id="g-copy" style="flex:1">링크 복사</button></div>
      <p class="small" id="g-state" style="margin:10px 0 0;color:var(--ink-3)">친구가 오기를 기다리는 중…</p>
    </div>
    <div class="way" id="w-pay">
      <p style="margin:0">바로 받고 싶다면 <b>${won(p.price)}</b> · 계좌이체 후 1~2일 안에 이메일로</p>
      <button class="btn ghost" id="pay-go">${won(p.price)}에 바로 받기</button>
    </div>`;
  $("#pdfbox").appendChild(box);
  box.querySelector("#g-share")?.addEventListener("click", () => navigator.share({ title: "운결 · 너의 인생이 보인다",
    text: "태어난 날만 넣으면 사주를 보여줘. 고민 상담도 무료래.", url: link }).catch(() => {}));
  box.querySelector("#g-copy").onclick = async () => {
    const b = box.querySelector("#g-copy");
    try { await Promise.race([navigator.clipboard.writeText(link), new Promise((_, no) => setTimeout(no, 1500))]); b.textContent = "복사했다 ✓ 친구에게 붙여넣어라"; }
    catch (e) { getSelection().selectAllChildren(box.querySelector("#g-link")); b.textContent = "위 링크를 길게 눌러 복사"; }
  };
  box.querySelector("#pay-go").onclick = () => orderForm(box.querySelector("#w-pay"), S.topic, false);
  box.querySelector("#first-go")?.addEventListener("click", (e) => { e.target.hidden = true; orderForm(box.querySelector("#w-first"), S.topic, false, true); });
  watchFriend(box);
  tail();
}

/* 친구가 왔는지 몇 초마다 확인 → 오면 무료 받기를 연다 */
function watchFriend(box) {
  let opened = false;
  const check = async () => {
    if (opened || document.hidden) return;
    let st;
    try { st = await api(`/api/invite/status?vid=${VID}`); } catch (e) { return; }
    const el = box.querySelector("#g-state");
    if (st.pdf_used) { el.textContent = "친구 초대 무료 기본 리포트는 이미 받았다. (1인 1회)"; opened = true; return; }
    FRIEND = st;
    if (st.pdf_ready) {
      opened = true;
      el.innerHTML = `${doryLine("친구 왔다! 약속대로 PDF 보내 줄게.")}<span class="ready">친구가 왔다. 약속대로 기본 리포트를 무료로 보내주마 ✓</span>`;
      VOICE.play("c07");
      orderForm(box.querySelector("#w-gift"), "full", true);
    }
  };
  check();
  const timer = setInterval(() => (opened ? clearInterval(timer) : check()), 8000);
}

/* 이름·이메일만 받는 간단 신청 (생년월일·고민은 상담에서 받은 그대로) */
function orderForm(where, product, useInvite, wantFree = false) {
  if (where.querySelector(".mini")) return;
  const p = CFG.products[product];
  const f = document.createElement("div");
  f.className = "mini";
  f.innerHTML = `<label>이름 ${useInvite || wantFree ? "" : '<span class="muted small">(입금자 이름과 같게)</span>'}</label><input class="m-name" maxlength="20" autocomplete="name">
    <label>PDF를 받을 이메일</label><input class="m-email" type="email" maxlength="120" autocomplete="email">
    <label class="check small"><input type="checkbox" class="m-agree"> <span>[필수] 개인정보(이름·이메일·생년월일·고민) 수집·이용과, 풀이 작성을 위한 AI 처리(국외 이전)에 동의해요. 발송 후 1년 뒤 파기.</span></label>
    <label class="check small"><input type="checkbox" class="m-mkt"> <span>[선택] 새 운세·할인 소식을 이메일로 받을게요.</span></label>
    <button class="btn m-go">${useInvite || wantFree ? "PDF 무료로 받기" : p.subscription ? `월 ${won(p.price)} 구독 신청`
      : FRIEND.ready && p.friend_discount ? `${won(p.price - p.friend_discount)} 신청하기 (친구 할인 -${won(p.friend_discount)})` : `${won(p.price)} 신청하기`}</button>
    <p class="err m-err"></p>`;
  where.appendChild(f);
  f.querySelector(".m-name").focus();
  f.querySelector(".m-go").onclick = async () => {
    const err = f.querySelector(".m-err");
    err.textContent = "";
    if (!f.querySelector(".m-agree").checked) { err.textContent = "동의해야 보내줄 수 있다."; return; }
    const t = CFG.topics[S.topic];
    const picked = t.q.map((q) => S.answers[q.id]).filter(Boolean).join(" / ");
    let story = (picked ? `[상담에서 고른 답] ${picked}\n` : "") + S.story;
    if (story.length < 10) story += ` (${t.label} 상담을 받았어요)`;
    const body = { product, name: f.querySelector(".m-name").value.trim(), email: f.querySelector(".m-email").value.trim(),
      birth: S.birth, situation: { concern: t.concern, job: "", story, goal: "" },
      agree: true, agree_ai: true, marketing: f.querySelector(".m-mkt").checked, vid: VID, use_invite: useInvite, want_free: wantFree,
      src: new URLSearchParams(location.search).get("src") || "consult" };
    if (CFG.products[product].partner && S.partner) {
      const rel = { match: S.answers.relation, reunion: "전 연인", pet: S.answers.kind }[product] || "";
      body.partner = { name: S.partner.name, relation: rel, birth: S.partner.birth };
    }
    const btn = f.querySelector(".m-go");
    btn.disabled = true;
    try {
      const r = await api("/api/apply", body);
      f.innerHTML = r.free
        ? `<p class="done">…좋다, ${esc(r.name)}. 신청번호 <b>${esc(r.code)}</b>.<br>정성껏 써서 1~2일 안에 이메일로 PDF를 보내주마. (스팸함도 봐라)</p>${wantFree ? recommendBox(r.my_link) : ""}`
        : `<p class="done">신청번호 <b>${esc(r.code)}</b> · ${esc(r.product)}</p>
           <p>아래 계좌로 <b>${won(r.amount)}</b>을 입금해 주세요. 입금자명은 <b>${esc(r.name)}</b>.</p>
           <div class="linkline">${r.bank ? esc(r.bank) : "입금 계좌는 이메일로 곧 안내해 드릴게요"}</div>
           <p class="muted small">같은 내용을 이메일로도 보냈어요. ${CFG.products[r.key]?.subscription ? "입금이 확인되면 다음 날 아침 7시부터 30일 동안 매일 보내드려요." : "입금이 확인되면 1~2일 안에 PDF로 보내드려요."}</p>`;
    } catch (x) {
      err.textContent = x.message;
      btn.disabled = false;
    }
  };
}

/* 무료 PDF를 받은 손님에게: 친구에게 추천해 달라는 부탁 + 내 링크 (친구가 와서 사주를 보면 기본 리포트가 자동으로 무료 신청됨) */
function recommendBox(myLink) {
  const link = myLink || `${location.origin}/?inv=${VID}`;
  const id = `rec-${Date.now()}`;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector(".r-share")?.addEventListener("click", () => navigator.share({ title: "운결 · 너의 인생이 보인다",
      text: "태어난 날만 넣으면 사주를 보여줘. 처음이면 PDF 풀이 하나가 무료래.", url: link }).catch(() => {}));
    el.querySelector(".r-copy").onclick = async (e) => {
      try { await Promise.race([navigator.clipboard.writeText(link), new Promise((_, no) => setTimeout(no, 1500))]); e.target.textContent = "복사했다 ✓ 친구에게 붙여넣어라"; }
      catch (x) { getSelection().selectAllChildren(el.querySelector(".linkline")); e.target.textContent = "위 링크를 길게 눌러 복사"; }
    };
  });
  return `<div class="recbox" id="${id}" style="margin-top:14px">
    <p style="margin:0">🙏 <b>하나만 부탁하자. 친구에게도 운결을 알려줘라.</b></p>
    <p class="muted small" style="margin:6px 0 0">친구가 이 링크로 와서 자기 사주를 보면, 고마운 뜻으로 <b style="color:var(--gold)">내 사주 기본 리포트(${won(CFG.products.full?.price || 9900)})</b>를 무료로 하나 더 메일로 보내주마. 친구도 처음이면 PDF 하나가 무료다.</p>
    <div class="linkline">${esc(link)}</div>
    <div class="row">${navigator.share ? '<button class="btn r-share" style="flex:1">친구에게 보내기</button>' : ""}<button class="btn ghost r-copy" style="flex:1">링크 복사</button></div>
  </div>`;
}

/* 넷째 장 아래: 더 깊은 PDF (친구가 오면: 기본 리포트 무료 · 평생 9,900원 · 신년 10% 할인) → 맨 끝에 매일 아침 구독 */
function tail() {
  const P = CFG.products;
  const deeper = [["full", "타고난 성향부터 일·돈·사람·올해까지, 내 사주 한 권"], ["newyear", "내년 열두 달, 달마다의 흐름"],
    ["life", "타고난 그릇부터 10년마다 바뀌는 흐름까지"]].filter(([k]) => P[k]);
  const daily = P.daily;
  const box = document.createElement("div");
  box.className = "offer";
  box.innerHTML = `<h3>더 깊게 보고 싶다면</h3>
    <p class="muted small" style="margin:0">친구가 네 링크로 와서 자기 사주를 보면, 기본 리포트는 무료 · 나머지는 할인해주마 (1인 1회).</p>
    ${deeper.map(([k, d]) => `<div class="way" id="w-${k}">
      <p style="margin:0"><b>${esc(P[k].label)}</b> · ${won(P[k].price)} · PDF 약 ${P[k].pages}쪽</p>
      <p class="muted small" style="margin:6px 0 0">${esc(d)}. <span style="color:var(--gold)">${P[k].invite_free ? "친구가 오면 무료" : `친구가 오면 ${won(P[k].friend_discount)} 할인`}</span></p>
      <button class="btn ghost" data-k="${k}">신청하기</button></div>`).join("")}
    ${daily ? `<div class="way" id="w-daily" style="margin-top:22px;border-color:rgba(217,178,106,.5)">
      <p style="margin:0">그리고… 원한다면, <b>매일 아침, 오늘의 흐름</b> · 월 ${won(daily.price)} (하루 ${Math.round(daily.price / 30).toLocaleString("ko-KR")}원)</p>
      <p class="muted small" style="margin:6px 0 0">매일 아침 7시 메일. 오늘은 밀어붙일 날인지, 숨을 고를 날인지. 답장으로 요즘 일을 알려주면 다음 날 풀이에 담는다. 언제든 그만둘 수 있다.</p>
      <button class="btn ghost" data-k="daily">구독 신청하기</button></div>` : ""}`;
  $("#pdfbox").appendChild(box);
  box.querySelectorAll("button[data-k]").forEach((b) => (b.onclick = () => orderForm(box.querySelector(`#w-${b.dataset.k}`), b.dataset.k, false)));
}

start().catch((x) => dory(x.message || "잠시 후 다시 와라."));

/* 앞 페이지에서 내려온 막을 올린다 · 넷째 장에서 상담으로 돌아가기 */
setTimeout(() => document.querySelector(".curtain")?.classList.remove("on"), 350);
$("#back-chat").onclick = () => turnPage("셋째 장 · 도령의 상담실", () => {
  $("#page-pdf").hidden = true; $(".room-head").hidden = false; $("#chat").hidden = false;
  return $("#chat");
});

$("#snd").hidden = false;
VOICE.set(VOICE.on);
$("#snd").onclick = (e) => { e.stopPropagation(); VOICE.set(!VOICE.on); };
