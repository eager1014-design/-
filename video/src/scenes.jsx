// 장면 틀 모음. 대본(episode.json)의 각 장면 "type" 이 아래 이름 중 하나다.
// 모든 장면은 { scene } 을 받고, 화면 요소의 등장 시점은 timing.revealFrames 로 내레이션에 맞춘다.
import React, { useContext } from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS, ELEMENTS } from "./theme.js";
import { cueFrame, revealFrames } from "./timing.js";
import { Dialogue } from "./presenter.jsx";
import { Card, FrameContext, Rich, Rise, Sfx, text, useAppear, useIsShort, useSceneSize, useUnit } from "./components.jsx";

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

// 그림이 그려지는 연출 (scene.draw, scene.drawFace — 2026-10-27 사장님): 바탕색 덮개를 연필이 지그재그로 지워 나가며 그림이 드러난다.
// 덮개는 그림 바탕색(scene.drawBg, 없으면 장면 바탕색)이라 검정 바탕 삽화·캐릭터 선화에서 '손으로 그리는' 느낌. 장면 앞쪽 55%(최대 2.4초) 동안 그린다.
function zigzag(rows) {
  const pts = [];
  for (let i = 0; i < rows; i++) {
    const y = ((i + 0.5) * 100) / rows;
    const [a, b] = i % 2 ? [105, -5] : [-5, 105];
    pts.push([a, y - 4], [b, y + 4]);
  }
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  return { pts, seg, total: seg.reduce((x, y) => x + y, 0) };
}
function tipAt({ pts, seg, total }, p) {
  let left = p * total;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const k = left / seg[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    left -= seg[i];
  }
  return pts.at(-1);
}
function DrawCover({ frames, rows = 6, color = COLORS.bg }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const id = React.useId().replace(/:/g, "");
  const dur = Math.max(18, Math.min(72, frames * 0.55));
  const p = ease(Math.min(1, frame / dur));
  if (p >= 1) return null;
  const z = zigzag(rows);
  const [tx, ty] = tipAt(z, p);
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", width: "100%", height: "100%" }}>
        <mask id={id}>
          <rect x="-10" y="-10" width="120" height="120" fill="white" />
          <path d={"M" + z.pts.map((q) => q.join(" ")).join(" L")} pathLength="1" stroke="black" strokeWidth={(100 / rows) * 1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="1 1" strokeDashoffset={1 - p} />
        </mask>
        <rect x="-10" y="-10" width="120" height="120" fill={color} mask={`url(#${id})`} />
      </svg>
      <div style={{ position: "absolute", left: `${Math.min(96, Math.max(2, tx))}%`, top: `${ty}%`, fontSize: 96 * u, transform: "translate(-12%, -88%)", opacity: interpolate(p, [0.9, 1], [1, 0], { extrapolateLeft: "clamp" }) }}>✏️</div>
    </AbsoluteFill>
  );
}

