// 포트폴리오를 폰 홈 화면에 '앱'으로 설치하게 해 주는 부분 (2026-11-19)
// - 안드로이드·크롬·엣지: 브라우저가 설치 가능하다고 알려 주면 왼쪽 아래 '앱으로 설치' 버튼이 뜸
// - 아이폰 사파리: 설치 버튼이 없어서 '공유 → 홈 화면에 추가' 안내를 띄움
// - 이미 앱으로 열었거나, 닫기(×)를 눌렀으면 안 뜸
(() => {
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* 설치 기능만 빠질 뿐 사이트는 그대로 */ }));
  }

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;
  const KEY = "pwa:dismissed";
  try { if (localStorage.getItem(KEY)) return; } catch (e) { /* 저장 막힌 브라우저면 매번 보일 뿐 */ }

  const css = document.createElement("style");
  css.textContent = `
    .pwa-bar { position: fixed; left: max(16px, env(safe-area-inset-left, 0px)); bottom: max(16px, env(safe-area-inset-bottom, 0px)); z-index: 60;
      display: flex; align-items: center; gap: 2px; background: #14233A; color: #fff; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.2);
      font: 600 14px "IBM Plex Sans KR", -apple-system, sans-serif; max-width: calc(100vw - 32px); }
    .pwa-bar button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 10px 6px 10px 16px; }
    .pwa-bar button.x { padding: 10px 14px 10px 6px; opacity: .7; font-size: 16px; line-height: 1; }
    .pwa-bar button:focus-visible { outline: 2px solid #8DB2EA; outline-offset: 2px; border-radius: 999px; }
    .pwa-tip { position: fixed; left: 16px; right: 16px; bottom: max(72px, calc(env(safe-area-inset-bottom, 0px) + 72px)); z-index: 61; max-width: 360px;
      background: #fff; color: #14233A; border: 1px solid #D6DDE7; border-radius: 14px; padding: 16px 18px; box-shadow: 0 12px 32px rgba(0,0,0,.22);
      font: 15px/1.6 "IBM Plex Sans KR", -apple-system, sans-serif; }
    .pwa-tip b { display: block; font-size: 16px; margin-bottom: 4px; }
    .pwa-tip ol { margin: 0; padding-left: 20px; }
  `;
  document.head.appendChild(css);

  let deferred = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function bar() {
    if (document.querySelector(".pwa-bar")) return;
    const b = document.createElement("div");
    b.className = "pwa-bar";
    b.innerHTML = `<button type="button" class="go">📲 앱으로 설치</button><button type="button" class="x" aria-label="설치 안내 닫기">×</button>`;
    document.body.appendChild(b);
    b.querySelector(".x").onclick = () => {
      b.remove(); document.querySelector(".pwa-tip")?.remove();
      try { localStorage.setItem(KEY, "1"); } catch (e) { /* 무시 */ }
    };
    b.querySelector(".go").onclick = async () => {
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice.catch(() => ({}));
        deferred = null;
        if (outcome === "accepted") b.remove();
        return;
      }
      // 아이폰: 직접 안내
      const old = document.querySelector(".pwa-tip");
      if (old) { old.remove(); return; }
      const t = document.createElement("div");
      t.className = "pwa-tip";
      t.setAttribute("role", "dialog");
      t.innerHTML = `<b>홈 화면에 추가하기</b><ol><li>아래쪽 <b style="display:inline">공유</b> 버튼(네모에 위 화살표)을 누르고</li><li><b style="display:inline">홈 화면에 추가</b>를 고르면 끝이에요.</li></ol>`;
      document.body.appendChild(t);
      t.addEventListener("click", () => t.remove());
    };
  }

  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; bar(); });
  addEventListener("appinstalled", () => document.querySelector(".pwa-bar")?.remove());
  // 아이폰 사파리에서만 (카톡 안 브라우저 등에서는 홈 화면 추가가 안 되므로 안 띄움)
  const safari = /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|kakaotalk|naver|instagram|fban|fbav|line\//i.test(navigator.userAgent);
  if (isIOS && safari) addEventListener("load", () => setTimeout(bar, 2500));
})();
