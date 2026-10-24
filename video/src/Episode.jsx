// 영상 1편 = 대본(episode.json)의 장면들을 순서대로 이어 붙인 것.
// 배경은 계속 깔려 있고, 장면은 부드럽게 전환된다. 목소리·자막·효과음·배경음악도 여기서 합친다.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { loadFont } from "@remotion/fonts";
import { FONT, FRAME, SIZES, SKINS, TRANSITION_FRAMES } from "./theme.js";
import { applyPace, cueFrame, sceneFrames, voiceSeconds } from "./timing.js";
import { Background, CaptionBandContext, CaptionBottomContext, Captions, ChapterProgress, Stickers, FrameContext, SideCharacter, SizeContext, StyleContext } from "./components.jsx";
import { SCENES } from "./scenes.jsx";
import { Cast, castTimeline, setCharacter } from "./presenter.jsx";
import { BAND, BandCast, Comments } from "./band.jsx";
import { COLORS } from "./theme.js";

for (const [file, weight] of [["Regular", "400"], ["SemiBold", "600"], ["Bold", "700"], ["ExtraBold", "800"]]) {
  loadFont({ family: "Pretendard", url: staticFile(`fonts/Pretendard-${file}.woff2`), weight });
}

// 장면 전환: calm 은 부드럽게 겹침(챕터만 옆으로 밀기), punchy 는 매번 방향을 바꿔 빠르게 밀고 닦아냄 (참고 쇼츠의 컷 리듬)
const PUNCHY_MOVES = [
  () => slide({ direction: "from-right" }),
  () => slide({ direction: "from-bottom" }),
  () => wipe({ direction: "from-left" }),
  () => slide({ direction: "from-left" }),
];
function transitionFor(next, i, style, cur) {
  if (next.type === "chapter") return slide({ direction: "from-right" });
  if (next.type === "dialogue" && cur?.type === "dialogue") return fade(); // 대화가 이어지면 두 사람은 그대로, 말풍선만 바뀌게
  return style === "punchy" ? PUNCHY_MOVES[i % PUNCHY_MOVES.length]() : fade();
}