// 캐릭터 표정 크게 그리기 (scene.drawFace: smile·surprised·serious·laugh·worried·kind): 내 캐릭터 얼굴이 연필로 그려지고 옆에 글씨
function DrawFace({ scene, frames }) {
  const u = useUnit();
  const short = useIsShort();
  const lines = lineItems(scene, "lines");
  const at = revealFrames(scene, lines);
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sfx at={at} />
      {/* 얼굴 클로즈업: 그림(900×1100, 머리가 위쪽 절반)을 크게 키워 머리만 보이게 */}
      <div style={{ position: "absolute", overflow: "hidden", ...(short ? { left: 0, width: "100%", top: "12%", height: "46%" } : { left: "50%", width: "42%", top: "8%", height: "84%" }) }}>
        <Img src={staticFile(`characters/round/faces/${scene.drawFace}.png`)} style={{ position: "absolute", height: "165%", left: "50%", top: "-6%", transform: "translateX(-50%)", filter: COLORS.dark ? "invert(1)" : undefined }} />
        <DrawCover frames={frames} rows={short ? 7 : 6} />
      </div>
      <AbsoluteFill style={short ? { top: "60%", justifyContent: "flex-start", alignItems: "center" } : { justifyContent: "center", alignItems: "flex-start", padding: `0 50% 0 ${120 * u}px` }}>
        {lines.map((l, i) => (
          <Rise key={i} at={at[i]} style={{ marginTop: 14 * u, textAlign: short ? "center" : "left", maxWidth: short ? "86%" : "100%" }}>
            <Rich text={l.text} at={at[i]} style={text(u, 80, 800, COLORS.ink)} />
          </Rise>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Story({ scene, frames }) {
  if (scene.drawFace && !scene.image) return <DrawFace scene={scene} frames={frames} />;
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
  // fit: "contain" — 세로 쇼츠에서 가로 그림을 자르지 않고 폭에 맞춰 통째로 (위아래는 어두운 여백, 글씨는 그림 아래)
  //   말풍선이 그려진 웹툰 컷처럼 잘리면 안 되는 그림에 쓴다
  if (short && scene.image && scene.fit === "contain") {
    return (
      <AbsoluteFill style={{ background: "#0B0B0C", justifyContent: "flex-start", alignItems: "center", paddingTop: 70 * u }}>
        <Sfx at={at} />
        <div style={{ width: "100%", overflow: "hidden" }}>
          <Img src={staticFile(scene.image)} style={{ width: "100%", display: "block", transform: `scale(${1 + (cam.scale - 1) * 0.5})`, transformOrigin: "50% 50%" }} />
        </div>
        {lines.map((l, i) => (
          <Rise key={i} at={at[i]} style={{ marginTop: 26 * u, textAlign: "center", maxWidth: "88%" }}>
            <Rich text={l.text} at={at[i]} style={text(u, 56, 800, COLORS.dark ? "#FFFFFF" : COLORS.card)} />
          </Rise>
        ))}
      </AbsoluteFill>
    );
  }
  const side = short ? (media ? "top" : "center") : scene.textSide || "center";
  const align = side === "left" ? "flex-start" : side === "right" ? "flex-end" : "center";
  const emojiRow = !media && !short;
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
            {scene.draw && scene.image && <DrawCover frames={frames} rows={short ? 7 : 6} color={scene.drawBg} />}
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
        emojiRow ? (
          // 가로 화면(띠 쇼츠 칸 포함)에서 그림 없는 이야기: 이모지는 왼쪽, 글씨는 오른쪽 (가운데에 겹치지 않게)
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 110 * u }}>
            <div style={{ fontSize: 190 * u, transform: `scale(${cam.scale})`, filter: "drop-shadow(0 12px 18px rgba(60,50,30,0.18))" }}>{scene.emoji || "🌿"}</div>
          </AbsoluteFill>
        ) : (
        <Center style={{ paddingBottom: (short ? 600 : 360) * u }}>
          <div style={{ fontSize: 260 * u, transform: `scale(${cam.scale})`, filter: "drop-shadow(0 12px 18px rgba(60,50,30,0.18))" }}>{scene.emoji || "🌿"}</div>
        </Center>
        )
      )}
      <AbsoluteFill
        style={emojiRow ? { justifyContent: "center", alignItems: "flex-start", paddingLeft: 420 * u, paddingRight: 60 * u } : {
          justifyContent: side === "center" ? "flex-end" : side === "top" ? "flex-start" : "center",
          alignItems: side === "top" ? "center" : align,
          padding: side === "center" ? `0 0 ${(short ? 560 : 200) * u}px` : side === "top" ? `${200 * u}px 0 0` : `0 ${120 * u}px`,
        }}
      >
        {lines.map((l, i) => (
          // 칠판 스킨은 card 가 어두워서 그림 위 글씨는 흰색
          <Rise key={i} at={at[i]} style={{ marginTop: 14 * u, textAlign: emojiRow ? "left" : side === "center" || side === "top" ? "center" : side, maxWidth: emojiRow ? "100%" : side === "center" || side === "top" ? "86%" : "46%" }}>
            <Rich text={l.text} at={at[i]} style={{ ...text(u, 62, 800, media ? (COLORS.dark ? "#FFFFFF" : COLORS.card) : COLORS.ink), textShadow: media ? `0 ${2 * u}px ${14 * u}px rgba(0,0,0,0.35)` : "none" }} />
          </Rise>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// 위인 사진 장면 (2026-10-23, 철학자·위인 시리즈): 저작권 풀린 실제 사진(tools/commons.mjs)을 액자처럼 왼쪽에 두고 천천히 확대,
// 얼굴에 빨간 점선 원이 그려지며(circle.at 단어) 오른쪽에 글씨. 세로 화면이면 사진 위·글씨 아래.
// 칸: image, aspect(가로/세로), name("아르투어 쇼펜하우어"), years("1788–1860"), lines[{text, cue}],
//     circle: { x, y, r (사진 기준 0~1), at: "단어" } — 얼굴 위치는 daily_short 가 제미나이로 찾음
function Photo({ scene, frames }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const short = useIsShort();
  const lines = lineItems(scene, "lines");
  const at = revealFrames(scene, lines);
  const aspect = Math.min(1.6, Math.max(0.55, scene.aspect || 0.78));
  // 사진 크기는 장면 칸에 맞춘다 (가로 칸: 높이 80%·폭 50% 안, 세로 화면: 높이 45%·폭 86% 안)
  const size = useSceneSize();
  const maxH = size.height * (short ? 0.45 : 0.74), maxW = size.width * (short ? 0.86 : 0.5);
  const H = Math.min(maxH, maxW / aspect);
  const W = H * aspect;
  const c = scene.circle;
  const k = Math.min(1, frame / Math.max(1, frames));
  const zoom = 1 + 0.1 * k;
  const origin = c ? `${c.x * 100}% ${c.y * 100}%` : "50% 35%";
  const cAt = c ? (c.at ? cueFrame(scene, c.at) ?? 20 : 20) : 0;
  const draw = c ? Math.min(1, Math.max(0, (frame - cAt) / 14)) : 0;
  const enter = Math.min(1, frame / 10);
  const R = c ? c.r * Math.max(W, H) : 0;
  const photo = (
    <div style={{ position: "relative", flex: "none", width: W, height: H, padding: 14 * u, background: "#FFFDF8",
      boxShadow: `0 ${14 * u}px ${40 * u}px rgba(60,50,30,0.28)`, transform: `rotate(-1.5deg) scale(${0.92 + 0.08 * enter})`, opacity: enter }}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: origin }}>
          <Img src={staticFile(scene.image)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: scene.color ? undefined : "grayscale(0.15) contrast(1.05)" }} />
          {c && draw > 0 && (
            <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width="100%" height="100%">
              <circle cx={`${c.x * 100}%`} cy={`${c.y * 100}%`} r={R * (1 + 0.5 * (1 - draw))} fill="none" stroke="#E0242E" strokeWidth={7 * u}
                strokeDasharray={`${18 * u} ${12 * u}`} strokeDashoffset={-(frame - cAt) * 1.2 * u} opacity={draw} />
            </svg>
          )}
        </div>
      </div>
      {scene.name && (
        <div style={{ position: "absolute", left: "50%", top: "100%", marginTop: -14 * u, transform: "translateX(-50%) rotate(1.5deg)", whiteSpace: "nowrap", width: "max-content",
          background: COLORS.ink, padding: `${6 * u}px ${18 * u}px`, borderRadius: 8 * u, ...text(u, 24, 700, "#FFFDF8") }}>
          {scene.name}{scene.years ? <span style={{ opacity: 0.7, fontWeight: 500 }}> · {scene.years}</span> : null}
        </div>
      )}
    </div>
  );
  return (
    <AbsoluteFill style={{ flexDirection: short ? "column" : "row", justifyContent: "center", alignItems: "center", gap: (short ? 50 : 50) * u, padding: `0 ${50 * u}px` }}>
      <Sfx at={[...at, ...(c ? [cAt] : [])]} />
      {photo}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 * u, flex: short ? "none" : 1, minWidth: 0, maxWidth: short ? "88%" : undefined, textAlign: short ? "center" : "left" }}>
        {lines.map((l, i) => (
          <Rise key={i} at={at[i]}>
            <Rich text={l.text} at={at[i]} style={text(u, i === 0 ? 56 : 46, 800)} />
          </Rise>
        ))}
      </div>
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
          <div style={{ ...text(u, 30, 800, COLORS.sageDeep), marginBottom: 16 * u }}>{scene.kicker || "💬 댓글로 알려주세요"}</div>
          <Rich text={scene.question} at={qAt} style={text(u, 62, 800)} />
        </Card>
      </Rise>
      <Rise at={chAt} style={{ marginTop: 50 * u, textAlign: "center" }}>
        <div style={text(u, 40, 700, COLORS.inkSoft)}>{scene.channel || "예민한자립가"}</div>
      </Rise>
    </Center>
  );
}

