// 장면 틀 모음. 대본(episode.json)의 각 장면 "type" 이 아래 이름 중 하나다.
// 모든 장면은 { scene } 을 받고, 화면 요소의 등장 시점은 timing.revealFrames 로 내레이션에 맞춘다.
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "./theme.js";
import { revealFrames } from "./timing.js";
import { Card, Rich, Rise, Sfx, text, useAppear, useIsShort, useUnit } from "./components.jsx";

const Center = ({ children, style }) => {
  const u = useUnit();
  const short = useIsShort();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${(short ? 220 : 120) * u}px ${(short ? 70 : 160) * u}px ${(short ? 420 : 170) * u}px`, ...style }}>
      {children}
    </AbsoluteFill>
  );
};

const Kicker = ({ children, at = 0, color = COLORS.sageDeep }) => {
  const u = useUnit();
  return (
    <Rise at={at}>
      <div style={{ ...text(u, 30, 800, color), letterSpacing: "0.04em", marginBottom: 22 * u, textAlign: "center" }}>{children}</div>
    </Rise>
  );
};

const lineItems = (scene, key) => (scene[key] || []).map((x) => (typeof x === "string" ? { text: x } : x));

// 1) 훅: 큰 문장이 한 줄씩 등장. lines: ["...", {text, cue}]
function Hook({ scene }) {
  const u = useUnit();
  const short = useIsShort();
  const lines = lineItems(scene, "lines");
  const at = revealFrames(scene, lines);
  return (
    <Center>
      <Sfx at={at} />
      {scene.kicker && <Kicker>{scene.kicker}</Kicker>}
      {lines.map((l, i) => (
        <Rise key={i} at={at[i]} style={{ marginBottom: 18 * u, textAlign: "center" }}>
          <Rich text={l.text} at={at[i]} style={text(u, (short ? 84 : 92) - (i === 0 ? 0 : 12), i === 0 ? 800 : 700)} />
        </Rise>
      ))}
    </Center>
  );
}

// 2) 한 문장 강조: text, kicker, tone("sage"|"terracotta")
function Statement({ scene }) {
  const u = useUnit();
  const short = useIsShort();
  const [at] = revealFrames(scene, [{ cue: scene.cue }]);
  return (
    <Center>
      <Sfx at={[at]} />
      {scene.kicker && <Kicker color={scene.tone === "terracotta" ? COLORS.terracotta : COLORS.sageDeep}>{scene.kicker}</Kicker>}
      <Rise at={at} style={{ textAlign: "center" }}>
        <Rich text={scene.text} at={at} style={text(u, short ? 78 : 84, 800)} />
      </Rise>
      {scene.sub && (
        <Rise at={at + 20} style={{ marginTop: 28 * u, textAlign: "center" }}>
          <div style={text(u, 38, 500, COLORS.inkSoft)}>{scene.sub}</div>
        </Rise>
      )}
    </Center>
  );
}

// 3) 오늘의 순서 예고: title, items: ["...", ...] — 번호 카드가 차례로
function Roadmap({ scene }) {
  const u = useUnit();
  const short = useIsShort();
  const items = lineItems(scene, "items");
  const at = revealFrames(scene, items);
  return (
    <Center>
      <Sfx at={at} />
      <Rise>
        <div style={{ ...text(u, short ? 64 : 66, 800), textAlign: "center", marginBottom: 44 * u }}>
          <Rich text={scene.title} />
        </div>
      </Rise>
      <div style={{ display: "flex", flexDirection: short ? "column" : "row", gap: 28 * u, width: "100%", justifyContent: "center" }}>
        {items.map((it, i) => (
          <Rise key={i} at={at[i]} style={{ flex: short ? "none" : 1, maxWidth: short ? "none" : 520 * u }}>
            <Card style={{ display: "flex", flexDirection: short ? "row" : "column", alignItems: short ? "center" : "flex-start", gap: 18 * u, height: "100%" }}>
              <div style={{ ...text(u, 64, 800, COLORS.sage), lineHeight: 1 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={text(u, short ? 42 : 40, 700)}>{it.text}</div>
            </Card>
          </Rise>
        ))}
      </div>
    </Center>
  );
}

// 4) 챕터 시작: number, title, sub
function Chapter({ scene }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const p = useAppear(0, { damping: 13 });
  const wipe = interpolate(frame, [0, 16], [0, 100], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Sfx at={[6]} />
      <AbsoluteFill style={{ background: COLORS.sageDeep, clipPath: `inset(0 ${100 - wipe}% 0 0)` }} />
      <Center>
        <div style={{ ...text(u, 260, 800, COLORS.amber), lineHeight: 1, transform: `scale(${0.6 + 0.4 * p})`, opacity: p }}>
          {String(scene.number).padStart(2, "0")}
        </div>
        <Rise at={10}>
          <div style={{ ...text(u, 76, 800, COLORS.card), textAlign: "center", marginTop: 20 * u }}>{scene.title}</div>
        </Rise>
        {scene.sub && (
          <Rise at={22}>
            <div style={{ ...text(u, 38, 500, `${COLORS.card}cc`), textAlign: "center", marginTop: 18 * u }}>{scene.sub}</div>
          </Rise>
        )}
      </Center>
    </AbsoluteFill>
  );
}

// 5) 큰 숫자: value(숫자), prefix, suffix, label, source
function BigNumber({ scene }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const [at] = revealFrames(scene, [{ cue: scene.cue }]);
  const p = interpolate(frame, [at, at + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - Math.pow(1 - t, 3) });
  const decimals = String(scene.value).includes(".") ? String(scene.value).split(".")[1].length : 0;
  const shown = (scene.value * p).toFixed(decimals);
  return (
    <Center>
      <Sfx at={[at]} />
      {scene.kicker && <Kicker>{scene.kicker}</Kicker>}
      <Rise at={at}>
        <div style={{ ...text(u, 220, 800, COLORS.sageDeep), lineHeight: 1, textAlign: "center" }}>
          <span style={{ fontSize: 110 * u }}>{scene.prefix}</span>
          {shown}
          <span style={{ fontSize: 110 * u }}>{scene.suffix}</span>
        </div>
      </Rise>
      <Rise at={at + 12} style={{ marginTop: 26 * u, textAlign: "center" }}>
        <Rich text={scene.label} at={at + 12} style={text(u, 50, 700)} />
      </Rise>
      {scene.source && (
        <Rise at={at + 24} style={{ marginTop: 26 * u }}>
          <div style={text(u, 24, 500, COLORS.inkSoft)}>출처: {scene.source}</div>
        </Rise>
      )}
    </Center>
  );
}

// 6) 논문 출처 카드: authors, year, journal, title, finding
function Citation({ scene }) {
  const u = useUnit();
  const short = useIsShort();
  const [cardAt, findAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.findingCue }]);
  return (
    <Center>
      <Sfx at={[cardAt, findAt]} />
      <Rise at={cardAt} distance={80} style={{ width: short ? "100%" : 1240 * u }}>
        <Card style={{ borderLeft: `${12 * u}px solid ${COLORS.sage}` }}>
          <div style={{ display: "flex", gap: 14 * u, alignItems: "center", marginBottom: 18 * u }}>
            <span style={{ ...text(u, 24, 800, COLORS.card), background: COLORS.sageDeep, borderRadius: 999, padding: `${6 * u}px ${16 * u}px` }}>연구</span>
            <span style={text(u, 28, 700, COLORS.inkSoft)}>
              {scene.authors} · {scene.year}
            </span>
          </div>
          <div style={{ ...text(u, short ? 36 : 40, 700), marginBottom: 10 * u }}>{scene.title}</div>
          {scene.journal && <div style={text(u, 26, 500, COLORS.inkSoft)}>{scene.journal}</div>}
        </Card>
      </Rise>
      {scene.finding && (
        <Rise at={findAt} style={{ marginTop: 44 * u, textAlign: "center" }}>
          <Rich text={scene.finding} at={findAt} style={text(u, short ? 54 : 58, 800)} />
        </Rise>
      )}
    </Center>
  );
}

// 7) 좌우 비교: left{title, emoji, items[]}, right{...}. 세로 영상에서는 위아래로.
function Compare({ scene }) {
  const u = useUnit();
  const short = useIsShort();
  const sides = [scene.left, scene.right];
  const items = sides.flatMap((s, si) => (s.items || []).map((x) => ({ ...(typeof x === "string" ? { text: x } : x), si })));
  const heads = revealFrames(scene, sides.map((s) => ({ cue: s.cue })));
  const at = revealFrames(scene, items);
  const colors = [scene.leftColor || COLORS.amber, scene.rightColor || COLORS.sage];
  return (
    <Center>
      <Sfx at={[...heads, ...at]} />
      {scene.title && (
        <Rise>
          <div style={{ ...text(u, 58, 800), textAlign: "center", marginBottom: 36 * u }}>
            <Rich text={scene.title} />
          </div>
        </Rise>
      )}
      <div style={{ display: "flex", flexDirection: short ? "column" : "row", gap: 36 * u, width: "100%", justifyContent: "center" }}>
        {sides.map((s, si) => (
          <Rise key={si} at={heads[si]} style={{ flex: 1, maxWidth: short ? "none" : 720 * u }}>
            <Card style={{ borderTop: `${12 * u}px solid ${colors[si]}`, height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18 * u, marginBottom: 20 * u }}>
                {s.emoji && <span style={{ fontSize: 64 * u }}>{s.emoji}</span>}
                <span style={text(u, 50, 800)}>{s.title}</span>
              </div>
              {items.map((it, ii) =>
                it.si !== si ? null : (
                  <Rise key={ii} at={at[ii]} distance={20}>
                    <div style={{ ...text(u, 36, 600), display: "flex", gap: 12 * u, marginTop: 12 * u }}>
                      <span style={{ color: colors[si] }}>●</span>
                      <span>{it.text}</span>
                    </div>
                  </Rise>
                ),
              )}
            </Card>
          </Rise>
        ))}
      </div>
    </Center>
  );
}

// 8) 체크리스트: title, items[] — 체크 표시가 그려지며 하나씩
function Checklist({ scene }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const items = lineItems(scene, "items");
  const at = revealFrames(scene, items);
  return (
    <Center>
      <Sfx at={at} />
      {scene.title && (
        <Rise>
          <div style={{ ...text(u, 60, 800), textAlign: "center", marginBottom: 40 * u }}>
            <Rich text={scene.title} />
          </div>
        </Rise>
      )}
      <Card style={{ minWidth: 900 * u, maxWidth: "100%" }}>
        {items.map((it, i) => {
          const draw = interpolate(frame, [at[i], at[i] + 12], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <Rise key={i} at={at[i]} distance={20}>
              <div style={{ display: "flex", alignItems: "center", gap: 24 * u, padding: `${16 * u}px 0`, borderBottom: i < items.length - 1 ? `${2 * u}px solid ${COLORS.bgDeep}` : "none" }}>
                <svg width={56 * u} height={56 * u} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                  <rect x="1" y="1" width="26" height="26" rx="8" fill={COLORS.sage} />
                  <path d="M7 14.5 L12 19 L21 9" fill="none" stroke={COLORS.card} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" strokeDashoffset={draw} />
                </svg>
                <Rich text={it.text} at={at[i]} style={text(u, 44, 700)} />
              </div>
            </Rise>
          );
        })}
      </Card>
    </Center>
  );
}

// 9) 막대 차트: title, bars[{label, value, color?}], unit, source
function Bars({ scene }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const bars = scene.bars || [];
  const at = revealFrames(scene, bars);
  const max = Math.max(...bars.map((b) => b.value));
  return (
    <Center>
      <Sfx at={at} />
      {scene.title && (
        <Rise>
          <div style={{ ...text(u, 58, 800), textAlign: "center", marginBottom: 44 * u }}>
            <Rich text={scene.title} />
          </div>
        </Rise>
      )}
      <Card style={{ width: "100%", maxWidth: 1300 * u }}>
        {bars.map((b, i) => {
          const grow = interpolate(frame, [at[i], at[i] + 24], [0, b.value / max], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - Math.pow(1 - t, 3) });
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 24 * u, margin: `${18 * u}px 0` }}>
              <div style={{ ...text(u, 34, 700), width: 300 * u, flexShrink: 0 }}>{b.label}</div>
              <div style={{ flex: 1, height: 54 * u, background: COLORS.bgDeep, borderRadius: 14 * u, overflow: "hidden" }}>
                <div style={{ width: `${grow * 100}%`, height: "100%", background: b.color || COLORS.sage, borderRadius: 14 * u }} />
              </div>
              <div style={{ ...text(u, 36, 800, COLORS.sageDeep), width: 150 * u, textAlign: "right", opacity: grow > 0 ? 1 : 0 }}>
                {Math.round((grow * max * 10)) / 10}
                {scene.unit}
              </div>
            </div>
          );
        })}
        {scene.source && <div style={{ ...text(u, 22, 500, COLORS.inkSoft), marginTop: 12 * u }}>출처: {scene.source}</div>}
      </Card>
    </Center>
  );
}

// 10) 이야기 장면: image(사진·일러스트) 또는 video 가 있으면 카메라 움직임, 없으면 큰 이모지.
//   motion: "zoomIn"(기본) | "zoomOut" | "panRight" | "panLeft" | "focus" (focus 는 focusX/focusY(0~1) 지점으로 다가감)
//   textSide: "center"(기본) | "left" | "right" — 그림의 빈 공간 쪽에 글씨를 둔다
//   세로 영상에서 가로(16:9) 그림을 쓰면 가운데만 보이므로, focusX(0~1, 캐릭터가 있는 곳)를 화면 가운데에 오게 자른다
const ease = (t) => t * t * (3 - 2 * t); // 부드럽게 시작하고 부드럽게 멈춤
function cameraOf(scene, t) {
  const m = scene.motion || "zoomIn";
  const k = ease(t);
  if (m === "zoomOut") return { scale: 1.16 - 0.12 * k, x: 0, y: 0, origin: "50% 50%" };
  if (m === "panRight") return { scale: 1.14, x: -4 + 8 * k, y: 0, origin: "50% 50%" };
  if (m === "panLeft") return { scale: 1.14, x: 4 - 8 * k, y: 0, origin: "50% 50%" };
  if (m === "focus") return { scale: 1.0 + 0.28 * k, x: 0, y: 0, origin: `${(scene.focusX ?? 0.6) * 100}% ${(scene.focusY ?? 0.45) * 100}%` };
  return { scale: 1.0 + 0.12 * k, x: 0, y: 0, origin: "50% 50%" };
}

// 세로 화면(9:16)에 16:9 그림을 꽉 채우면 보이는 폭은 그림의 약 32%
const SHORT_VISIBLE = 9 / 16 / (16 / 9);
function shortCrop(scene) {
  if (scene.focusX == null) return "50% 50%";
  const x = Math.min(1, Math.max(0, (scene.focusX - SHORT_VISIBLE / 2) / (1 - SHORT_VISIBLE)));
  return `${x * 100}% 50%`;
}

function Story({ scene, frames }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const short = useIsShort();
  const t = Math.min(1, frame / Math.max(1, frames));
  const cam = cameraOf(scene, t);
  // 세로 영상: 자른 뒤 캐릭터가 가운데에 오므로 확대도 가운데(세로 위치만 focusY)를 기준으로
  if (short && scene.motion === "focus") cam.origin = `50% ${(scene.focusY ?? 0.45) * 100}%`;
  const crop = short ? shortCrop(scene) : "50% 50%";
  const lines = lineItems(scene, "lines");
  const at = revealFrames(scene, lines);
  const media = scene.image || scene.video;
  const side = short ? (media ? "top" : "center") : scene.textSide || "center";
  const align = side === "left" ? "flex-start" : side === "right" ? "flex-end" : "center";
  return (
    <AbsoluteFill>
      <Sfx at={at} />
      {media ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <AbsoluteFill style={{ transform: `translate(${cam.x}%, ${cam.y}%) scale(${cam.scale})`, transformOrigin: cam.origin }}>
            {scene.image ? (
              <Img src={staticFile(scene.image)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: crop }} />
            ) : (
              <OffthreadVideo src={staticFile(scene.video)} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: crop }} />
            )}
          </AbsoluteFill>
          {/* 글씨가 잘 보이도록 글씨 쪽만 살짝 어둡게 */}
          <AbsoluteFill
            style={{
              background:
                side === "left"
                  ? "linear-gradient(90deg, rgba(43,42,40,0.55) 0%, rgba(43,42,40,0.25) 40%, rgba(43,42,40,0) 62%)"
                  : side === "right"
                    ? "linear-gradient(270deg, rgba(43,42,40,0.55) 0%, rgba(43,42,40,0.25) 40%, rgba(43,42,40,0) 62%)"
                    : side === "top"
                      ? "linear-gradient(180deg, rgba(43,42,40,0.6) 0%, rgba(43,42,40,0.3) 22%, rgba(43,42,40,0) 38%)"
                      : "linear-gradient(180deg, rgba(43,42,40,0) 45%, rgba(43,42,40,0.55) 100%)",
            }}
          />
        </AbsoluteFill>
      ) : (
        <Center style={{ paddingBottom: (short ? 600 : 360) * u }}>
          <div style={{ fontSize: 260 * u, transform: `scale(${cam.scale})`, filter: "drop-shadow(0 12px 18px rgba(60,50,30,0.18))" }}>{scene.emoji || "🌿"}</div>
        </Center>
      )}
      <AbsoluteFill
        style={{
          justifyContent: side === "center" ? "flex-end" : side === "top" ? "flex-start" : "center",
          alignItems: side === "top" ? "center" : align,
          padding: side === "center" ? `0 0 ${(short ? 560 : 200) * u}px` : side === "top" ? `${200 * u}px 0 0` : `0 ${120 * u}px`,
        }}
      >
        {lines.map((l, i) => (
          <Rise key={i} at={at[i]} style={{ marginTop: 14 * u, textAlign: side === "center" || side === "top" ? "center" : side, maxWidth: side === "center" || side === "top" ? "86%" : "46%" }}>
            <Rich text={l.text} at={at[i]} style={{ ...text(u, 62, 800, media ? COLORS.card : COLORS.ink), textShadow: media ? `0 ${2 * u}px ${14 * u}px rgba(0,0,0,0.35)` : "none" }} />
          </Rise>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// 11) 마무리: question(댓글 질문 하나), channel
function Outro({ scene }) {
  const u = useUnit();
  const [qAt, chAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.channelCue }]);
  return (
    <Center>
      <Sfx at={[qAt, chAt]} />
      <Rise at={qAt}>
        <Card style={{ textAlign: "center", borderTop: `${12 * u}px solid ${COLORS.amber}` }}>
          <div style={{ ...text(u, 30, 800, COLORS.sageDeep), marginBottom: 16 * u }}>💬 댓글로 알려주세요</div>
          <Rich text={scene.question} at={qAt} style={text(u, 62, 800)} />
        </Card>
      </Rise>
      <Rise at={chAt} style={{ marginTop: 50 * u, textAlign: "center" }}>
        <div style={text(u, 40, 700, COLORS.inkSoft)}>{scene.channel || "예민한자립가"}</div>
      </Rise>
    </Center>
  );
}

export const SCENES = {
  hook: Hook,
  statement: Statement,
  roadmap: Roadmap,
  chapter: Chapter,
  bigNumber: BigNumber,
  citation: Citation,
  compare: Compare,
  checklist: Checklist,
  bars: Bars,
  story: Story,
  outro: Outro,
};
