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
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { COLORS, FONT } from "./theme.js";
import { Background } from "./components.jsx";

loadFont({ family: FONT, url: staticFile("fonts/Pretendard-ExtraBold.woff2"), weight: "800" });
loadFont({ family: FONT, url: staticFile("fonts/Pretendard-Bold.woff2"), weight: "700" });

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
