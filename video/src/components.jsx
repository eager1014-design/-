// 모든 장면이 같이 쓰는 부품: 배경, 형광펜 글자, 자막, 챕터 진행 표시, 효과음, 등장 움직임.
import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme.js";
import { captionChunks } from "./timing.js";

// 화면 크기에 비례하는 단위. 가로(1920×1080)와 세로(1080×1920) 모두 짧은 변 1080 = 1080u.
// 세로(쇼츠)는 휴대폰으로 보니까 글씨를 15% 키운다.
export function useUnit() {
  const { width, height } = useVideoConfig();
  return (Math.min(width, height) / 1080) * (height > width ? 1.15 : 1);
}

export function useIsShort() {
  const { width, height } = useVideoConfig();
  return height > width;
}

// 영상 전체 분위기: "calm"(차분) | "punchy"(통통 튀는 쇼츠 느낌). Episode 가 episode.json 의 style 로 정한다.
export const StyleContext = createContext("calm");
export const usePunchy = () => useContext(StyleContext) === "punchy";

// 부드럽게 튀어나오는 등장 (0 → 1). punchy 는 살짝 넘쳤다가 돌아오는 탄력.
export function useAppear(at = 0, { damping = 16, mass = 0.7 } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punchy = usePunchy();
  return spring({ frame: frame - at, fps, config: punchy ? { damping: 8, mass: 0.55, stiffness: 170 } : { damping, mass } });
}

// 아래에서 살짝 올라오며 나타나는 상자 (punchy: 작게 시작해서 통 튀어나옴)
export function Rise({ at = 0, children, style, distance = 40 }) {
  const p = useAppear(at);
  const u = useUnit();
  const punchy = usePunchy();
  const move = punchy ? `translateY(${(1 - p) * distance * 1.6 * u}px) scale(${0.7 + 0.3 * p})` : `translateY(${(1 - p) * distance * u}px) scale(${0.96 + 0.04 * p})`;
  return (
    <div style={{ opacity: Math.min(1, p), transform: move, ...style }}>
      {children}
    </div>
  );
}

// 천천히 움직이는 배경: 크림 바탕 + 흐릿한 세이지·호박색 빛 + 종이 질감.
// 렌더링이 빠르도록 blur 필터 대신 원형 그라데이션, 질감은 미리 만든 이미지(scripts/make_textures.mjs)를 쓴다.
export function Background({ tint = "sage" }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const glow = (x, y, size, color, speed, phase) => {
    const px = x + Math.sin(t * speed + phase) * 4;
    const py = y + Math.cos(t * speed * 0.8 + phase) * 4;
    return `radial-gradient(circle at ${px}% ${py}%, ${color}66 0%, ${color}00 ${size}%)`;
  };
  const main = tint === "amber" ? COLORS.amber : tint === "terracotta" ? COLORS.terracotta : COLORS.sage;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: [glow(12, 18, 45, main, 0.18, 0), glow(90, 85, 42, COLORS.amber, 0.14, 2), glow(75, 10, 30, COLORS.bgDeep, 0.2, 4)].join(","),
      }}
    >
      <AbsoluteFill style={{ backgroundImage: `url(${staticFile("textures/grain.png")})`, backgroundSize: "256px 256px", opacity: 0.5 }} />
    </AbsoluteFill>
  );
}

// **단어** 로 감싼 부분에 형광펜이 왼쪽부터 칠해진다.
export function Rich({ text, at = 0, color = COLORS.amber, style }) {
  const frame = useCurrentFrame();
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  let mark = 0;
  return (
    <span style={style}>
      {parts.map((p, i) => {
        if (!p.startsWith("**")) return <React.Fragment key={i}>{p}</React.Fragment>;
        const start = at + 8 + mark++ * 6;
        const w = interpolate(frame, [start, start + 12], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <span
            key={i}
            style={{
              backgroundImage: `linear-gradient(transparent 58%, ${color}cc 58%, ${color}cc 92%, transparent 92%)`,
              backgroundSize: `${w}% 100%`,
              backgroundRepeat: "no-repeat",
              padding: "0 0.08em",
            }}
          >
            {p.slice(2, -2)}
          </span>
        );
      })}
    </span>
  );
}

// 하단 자막. 내레이션을 조각내서 말하는 속도에 맞춰 보여준다.
export function Captions({ scene }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const short = useIsShort();
  const punchy = usePunchy();
  const chunks = captionChunks(scene, short ? 15 : 24);
  const now = chunks.find((c) => frame >= c.from && frame < c.to);
  if (!now) return null;
  const keys = punchy ? keywordsOf(scene) : [];
  const pop = punchy ? spring({ frame: frame - now.from, fps: 30, config: { damping: 10, mass: 0.4 } }) : 1;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: (short ? 330 : 60) * u, pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: punchy ? 800 : 700,
          fontSize: (short ? 56 : 46) * (punchy ? 1.12 : 1) * u,
          color: "#FFFFFF",
          WebkitTextStroke: `${(punchy ? 10 : 7) * u}px ${COLORS.ink}`,
          transform: `scale(${0.85 + 0.15 * pop})`,
          paintOrder: "stroke fill",
          letterSpacing: "-0.01em",
          textAlign: "center",
          maxWidth: "88%",
          lineHeight: 1.3,
        }}
      >
        {punchy
          ? now.text.split(" ").map((w, i) => (
              <span key={i} style={{ color: isKeyword(w, keys) ? KEY_COLOR : "#FFFFFF" }}>
                {i ? " " : ""}
                {w}
              </span>
            ))
          : now.text}
      </div>
    </AbsoluteFill>
  );
}

