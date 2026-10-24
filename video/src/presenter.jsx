// 말하는 캐릭터 (화면을 바라보며 이야기하는 진행자).
// 그림: public/characters/main/faces/*.png (표정), poses/*.png (손짓) — scripts/cut_sheet.py 로 머리 위치를 맞춘 '선만 남긴 투명 그림'
// 진행자 자리 바탕색은 COLORS.bg (입·눈 덮개도 같은 색으로 칠함)
// 위치표: public/characters/main/rig.json (scripts/face_rig.py) — 그림마다 눈동자·입 위치
//
// 장면 칸:
//   "face": "surprised" 또는 [{ "at": "그런데", "is": "surprised" }, { "at": "사십칠", "is": "serious" }]
//          smile(기본) · surprised · serious · laugh · worried · kind
//   "gesture": "point" 또는 [{ "at": "단어", "is": "idea" }] — idea · point · think · explain. "none" 이면 손짓 끝
//          손짓 그림이 있는 동안은 손짓 그림이 보인다 (얼굴은 미소)
// 움직임: 목소리 크기만큼 입이 열림 · 3초쯤마다 눈 깜빡임 · 숨쉬기 · 말할 때 살짝 끄덕임 · 표정/손짓이 바뀌면 통 튀어나옴
import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData } from "@remotion/media-utils";
import { COLORS } from "./theme.js";
import { cueFrame, voiceSeconds } from "./timing.js";
import rigMain from "../public/characters/main/rig.json";
import rigRound from "../public/characters/round/rig.json";

// 캐릭터 고르기: 편의 "character" 칸 (기본 round = 2026-10-24 새 동그란 안경 캐릭터, main = 예전 곱슬머리 선화)
// round 는 scripts/align_by_eyes.py 로 눈동자 기준 정렬 — 눈동자가 커서 깜빡임 덮개도 크다
const CHARS = {
  main: { base: "characters/main", rig: rigMain, lid: [12, 19], mouthCover: [40, 16] },
  round: { base: "characters/round", rig: rigRound, lid: [19, 26], bandScale: 1.35, mouthCover: [62, 30] }, // 입 그림이 커서 말할 때 덮개도 크게 (작으면 입이 두 개로 보임) // 전신이라 쇼츠 아래 자리에서 작아 보여 키움
};
let CH = CHARS.round;
export function setCharacter(name) {
  CH = CHARS[name] || CHARS.round;
}
export const bandScale = () => CH.bandScale || 1;
export const DARK_BG = "#0B0B0C"; // 대화 장면(밤) 바탕
const OPEN_MOUTH = new Set(["faces/surprised", "faces/laugh"]); // 이미 입이 열린 그림은 입을 덧그리지 않음
const CLOSED_EYES = new Set(["faces/kind"]); // 눈 감은 그림은 깜빡임 없음

// 단어 시점에 따라 바뀌는 값: "smile" 또는 [{at, is}] → 지금 프레임의 값과 바뀐 프레임
function timeline(scene, value, frame, fallback) {
  if (!value) return { is: fallback, since: 0 };
  if (typeof value === "string") return { is: value, since: 0 };
  let cur = { is: fallback, since: 0 };
  for (const v of value) {
    const at = v.at ? cueFrame(scene, v.at) ?? 0 : 0;
    if (frame >= at) cur = { is: v.is, since: at };
  }
  return cur;
}

// 목소리 크기 (0~1). 목소리 파일이 없으면(초안) 말하는 동안 흉내만 낸다.
export function useLoudnessFake(scene) {
  const frame = useCurrentFrame();
  const talking = frame < voiceSeconds(scene) * 30 - 4;
  if (!talking) return 0;
  const v = 0.5 + 0.35 * Math.sin(frame * 1.7) + 0.25 * Math.sin(frame * 0.63 + 1);
  return Math.max(0, Math.min(1, v));
}

export function useLoudnessAudio(scene) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const data = useAudioData(staticFile(scene.audio));
  if (!data) return 0;
  // 지금 들리는 순간의 소리 크기(RMS)를 직접 잰다. (주파수 막대 visualizeAudio 는 값이 너무 작아 늘 '조용함'으로 나왔음 — 2026-10-22)
  const rate = (scene.playbackRate || 1) * (scene.paceRate || 1);
  const t = (scene.trimStart || 0) + (frame / fps) * rate;
  const wave = data.channelWaveforms[0];
  const sr = data.sampleRate;
  const from = Math.floor(t * sr), len = Math.floor(sr / fps);
  if (from < 0 || from + len > wave.length) return 0;
  let sum = 0;
  for (let i = from; i < from + len; i += 4) sum += wave[i] * wave[i];
  const rms = Math.sqrt(sum / (len / 4));
  return Math.max(0, Math.min(1, (rms - 0.015) * 9));
}

