/* 운결 — 손님 사주 풀이 신청서 */

let PARTNER_FOR = null;

function onProduct() {
  const p = document.querySelector('input[name="product"]:checked')?.value;
  const need = p ? window.PRODUCTS[p].partner : null;
  const box = $("#partner-box");
  box.hidden = !need;
  if (need && need !== PARTNER_FOR) box.innerHTML = partnerFields(need);  // 같은 종류로 바꾸면 입력값 유지
  if (need) PARTNER_FOR = need;
  $("#story-label").textContent = p === "counsel" ? "궁금한 질문 하나" : "지금 상황과 고민";
  const sub = p && window.PRODUCTS[p].subscription;
  $("#submit").textContent = sub ? `월 ${won(window.PRODUCTS[p].price)} 구독 신청` : window.FREE_FIRST ? "신청하기 · 처음이면 무료"
    : p ? `${won(window.PRODUCTS[p].price)} 신청하기` : "신청하기";
}

/* 친구 초대 코드: 링크(?ref=)로 들어오면 기억해 두었다가 신청할 때 함께 보낸다 */
const REF = (() => {
  const q = new URLSearchParams(location.search).get("ref");
  try { if (q) localStorage.setItem("ungyeol_ref", q); return q || localStorage.getItem("ungyeol_ref") || ""; }
  catch (e) { return q || ""; }
})();

function shareBox(r) {
  return `<div class="sharebox">
    <p class="line small">${r.free_kind === "ref" ? "친구 덕에 받은 무료를 썼다. " : ""}친구에게 이 링크를 보내라.</p>
    <p class="muted small">친구도 첫 풀이가 무료, 친구가 신청하면 너에게 <b style="color:var(--gold)">무료 풀이 한 번</b>이 더 생긴다.${r.credits ? ` (지금 남은 무료 ${r.credits}회)` : ""}</p>
    <div class="linkline" id="mylink">${esc(r.my_link)}</div>
    <div class="done-actions">
      <button class="btn ghost" id="copy-link">링크 복사</button>
      ${navigator.share ? '<button class="btn" id="share-link">친구에게 보내기</button>' : ""}
    </div></div>`;
}

function showDone(r) {
  $("#app").innerHTML = `
    <div class="card done-box">
      ${r.returning ? `<p class="line">…또 왔구나, ${esc(r.name)}. 반갑다.</p>
      <p class="line small">네 이야기는 기억하고 있다. 이번에도 들여다봐 주마.</p>`
        : `<p class="line">…좋다. ${esc(r.name)}, 네 이름 기억해 두지.</p>
      <p class="line small">네 운명을 들여다볼 준비를 하마.</p>`}
      <h2 style="margin-top:22px">신청이 접수되었어요</h2>
      ${r.free ? `
      <p class="muted">신청번호 <b>${esc(r.code)}</b> · ${esc(r.product)}</p>
      <div class="bankline">첫 풀이 1회 무료 — 입금하지 않으셔도 돼요</div>
      <p class="muted small">1~2일 안에 풀이를 PDF로 이메일에 보내드려요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
    </div>` : `
      <p class="muted">신청번호 <b>${esc(r.code)}</b> · ${esc(r.product)}</p>
      <p>아래 계좌로 <b>${won(r.amount)}</b>을 입금해 주세요.<br>입금자명은 <b>${esc(r.name)}</b>으로 해 주세요.</p>
      <div class="bankline">${r.bank ? esc(r.bank) : "입금 계좌는 이메일로 곧 안내해 드릴게요"}</div>
      <p class="muted small">같은 내용을 이메일로도 보내드렸어요. ${window.PRODUCTS[r.key]?.subscription
        ? "입금이 확인되면 그다음 아침부터 30일 동안 매일 7시에 '오늘의 흐름'을 보내드립니다."
        : "입금이 확인되면 1~2일 안에 풀이를 PDF로 보내드립니다."}<br>
      메일이 안 보이면 스팸함도 확인해 주세요.</p>
    </div>`}`;
  if (r.my_link) {
    $(".done-box").insertAdjacentHTML("beforeend", shareBox(r));
    $("#copy-link").onclick = async () => {
      try { await navigator.clipboard.writeText(r.my_link); $("#copy-link").textContent = "복사했어요 ✓"; }
      catch (e) { getSelection().selectAllChildren($("#mylink")); $("#copy-link").textContent = "길게 눌러 복사하세요"; }
    };
    $("#share-link")?.addEventListener("click", () => navigator.share({ title: "운결 · 너의 인생이 보인다",
      text: "태어난 날만 넣으면 사주를 보여줘. 이 링크로 들어가면 첫 풀이 무료래.", url: r.my_link }).catch(() => {}));
  }
  $(".done-box").insertAdjacentHTML("beforeend", `<div class="done-actions">
      <a class="btn ghost" href="/">처음으로</a>
      <a class="btn" href="/#form">다른 풀이도 보기</a></div>`);
  window.scrollTo(0, 0);
}