// punchy 자막에서 키워드만 노란색. 키워드 = 장면 화면 글씨에서 **강조**한 말 + scene.keywords
const KEY_COLOR = "#FFD84D";
function keywordsOf(scene) {
  const marked = [...JSON.stringify(scene).matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
  return [...marked, ...(scene.keywords || [])].flatMap((k) => k.split(/[\s\\n]+/)).map((k) => k.replace(/[^가-힣a-zA-Z0-9%]/g, "")).filter((k) => k.length >= 2);
}
function isKeyword(word, keys) {
  const w = word.replace(/[^가-힣a-zA-Z0-9%]/g, "");
  // 조사가 붙거나 빠져도 맞도록: "사람이" ↔ "사람", "감정도" ↔ "감정"
  return w.length >= 2 && keys.some((k) => w.includes(k) || k.includes(w.slice(0, Math.max(2, w.length - 1))));
}

// 상단 챕터 진행 표시 (01 · 02 · 03). 지금 챕터만 진하게.
export function ChapterProgress({ chapters, current }) {
  const u = useUnit();
  const short = useIsShort();
  const punchy = usePunchy();
  const pop = useAppear(4);
  if (!chapters?.length) return null;
  return (
    <div style={{ position: "absolute", top: (short ? 90 : 44) * u, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 14 * u }}>
      {chapters.map((c, i) => {
        const on = i + 1 === current;
        return (
          <div
            key={i}
            style={{
              fontFamily: FONT,
              fontWeight: on ? 800 : 600,
              fontSize: (punchy && short ? 26 : 22) * u,
              transform: on && punchy ? `scale(${0.8 + 0.2 * pop})` : undefined,
              padding: `${8 * u}px ${18 * u}px`,
              borderRadius: 999,
              color: on ? COLORS.card : COLORS.inkSoft,
              background: on ? COLORS.sageDeep : `${COLORS.card}cc`,
              border: `${2 * u}px solid ${on ? COLORS.sageDeep : COLORS.bgDeep}`,
            }}
          >
            {String(i + 1).padStart(2, "0")} {c}
          </div>
        );
      })}
    </div>
  );
}

// 효과음: 요소가 나타나는 순간마다 "뽁". 장면이 시작할 때 "슉".
export function Sfx({ at = [], whoosh = true }) {
  return (
    <>
      {whoosh && (
        <Sequence from={0} durationInFrames={20}>
          <Audio src={staticFile("sfx/whoosh.wav")} volume={0.35} />
        </Sequence>
      )}
      {at.map((f, i) => (
        <Sequence key={i} from={Math.max(0, f)} durationInFrames={12}>
          <Audio src={staticFile("sfx/pop.wav")} volume={0.4} />
        </Sequence>
      ))}
    </>
  );
}

// 둥근 카드
export function Card({ children, style }) {
  const u = useUnit();
  return (
    <div
      style={{
        background: COLORS.card,
        borderRadius: 28 * u,
        boxShadow: `0 ${10 * u}px 0 ${COLORS.bgDeep}, 0 ${24 * u}px ${60 * u}px rgba(60,50,30,0.10)`,
        padding: `${36 * u}px ${44 * u}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export const text = (u, size, weight = 700, color = COLORS.ink) => ({
  fontFamily: FONT,
  fontSize: size * u,
  fontWeight: weight,
  color,
  letterSpacing: "-0.02em",
  lineHeight: 1.35,
  wordBreak: "keep-all",
  whiteSpace: "pre-line",
});

// 모션그래픽 옆에 서 있는 채널 캐릭터. 배경을 오려낸 그림(scripts/cutout.mjs 로 만든 .cut.png)을 쓴다.
// scene.pose = "characters/main/poses/think.png", scene.poseSide = "right" | "left"
export function SideCharacter({ src, side = "right", at = 0 }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const short = useIsShort();
  const p = useAppear(at, { damping: 14 });
  const bob = Math.sin(frame / 22) * 4 * u; // 숨 쉬듯 살짝 움직임
  const size = (short ? 520 : 460) * u;
  return (
    <div
      style={{
        position: "absolute",
        bottom: (short ? 300 : 0) * u,
        [side]: (short ? 10 : 30) * u,
        width: size,
        height: size,
        opacity: p,
        transform: `translateY(${(1 - p) * 60 * u + bob}px)`,
        pointerEvents: "none",
      }}
    >
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 8px 10px rgba(60,50,30,0.12))" }} />
    </div>
  );
}