// fill: 몸 안을 흰색으로 채운 그림(*.fill.png) — 실사 배경 위에 '만화 캐릭터가 들어온' 느낌. 입·눈 덮개는 흰색
export function Character({ scene, loud, anchored = false, dark = false, fill = false }) {
  dark = dark || COLORS.dark; // 칠판 스킨이면 선을 흰색으로
  const BG = fill ? "#FFFFFF" : dark ? (COLORS.dark ? COLORS.bg : DARK_BG) : COLORS.bg; // 입·눈 덮개 색 = 얼굴 바탕색
  const INK = dark ? "#F4EFE6" : COLORS.ink;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = timeline(scene, scene.gesture, frame, null);
  const f = timeline(scene, scene.face, frame, "smile");
  const key = g.is && g.is !== "none" ? `poses/${g.is}` : `faces/${f.is}`;
  const since = Math.max(g.since, f.since);
  const r = CH.rig[key] || CH.rig["faces/smile"];

  const pop = spring({ frame: frame - since, fps, config: { damping: 9, mass: 0.5, stiffness: 180 } });
  const breath = Math.sin(frame / 22) * 4;
  const nod = loud * 7;
  const sway = Math.sin(frame / 37) * 1.2 + loud * 0.8;

  // 3초쯤마다 0.15초 깜빡 (장면마다 박자를 조금 다르게)
  const seed = (scene.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const blinkPhase = (frame + seed * 7) % 95;
  const blink = !CLOSED_EYES.has(key) && blinkPhase < 5;

  const mouthOpen = !OPEN_MOUTH.has(key) && loud > 0.12;
  const [mx, my] = r.mouth;
  const rx = 15 + 9 * loud;
  const ry = 3 + 12 * loud;

  return (
    <div
      style={{
        position: "absolute", left: anchored ? 0 : "50%", top: anchored ? 0 : 10, width: 900, height: 1100, // 머리가 자리 위쪽에 오게 (몸 아래는 화면 밖으로)
        transform: `${anchored ? "" : "translateX(-50%) "}translateY(${breath + nod}px) rotate(${sway}deg) scale(${1.06 - 0.06 * Math.min(1, pop)})`,
        transformOrigin: "50% 95%",
      }}
    >
      <Img src={staticFile(`${CH.base}/${key}${fill ? ".fill" : ""}.png`)} style={{ width: 900, height: 1100, display: "block", filter: dark ? "invert(1)" : undefined }} />
      <svg width={900} height={1100} style={{ position: "absolute", inset: 0 }}>
        {mouthOpen && (
          <>
            <ellipse cx={mx} cy={my} rx={CH.mouthCover[0]} ry={CH.mouthCover[1]} fill={BG} />
            <ellipse cx={mx} cy={my + 2} rx={rx} ry={ry} fill={dark ? DARK_BG : COLORS.ink} stroke={dark ? INK : "none"} strokeWidth={5} />
            {ry > 8 && <ellipse cx={mx} cy={my + 2 + ry * 0.45} rx={rx * 0.55} ry={ry * 0.35} fill="#D9776A" />}
          </>
        )}
        {blink &&
          r.eyes.map(([ex, ey], i) => (
            <g key={i}>
              <ellipse cx={ex} cy={ey} rx={CH.lid[0]} ry={CH.lid[1]} fill={BG} />
              <path d={`M ${ex - CH.lid[0] + 1} ${ey + 1} Q ${ex} ${ey + 8} ${ex + CH.lid[0] - 1} ${ey + 1}`} stroke={INK} strokeWidth={6} fill="none" strokeLinecap="round" />
            </g>
          ))}
      </svg>
    </div>
  );
}

// ── 무대 위 캐릭터 (너진똑식): 화면을 나누지 않고, 캐릭터가 장면 안에 들어와 설명하고·빠지고·옆에서 글자를 가리킨다 ──
// 장면 칸 "cast": "right" 또는 [{ "at": "단어", "pos": "right" }, { "at": "단어", "pos": "off" }]
//   pos: right(오른쪽에서 설명) · left(왼쪽, 좌우 반전 → 가리키기가 오른쪽 글자를 향함) · center(가운데에서 나를 보며 직접 말함, 장면은 뒤로 흐려짐)
//        corner(구석에 작게) · off(퇴장)
// 캐릭터가 서는 자리만큼 장면(글씨·그래픽)이 옆/위로 비켜서고 살짝 작아진다. 장면 사이에는 앞 장면 끝 자리에서 이어서 시작한다.
const STAGE = {
  long: {
    right: { cx: 0.80, top: 0.22, s: 0.78, dx: -0.11, dy: 0, k: 0.88, dim: 0 },
    left: { cx: 0.20, top: 0.22, s: 0.78, dx: 0.11, dy: 0, k: 0.88, dim: 0, flip: true },
    center: { cx: 0.50, top: 0.44, s: 0.80, dx: 0, dy: -0.27, k: 0.80, dim: 0 }, // 글씨는 위로, 캐릭터는 그 아래에서 나를 보며 말함
    corner: { cx: 0.90, top: 0.56, s: 0.48, dx: -0.03, dy: 0, k: 0.96, dim: 0 },
    off: { cx: 1.30, top: 0.22, s: 0.78, dx: 0, dy: 0, k: 1, dim: 0 },
  },
  // 쇼츠 무대(제목 띠 아래, 높이 1420): 캐릭터 얼굴(눈·입)은 안전 영역 아래선(y 1399) 위에, 장면은 제목과 머리 사이로
  short: {
    right: { cx: 0.74, top: 0.356, s: 0.62, dx: 0, dy: -0.215, k: 0.64, dim: 0 },
    left: { cx: 0.26, top: 0.356, s: 0.62, dx: 0, dy: -0.215, k: 0.64, dim: 0, flip: true },
    center: { cx: 0.50, top: 0.32, s: 0.70, dx: 0, dy: -0.215, k: 0.64, dim: 0 },
    corner: { cx: 0.82, top: 0.434, s: 0.45, dx: 0, dy: -0.215, k: 0.64, dim: 0 },
    off: { cx: 1.45, top: 0.356, s: 0.62, dx: 0, dy: -0.215, k: 0.64, dim: 0 }, // 퇴장해도 장면은 같은 자리 (자막 줄이 늘 비어 있게)
  },
};

export function castTimeline(scene) {
  const c = scene.cast;
  if (!c) return [];
  return typeof c === "string" ? [{ pos: c }] : c;
}

// 지금 프레임의 무대 상태 (앞 자리 → 새 자리로 스프링 이동)
function useStage(scene, start) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fmt = height > width ? "short" : "long";
  // 그림 장면에서 캐릭터가 퇴장해 있으면 그림을 화면 가득 (쇼츠도 줄여 올리지 않음)
  const T = scene.image || scene.video ? { ...STAGE[fmt], off: { ...STAGE[fmt].off, dx: 0, dy: 0, k: 1 } } : STAGE[fmt];
  let from = T[start] || T.off;
  let to = from;
  let at = 0;
  for (const c of castTimeline(scene)) {
    const f = c.at ? cueFrame(scene, c.at) ?? 0 : 0;
    if (frame < f) break;
    from = to;
    to = T[c.pos] || T.off;
    at = f;
  }
  const p = Math.min(1, spring({ frame: frame - at, fps, config: { damping: 15, mass: 0.7, stiffness: 120 } }));
  const mix = (k) => from[k] + (to[k] - from[k]) * p;
  return { fmt, cx: mix("cx"), top: mix("top"), s: mix("s"), dx: mix("dx"), dy: mix("dy"), k: mix("k"), dim: mix("dim"), flip: (p < 0.5 ? from : to).flip, visible: !(from === T.off && to === T.off) };
}

