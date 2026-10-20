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
  $("#submit").textContent = window.FREE_FIRST ? "신청하기 · 처음이면 무료" : p ? `${won(window.PRODUCTS[p].price)} 신청하기` : "신청하기";
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
      <p class="muted small">같은 내용을 이메일로도 보내드렸어요. 입금이 확인되면 1~2일 안에 풀이를 PDF로 보내드립니다.<br>
      메일이 안 보이면 스팸함도 확인해 주세요.</p>
    </div>`}`;
  window.scrollTo(0, 0);
}

async function init() {
  const cfg = await api("/api/apply/config");
  window.PRODUCTS = cfg.products;
  window.FREE_FIRST = cfg.free_first;
  document.body.classList.toggle("no-free", !cfg.free_first);
  let lastTier = "";
  $("#products").innerHTML = Object.entries(cfg.products).map(([k, p]) => {
    const head = p.tier !== lastTier ? `<div class="tier">${esc(p.tier)}</div>` : "";
    lastTier = p.tier;
    return `${head}<label class="product"><input type="radio" name="product" value="${k}">
      <span><b>${esc(p.label)}</b> <span class="pages">PDF 약 ${p.pages}쪽</span><br><span class="muted small">${esc(p.desc)}</span></span>
      <span class="p">${won(p.price)}</span></label>`;
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

startToon();

init().catch((x) => ($("#app").innerHTML = `<div class="card"><p>${esc(x.message)}</p></div>`));