// 12) 사주 = 네 기둥 × 두 글자 = 여덟 글자(팔자). 초등학생도 알게.
//  cue: 기둥들이 하나씩 내려앉는 순간 · countCue: "4 × 2 = 8글자" · meCue: '나'를 뜻하는 칸(일간)만 빛남
//  me: { char: "癸", name: "계수", desc: "비·이슬·우물물", element: "water" } — 나머지 칸은 "?" (개인 생년월일 없이)
//  chars: 8글자를 다 보여줄 때만 [년간,년지,월간,월지,일간,일지,시간,시지]
// 사주 장면 크기는 제목 띠 쇼츠의 가운데 칸 기준. 칸이 없는 영상(가로 롱폼 등)에서는 1.4배로 키운다
const useSajuUnit = () => useUnit() * (useContext(FrameContext) ? 1 : 1.4);

function Pillars({ scene }) {
  const u = useSajuUnit();
  const frame = useCurrentFrame();
  const [at, countAt, meAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.countCue }, { cue: scene.meCue }]);
  const cols = [["태어난 해", 0], ["태어난 달", 2], ["태어난 날", 4], ["태어난 시", 6]];
  const me = scene.me || {};
  const el = ELEMENTS[me.element] || ELEMENTS.water;
  const focus = scene.meCue ? interpolate(frame, [meAt, meAt + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const cell = (ch, isMe, delay) => {
    const p = useAppear(at + delay);
    const glow = isMe ? focus : 0;
    return (
      <div style={{ width: 120 * u, height: 120 * u, borderRadius: 22 * u, display: "flex", alignItems: "center", justifyContent: "center",
        background: glow ? el.color : COLORS.card, border: `${4 * u}px solid ${glow ? el.color : COLORS.bgDeep}`,
        boxShadow: `0 ${8 * u}px ${18 * u}px rgba(60,50,30,${0.08 + 0.2 * glow})`,
        transform: `translateY(${(1 - p) * -120 * u}px) scale(${(0.8 + 0.2 * Math.min(1, p)) * (1 + 0.22 * glow)})`, opacity: Math.min(1, p) * (isMe ? 1 : 1 - 0.65 * focus),
        ...text(u, 68, 800, glow ? "#FFFFFF" : COLORS.inkSoft), zIndex: isMe ? 2 : 1 }}>{ch}</div>
    );
  };
  return (
    <Center>
      <Sfx at={[at, countAt, meAt].filter((x, i) => i === 0 || [scene.countCue, scene.meCue][i - 1])} />
      {scene.kicker && <Kicker>{scene.kicker}</Kicker>}
      <div style={{ display: "flex", gap: 30 * u, alignItems: "flex-end" }}>
        {cols.map(([label, k], ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * u }}>
            {cell(scene.chars?.[k] ?? (k === 4 ? me.char || "?" : "?"), k === 4, ci * 7)}
            {cell(scene.chars?.[k + 1] ?? "?", false, ci * 7 + 4)}
            <div style={{ ...text(u, 26, 700, COLORS.inkSoft), marginTop: 2 * u, opacity: Math.min(1, useAppear(at + ci * 7 + 8)) * (1 - 0.5 * focus) }}>{label}</div>
          </div>
        ))}
      </div>
      {scene.countCue && (
        <Rise at={countAt} style={{ marginTop: 26 * u, opacity: 1 - focus }}>
          <Rich text={scene.countText || "기둥 4개 × 2글자 = **여덟 글자(팔자)**"} at={countAt} style={text(u, 42, 700)} />
        </Rise>
      )}
      {scene.meCue && (
        <Rise at={meAt + 8} style={{ marginTop: scene.countCue ? -52 * u : 26 * u, textAlign: "center" }}>
          <Rich text={scene.meText || `이 한 글자가 **'나'**: ${me.char || ""} ${me.name || ""}${me.desc ? ` · ${me.desc}` : ""}`} at={meAt + 8} style={text(u, 44, 800)} />
        </Rise>
      )}
    </Center>
  );
}