async function init() {
  const cfg = await api("/api/apply/config");
  window.PRODUCTS = cfg.products;
  window.FREE_FIRST = cfg.free_first;
  initQuick();
  if (cfg.products.daily) {
    const price = cfg.products.daily.price;
    $("#sub-price").textContent = `월 ${won(price)}`;
    $("#sub-day").textContent = Math.round(price / 30).toLocaleString("ko-KR");
    $("#pick-daily").textContent = `운결에게 맡기기 · 월 ${won(price)}`;
  }
  $("#pick-daily").onclick = (e) => {  // 구독을 골라둔 채로 신청서로
    e.preventDefault();
    const d = document.querySelector('input[name="product"][value="daily"]');
    if (d) { d.checked = true; onProduct(); }
    $("#form").scrollIntoView({ behavior: "smooth" });
  };
  document.body.classList.toggle("no-free", !cfg.free_first);
  let lastTier = "";
  $("#products").innerHTML = Object.entries(cfg.products).map(([k, p]) => {
    const head = p.tier !== lastTier ? `<div class="tier">${esc(p.tier)}</div>` : "";
    lastTier = p.tier;
    return `${head}<label class="product"><input type="radio" name="product" value="${k}">
      <span><b>${esc(p.label)}</b> <span class="pages">${p.subscription ? "매일 아침 메일" : `PDF 약 ${p.pages}쪽`}</span><br><span class="muted small">${esc(p.desc)}</span></span>
      <span class="p">${won(p.price)}${p.subscription ? '<br><span class="muted small">/ 월</span>' : ""}</span></label>`;
  }).join("");
  $("#concern").innerHTML = Object.entries(cfg.concerns).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("#me-birth").innerHTML = birthFields("me");
  document.querySelectorAll('input[name="product"]').forEach((el) => (el.onchange = onProduct));
  const want = new URLSearchParams(location.search).get("p");  // 스레드 링크에 ?p=match 처럼 상품을 미리 고를 수 있음
  const pre = document.querySelector(`input[name="product"][value="${want}"]`) || document.querySelector('input[name="product"]');
  pre.checked = true;
  onProduct();

  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#submit"), err = $("#err");
    err.textContent = "";
    const product = document.querySelector('input[name="product"]:checked')?.value;
    const body = {
      product, name: $("#name").value.trim(), email: $("#email").value.trim(), birth: readBirth("me"),
      situation: { concern: $("#concern").value, job: $("#job").value, story: $("#story").value, goal: $("#goal").value },
      agree: $("#agree").checked, agree_ai: $("#agree_ai").checked, marketing: $("#marketing").checked, ref: REF,
      src: new URLSearchParams(location.search).get("src") || "",  // 어느 홍보 채널에서 왔는지 (?src=threads)
    };
    if (window.PRODUCTS[product].partner) body.partner = { name: $("#p-name").value, relation: $("#p-rel").value, birth: readBirth("p") };
    btn.disabled = true;
    try {
      showDone(await api("/api/apply", body));
    } catch (x) {
      err.textContent = x.message;
    } finally {
      btn.disabled = false;
    }
  };
}

