// 썸네일 한 장 (정지 화면).
// 렌더링: npx remotion still Thumbnail out/<편>_thumb.png --props=public/episodes/<편>/upload.json
// upload.json 의 thumbnail:
//   lines   : ["첫 줄", "**강조** 둘째 줄"]  (**강조** = 노란색)
//   kicker  : 작은 윗글 (선택)
//   format  : "long"(1280×720, 기본) | "short"(1080×1920)
//   두 가지 모양:
//   ① 장면 그림 배경 (자극적, 추천): scene: { image: "episodes/…/s09.png", focusX: 0.62, focusY: 0.45, zoom: 1.6 }
//      → 그림을 캐릭터 쪽으로 크게 확대, 반대편을 어둡게 해서 흰 글씨(검은 테두리)를 크게
//   ② 크림 배경 + 오려낸 캐릭터: image: "characters/main/think.cut.png" (scene 이 없을 때)
//   ③ style: "bold" — 레퍼런스(Grabity) 공식 (2026-10-24): 흰/검은 바탕 + 아주 굵은 글씨 1~2줄(검은 테두리) + 단순한 손그림 하나 + 손글씨 메모
//      bg: "black" | "white", layout: "top"(그림 위·글씨 아래) | "bottom"(글씨 위·그림 아래) | "side"(얼굴 왼쪽 크게·글씨 오른쪽) | "overlap"(오린 캐릭터 크게 + 큰 글자를 비스듬히 앞에 겹침 — image 는 .cut.png) | "text"(글씨만 크게)
//      lines 안의 **노랑**, !!빨강!!, 나머지 흰색. image: 손그림(흰 바탕이면 흰 바탕 그림, 검은 바탕이면 검은 바탕 그림), note: 손글씨 한 줄, noteX·noteY(0~1)
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { COLORS, FONT } from "./theme.js";
import { Background } from "./components.jsx";

loadFont({ family: "Pretendard", url: staticFile("fonts/Pretendard-ExtraBold.woff2"), weight: "800" });
loadFont({ family: "Pretendard", url: staticFile("fonts/Pretendard-Bold.woff2"), weight: "700" });
loadFont({ family: "BlackHanSans", url: staticFile("fonts/BlackHanSans-Regular.ttf"), weight: "100 900" });
loadFont({ family: "NanumPen", url: staticFile("fonts/NanumPenScript-Regular.ttf"), weight: "100 900" });