// 13) 오행: 다섯 기운(나무·불·흙·쇠·물)이 둥글게 → 화살표로 "키워준다" 흐름 → focus 하나만 남김
//  cue: 다섯 원 등장 · cycleCue: 화살표가 그려짐 · focus: "water" 등, focusCue: 나머지가 흐려지고 focus 가 커짐
function Elements({ scene }) {
  const u = useSajuUnit();
  const frame = useCurrentFrame();
  const [at, cycleAt, focusAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.cycleCue }, { cue: scene.focusCue }]);
  const keys = ["wood", "fire", "earth", "metal", "water"];
  const R = 130 * u;
  const pos = keys.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [Math.cos(a) * R, Math.sin(a) * R];
  });
  const draw = scene.cycleCue ? interpolate(frame, [cycleAt, cycleAt + 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const focus = scene.focusCue ? interpolate(frame, [focusAt, focusAt + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const W = 460 * u, H = 360 * u, cx = W / 2, cy = H / 2 + 12 * u, r = 54 * u;
  return (
    <Center>
      <Sfx at={[at, cycleAt, focusAt].filter((x, i) => i === 0 || [scene.cycleCue, scene.focusCue][i - 1])} />
      {scene.kicker && <Kicker>{scene.kicker}</Kicker>}
      <div style={{ position: "relative", width: W, height: H, flexShrink: 0 }}>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 1 - 0.7 * focus }}>
          <defs>
            <marker id="el-arrow" markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS.inkSoft} />
            </marker>
          </defs>
          {pos.map(([x1, y1], i) => {
            const [x2, y2] = pos[(i + 1) % 5];
            const len = Math.hypot(x2 - x1, y2 - y1);
            const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
            const sx = cx + x1 + ux * (r + 12 * u), sy = cy + y1 + uy * (r + 12 * u);
            const ex = cx + x2 - ux * (r + 22 * u), ey = cy + y2 - uy * (r + 22 * u);
            const seg = Math.min(1, Math.max(0, draw * 5 - i));
            if (seg <= 0) return null;
            return <line key={i} x1={sx} y1={sy} x2={sx + (ex - sx) * seg} y2={sy + (ey - sy) * seg}
              stroke={COLORS.inkSoft} strokeWidth={5 * u} strokeLinecap="round" markerEnd={seg > 0.95 ? "url(#el-arrow)" : undefined} />;
          })}
        </svg>
        {keys.map((k, i) => {
          const e = ELEMENTS[k];
          const p = useAppear(at + i * 6);
          const isF = k === scene.focus;
          const grow = isF ? 1 + 0.35 * focus : 1;
          return (
            <div key={k} style={{ position: "absolute", left: cx + pos[i][0] - r, top: cy + pos[i][1] - r, width: 2 * r, height: 2 * r, borderRadius: "50%",
              background: e.color, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              transform: `scale(${Math.min(1.1, p) * grow})`, opacity: Math.min(1, p) * (isF || !scene.focus ? 1 : 1 - 0.75 * focus),
              boxShadow: `0 ${8 * u}px ${20 * u}px rgba(60,50,30,0.15)`, zIndex: isF ? 2 : 1 }}>
              <div style={{ fontSize: 40 * u, lineHeight: 1 }}>{e.emoji}</div>
              <div style={{ ...text(u, 26, 800, "#FFFFFF"), marginTop: 2 * u }}>{e.name}</div>
            </div>
          );
        })}
        {scene.cycleCue && (
          <div style={{ position: "absolute", left: 0, right: 0, top: cy - 20 * u, textAlign: "center", opacity: draw * (1 - focus), ...text(u, 26, 700, COLORS.inkSoft) }}>
            {scene.cycleText || "서로 키워준다"}
          </div>
        )}
      </div>
      {scene.focusText && (
        <Rise at={focusAt + 8} style={{ marginTop: 10 * u, textAlign: "center" }}>
          <Rich text={scene.focusText} at={focusAt + 8} style={text(u, 44, 800)} />
        </Rise>
      )}
    </Center>
  );
}

