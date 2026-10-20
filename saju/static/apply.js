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

function showDone(r) {
  $("#app").innerHTML = `
    <div class="card done-box">
      <p class="line">…좋다. ${esc(r.name)}, 네 이름 기억해 두지.</p>
      <p class="line small">네 운명을 들여다볼 준비를 하마.</p>
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
  window.scrollTo(0, 0);
}

async function init() {
  const cfg = await api("/api/apply/config");
  window.PRODUCTS = cfg.products;
  window.FREE_FIRST = cfg.free_first;
  if (cfg.products.daily) $("#sub-price").textContent = `월 ${won(cfg.products.daily.price)}`;
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
      agree: $("#agree").checked, agree_ai: $("#agree_ai").checked,
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

/* ---------- 내레이션: 장면마다 /voice/n01.mp3 … 를 차례로 (파일이 없으면 조용히 건너뜀) ---------- */
const Voice = {
  queue: [], cur: null, played: new Set(),
  add(id) {
    if (!id || this.played.has(id) || !Sound.on) return;
    this.played.add(id);
    this.queue.push(id);
    if (!this.cur) this.next();
  },
  next() {
    const id = this.queue.shift();
    if (!id) { this.cur = null; Sound.duck(false); return; }
    const a = (this.cur = new Audio(`/voice/${id}.mp3`));
    Sound.duck(true);
    a.onended = a.onerror = () => this.next();
    a.play().catch(() => this.next());
  },
  stop() { this.queue = []; if (this.cur) { this.cur.pause(); this.cur = null; } Sound.duck(false); },
};

function enter(withSound) {
  $("#gate").classList.add("out");
  setTimeout(() => $("#gate").remove(), 1100);
  const btn = $("#snd");
  btn.hidden = false;
  if (withSound) Sound.start();
  setTimeout(startToon, 300);  // 소리가 켜진 뒤 첫 장면이 시작되게
  btn.textContent = withSound ? "🔊" : "🔇";
  btn.onclick = () => { const on = Sound.toggle(); btn.textContent = on ? "🔊" : "🔇"; btn.setAttribute("aria-label", on ? "소리 끄기" : "소리 켜기"); };
}

if ($("#gate")) {
  $("#enter-sound").onclick = () => enter(true);
  $("#enter-quiet").onclick = () => enter(false);
  if (location.search.includes("p=") || location.hash === "#form") enter(false);  // 상품 링크로 바로 온 손님은 입장 화면 없이
}

/* ---------- 웹툰 연출: 장면이 화면에 들어오면 나타나고, 대사는 한 글자씩 ---------- */
const CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;

function typeLine(el) {
  const text = el.textContent;
  el.innerHTML = [...text].map((ch) => `<span class="c">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
  el.dataset.text = text;
  return el.querySelectorAll(".c");
}

function startToon() {
  const panels = document.querySelectorAll(".panel");
  if (!panels.length) return;
  const queue = new Map();
  panels.forEach((p) => queue.set(p, [...p.querySelectorAll("[data-type]")].map(typeLine)));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const p = e.target;
      io.unobserve(p);
      p.classList.add("show");
      Sound.gong(p.classList.contains("reveal"));
      Voice.add(p.dataset.voice);
      let delay = 600;
      (queue.get(p) || []).forEach((chars) => {
        chars.forEach((c, i) => setTimeout(() => c.classList.add("on"), CALM ? 0 : delay + i * 70));
        delay += chars.length * 70 + 500;
      });
    });
  }, { threshold: 0.35 });
  panels.forEach((p) => io.observe(p));
  if (!CALM) setInterval(ember, 700);
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