// ③ bold 썸네일: **노랑** !!빨강!! 나머지 흰색, 모두 굵은 검은 테두리
function BoldText({ text }) {
  return String(text)
    .split(/(\*\*[^*]+\*\*|!![^!]+!!)/g)
    .filter(Boolean)
    .map((p, i) => <span key={i} style={{ color: p.startsWith("**") ? "#FFE03A" : p.startsWith("!!") ? "#F2342C" : "#FFFFFF" }}>{p.startsWith("**") || p.startsWith("!!") ? p.slice(2, -2) : p}</span>);
}
function BoldThumb({ t, width, height }) {
  const tall = height > width;
  const u = Math.min(width, height) / 720;
  const dark = t.bg !== "white";
  const layout = t.image ? t.layout || "top" : "text";
  const lines = t.lines || ["제목"]; // 줄은 대본이 쓴 그대로 — 자동으로 나누면 단이 많아져 안 읽힘 (2026-10-30 사장님)
  const longest = Math.max(...lines.map((l) => String(l).replace(/\*\*|!!/g, "").length));
  const side = layout === "side" && !tall; // 얼굴 왼쪽 크게 · 글씨 오른쪽 (2026-10-30: 글씨가 얼굴을 가리지 않게)
  const size = side ? Math.min(170, 640 / Math.max(longest, 2.5)) * u : Math.min(layout === "text" ? 230 : 150, ((tall ? 1000 : 1200) / Math.max(longest, 3)) * 1.05) * u;
  const text = (
    <div style={{ textAlign: "center", zIndex: 2 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: "BlackHanSans", fontSize: size, lineHeight: 1.02, letterSpacing: "-0.03em", whiteSpace: "nowrap", WebkitTextStroke: `${size * 0.11}px #0A0A0A`, paintOrder: "stroke fill" }}>
          <BoldText text={l} />
        </div>
      ))}
    </div>
  );
  const art = t.image && (
    <Img src={staticFile(t.image)} style={{ flex: 1, minHeight: 0, width: "100%", objectFit: "contain", mixBlendMode: dark ? "screen" : "multiply" }} />
  );
  // overlap: 글자가 물체처럼 — 오린 캐릭터 얼굴을 크게 두고, 큰 글자를 비스듬히 그 앞(어깨·손 쪽)에 겹쳐 올림. 글자를 뒤에 두면 앞 글자가 가려져 안 읽혀서 앞으로 (2026-10-30 사장님: "글자가 물체인 거지")
  if (layout === "overlap" && !tall) {
    const big = Math.min(250, 860 / Math.max(longest, 2.5)) * u * (t.textScale || 1);
    const edge = "#fff"; // 검은 바탕에서도 흰 스티커 테두리 — 검은 선이 바탕에 묻히지 않게 (2026-10-31)
    return (
      <AbsoluteFill style={{ background: dark ? "#050505" : "#FFFFFF", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: "3%", ...(t.textPos === "top" ? { top: "4%" } : { bottom: "8%" }), transform: "rotate(-6deg)", textAlign: "right", zIndex: 3 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontFamily: "BlackHanSans", fontSize: big * (i === lines.length - 1 ? 1.12 : 0.9), lineHeight: 1.0, letterSpacing: "-0.03em", whiteSpace: "nowrap",
              WebkitTextStroke: `${big * 0.1}px #0A0A0A`, paintOrder: "stroke fill", marginRight: i % 2 ? 0 : big * 0.35 }}>
              <BoldText text={l} />
            </div>
          ))}
        </div>
        <Img src={staticFile(t.image)} style={{ position: "absolute", left: "2%", top: "-4%", height: "104%", zIndex: 2,
          filter: `drop-shadow(${8 * u}px 0 0 ${edge}) drop-shadow(-${8 * u}px 0 0 ${edge}) drop-shadow(0 -${8 * u}px 0 ${edge}) drop-shadow(0 ${8 * u}px 0 ${edge})` }} />
      </AbsoluteFill>
    );
  }
  // behind: 누끼 인물 + 흰 테두리 + '글자 뒤 인물'(레퍼런스 2026-10-31) — 첫 줄을 둘로 나눠 머리 양옆에 크게 깔고 캐릭터가 그 앞을 가림, 둘째 줄은 아래에 맨 앞으로.
  // 머리가 글자를 가려도 읽히게 말 사이 틈에 머리를 둔다
  if (layout === "behind" && !tall) {
    const paint = t.bg === "red" ? "#C8161D" : dark ? "#050505" : "#FFFFFF";
    const [top, bottom] = lines;
    const parts = String(top).split(" ");
    const cutAt = parts.length < 2 ? 0 : parts.reduce((best, _, i) => { // 양쪽 글자 수가 가장 비슷해지는 띄어쓰기
      if (!i) return best;
      const gap = (k) => Math.abs(parts.slice(0, k).join("").length - parts.slice(k).join("").length);
      return gap(i) < gap(best) ? i : best;
    }, 1);
    const left = parts.slice(0, cutAt).join(" ");
    const right = parts.slice(cutAt).join(" ");
    const count = (x) => x.replace(/\*\*|!!|\s/g, "").length;
    const all = Math.max(count(left) + count(right), 1);
    const big = Math.min(235, 830 / Math.max(all, 3)) * u;
    const headX = 50 + ((count(left) - count(right)) / all) * 24; // 짧은 쪽으로 머리를 옮겨 글자 자리를 넓힌다
    const word = (w, side) => w && (
      <div style={{ position: "absolute", top: "5%", [side]: side === "left" ? "2%" : "2%", width: `${side === "left" ? headX - 19 : 100 - headX - 19}%`, display: "flex", justifyContent: "center", fontFamily: "BlackHanSans", fontSize: big, lineHeight: 1.05, letterSpacing: "-0.03em", whiteSpace: "nowrap", WebkitTextStroke: `${big * 0.09}px #0A0A0A`, paintOrder: "stroke fill", zIndex: 1 }}>
        <span><BoldText text={w} /></span>
      </div>
    );
    const low = bottom ? Math.min(150, 1160 / count(bottom)) * u : 0;
    // 첫 줄에 띄어쓰기가 없으면(3~4자) 화면 폭 가득 깐다 — 머리가 가려도 글자가 커서 읽힘 (사장님 2026-10-31 '1인기업' 레퍼런스)
    const giant = parts.length < 2;
    const huge = Math.min(430, 1250 / Math.max(count(top), 2)) * u;
    return (
      <AbsoluteFill style={{ background: paint, overflow: "hidden" }}>
        {giant ? (
          <div style={{ position: "absolute", top: "1%", left: 0, right: 0, textAlign: "center", fontFamily: "BlackHanSans", fontSize: huge, lineHeight: 1.05, letterSpacing: "-0.02em", whiteSpace: "nowrap", WebkitTextStroke: `${huge * 0.05}px #0A0A0A`, paintOrder: "stroke fill", zIndex: 1 }}>
            <BoldText text={top} />
          </div>
        ) : (
          <>
            {word(left, "left")}
            {word(right, "right")}
          </>
        )}
        <Img src={staticFile(t.image)} style={{ position: "absolute", left: giant ? "56%" : `${headX}%`, transform: "translateX(-50%)", top: giant ? (bottom ? "12%" : "17%") : "7%", height: giant ? (bottom ? "86%" : "100%") : bottom ? "92%" : "98%", zIndex: 2,
          filter: `drop-shadow(${7 * u}px 0 0 #fff) drop-shadow(-${7 * u}px 0 0 #fff) drop-shadow(0 -${7 * u}px 0 #fff) drop-shadow(0 ${7 * u}px 0 #fff)` }} />
        {bottom && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "3%", textAlign: "center", fontFamily: "BlackHanSans", fontSize: low, lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", WebkitTextStroke: `${low * 0.12}px #0A0A0A`, paintOrder: "stroke fill", zIndex: 3 }}>
            <BoldText text={bottom} />
          </div>
        )}
      </AbsoluteFill>
    );
  }
  if (side) return (
    <AbsoluteFill style={{ background: dark ? "#050505" : "#FFFFFF", flexDirection: "row", alignItems: "center" }}>
      <div style={{ width: "48%", height: "100%", display: "flex" }}>{art}</div>
      <div style={{ width: "52%", display: "flex", justifyContent: "center", paddingRight: 16 * u }}>{text}</div>
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ background: dark ? "#050505" : "#FFFFFF" }}>
      <AbsoluteFill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", padding: `${(layout === "text" ? 40 : 18) * u}px ${30 * u}px`, gap: 6 * u }}>
        {layout === "bottom" && text}
        {art}
        {layout !== "bottom" && text}
      </AbsoluteFill>
      {t.note && (
        <div style={{ position: "absolute", left: `${(t.noteX ?? 0.17) * 100}%`, top: `${(t.noteY ?? (layout === "bottom" ? 0.66 : layout === "top" ? 0.1 : 0.16)) * 100}%`, transform: "translate(-50%, -50%) rotate(-6deg)", fontFamily: "NanumPen", fontSize: 62 * u, color: dark ? "#FFFFFF" : "#111111", whiteSpace: "nowrap" }}>
          {t.note}
        </div>
      )}
    </AbsoluteFill>
  );
}

