// 띠 쇼츠 (episode.json 의 "layout": "band" | "one", 2026-10-23 사장님 요청): 겹치지 않게 자리를 나눈 세로 쇼츠
// "one" = 검은 띠 없이 종이 배경 한 장 안에 제목·그래픽·자막·캐릭터가 다 들어감 (너진똑식, 사장님: "검은 배경·초록 배경 나누지 말고")
//   + "castLook": "circle" 이면 캐릭터가 동그라미 창 안에서 말함
//   위 제목 2줄 → 16:9 그래픽 칸(가로 장면을 크게) → 자막 전용 줄 → 아래: 말하는 캐릭터 + 반대쪽에 댓글 말풍선
// 자막이 그래픽을 가리던 문제(진행자 쇼츠에서 장면을 0.64배로 줄여 자막 줄과 겹침)를 칸 분리로 없앤다.
// 위치는 모두 1080×1920 기준, 안전 영역(y 193~1399) 안 — 캐릭터 얼굴·댓글 글씨도 1399 위.
import React from "react";
import { Audio, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme.js";
import { cueFrame } from "./timing.js";
import { Character, bandScale, castTimeline, useLoudnessAudio, useLoudnessFake } from "./presenter.jsx";

export const BAND = {
  titleTop: 205,
  titleSize: 78,
  boxTop: 440, // 그래픽 칸 1080×608
  boost: 1.9, // 칸 안 글씨·도형 확대 (진행자 쇼츠보다 약 1.4배)
  caption: { top: 1062, height: 104, size: 64, chunk: 13 },
  castTop: 1178, // 캐릭터 머리 위치 → 얼굴이 y 1240~1390
  castScale: 0.46,
  circleTop: 1172, // 동그라미 창 (지름 280 → 얼굴 가운데가 y 약 1310)
  comments: { top: 1186, bottom: 1396, width: 560 },
};

// 장면의 cast(right·left·center·corner·off)를 아래 두 자리로 줄인다: 오른쪽 / 왼쪽 / 퇴장
const SPOT = { right: 0.76, center: 0.76, corner: 0.76, left: 0.24, off: 1.4 };
function spotAt(scene, frame, start) {
  let from = start, to = start, at = 0;
  for (const c of castTimeline(scene)) {
    const f = c.at ? cueFrame(scene, c.at) ?? 0 : 0;
    if (frame < f) break;
    from = to;
    to = c.pos;
    at = f;
  }
  return { from: from in SPOT ? from : "right", to: to in SPOT ? to : "right", at };
}

// look: "dark"(검은 띠 위 흰 몸) · "paper"(한 배경 안에 선화 캐릭터가 서 있음) · "circle"(동그라미 창 안에서 말함)
function BandCharacter({ scene, start, loud, look }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { from, to, at } = spotAt(scene, frame, start);
  const p = Math.min(1, spring({ frame: frame - at, fps, config: { damping: 15, mass: 0.7, stiffness: 120 } }));
  const cx = SPOT[from] + (SPOT[to] - SPOT[from]) * p;
  const flip = (p < 0.5 ? from : to) === "left";
  if (look === "circle") {
    // 동그라미 창: 머리·어깨만 보이게 (얼굴이 원 가운데)
    const D = 280;
    const pos = Math.min(1, Math.max(0, (cx - 0.24) / 0.52)); // 왼쪽 0 ~ 오른쪽 1
    const left = 44 + pos * (1080 - 88 - D);
    const gone = to === "off" ? p : from === "off" ? 1 - p : 0;
    return (
      <div style={{ position: "absolute", left, top: BAND.circleTop, width: D, height: D, borderRadius: "50%", overflow: "hidden",
        background: COLORS.card, border: `8px solid ${COLORS.sage}`, boxShadow: "0 10px 28px rgba(60,50,30,0.22)",
        transform: `scale(${1 - gone})`, opacity: 1 - gone }}>
        <div style={{ position: "absolute", left: D / 2, top: D / 2 - 181, width: 0, height: 0 }}>
          <div style={{ position: "absolute", transform: `translateX(-50%) scale(0.55) ${flip ? "scaleX(-1)" : ""}`, transformOrigin: "50% 0%" }}>
            <div style={{ position: "relative", width: 900, height: 1100 }}>
              <Character scene={scene} loud={loud} anchored />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: cx * 1080, top: BAND.castTop, width: 0, height: 0 }}>
      <div style={{ position: "absolute", transform: `translateX(-50%) scale(${BAND.castScale * bandScale()}) ${flip ? "scaleX(-1)" : ""}`, transformOrigin: "50% 0%" }}>
        <div style={{ position: "relative", width: 900, height: 1100 }}>
          <Character scene={scene} loud={loud} anchored fill={look === "dark"} />
        </div>
      </div>
    </div>
  );
}
function CastAudio(props) {
  return <BandCharacter {...props} loud={useLoudnessAudio(props.scene)} />;
}
function CastFake(props) {
  return <BandCharacter {...props} loud={useLoudnessFake(props.scene)} />;
}
export function BandCast({ scene, start, look = "dark" }) {
  if (!castTimeline(scene).length && start === "off") return null;
  return scene.audio ? <CastAudio scene={scene} start={start} look={look} /> : <CastFake scene={scene} start={start} look={look} />;
}

