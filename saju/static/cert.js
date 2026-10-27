/* 공식 예민인 인증서 (2026-10-27 사장님: 펫락 제안 ③ — 무료, 공유용).
   무료 '바로 보기' 결과(r)로 브라우저에서 그림을 그린다: 서버·AI 없음, 비용 0. 저장·공유하면 아래 주소가 같이 퍼진다.
   놀리지 않고 '자랑하고 싶은' 문구로. 자격은 다섯 기운 중 가장 많은 기운, 충전법은 가장 적은 기운에서. */
const CERT_TOP = { 수: "눈치·공감 특급", 화: "분위기 감지 특급", 목: "새 시작 감각 1급", 금: "디테일 검수 1급", 토: "사람 챙기기 1급" };
const CERT_CHARGE = { 목: "아침 산책", 화: "햇빛과 칭찬", 토: "같은 시간 같은 습관", 금: "하나씩 끝내기", 수: "혼자 조용히 쉬기" };

function certLines(r, name) {
  const els = Object.entries(r.elements || {});
  const top = els.slice().sort((a, b) => b[1] - a[1])[0]?.[0] || "수";
  const low = els.slice().sort((a, b) => a[1] - b[1])[0]?.[0] || "화";
  return {
    name: (name || "").trim() || "이름 없는 예민인",
    image: r.image || "",
    quals: [CERT_TOP[top], "방해 금지 모드 숙련", "남들이 못 듣는 소리 청취 1급"],
    charge: CERT_CHARGE[low],
  };
}

async function drawCert(canvas, r, name) {
  const W = 1080, H = 1350, c = canvas.getContext("2d");
  canvas.width = W; canvas.height = H;
  try { await Promise.all(["700 60px 'Noto Serif KR'", "400 34px 'Noto Serif KR'"].map((f) => document.fonts.load(f))); } catch (e) { /* 기본 글꼴로 */ }
  const L = certLines(r, name);
  const serif = "'Noto Serif KR', 'Apple SD Gothic Neo', serif";
  const INK = "#2b2117", GOLD = "#b08a3e", RED = "#b3262f";
  c.fillStyle = "#f7f0e1"; c.fillRect(0, 0, W, H);
  c.strokeStyle = GOLD; c.lineWidth = 10; c.strokeRect(40, 40, W - 80, H - 80);
  c.lineWidth = 2; c.strokeRect(64, 64, W - 128, H - 128);
  c.textAlign = "center"; c.fillStyle = INK;
  const no = new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + String(Math.floor(Math.random() * 9000) + 1000);
  c.font = `400 28px ${serif}`; c.fillStyle = "#7a6a55"; c.fillText(`제 ${no} 호`, W / 2, 150);
  c.font = `700 84px ${serif}`; c.fillStyle = INK; c.fillText("공식 예민인 인증서", W / 2, 270);
  c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.moveTo(260, 310); c.lineTo(W - 260, 310); c.stroke();
  c.font = `700 52px ${serif}`; c.fillText(`성명  ${L.name}`, W / 2, 410);
  if (L.image) { c.font = `400 34px ${serif}`; c.fillStyle = "#5c4b36"; c.fillText(`타고난 기운 「${L.image}」`, W / 2, 470); }
  c.textAlign = "left"; c.fillStyle = INK;
  const x = 170; let y = 580;
  c.font = `700 30px ${serif}`; c.fillStyle = GOLD; c.fillText("보유 자격", x, y);
  c.fillStyle = INK; c.font = `400 40px ${serif}`;
  L.quals.forEach((q) => { y += 66; c.fillText(`·  ${q}`, x, y); });
  y += 96; c.font = `700 30px ${serif}`; c.fillStyle = GOLD; c.fillText("공식 충전법", x, y);
  y += 62; c.fillStyle = INK; c.font = `400 40px ${serif}`; c.fillText(`·  ${L.charge}`, x, y);
  c.textAlign = "center"; c.font = `400 31px ${serif}`; c.fillStyle = "#3d3125";
  ["위 사람은 남들이 지나치는 마음을 알아채는", "섬세한 감각을 갖추었기에 이 증서를 드립니다.", "고장 난 게 아니라, 섬세하게 만들어졌습니다."]
    .forEach((t, i) => c.fillText(t, W / 2, 1012 + i * 50));
  // 도장
  c.save(); c.translate(W - 175, 1165); c.rotate(-0.12);  // 글씨와 안 겹치게 오른쪽 아래
  c.strokeStyle = RED; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, 58, 0, Math.PI * 2); c.stroke();
  c.fillStyle = RED; c.font = `700 38px ${serif}`; c.textAlign = "center"; c.fillText("運結", 0, 13); c.restore();
  c.textAlign = "center"; c.font = `400 26px ${serif}`; c.fillStyle = "#7a6a55";
  c.fillText(`내 사용설명서 · 무료 성향 보기  ${location.host}`, W / 2 - 40, H - 92);
}

/* 무료 결과 끝에 붙는 칸: 이름 넣기 → 인증서 → 저장·공유 → 사용설명서 */
function certPanel(r) {
  const p = quickPanel(`<p class="kicker">무료 · 공유용</p>
    <p class="line gold big2" data-type>공식 예민인 인증서</p>
    <p class="small muted">네 기운으로 발급해 주마. 이름(별명)을 넣고 저장해서 친구에게 보여줘라.</p>
    <div class="cert-row"><input id="cert-name" maxlength="10" placeholder="인증서에 넣을 이름"><button type="button" class="btn ghost" id="cert-make">발급</button></div>
    <canvas id="cert-canvas" class="cert" aria-label="공식 예민인 인증서 그림"></canvas>
    <div class="cert-row"><button type="button" class="btn" id="cert-save">이미지로 저장</button><button type="button" class="btn ghost" id="cert-share" hidden>공유하기</button></div>
    <p class="small muted" style="margin-top:14px">인증서는 맛보기다. 잘 돌아가는 환경, 과부하 경고, 충전법, 같이 사는 사람을 위한 사용법까지 — 전부 담은 건 설명서에 있다.</p>
    <div class="cert-row"><button type="button" class="btn ghost" id="cert-manual">예민한 나 사용설명서 받기</button><button type="button" class="btn ghost" id="cert-gift">내 사람 설명서 선물하기</button></div>`, "certpanel");
  const cv = p.querySelector("#cert-canvas");
  const make = () => drawCert(cv, r, p.querySelector("#cert-name").value);
  make();
  p.querySelector("#cert-make").onclick = make;
  p.querySelector("#cert-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); make(); } });
  const blob = () => new Promise((ok) => cv.toBlob(ok, "image/png"));
  p.querySelector("#cert-save").onclick = async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await blob());
    a.download = "운결_예민인_인증서.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const share = p.querySelector("#cert-share");
  if (navigator.canShare && navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] })) {
    share.hidden = false;
    share.onclick = async () => {
      const f = new File([await blob()], "운결_예민인_인증서.png", { type: "image/png" });
      try { await navigator.share({ files: [f], text: `나 공식 예민인 인증 받음 ${location.origin}/?src=cert` }); } catch (e) { /* 취소 */ }
    };
  }
  p.querySelector("#cert-manual").onclick = () => pickProduct("manual", QUICK?.birth);
  p.querySelector("#cert-gift").onclick = () => pickProduct("manual_gift", QUICK?.birth);
  return p;
}
