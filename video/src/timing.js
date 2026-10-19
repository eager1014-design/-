// 장면 길이·등장 시점·자막 나누기 계산. 화면 그리는 코드와 분리해서 어디서든 같은 값을 쓰게 한다.
import { CHARS_PER_SECOND, FPS, SCENE_PAD_FRAMES, TRANSITION_FRAMES } from "./theme.js";

// 빠른 편집(episode.json 의 "pace": { "speed": 1.1, "trim": true }):
//  - trim: 장면 앞뒤의 쉼을 잘라낸다 (받아쓰기 시각 charTimes 가 있는 장면만)
//  - speed: 목소리를 그만큼 빠르게 (음 높이는 그대로)
// 장면에 trimStart·voiceEnd·paceRate 를 붙여 돌려준다. 영상 길이 계산(Root)과 화면(Episode)이 같이 쓴다.
export function applyPace(scenes, pace) {
  if (!pace) return scenes;
  return scenes.map((s) => {
    if (!s.audioDuration) return s;
    const ct = s.charTimes || [];
    const trim = pace.trim && ct.length > 0;
    return {
      ...s,
      paceRate: pace.speed || 1,
      trimStart: trim ? Math.max(0, ct[0] - 0.08) : 0,
      voiceEnd: trim ? Math.min(s.audioDuration, ct.at(-1) + 0.3) : s.audioDuration,
      padFrames: 14, // 전환(12프레임)보다는 길어야 다음 장면 목소리와 안 겹친다
    };
  });
}

// 녹음 파일 속 시각(초) → 장면 안에서 실제로 들리는 시각(초)
export function heardAt(scene, t) {
  return (t - (scene.trimStart || 0)) / (scene.paceRate || 1);
}

// 목소리 길이(초). tts 도구가 audioDuration 을 채우기 전에는 글자 수로 어림한다.
export function voiceSeconds(scene) {
  if (scene.audioDuration) return ((scene.voiceEnd ?? scene.audioDuration) - (scene.trimStart || 0)) / (scene.paceRate || 1);
  const chars = (scene.narration || "").replace(/\s/g, "").length;
  return Math.max(2, chars / CHARS_PER_SECOND);
}

export function sceneFrames(scene) {
  if (scene.holdSeconds) return Math.round(scene.holdSeconds * FPS);
  return Math.ceil(voiceSeconds(scene) * FPS) + (scene.padFrames ?? SCENE_PAD_FRAMES);
}

export function totalFrames(scenes) {
  const sum = scenes.reduce((a, s) => a + sceneFrames(s), 0);
  return sum - TRANSITION_FRAMES * Math.max(0, scenes.length - 1);
}

// 대본 글자 중 한글·영문만 센다 (split_voice 의 charTimes 와 같은 기준)
const keep = (s) => s.replace(/[^가-힣a-zA-Z]/g, "");

// 내레이션에서 cue 단어를 말하기 시작하는 프레임. charTimes(받아쓰기로 잰 실제 시각)가 있으면 그걸 쓰고,
// 없으면 글자 수 비례로 어림한다. 찾지 못하면 null.
export function cueFrame(scene, cue) {
  const text = scene.narration || "";
  const at = cue ? text.indexOf(cue) : -1;
  if (at < 0) return null;
  const before = keep(text.slice(0, at)).length;
  if (scene.charTimes?.length) {
    const t = scene.charTimes[Math.min(before, scene.charTimes.length - 1)];
    return Math.max(0, Math.round(heardAt(scene, t) * FPS));
  }
  const plain = keep(text).length || 1;
  return Math.round((before / plain) * voiceSeconds(scene) * FPS);
}

// 화면 요소가 나타날 프레임. cue(내레이션 속 단어)가 있으면 그 단어를 말하는 순간에 맞춘다.
// 없으면 목소리 구간의 10%~70% 사이에 고르게 나눈다.
export function revealFrames(scene, items) {
  const voice = voiceSeconds(scene) * FPS;
  return items.map((item, i) => {
    const cue = typeof item === "object" ? item.cue : null;
    const f = cueFrame(scene, cue);
    if (f !== null) return f;
    const spread = items.length > 1 ? i / (items.length - 1) : 0;
    return Math.round(voice * (0.1 + 0.6 * spread));
  });
}

// 내레이션을 자막 조각으로 나누고, 글자 수에 비례해서 시간을 배분한다.
export function captionChunks(scene, maxChars) {
  const text = (scene.narration || "").trim();
  if (!text) return [];
  const pieces = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    let line = "";
    for (const word of sentence.split(/\s+/)) {
      if (line && (line + " " + word).length > maxChars) {
        pieces.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
      // 쉼표에서는 자막을 끊어 호흡을 맞춘다
      if (/[,，]$/.test(word) && line.length > maxChars * 0.4) {
        pieces.push(line);
        line = "";
      }
    }
    if (line) pieces.push(line);
  }
  const voice = voiceSeconds(scene) * FPS;
  if (scene.charTimes?.length) {
    let idx = 0;
    const starts = pieces.map((p) => {
      const t = scene.charTimes[Math.min(idx, scene.charTimes.length - 1)];
      idx += keep(p).length;
      return Math.max(0, Math.round(heardAt(scene, t) * FPS));
    });
    return pieces.map((p, i) => ({ text: p.replace(/[.,，]$/, ""), from: i === 0 ? 0 : starts[i], to: i + 1 < pieces.length ? starts[i + 1] : Math.round(voice) }));
  }
  const total = pieces.reduce((a, p) => a + p.replace(/\s/g, "").length, 0);
  let cursor = 0;
  return pieces.map((p) => {
    const len = (p.replace(/\s/g, "").length / total) * voice;
    const chunk = { text: p.replace(/[.,，]$/, ""), from: Math.round(cursor), to: Math.round(cursor + len) };
    cursor += len;
    return chunk;
  });
}