/* ---------- 소리: 음악 파일 없이 브라우저가 직접 만든다 (저작권 걱정 없음) ---------- */
const Sound = {
  ctx: null, master: null, on: false, beat: null,
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(c.destination);
    this.master.gain.linearRampToValueAtTime(0.9, c.currentTime + 3);
    // 낮게 깔리는 울림 (두 음을 살짝 어긋나게 → 일렁임)
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
    const dg = c.createGain(); dg.gain.value = 0.16; lp.connect(dg).connect(this.master);
    [[55, "sine", 1], [55.7, "sine", 1], [82.4, "triangle", 0.25], [110.3, "sine", 0.12]].forEach(([f, t, g]) => {
      const o = c.createOscillator(); o.type = t; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = g; o.connect(og).connect(lp); o.start();
    });
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 160;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    // 바람 소리 (잡음을 걸러서)
    const buf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 0.8;
    const wg = c.createGain(); wg.gain.value = 0.045; n.connect(bp).connect(wg).connect(this.master); n.start();
    const wl = c.createOscillator(); wl.frequency.value = 0.05; const wlg = c.createGain(); wlg.gain.value = 320;
    wl.connect(wlg).connect(bp.frequency); wl.start();
    this.noise = buf;
    // 심장 박동
    this.beat = setInterval(() => this.heart(), 1500);
    this.on = true;
    document.addEventListener("visibilitychange", () => this.ctx && (document.hidden ? this.ctx.suspend() : this.on && this.ctx.resume()));
  },
  thump(t, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.25);
  },
  heart() {
    if (!this.on || window.scrollY > (document.querySelector("#form")?.offsetTop || 0) - 200) return;
    const t = this.ctx.currentTime; this.thump(t, 0.45); this.thump(t + 0.24, 0.3);
  },
  gong(deep) {
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime, base = deep ? 65 : 98;
    [[1, 0.22], [2.02, 0.1], [2.97, 0.07], [4.2, 0.03]].forEach(([m, v]) => {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = base * m;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * (deep ? 1.6 : 1), t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (deep ? 7 : 4.5)); o.connect(g).connect(this.master); o.start(t); o.stop(t + 7.5);
    });
    if (deep) {  // 크게 드러날 때 '쏴아' 하고 부풀어 오르는 소리
      const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(200, t - 0); f.frequency.exponentialRampToValueAtTime(2400, t + 1.2);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 2.5);
    }
  },
  duck(down) {  // 목소리가 나올 때 배경 소리를 줄인다
    if (this.ctx && this.on) this.master.gain.linearRampToValueAtTime(down ? 0.35 : 0.9, this.ctx.currentTime + 0.8);
  },
  toggle() {
    if (!this.ctx) { this.start(); return true; }
    this.on = !this.on;
    if (!this.on) Voice.stop();
    this.master.gain.linearRampToValueAtTime(this.on ? 0.9 : 0, this.ctx.currentTime + 0.6);
    return this.on;
  },
};

/* ---------- 내레이션: 지금 화면에 가장 크게 보이는 장면의 목소리를 바로 튼다 ----------
   넘기면 즉시 다음 장면 목소리로, 위로 올라가면 그 장면 목소리로 바뀐다. 파일이 없으면 조용히 건너뜀. */
const Voice = {
  cache: {}, cur: null, active: null,
  preload() {
    document.querySelectorAll("[data-voice]").forEach((p) => {
      const id = p.dataset.voice;
      if (!this.cache[id]) { const a = new Audio(`/voice/${id}.mp3`); a.preload = "auto"; this.cache[id] = a; }
    });
  },
  play(id) {
    if (!id || !Sound.on) return;
    this.stop(true);
    const a = this.cache[id] || (this.cache[id] = new Audio(`/voice/${id}.mp3`));
    try { a.currentTime = 0; } catch (e) { /* 아직 안 받아진 파일 */ }
    this.cur = a;
    Sound.duck(true);
    a.onended = () => { if (this.cur === a) { this.cur = null; Sound.duck(false); } };
    a.play().catch(() => { if (this.cur === a) { this.cur = null; Sound.duck(false); } });
  },
  stop(keepDuck) {
    if (this.cur) this.cur.pause();
    this.cur = null;
    if (!keepDuck) Sound.duck(false);
  },
  watch() {
    // 장면마다 '화면을 얼마나 차지하는지'를 재서, 가장 큰 장면이 바뀌는 순간 목소리를 바꾼다
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.isIntersecting ? e.intersectionRect.height / innerHeight : 0));
      let best = null, max = 0.3;
      seen.forEach((v, el) => { if (v > max) { max = v; best = el; } });
      const id = best?.dataset.voice || null;
      if (id && id !== this.active) { this.active = id; this.play(id); }
    }, { threshold: [0, .15, .3, .45, .6, .75, .9, 1] });
    document.querySelectorAll("[data-voice]").forEach((p) => io.observe(p));
  },
};

function enter(withSound) {
  $("#gate").classList.add("out");
  setTimeout(() => $("#gate").remove(), 1100);
  const btn = $("#snd");
  btn.hidden = false;
  if (withSound) { Sound.start(); Voice.preload(); }
  Voice.watch();
  setTimeout(startToon, 300);  // 소리가 켜진 뒤 첫 장면이 시작되게
  btn.textContent = withSound ? "🔊" : "🔇";
  btn.onclick = () => {
    const on = Sound.toggle();
    btn.textContent = on ? "🔊" : "🔇"; btn.setAttribute("aria-label", on ? "소리 끄기" : "소리 켜기");
    if (on) { Voice.preload(); Voice.play(Voice.active); }  // 소리를 켜면 지금 장면 목소리부터
  };
}