// 장면(children)을 캐릭터 자리만큼 비켜 세우고, 그 위에 캐릭터를 올린다. W·H 는 이 무대의 크기.
export function Cast({ scene, start, W, H, children }) {
  const st = useStage(scene, start);
  // speaker: "guest" 면 다른 사람(예: 운결 도령)이 말하는 장면 → 우리 캐릭터는 듣기만 (입 다묾)
  const listening = scene.speaker === "guest";
  const loudFake = listening ? 0 : useLoudnessFake(scene);
  return (
    <>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${st.dx * W}px, ${st.dy * H}px) scale(${st.k})`, transformOrigin: "50% 40%", opacity: 1 - st.dim }}>
        {children}
      </div>
      {st.visible && (
        <div style={{ position: "absolute", left: st.cx * W, top: st.top * H, width: 0, height: 0 }}>
          <div style={{ position: "absolute", left: 0, top: 0, transform: `translateX(-50%) scale(${st.s}) ${st.flip ? "scaleX(-1)" : ""}`, transformOrigin: "50% 0%" }}>
            <div style={{ position: "relative", width: 900, height: 1100, left: 0, top: 0 }}>
              {scene.audio && !listening ? <WithAudioAt scene={scene} /> : <Character scene={scene} loud={loudFake} anchored />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WithAudioAt({ scene }) {
  return <Character scene={scene} loud={useLoudnessAudio(scene)} anchored />;
}

// ── 대화 장면 (type "dialogue"): 어두운 상담실에 나(흰 몸 만화 캐릭터, 왼쪽)와 운결 도령(원래 실사풍 그림체, 오른쪽)이 나란히 서서 대화 ──
// 장면 칸: speaker "me" | "dory", bubble(말풍선 글, 없으면 내레이션), face·gesture(나), doryPose(calm·smirk·serious·explain)
//   room(배경 그림, 없으면 ep03s 상담실). 대사가 바뀌어도 두 사람은 같은 자리 → 말풍선만 바뀜. 말하는 쪽은 밝게 들썩, 듣는 쪽은 살짝 어둡게.
// 그림: public/characters/dory/*.png (scripts/chroma_cut.py — 챗GPT 초록 배경 시트에서 오려냄)
const ROOM_DEFAULT = "episodes/ep03s-dory-talk/img/room.png";
function DialogueAudio({ scene }) {
  return <DialogueBody scene={scene} loud={useLoudnessAudio(scene)} />;
}
function DialogueFake({ scene }) {
  return <DialogueBody scene={scene} loud={useLoudnessFake(scene)} />;
}
export function Dialogue({ scene }) {
  return scene.audio ? <DialogueAudio scene={scene} /> : <DialogueFake scene={scene} />;
}
function DialogueBody({ scene, loud }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const meTalks = scene.speaker !== "dory";
  const pop = Math.min(1, spring({ frame: frame - 2, fps, config: { damping: 11, mass: 0.6, stiffness: 160 } }));
  const breathe = Math.sin(frame / 24);
  const doryLoud = meTalks ? 0 : loud;
  const text = scene.bubble || scene.narration;
  // 무대 1080×1420 (제목 띠 아래). 두 사람 얼굴은 안전 영역(전체 y 1399) 위에
  const bubble = meTalks ? { left: 40, top: 130, width: 600 } : { left: 400, top: 40, width: 640 };
  return (
    <AbsoluteFill style={{ background: DARK_BG, overflow: "hidden" }}>
      <Img src={staticFile(scene.room || ROOM_DEFAULT)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover",
        filter: "brightness(0.8)", transform: `scale(${1.04 + 0.03 * Math.min(1, frame / 200)})` }} />
      {/* 도령 (오른쪽) */}
      <div style={{ position: "absolute", left: 450, top: 470, width: 640, height: 640,
        transform: `translateY(${breathe * 3 - doryLoud * 8}px) scale(${1 + doryLoud * 0.02})`, transformOrigin: "50% 100%",
        filter: `brightness(${meTalks ? 0.68 : 1.05}) drop-shadow(0 0 30px rgba(0,0,0,0.6))` }}>
        <Img src={staticFile(`characters/dory/${scene.doryPose || "calm"}.png`)} style={{ width: "100%", height: "100%" }} />
      </div>
      {/* 나 (왼쪽): 흰 몸 만화 캐릭터 */}
      <div style={{ position: "absolute", left: 0, top: 400, width: 0, height: 0 }}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: "scale(0.6)", transformOrigin: "0% 0%",
          filter: `brightness(${meTalks ? 1 : 0.72}) drop-shadow(0 0 24px rgba(0,0,0,0.6))` }}>
          <div style={{ position: "relative", width: 900, height: 1100 }}>
            <Character scene={{ ...scene, face: scene.face || "smile" }} loud={meTalks ? loud : 0} anchored fill />
          </div>
        </div>
      </div>
      {/* 아래쪽 어둠 — 두 사람 몸 아래 잘린 곳을 자연스럽게 */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(11,11,12,0) 62%, ${DARK_BG} 86%)` }} />
      {/* 말풍선: 말하는 사람 머리 위 */}
      <div style={{ position: "absolute", left: bubble.left, top: bubble.top, width: bubble.width,
        transform: `scale(${0.6 + 0.4 * pop})`, opacity: pop, transformOrigin: meTalks ? "20% 100%" : "70% 100%" }}>
        <div style={{ background: meTalks ? "#FFFDF8" : "rgba(22,13,15,0.92)", color: meTalks ? COLORS.ink : "#F4EFE6",
          border: meTalks ? `4px solid ${COLORS.ink}` : "3px solid #C0283A", borderRadius: 34, padding: "24px 30px",
          fontFamily: "Pretendard", fontWeight: 700, fontSize: 44, lineHeight: 1.4, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", whiteSpace: "pre-line" }}>
          {text}
        </div>
        <div style={{ position: "absolute", [meTalks ? "left" : "right"]: meTalks ? 150 : 200, top: "100%", width: 0, height: 0,
          borderLeft: "16px solid transparent", borderRight: "16px solid transparent", borderTop: `30px solid ${meTalks ? COLORS.ink : "#C0283A"}` }} />
      </div>
    </AbsoluteFill>
  );
}

function WithAudio({ scene }) {
  return <Character scene={scene} loud={useLoudnessAudio(scene)} />;
}
function WithoutAudio({ scene }) {
  return <Character scene={scene} loud={useLoudnessFake(scene)} />;
}

export function Presenter({ scene }) {
  return scene.audio ? <WithAudio scene={scene} /> : <WithoutAudio scene={scene} />;
}