// 장면마다 시작 프레임과 그때의 챕터 번호를 미리 계산한다.
// steps(쇼츠용 단계 막대)를 쓰면 장면의 "step" 번호가 곧 진행 표시 (step 이 없는 장면은 막대 숨김)
function layout(scenes, useSteps) {
  let start = 0;
  let lastPos = "off";
  let chapter = 0;
  return scenes.map((s) => {
    if (s.type === "chapter") chapter = s.number;
    if (useSteps) chapter = s.step || 0;
    const frames = sceneFrames(s);
    const item = { scene: s, start, frames, chapter, castStart: lastPos };
    const tl = castTimeline(s);
    if (tl.length) lastPos = tl.at(-1).pos;
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

// 제목 띠 쇼츠 (frame): 세로 영상 = 위 고정 제목 2줄(둘째 줄 빨간 띠) + 가운데 16:9 칸(기존 장면을 가로 배치로) + 아래 채널명.
// frame: { title: ["줄1", "줄2"], brand: "예민한자립가" }
const BOX_SCALE = SIZES.short.width / SIZES.long.width; // 1080 / 1920
const FRAME_CTX = { scale: BOX_SCALE, boost: FRAME.boost };
const STAGE_H = SIZES.short.height - FRAME.presenterBoxTop; // 제목 띠 아래 무대 높이 (진행자 쇼츠)
function FrameShell({ frame, presenter, children }) {
  const [l1, l2] = frame.title || [];
  const titleTop = presenter ? FRAME.presenterTitleTop : 300;
  const boxTop = presenter ? FRAME.presenterBoxTop : FRAME.boxTop;
  const boxBottom = boxTop + SIZES.long.height * BOX_SCALE;
  const line = { fontFamily: FONT, fontWeight: 800, fontSize: 88, lineHeight: 1.15, letterSpacing: "-0.02em", color: FRAME.title };
  return (
    <AbsoluteFill style={{ backgroundColor: FRAME.bg }}>
      <div style={{ position: "absolute", top: titleTop, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        {l1 && <div style={line}>{l1}</div>}
        {l2 && <div style={{ ...line, background: COLORS.band, borderRadius: COLORS.bandRadius, padding: "6px 26px 10px" }}>{l2}</div>}
      </div>
      {presenter ? (
        <div style={{ position: "absolute", top: boxTop, left: 0, width: SIZES.short.width, height: STAGE_H, overflow: "hidden" }}>
          <SizeContext.Provider value={{ width: SIZES.short.width, height: STAGE_H }}>
            <CaptionBottomContext.Provider value={Math.round(STAGE_H * 0.605)}>{children}</CaptionBottomContext.Provider>
          </SizeContext.Provider>
        </div>
      ) : (
        <div style={{ position: "absolute", top: boxTop, left: 0, width: SIZES.long.width, height: SIZES.long.height,
          transform: `scale(${BOX_SCALE})`, transformOrigin: "top left", overflow: "hidden" }}>
          <SizeContext.Provider value={SIZES.long}>
            <FrameContext.Provider value={FRAME_CTX}>{children}</FrameContext.Provider>
          </SizeContext.Provider>
        </div>
      )}
      {!presenter && <div style={{ position: "absolute", top: boxBottom + 44, left: 0, right: 0,
        display: "flex", justifyContent: "center", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#FFFFFF", overflow: "hidden" }}>
          <Img src={staticFile("characters/main/think.cut.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 15%" }} />
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 40, color: FRAME.brand }}>{frame.brand || "예민한자립가"}</div>
      </div>}
    </AbsoluteFill>
  );
}

// style: "calm"(기본, 차분한 등장) | "punchy"(통통 튀는 등장, 굵은 자막·키워드 색)
// presenter: true → 캐릭터가 장면 안에 들어와 설명 (장면 칸 "cast" 로 등장·퇴장·자리). 쇼츠는 frame(위 제목)과 같이 쓰면 제목 아래 전체가 무대
// 화면 글씨가 곧 내레이션인 장면은 하단 자막을 끈다 (같은 말이 두 번 보이지 않게)
const captionOn = (captions, scene) => captions && (scene.captions ?? !["hook", "statement", "story", "chapter", "dialogue"].includes(scene.type));

// 띠 쇼츠 ("layout": "band", band.jsx): 제목 / 16:9 그래픽 칸 / 자막 줄 / 캐릭터 + 댓글 — 서로 겹치지 않는 칸
function BandEpisode({ items, style, frame = {}, captions, music, musicStart, musicVolume, paper, castLook }) {
  const [l1, l2] = frame.title || [];
  const line = { fontFamily: FONT, fontWeight: 800, fontSize: BAND.titleSize, lineHeight: 1.15, letterSpacing: "-0.02em", color: paper ? COLORS.ink : FRAME.title };
  const last = items.length - 1;
  const look = castLook === "circle" ? "circle" : paper ? "paper" : "dark";
  return (
    <StyleContext.Provider value={style}>
    <AbsoluteFill style={{ backgroundColor: FRAME.bg }}>
      {paper && <SizeContext.Provider value={SIZES.short}><Background /></SizeContext.Provider>}
      <div style={{ position: "absolute", top: BAND.titleTop, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {l1 && <div style={line}>{l1}</div>}
        {l2 && <div style={{ ...line, color: FRAME.title, background: COLORS.band, borderRadius: COLORS.bandRadius, padding: "4px 24px 8px" }}>{l2}</div>}
      </div>
      <div style={{ position: "absolute", top: BAND.boxTop, left: 0, width: SIZES.long.width, height: SIZES.long.height,
        transform: `scale(${BOX_SCALE})`, transformOrigin: "top left", overflow: "hidden" }}>
        <SizeContext.Provider value={SIZES.long}>
          <FrameContext.Provider value={{ scale: BOX_SCALE, boost: BAND.boost }}>
            {!paper && <Background />}
            <TransitionSeries>
              {items.map((it, i) => {
                const Scene = SCENES[it.scene.type];
                if (!Scene) throw new Error(`모르는 장면 종류: "${it.scene.type}" (장면 ${i + 1})`);
                return (
                  <React.Fragment key={it.scene.id || i}>
                    <TransitionSeries.Sequence durationInFrames={it.frames}>
                      <Scene scene={it.scene} frames={it.frames} />
                      <SceneSfx scene={it.scene} />
                      {it.scene.audio && (
                        <Audio src={staticFile(it.scene.audio)} playbackRate={(it.scene.playbackRate || 1) * (it.scene.paceRate || 1)}
                          startFrom={Math.round((it.scene.trimStart || 0) * 30)} />
                      )}
                    </TransitionSeries.Sequence>
                    {i < last && <TransitionSeries.Transition presentation={transitionFor(items[i + 1].scene, i, style, it.scene)}
                      timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />}
                  </React.Fragment>
                );
              })}
            </TransitionSeries>
          </FrameContext.Provider>
        </SizeContext.Provider>
      </div>
      {/* 자막·캐릭터·댓글은 칸 밖 (장면 전환에 같이 밀리지 않게 따로 이어 붙임) */}
      <SizeContext.Provider value={SIZES.short}>
        <CaptionBandContext.Provider value={{ ...BAND.caption, paper }}>
          {items.map((it, i) => (
            <Sequence key={it.scene.id || i} from={it.start} durationInFrames={i < last ? it.frames - TRANSITION_FRAMES : it.frames}>
              {captionOn(captions, it.scene) && <Captions scene={it.scene} />}
              <BandCast scene={it.scene} start={it.castStart} look={look} />
              <Comments scene={it.scene} start={it.castStart} />
            </Sequence>
          ))}
        </CaptionBandContext.Provider>
      </SizeContext.Provider>
      {music && items.length > 0 && <Music src={music} items={items} startId={musicStart} volume={musicVolume} />}
    </AbsoluteFill>
    </StyleContext.Provider>
  );
}

// 편마다 색 바꾸기 ("palette": {bg, card, ink, sage, …}) — 예민한자립가가 아닌 영상(예: 자동화 사례 홍보, 남색·금색)용
const DEFAULT_COLORS = { ...COLORS };
// 글꼴은 편마다 한 번만 불러온다. 굵기 범위를 주면 굵게 쓴 글씨도 가짜 굵게(번짐) 처리하지 않음
const loadedSkins = new Set();
function useSkinFont(skin) {
  const font = SKINS[skin]?.font;
  if (font && !loadedSkins.has(skin)) { loadedSkins.add(skin); loadFont({ family: "SkinFont", url: staticFile(font), weight: "100 900" }); }
}

export function Episode({ scenes = [], chapters = [], steps, pace, style = "calm", music, musicStart, musicVolume, captions = true, frame, presenter, layout: screen, castLook, palette, skin, character }) {
  setCharacter(character);
  Object.assign(COLORS, DEFAULT_COLORS, SKINS[skin]?.colors || {}, palette || {});
  useSkinFont(skin);
  const items = layout(applyPace(scenes, pace), !!steps?.length);
  if (screen === "band" || screen === "one") return <BandEpisode {...{ items, style, frame, captions, music, musicStart, musicVolume, castLook }} paper={screen === "one"} />;
  const bar = steps?.length ? steps : chapters;
  const Shell = frame ? FrameShell : React.Fragment;
  const stage = frame ? { W: SIZES.short.width, H: STAGE_H } : { W: SIZES.long.width, H: SIZES.long.height };
  const shellProps = frame ? { frame, presenter } : {};
  return (
    <StyleContext.Provider value={style}>
    <AbsoluteFill>
      <Shell {...shellProps}>
      <Background />
      <TransitionSeries>
        {items.map((it, i) => {
          const Scene = SCENES[it.scene.type];
          if (!Scene) throw new Error(`모르는 장면 종류: "${it.scene.type}" (장면 ${i + 1}). 쓸 수 있는 종류: ${Object.keys(SCENES).join(", ")}`);
          const showProgress = !frame && it.chapter > 0 && !["chapter", "outro"].includes(it.scene.type);  // 제목 띠 쇼츠는 위 제목이 대신함
          return (
            <React.Fragment key={it.scene.id || i}>
              <TransitionSeries.Sequence durationInFrames={it.frames}>
                {presenter && it.scene.type !== "dialogue" ? (
                  <Cast scene={it.scene} start={it.castStart} W={stage.W} H={stage.H}>
                    <Scene scene={it.scene} frames={it.frames} />
                  </Cast>
                ) : (
                  <Scene scene={it.scene} frames={it.frames} />
                )}
                {it.scene.pose && <SideCharacter src={it.scene.pose} side={it.scene.poseSide} at={6} />}
                {it.scene.stickers && <Stickers scene={it.scene} />}
                {showProgress && <ChapterProgress chapters={bar} current={it.chapter} />}
                {captionOn(captions, it.scene) && <Captions scene={it.scene} />}
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
                  presentation={transitionFor(items[i + 1].scene, i, style, it.scene)}
                  timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      </Shell>
      {music && items.length > 0 && <Music src={music} items={items} startId={musicStart} volume={musicVolume} />}
    </AbsoluteFill>
    </StyleContext.Provider>
  );
}
