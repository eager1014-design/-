// 모든 장면이 같이 쓰는 부품: 배경, 형광펜 글자, 자막, 챕터 진행 표시, 효과음, 등장 움직임.
import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme.js";
import { captionChunks, cueFrame, SFX_LEAD, voiceSafeVolume } from "./timing.js";

// 장면을 그릴 크기를 영상 크기와 다르게 정할 때 (제목 띠 쇼츠: 세로 영상 가운데 칸에 장면을 가로 배치로 그림).
// 값: { width, height } 또는 null(영상 크기 그대로)
export const SizeContext = createContext(null);
// 제목 띠 쇼츠에서 가운데 칸의 축소 비율(scale)과 칸 안 글씨·도형 확대(boost). null 이면 보통 영상
export const FrameContext = createContext(null);
// 자막 아래 여백을 직접 정할 때 (px). 진행자 쇼츠 무대에서는 캐릭터 얼굴을 가리지 않게 머리 위로 올린다
export const CaptionBottomContext = createContext(null);
// 띠 쇼츠(band.jsx): 자막 전용 줄 { top, height, size, chunk } — 이 줄 가운데에 한 줄로만 나온다
export const CaptionBandContext = createContext(null);

export function useSceneSize() {
  const video = useVideoConfig();
  return useContext(SizeContext) || video;
}

// 화면 크기에 비례하는 단위. 가로(1920×1080)와 세로(1080×1920) 모두 짧은 변 1080 = 1080u.
// 세로(쇼츠)는 휴대폰으로 보니까 글씨를 15% 키운다.
export function useUnit() {
  const { width, height } = useSceneSize();
  const fr = useContext(FrameContext);
  // 제목 띠 쇼츠: 가로 장면을 작은 칸에 줄여 넣으니 칸 안 요소를 키워서 휴대폰에서 읽히게
  return (Math.min(width, height) / 1080) * (height > width ? 1.15 : 1) * (fr?.boost || 1);
}