// 실제 화면 보여주기 (자동화 사례 영상, 2026-10-24): 왼쪽 글씨(사례 이름·제목·전에는→지금은) + 오른쪽 브라우저 창/휴대폰 안의 실제 화면
// image | video, device("browser"|"phone"), url(주소창 글씨), kicker, title, before, after, cue, beforeCue, afterCue,
// scroll(0~1, 긴 화면을 천천히 내려 보임), example(true 면 "예시 화면" 표시 — 개인 정보 대신 예시 숫자를 넣은 화면)
function Screen({ scene, frames }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const [tAt, bAt, aAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.beforeCue }, { cue: scene.afterCue }]);
  const phone = scene.device === "phone";
  const t = Math.min(1, frame / Math.max(1, frames));
  const ease = t * t * (3 - 2 * t);
  const zoom = 1 + 0.04 * ease;
  const shift = (scene.scroll || 0) * ease * 100;
  const media = scene.image ? (
    <Img src={staticFile(scene.image)} style={{ width: "100%", display: "block", transform: `translateY(-${shift}%)` }} />
  ) : (
    <OffthreadVideo src={staticFile(scene.video)} muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
  );
  const shadow = `0 ${30 * u}px ${80 * u}px rgba(20,35,58,0.28)`;
  const device = phone ? (
    <div style={{ width: 430 * u, height: 860 * u, borderRadius: 64 * u, background: "#111", padding: 16 * u, boxShadow: shadow }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 50 * u, overflow: "hidden", background: "#fff" }}>{media}</div>
    </div>
  ) : (
    <div style={{ width: 1040 * u, borderRadius: 18 * u, overflow: "hidden", background: COLORS.card, boxShadow: shadow, border: `1px solid ${COLORS.bgDeep}` }}>
      <div style={{ height: 52 * u, display: "flex", alignItems: "center", gap: 10 * u, padding: `0 ${20 * u}px`, background: COLORS.bgDeep }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: 99, background: c }} />)}
        {scene.url && <div style={{ marginLeft: 20 * u, flex: 1, height: 32 * u, borderRadius: 8 * u, background: COLORS.card, ...text(u, 20, 500, COLORS.inkSoft), lineHeight: `${32 * u}px`, paddingLeft: 16 * u }}>{scene.url}</div>}
      </div>
      <div style={{ height: 650 * u, overflow: "hidden" }}>{media}</div>
    </div>
  );
  return (
    // 진행자 캐릭터가 구석(cast "corner")에 있으면 오른쪽을 비워 화면과 겹치지 않게
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: `0 ${(scene.cast === "corner" ? 330 : 110) * u}px 0 ${130 * u}px`, gap: 60 * u }}>
      <Sfx at={[tAt]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {scene.kicker && <Rise><div style={{ ...text(u, 28, 800, COLORS.sage), letterSpacing: "0.06em", marginBottom: 18 * u }}>{scene.kicker}</div></Rise>}
        <Rise at={tAt}><div style={{ ...text(u, 64, 800), lineHeight: 1.22 }}><Rich text={scene.title} at={tAt} /></div></Rise>
        {scene.before && (
          <Rise at={bAt} style={{ marginTop: 46 * u }}>
            <div style={text(u, 24, 700, COLORS.terracotta)}>전에는</div>
            <div style={{ ...text(u, 34, 500, COLORS.inkSoft), marginTop: 6 * u }}>{scene.before}</div>
          </Rise>
        )}
        {scene.after && (
          <Rise at={aAt} style={{ marginTop: 30 * u }}>
            <div style={text(u, 24, 700, COLORS.sage)}>지금은</div>
            <div style={{ ...text(u, 38, 800), marginTop: 6 * u }}><Rich text={scene.after} at={aAt} /></div>
          </Rise>
        )}
      </div>
      <Rise at={0} style={{ transform: `scale(${zoom})`, position: "relative" }}>
        {device}
        {scene.example && <div style={{ position: "absolute", top: (phone ? 40 : 70) * u, right: (phone ? -20 : 20) * u, ...text(u, 20, 700, "#fff"), background: "rgba(20,35,58,0.75)", padding: `${6 * u}px ${14 * u}px`, borderRadius: 8 * u }}>예시 화면</div>}
      </Rise>
    </AbsoluteFill>
  );
}

