// 영상 1편 = 대본(episode.json)의 장면들을 순서대로 이어 붙인 것.
// 배경은 계속 깔려 있고, 장면은 부드럽게 전환된다. 목소리·자막·효과음·배경음악도 여기서 합친다.
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/fonts";
import { FONT, TRANSITION_FRAMES } from "./theme.js";
import { applyPace, cueFrame, sceneFrames, voiceSeconds } from "./timing.js";
import { Background, Captions, ChapterProgress, SideCharacter, StyleContext } from "./components.jsx";
import { SCENES } from "./scenes.jsx";

for (const [file, weight] of [["Regular", "400"], ["SemiBold", "600"], ["Bold", "700"], ["ExtraBold", "800"]]) {
  loadFont({ family: FONT, url: staticFile(`fonts/Pretendard-${file}.woff2`), weight });
}

// 장면마다 시작 프레임과 그때의 챕터 번호를 미리 계산한다.
// steps(쇼츠용 단계 막대)를 쓰면 장면의 "step" 번호가 곧 진행 표시 (step 이 없는 장면은 막대 숨김)
function layout(scenes, useSteps) {
  let start = 0;
  let chapter = 0;
  return scenes.map((s) => {
    if (s.type === "chapter") chapter = s.number;
    if (useSteps) chapter = s.step || 0;
    const frames = sceneFrames(s);
    const item = { scene: s, start, frames, chapter };
    start += frames - TRANSITION_FRAMES;
    return item;
  });
}

// 배경음악 연출 (사람이 편집하듯):
//  - 에피소드의 musicStart(장면 id)부터 음악이 서서히 들어온다 (그 전은 고요하게 — 첫 훅이 또렷하게 들리도록)
//  - 목소리가 나오는 동안은 작게, 쉬는 구간은 조금 크게 (부드럽게 오르내림)
//  - 장면의 musicDrop: { at: "단어", until: "단어"(없으면 장면 끝), level: 0~1 } → 핵심 문장 직전에 음악을 빼서 그 말이 꽂히게
//  - 장면의 musicMute: true → 그 장면 전체 무음
const ramp = (f, a, b) => Math.min(1, Math.max(0, (f - a) / Math.max(1, b - a)));
function Music({ src, items, startId, volume = 0.16 }) {
  const frame = useCurrentFrame();
  const startItem = items.find((it) => it.scene.id === startId) || items[0];
  const last = items.at(-1);
  const end = last.start + last.frames;
  // 목소리 작게: 목소리 구간에서 0.55배, 경계는 10프레임에 걸쳐 부드럽게
  let duck = 1;
  for (const it of items) {
    const vs = it.start;
    const ve = it.start + Math.ceil(voiceSeconds(it.scene) * 30);
    const inVoice = Math.min(ramp(frame, vs - 10, vs), 1 - ramp(frame, ve, ve + 15));
    duck = Math.min(duck, 1 - 0.45 * inVoice);
  }
  // 핵심 문장에서 음악 빼기: 단어 0.3초 전부터 빠지기 시작, 끝나면 0.8초에 걸쳐 돌아옴
  let drop = 1;
  for (const it of items) {
    const s = it.scene;
    const windows = [];
    if (s.musicMute) windows.push({ a: it.start, b: it.start + it.frames, level: 0 });
    for (const d of [].concat(s.musicDrop || [])) {
      const a = cueFrame(s, d.at);
      const b = d.until ? cueFrame(s, d.until) : it.frames;
      if (a === null) continue;
      windows.push({ a: it.start + a, b: it.start + (b ?? it.frames), level: d.level ?? 0 });
    }
    for (const w of windows) {
      const inside = Math.min(ramp(frame, w.a - 9, w.a), 1 - ramp(frame, w.b, w.b + 24));
      drop = Math.min(drop, 1 - (1 - w.level) * inside);
    }
  }
  const enter = ramp(frame, startItem.start, startItem.start + 45);
  const exit = 1 - ramp(frame, end - 60, end);
  const v = volume * duck * drop * enter * exit;
  return <Audio src={staticFile(src)} volume={v} startFrom={0} />;
}

// 장면별 추가 효과음: scene.sfx = [{ name: "chime", cue: "단어" | after: true, volume }]
function SceneSfx({ scene }) {
  return (
    <>
      {(scene.sfx || []).map((x, i) => {
        const at = x.after ? Math.ceil(voiceSeconds(scene) * 30) + 2 : cueFrame(scene, x.cue) ?? 0;
        return (
          <Sequence key={i} from={Math.max(0, at)} durationInFrames={90}>
            <Audio src={staticFile(`sfx/${x.name}.${x.ext || "wav"}`)} volume={x.volume ?? 0.35} />
          </Sequence>
        );
      })}
    </>
  );
}

// style: "calm"(기본, 차분한 등장) | "punchy"(통통 튀는 등장, 굵은 자막·키워드 색)
export function Episode({ scenes = [], chapters = [], steps, pace, style = "calm", music, musicStart, musicVolume, captions = true }) {
  const items = layout(applyPace(scenes, pace), !!steps?.length);
  const bar = steps?.length ? steps : chapters;
  return (
    <StyleContext.Provider value={style}>
    <AbsoluteFill>
      <Background />
      <TransitionSeries>
        {items.map((it, i) => {
          const Scene = SCENES[it.scene.type];
          if (!Scene) throw new Error(`모르는 장면 종류: "${it.scene.type}" (장면 ${i + 1}). 쓸 수 있는 종류: ${Object.keys(SCENES).join(", ")}`);
          // 화면 글씨가 곧 내레이션인 장면은 하단 자막을 끈다 (같은 말이 두 번 보이지 않게)
          const captionOn = captions && (it.scene.captions ?? !["hook", "statement", "story", "chapter"].includes(it.scene.type));
          const showProgress = it.chapter > 0 && !["chapter", "outro"].includes(it.scene.type);
          return (
            <React.Fragment key={it.scene.id || i}>
              <TransitionSeries.Sequence durationInFrames={it.frames}>
                <Scene scene={it.scene} frames={it.frames} />
                {it.scene.pose && <SideCharacter src={it.scene.pose} side={it.scene.poseSide} at={6} />}
                {showProgress && <ChapterProgress chapters={bar} current={it.chapter} />}
                {captionOn && <Captions scene={it.scene} />}
                <SceneSfx scene={it.scene} />
                {it.scene.audio && (
                  <Audio
                    src={staticFile(it.scene.audio)}
                    playbackRate={(it.scene.playbackRate || 1) * (it.scene.paceRate || 1)}
                    startFrom={Math.round((it.scene.trimStart || 0) * 30)}
                  />
                )}
              </TransitionSeries.Sequence>
              {i < items.length - 1 && (
                <TransitionSeries.Transition
                  presentation={items[i + 1].scene.type === "chapter" ? slide({ direction: "from-right" }) : fade()}
                  timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      {music && items.length > 0 && <Music src={music} items={items} startId={musicStart} volume={musicVolume} />}
    </AbsoluteFill>
    </StyleContext.Provider>
  );
}