export function useIsShort() {
  const { width, height } = useSceneSize();
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
  // 배경은 모든 스킨에서 단색 (2026-10-24 칠판: 그라데이션에 흰 선이 묻힘 → 2026-10-26 사장님: "초록 그라데이션 별로, 그라데이션은 하지 마")
  // 빛 번짐 배경으로 되돌리려면 편 episode.json 에 "glowBackground": true 를 넣는 식으로 따로 켜야 함 (지금은 안 씀)
  if (COLORS.flat || !COLORS.glow) return <AbsoluteFill style={{ backgroundColor: COLORS.bg }} />;
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
        if (COLORS.dark) {
          // 칠판: 형광펜 대신 글씨가 노랗게 켜지며 빛남 (켜지는 순간 살짝 커졌다 돌아옴)
          const on = w / 100;
          const glow = 0.55 + 0.45 * Math.sin((frame - start) / 9);
          return (
            <span key={i} style={{ color: on > 0 ? color : undefined, textShadow: on > 0 ? `0 0 ${18 + 10 * glow}px ${color}aa, 0 0 4px ${color}` : undefined, display: "inline-block", transform: `scale(${1 + 0.12 * Math.sin(Math.min(1, on) * Math.PI)})` }}>
              {p.slice(2, -2)}
            </span>
          );
        }
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
  const fr = useContext(FrameContext);
  const unit = useUnit();
  // 제목 띠 쇼츠: 가운데 칸 안에 그리지만, 휴대폰 화면에서 쇼츠 자막 크기로 보이게 축소 비율만큼 키운다
  const u = fr ? 1.15 / fr.scale : unit;
  const short = useIsShort() || !!fr;
  const punchy = usePunchy();
  const bottomPx = useContext(CaptionBottomContext);
  const band = useContext(CaptionBandContext);
  const chunks = captionChunks(scene, band ? band.chunk : 15); // 한 줄 최대 15자 (사운드·자막 원칙 2026-10-24)
  const now = chunks.find((c) => frame >= c.from && frame < c.to);
  if (!now) return null;
  const keys = punchy ? keywordsOf(scene) : [];
  const pop = punchy ? spring({ frame: frame - now.from, fps: 30, config: { damping: 10, mass: 0.4 } }) : 1;
  return (
    <AbsoluteFill style={band ? { top: band.top, height: band.height, justifyContent: "center", alignItems: "center", pointerEvents: "none" }
      : { justifyContent: "flex-end", alignItems: "center", paddingBottom: bottomPx ?? (fr ? 40 : short ? 330 : 60) * u, pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: punchy ? 800 : 700,
          fontSize: band ? band.size : (short ? 56 : 46) * (punchy ? 1.12 : 1) * u,
          color: "#FFFFFF",
          WebkitTextStroke: band && !band.paper ? "none" : `${band ? 7 : (punchy ? 10 : 7) * u}px ${COLORS.stroke || COLORS.ink}`,
          transform: `scale(${0.85 + 0.15 * pop})`,
          paintOrder: "stroke fill",
          letterSpacing: "-0.01em",
          textAlign: "center",
          maxWidth: band ? "96%" : "88%",
          whiteSpace: band ? "nowrap" : undefined,
          lineHeight: 1.3,
        }}
      >
        {punchy
          ? now.text.split(" ").map((w, i) => (
              <span key={i} style={{ color: isKeyword(w, keys) ? COLORS.key : "#FFFFFF" }}>
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
// 효과음 자동 넣기 스위치: 편의 "soundPlan": true 면 끔 → 대본이 장면마다 고른 효과음(sfx)·강조 자막(punch) 소리만 남음
// (자동으로 장면마다 휙 + 글씨마다 뽁이 나면 '한 문장에 효과음 최대 1개' 원칙이 깨짐)
export const SOUND = { auto: true };
export const sfxFile = (name, ext) => `sfx/${name}.${ext || (["chime", "whoosh", "pop"].includes(name) ? "wav" : "mp3")}`;

export function Sfx({ at = [], whoosh = true }) {
  if (!SOUND.auto) return null;
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
        boxShadow: COLORS.dark ? `0 0 0 ${2 * u}px ${COLORS.sage}55, 0 0 ${40 * u}px ${COLORS.sage}22` : `0 ${10 * u}px 0 ${COLORS.bgDeep}, 0 ${24 * u}px ${60 * u}px rgba(60,50,30,0.10)`,
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

// 스티커: 장면 칸 "stickers": [{"emoji": "✨", "at": "단어", "x": 0.82, "y": 0.18, "size": 90}] — 그 단어에서 통통 튀며 나타나 살짝 흔들림
// x·y 는 화면 비율(0~1), size 는 1080 기준 px. 귀여운 스타일(skin cute)에서 반짝이·전구·말풍선 같은 포인트용
export function Stickers({ scene }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const u = width / 1080;
  return (scene.stickers || []).map((st, i) => {
    const at = st.at ? cueFrame(scene, st.at) : 6;
    if (frame < at) return null;
    const pop = spring({ frame: frame - at, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } });
    const wobble = Math.sin((frame - at) / 9 + i) * 6;
    return (
      <div key={i} style={{ position: "absolute", left: `${(st.x ?? 0.85) * 100}%`, top: `${(st.y ?? 0.2) * 100}%`, transform: `translate(-50%, -50%) scale(${pop}) rotate(${wobble}deg)`, fontSize: (st.size || 90) * u, lineHeight: 1, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.15))" }}>
        {st.emoji}
      </div>
    );
  });
}

// 소품 아이콘: 장면 칸 "props": [{"icon": "brain", "at": "단어", "x": 0.8, "y": 0.35, "size": 260, "move": "bob"}]
// 그림: public/icons/<이름>.png (검은 선 손그림, 칠판 스킨에서는 흰 선으로 뒤집음)
// 등장: 왼쪽부터 선이 그려지듯 드러남(빛나는 펜 끝) → 그다음 계속 살짝 움직임 move: bob(둥실) · wiggle(흔들) · pulse(두근) · spin(빙글)
export function Props({ scene }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const u = width / 1080;
  return (scene.props || []).map((p, i) => {
    const at = p.at ? cueFrame(scene, p.at) : 6;
    if (at == null || frame < at) return null;
    const t = frame - at;
    const draw = Math.min(1, t / 20);
    const ease = 1 - Math.pow(1 - draw, 3);
    const m = p.move || "bob";
    const idle = t < 20 ? "" : m === "wiggle" ? `rotate(${Math.sin(t / 6) * 6}deg)` : m === "pulse" ? `scale(${1 + 0.06 * Math.sin(t / 5)})` : m === "spin" ? `rotate(${(t - 20) * 2}deg)` : `translateY(${Math.sin(t / 14) * 10 * u}px)`;
    const size = (p.size || 240) * u;
    return (
      <div key={i} style={{ position: "absolute", left: `${(p.x ?? 0.8) * 100}%`, top: `${(p.y ?? 0.35) * 100}%`, width: size, height: size, transform: `translate(-50%, -50%) ${idle}` }}>
        <Img src={staticFile(`icons/${p.icon}.png`)} style={{ width: "100%", height: "100%", objectFit: "contain", clipPath: `inset(0 ${100 - ease * 100}% 0 0)`,
          filter: COLORS.dark ? `invert(1) drop-shadow(0 0 ${8 * u}px ${COLORS.sage}aa)` : undefined }} />
        {draw < 1 && <div style={{ position: "absolute", left: `${ease * 100}%`, top: "50%", width: 18 * u, height: 18 * u, borderRadius: 99, background: COLORS.amber, boxShadow: `0 0 ${24 * u}px ${COLORS.amber}`, transform: "translate(-50%, -50%)" }} />}
      </div>
    );
  });
}

// 강조 자막 (사운드·자막 원칙 2026-10-24): 장면 칸 "punch": [{"text": "**7분**이면 끝", "at": "칠", "kind": "number"}]
// 화면 가운데~약간 아래, 일반 자막의 약 2배, 굵은 고딕, 흰 글씨 + 검은 테두리, **단어**만 골드(#FFD700). 1.6초 보임.
// kind 별 움직임·소리: number(사실·숫자) 팝업 + 쿵 · turn(반전·깨달음) 줌인 + 심장소리 · hope(다짐·희망) 아래서 떠오름 + 반짝
//                     question(질문) 옆에서 밀려옴 + 스윽 · emotion(이혼·약·바닥·부모님·고백) 색 없이 천천히, 소리 없음
const PUNCH_SFX = { number: "thud", turn: "heartbeat", hope: "sparkle", question: "swipe" };
export function Punch({ scene }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  return (scene.punch || []).map((p, i) => {
    const at = p.at ? cueFrame(scene, p.at) ?? 0 : 0;
    const t = frame - at;
    const dur = Math.round((p.seconds || 1.6) * fps);
    const kind = p.kind || "number";
    if (t < 0 || t > dur) return null;
    const sp = spring({ frame: t, fps, config: { damping: 11, mass: 0.5, stiffness: 170 } });
    const out = 1 - Math.max(0, Math.min(1, (t - (dur - 8)) / 8));
    const move = kind === "turn" ? `scale(${1.35 - 0.35 * sp})` : kind === "hope" ? `translateY(${(1 - sp) * 120 * u}px)` : kind === "question" ? `translateX(${(1 - sp) * 380 * u}px)` : kind === "emotion" ? "none" : `scale(${0.3 + 0.7 * sp})`;
    const opacity = (kind === "emotion" ? Math.min(1, t / 12) : Math.min(1, sp * 1.5)) * out;
    const gold = kind === "emotion" ? "#FFFFFF" : "#FFD700";
    const parts = String(p.text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return (
      // 뒤 화면을 잠깐 어둡게 눌러 강조 자막만 또렷하게 (복잡한 화면 위에서도 읽히게)
      <AbsoluteFill key={i} style={{ justifyContent: "center", alignItems: "center", paddingTop: height * 0.12, pointerEvents: "none", background: `rgba(0,0,0,${0.6 * opacity})` }}>
        <div style={{ transform: move, opacity, fontFamily: FONT, fontWeight: 800, fontSize: (height > width ? 118 : 104) * u, lineHeight: 1.15, letterSpacing: "-0.02em",
          color: "#FFFFFF", WebkitTextStroke: `${14 * u}px #000000`, paintOrder: "stroke fill", textAlign: "center", maxWidth: "90%", whiteSpace: "pre-line" }}>
          {parts.map((x, k) => x.startsWith("**") ? <span key={k} style={{ color: gold }}>{x.slice(2, -2)}</span> : <React.Fragment key={k}>{x}</React.Fragment>)}
        </div>
      </AbsoluteFill>
    );
  });
}

// 강조 자막 효과음 (Punch 와 같은 시점, 장면 효과음과 0.5초 안에 겹치면 하나만)
export function PunchSfx({ scene }) {
  return (scene.punch || []).map((p, i) => {
    const kind = p.kind || "number";
    const name = p.sfx || PUNCH_SFX[kind];
    if (!name || kind === "emotion" || scene.emotion) return null;
    const at = p.at ? cueFrame(scene, p.at) ?? 0 : 0;
    const clash = (scene.sfx || []).some((x) => !x.after && Math.abs((cueFrame(scene, x.cue) ?? 0) - at) < 15);
    if (clash) return null;
    const from = Math.max(0, at - SFX_LEAD);
    return (
      <Sequence key={i} from={from} durationInFrames={60}>
        <Audio src={staticFile(sfxFile(name))} volume={voiceSafeVolume(scene, from, 0.38)} />
      </Sequence>
    );
  });
}