// 시간 줄이기 (2026-10-24 사장님: "문서작업 7시간 → 7분 모션그래픽"): from 큰 숫자 → 빨간 줄이 그어짐 → 화살표가 그려짐 → to 가 튀어나오며 빛남
// title, from("7시간"), to("7분"), label(작은 설명), example(true 면 '예시' 표시), cue(시작), toCue(줄어든 숫자가 나오는 단어)
function Shrink({ scene }) {
  const u = useUnit();
  const frame = useCurrentFrame();
  const [at, toAt] = revealFrames(scene, [{ cue: scene.cue }, { cue: scene.toCue }]);
  const ramp = (a, b) => Math.max(0, Math.min(1, (frame - a) / Math.max(1, b - a)));
  const strike = ramp(toAt - 14, toAt);
  const arrow = ramp(toAt - 6, toAt + 10);
  const pop = ramp(toAt + 4, toAt + 16);
  const big = (sz, color) => ({ ...text(u, sz, 800, color), lineHeight: 1, whiteSpace: "nowrap" });
  return (
    <Center>
      <Sfx at={[at, toAt]} />
      {scene.title && <Rise at={0}><div style={{ ...text(u, 52, 800), textAlign: "center", marginBottom: 50 * u }}><Rich text={scene.title} at={0} /></div></Rise>}
      <div style={{ display: "flex", alignItems: "center", gap: 50 * u }}>
        <Rise at={at} style={{ position: "relative" }}>
          <div style={big(150, COLORS.inkSoft)}>{scene.from}</div>
          {strike > 0 && <div style={{ position: "absolute", left: -10 * u, top: "52%", height: 12 * u, width: `calc(${strike * 100}% + ${20 * u}px)`, background: COLORS.terracotta, borderRadius: 99, transform: "rotate(-4deg)", boxShadow: COLORS.dark ? `0 0 ${16 * u}px ${COLORS.terracotta}` : undefined }} />}
        </Rise>
        <svg width={170 * u} height={80 * u} viewBox="0 0 170 80" style={{ opacity: arrow > 0 ? 1 : 0 }}>
          <path d="M8 40 H150 M120 12 L156 40 L120 68" fill="none" stroke={COLORS.ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - arrow} />
        </svg>
        <div style={{ ...big(190, COLORS.amber), transform: `scale(${pop === 0 ? 0 : 0.6 + 0.4 * pop + 0.12 * Math.sin(pop * Math.PI)})`, textShadow: COLORS.dark ? `0 0 ${30 * u}px ${COLORS.amber}aa` : undefined }}>{scene.to}</div>
      </div>
      {scene.label && <Rise at={toAt + 10} style={{ marginTop: 44 * u }}><div style={{ ...text(u, 40, 700, COLORS.inkSoft), textAlign: "center" }}><Rich text={scene.label} at={toAt + 10} /></div></Rise>}
      {scene.example && <div style={{ position: "absolute", right: 60 * u, bottom: 60 * u, ...text(u, 26, 700, COLORS.inkSoft), border: `2px solid ${COLORS.inkSoft}`, borderRadius: 10 * u, padding: `${4 * u}px ${14 * u}px` }}>예시</div>}
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
  photo: Photo,
  outro: Outro,
  pillars: Pillars,
  elements: Elements,
  dialogue: Dialogue,
  screen: Screen,
  shrink: Shrink,
};