const KEY_YELLOW = "#FFD84D";

// **강조** 부분: 그림 배경이면 노란 글씨, 크림 배경이면 노란 형광펜
function Marked({ text, onImage }) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p, i) =>
      !p.startsWith("**") ? (
        <React.Fragment key={i}>{p}</React.Fragment>
      ) : onImage ? (
        <span key={i} style={{ color: KEY_YELLOW }}>{p.slice(2, -2)}</span>
      ) : (
        <span key={i} style={{ backgroundImage: `linear-gradient(transparent 55%, ${COLORS.amber} 55%, ${COLORS.amber} 92%, transparent 92%)`, padding: "0 0.06em" }}>
          {p.slice(2, -2)}
        </span>
      ),
    );
}

export function Thumbnail({ thumbnail = {} }) {
  const { width, height } = useVideoConfig();
  const tall = height > width;
  const u = Math.min(width, height) / 720;
  const { lines = ["제목"], kicker, image = "characters/main/think.cut.png", scene, textSide = "left" } = thumbnail;
  if (thumbnail.style === "bold") return <BoldThumb t={thumbnail} width={width} height={height} />;

  if (scene?.image) {
    const zoom = scene.zoom || 1.5;
    const fx = (scene.focusX ?? 0.6) * 100;
    const fy = (scene.focusY ?? 0.45) * 100;
    // 글씨 반대편에 캐릭터가 오도록: 확대 기준점을 캐릭터에 두고, 그림을 글씨 반대쪽으로 민다
    const shift = tall ? 0 : textSide === "left" ? 18 : -18;
    return (
      <AbsoluteFill style={{ background: COLORS.ink, overflow: "hidden" }}>
        <AbsoluteFill style={{ transform: `translateX(${shift}%) scale(${zoom})`, transformOrigin: `${fx}% ${fy}%` }}>
          <Img src={staticFile(scene.image)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${fx}% ${fy}%` }} />
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            background: tall
              ? "linear-gradient(180deg, rgba(20,18,16,0.85) 0%, rgba(20,18,16,0.5) 35%, rgba(20,18,16,0) 55%)"
              : `linear-gradient(${textSide === "left" ? 90 : 270}deg, rgba(20,18,16,0.88) 0%, rgba(20,18,16,0.6) 38%, rgba(20,18,16,0) 62%)`,
          }}
        />
        <AbsoluteFill
          style={{
            justifyContent: tall ? "flex-start" : "center",
            alignItems: tall ? "center" : textSide === "left" ? "flex-start" : "flex-end",
            padding: tall ? `${150 * u}px ${40 * u}px 0` : `0 ${50 * u}px`,
          }}
        >
          {kicker && (
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 40 * u, color: "#fff", background: COLORS.terracotta, padding: `${6 * u}px ${18 * u}px`, borderRadius: 10 * u, marginBottom: 18 * u }}>
              {kicker}
            </div>
          )}
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: FONT,
                fontWeight: 800,
                fontSize: (tall ? 130 : 122) * u,
                lineHeight: 1.08,
                letterSpacing: "-0.05em",
                color: "#fff",
                WebkitTextStroke: `${12 * u}px #111`,
                paintOrder: "stroke fill",
                textAlign: tall ? "center" : textSide,
                whiteSpace: "nowrap",
              }}
            >
              <Marked text={l} onImage />
            </div>
          ))}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill
        style={{
          flexDirection: tall ? "column" : "row",
          alignItems: "center",
          justifyContent: tall ? "flex-start" : "space-between",
          padding: tall ? `${170 * u}px ${50 * u}px 0` : `0 ${40 * u}px 0 ${70 * u}px`,
        }}
      >
        <div style={{ flex: tall ? "none" : 1, textAlign: tall ? "center" : "left", zIndex: 1 }}>
          {kicker && <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34 * u, color: COLORS.sageDeep, marginBottom: 14 * u }}>{kicker}</div>}
          {lines.map((l, i) => (
            <div
              key={i}
              style={{ fontFamily: FONT, fontWeight: 800, fontSize: (tall ? 92 : 88) * u, lineHeight: 1.18, letterSpacing: "-0.04em", color: COLORS.ink, wordBreak: "keep-all" }}
            >
              <Marked text={l} />
            </div>
          ))}
        </div>
        <Img
          src={staticFile(image)}
          style={{ height: (tall ? 760 : 620) * u, maxWidth: tall ? "90%" : "42%", objectFit: "contain", marginTop: tall ? 60 * u : 0, filter: "drop-shadow(0 10px 14px rgba(60,50,30,0.15))" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