if ($("#gate") && REF) {  // 친구가 보낸 링크로 온 손님
  const sub = document.querySelector(".gate-sub.free-only");
  if (sub) sub.textContent = "친구가 보낸 링크로 왔구나. 너의 첫 풀이도… 그냥 봐주지.";
}
if ($("#gate")) {
  $("#enter-sound").onclick = () => enter(true);
  $("#enter-quiet").onclick = () => enter(false);
  if (location.search.includes("p=") || location.hash === "#form") {  // 상품 링크·'다른 풀이도 보기'로 온 손님은 입장 화면 없이 신청서로
    enter(false);
    if (location.hash === "#form") setTimeout(() => $("#form")?.scrollIntoView(), 400);
  }
}

/* ---------- 웹툰 연출: 장면이 화면에 들어오면 나타나고, 대사는 한 글자씩 ---------- */
const CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;

function typeLine(el) {
  const text = el.textContent;
  el.innerHTML = [...text].map((ch) => `<span class="c">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
  el.dataset.text = text;
  return el.querySelectorAll(".c");
}

function decorate() {
  // 움직임 효과용 겹 (빛, 화면 깨짐)
  document.querySelectorAll(".fx-lamp, .fx-candle, .fx-moon, .fx-burn").forEach((f) => f.insertAdjacentHTML("beforeend", '<div class="glow"></div>'));
  document.querySelectorAll(".fx-glitch").forEach((f) => f.insertAdjacentHTML("beforeend", '<div class="gl r"></div><div class="gl b"></div>'));
  if (CALM) return;
  // 깊이감: 스크롤할 때 그림이 화면보다 조금 느리게 움직인다
  const pars = [...document.querySelectorAll(".par")];
  let ticking = false;
  const move = () => {
    const vh = innerHeight;
    pars.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const k = (r.top + r.height / 2 - vh / 2) / vh;  // 화면 가운데 0, 위 -, 아래 +
      el.style.transform = `translateY(${(k * -28).toFixed(1)}px)`;
    });
    ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  move();
}

const TYPE_QUEUE = new Map();
let TOON_IO = null;

/* 장면 하나를 '화면에 들어오면 나타나기 + 대사 한 글자씩'에 등록 (나중에 생기는 '바로 보기' 결과 장면도 같은 방식) */
function watchPanel(p, speed = 70) {
  TYPE_QUEUE.set(p, { lines: [...p.querySelectorAll("[data-type]")].map(typeLine), speed });
  TOON_IO.observe(p);
}

function startToon() {
  const panels = document.querySelectorAll(".panel");
  if (!panels.length) return;
  decorate();
  TOON_IO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const p = e.target;
      TOON_IO.unobserve(p);
      p.classList.add("show");
      Sound.gong(p.classList.contains("reveal"));
      const { lines = [], speed = 70 } = TYPE_QUEUE.get(p) || {};
      let delay = 500;
      lines.forEach((chars) => {
        chars.forEach((c, i) => setTimeout(() => c.classList.add("on"), CALM ? 0 : delay + i * speed));
        delay += chars.length * speed + 400;
      });
    });
  }, { threshold: 0.3 });
  panels.forEach((p) => watchPanel(p));
  if (!CALM) setInterval(ember, 700);
}

/* ---------- 무료 바로 보기: 생년월일 → 도령이 '너는 누구인지' 웹툰처럼 ---------- */
function quickPanel(html, cls = "") {
  const p = document.createElement("div");
  p.className = `panel q ${cls}`;
  p.innerHTML = html;
  $("#quick-result").appendChild(p);
  if (TOON_IO) watchPanel(p, 45);
  else p.classList.add("show"), p.querySelectorAll(".line .c").forEach((c) => c.classList.add("on"));
  return p;
}

const say = (t, cls = "") => `<p class="line ${cls}" data-type>${esc(t)}</p>`;
const dory = (t) => `<div class="talk"><img src="/img/toon/uneasy.jpg" alt="" class="ava"><p class="line bubble" data-type>${esc(t)}</p></div>`;

function showQuick(r, birth) {
  const box = $("#quick-result");
  box.innerHTML = "";
  const EL = { 목: "나무", 화: "불", 토: "흙", 금: "쇠", 수: "물" };
  quickPanel(dory(`…${r.birth_text}. 보인다.`));
  quickPanel(`<p class="kicker">너는</p><p class="line gold big2" data-type>「${esc(r.image)}」</p>${say(r.core)}`);
  quickPanel(`<p class="kicker">네 힘은</p>${r.good.map((g) => say("· " + g)).join("")}`);
  quickPanel(`<p class="kicker">다만…</p>${r.shadow.map((g) => say("· " + g, "small")).join("")}`);
  const max = Math.max(...Object.values(r.elements), 1);
  quickPanel(`<p class="kicker">네 안의 다섯 기운</p><div class="bars5">${Object.entries(r.elements).map(([k, v]) =>
      `<div class="b5"><span>${EL[k]}</span><i class="e-${k}" style="--w:${Math.max(v / max * 100, 4)}%"></i><b>${v}</b></div>`).join("")}</div>
    ${r.notes.map((n) => say(n, "small")).join("")}`);
  if (r.stars.length) quickPanel(`<p class="kicker">너에게 있는 별</p>${r.stars.map((s) => say(s, "small")).join("")}`);
  quickPanel(`<p class="kicker">올해 ${r.year.year}년 · ${esc(r.year.ko)}</p>${say(r.year.text)}
    <p class="kicker" style="margin-top:22px">오늘 ${esc(r.today.date)} · ${esc(r.today.ko)}일</p>${say(r.today.text)}`, "fortune");
  quickPanel(dory(r.tip));
  const recs = quickPanel(`<p class="kicker">여기까지가 겉이다</p>${say("더 깊이 보고 싶다면… 너에게는 이게 맞겠다.")}
    <div class="recs">${r.recs.map((x) => `<button class="rec" data-key="${x.key}">
      <b>${esc(x.label)}</b><span>${esc(x.why)}</span>
      <em>${x.subscription ? `월 ${won(x.price)}` : window.FREE_FIRST ? `처음이면 무료 · 원래 ${won(x.price)}` : won(x.price)}</em></button>`).join("")}</div>
    <button class="linkbtn" id="rec-all">다른 풀이도 보기 ↓</button>`, "recs-panel");
  recs.querySelectorAll(".rec").forEach((b) => (b.onclick = () => pickProduct(b.dataset.key, birth)));
  $("#rec-all").onclick = () => pickProduct(null, birth);
  setTimeout(() => box.firstElementChild?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
}

/* 추천을 누르면: 그 풀이를 골라두고, 방금 넣은 생년월일을 신청서에 채워서 내려간다 */
function pickProduct(key, birth) {
  if (key) {
    const el = document.querySelector(`input[name="product"][value="${key}"]`);
    if (el) { el.checked = true; onProduct(); }
  }
  if (birth) {
    $("#me-y").value = birth.year; $("#me-m").value = birth.month; $("#me-d").value = birth.day;
    $("#me-h").value = birth.hour ?? "";
    const cal = birth.calendar === "lunar" ? (birth.leap ? "leap" : "lunar") : "solar";
    document.querySelector(`input[name="me-cal"][value="${cal}"]`).checked = true;
    const g = document.querySelector(`input[name="me-g"][value="${birth.gender}"]`); if (g) g.checked = true;
  }
  $("#form").scrollIntoView({ behavior: "smooth" });
}

function initQuick() {
  const qf = $("#qform");
  if (!qf) return;
  $("#q-birth").innerHTML = birthFields("q");
  qf.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#q-go"), err = $("#q-err");
    err.textContent = "";
    const birth = readBirth("q");
    btn.disabled = true; btn.textContent = "들여다보는 중…";
    try {
      showQuick(await api("/api/quick", { birth }), birth);
      Sound.gong(true);
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; btn.textContent = "다시 보기"; }
  };
}

function ember() {
  if (document.hidden || window.scrollY > document.querySelector(".toon")?.offsetHeight) return;
  const e = document.createElement("span");
  e.className = "ember";
  e.style.left = Math.random() * 100 + "vw";
  e.style.setProperty("--dx", (Math.random() * 80 - 40) + "px");
  e.style.animationDuration = 6 + Math.random() * 6 + "s";
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 13000);
}

if (!document.querySelector("#gate")) startToon();  // 입장 화면이 있으면 '들어가기'를 누른 뒤 시작

init().catch((x) => ($("#app").innerHTML = `<div class="card"><p>${esc(x.message)}</p></div>`));