// ── 댓글 말풍선: 장면 칸 "comments": [{ "text": "저만 그런 줄", "at": "단어"(나타날 순간), "name": "닉네임", "real": true }] ──
// 가짜 후기·가짜 댓글 금지(표시광고법) → real 이 아니면 이름 자리에 "예시"가 붙는다. 실제 댓글은 real: true + name.
// 캐릭터 반대쪽에 아래에서부터 쌓이고, 새 댓글이 오면 위로 밀리며 오래된 건 사라진다 (최대 3개).
export function Comments({ scene, start }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const list = (scene.comments || []).map((c, i) => ({ ...c, from: c.at ? cueFrame(scene, c.at) ?? i * 30 : 10 + i * 35 }));
  if (!list.length) return null;
  const { to } = spotAt(scene, frame, start);
  const onLeft = to !== "left"; // 캐릭터가 오른쪽(기본)이면 댓글은 왼쪽
  const shown = list.filter((c) => frame >= c.from).slice(-3);
  const { top, bottom, width } = BAND.comments;
  let y = bottom;
  const placed = shown.slice().reverse().map((c) => {
    const h = 64 + Math.ceil(c.text.length / 13) * 48;
    y -= h + 14;
    return { ...c, y, h };
  });
  return (
    <>
      {list.map((c, i) => (
        <Sequence key={`s${i}`} from={c.from} durationInFrames={30}>
          <Audio src={staticFile("sfx/bubble.mp3")} volume={0.3} />
        </Sequence>
      ))}
      {placed.map((c) => {
        const pop = Math.min(1, spring({ frame: frame - c.from, fps, config: { damping: 11, mass: 0.5, stiffness: 170 } }));
        const fade = c.y < top ? Math.max(0, 1 - (top - c.y) / 80) : 1;
        return (
          <div key={c.text} style={{
            position: "absolute", [onLeft ? "left" : "right"]: 44, top: c.y, width,
            opacity: Math.min(pop, fade), transform: `translateY(${(1 - pop) * 40}px) scale(${0.85 + 0.15 * pop})`,
            transformOrigin: onLeft ? "0% 100%" : "100% 100%",
            display: "flex", gap: 16, alignItems: "flex-start",
            background: "rgba(255,255,255,0.97)", borderRadius: 26, padding: "16px 22px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", flex: "none", background: "#C9D6C3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>
              {c.emoji || "🙂"}
            </div>
            <div style={{ fontFamily: FONT, minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 600, color: "#8A857C" }}>{c.real ? `@${c.name || "시청자"}` : "예시"}</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#1E1D1B", lineHeight: 1.25 }}>{c.text}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
