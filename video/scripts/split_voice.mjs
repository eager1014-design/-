// 통째로 녹음한 내레이션(예: ElevenLabs 에서 받은 voice_full.mp3)을 장면별로 잘라 episode.json 에 연결한다. 무료.
// 사용법: node scripts/split_voice.mjs public/episodes/<편>/episode.json [녹음파일=voice_full.mp3] [--dry]
// 준비: node scripts/setup_whisper.mjs (처음 한 번)
//
// 방법: 내 컴퓨터의 받아쓰기(whisper.cpp)로 글자마다 말한 시각을 얻고, 대본 글자와 맞춰서(정렬) 장면 경계 시각을 찾는다.
// 경계 근처의 쉼(무음) 가운데에서 자른다. 쉼만 보고 자르면 "…" 쉼과 문단 사이 쉼을 헷갈려서 이 방식을 쓴다.
// 받아쓴 결과는 transcript.json 으로 남겨서 단어 단위 자막에도 쓸 수 있게 한다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { transcribe } from "@remotion/install-whisper-cpp";
import { WHISPER_MODEL, WHISPER_VERSION } from "./whisper-config.mjs";

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WHISPER_DIR = path.join(VIDEO, "whisper");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const file = path.resolve(args[0] || "");
if (!args[0] || !fs.existsSync(file)) die("대본 파일을 넣어주세요. 예: node scripts/split_voice.mjs public/episodes/ep01/episode.json");
if (!fs.existsSync(path.join(WHISPER_DIR, "main"))) die("받아쓰기 프로그램이 없습니다. 먼저 node scripts/setup_whisper.mjs 를 실행하세요.");
const dir = path.dirname(file);
let voice = path.join(dir, args[1] || "voice_full.mp3");
if (!fs.existsSync(voice) && fs.existsSync(`${voice}.mp3`)) {
  // 맥에서 확장자가 숨겨져 ".mp3.mp3" 로 저장되는 경우가 많다
  fs.renameSync(`${voice}.mp3`, voice);
  console.log(`📝 파일 이름 바로잡음: ${path.basename(voice)}.mp3 → ${path.basename(voice)}`);
}
if (!fs.existsSync(voice)) die(`녹음 파일이 없습니다: ${path.relative(VIDEO, voice)}`);

const ff = (a) => spawnSync("npx", ["remotion", "ffmpeg", "-hide_banner", ...a], { cwd: VIDEO, encoding: "utf8", maxBuffer: 1 << 26 });
const total = parseFloat(
  execFileSync("npx", ["remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voice], { cwd: VIDEO, encoding: "utf8" })
    .split("\n")
    .filter((l) => /^[\d.]+$/.test(l.trim()))
    .at(-1),
);

// 1) 받아쓰기 (같은 녹음이면 저장된 결과를 다시 씀)
const transcriptFile = path.join(dir, "transcript.json");
const stat = fs.statSync(voice);
let transcript = fs.existsSync(transcriptFile) ? JSON.parse(fs.readFileSync(transcriptFile, "utf8")) : null;
if (!transcript || transcript.source !== path.basename(voice) || transcript.size !== stat.size) {
  const wav16 = path.join(dir, ".voice16k.wav");
  ff(["-y", "-v", "error", "-i", voice, "-ar", "16000", "-ac", "1", wav16]);
  console.log(`🎧 받아쓰는 중 (${Math.round(total)}초 분량, 1~3분 걸림)…`);
  const out = await transcribe({
    inputPath: wav16,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model: WHISPER_MODEL,
    language: "ko",
    tokenLevelTimestamps: true,
    printOutput: false,
  });
  fs.rmSync(wav16, { force: true });
  const tokens = out.transcription.flatMap((seg) => seg.tokens.filter((t) => !/^\[_/.test(t.text)).map((t) => ({ text: t.text, from: t.offsets.from / 1000, to: t.offsets.to / 1000 })));
  transcript = { source: path.basename(voice), size: stat.size, tokens };
  fs.writeFileSync(transcriptFile, JSON.stringify(transcript, null, 1));
}

// 2) 글자 단위로 펼치기: 한글·영문만 남긴다 (숫자는 "2018" / "이천십팔" 처럼 표기가 달라질 수 있어 뺀다)
const keep = (s) => s.replace(/[^가-힣a-zA-Z]/g, "");
const hyp = [];
for (const t of transcript.tokens) {
  const chars = [...keep(t.text)];
  chars.forEach((c, i) => hyp.push({ c, t: t.from + ((t.to - t.from) * (i + 0.5)) / chars.length }));
}
const ep = JSON.parse(fs.readFileSync(file, "utf8"));
const scenes = ep.scenes.filter((s) => s.narration?.trim());
const ref = [];
const sceneStart = [];
for (const [i, s] of scenes.entries()) {
  sceneStart.push(ref.length);
  for (const c of keep(s.narration)) ref.push({ c, scene: i });
}

// 3) 대본 글자 ↔ 받아쓴 글자 정렬 (편집 거리). ref 글자마다 맞는 hyp 글자 번호를 얻는다.
const R = ref.length;
const H = hyp.length;
const W = H + 1;
const cost = new Uint32Array((R + 1) * W);
const move = new Uint8Array((R + 1) * W); // 0=맞춤, 1=대본만(빠짐), 2=받아쓰기만(덧붙음)
for (let j = 1; j <= H; j++) (cost[j] = j), (move[j] = 2);
for (let i = 1; i <= R; i++) {
  cost[i * W] = i;
  move[i * W] = 1;
  for (let j = 1; j <= H; j++) {
    const diag = cost[(i - 1) * W + j - 1] + (ref[i - 1].c === hyp[j - 1].c ? 0 : 1);
    const up = cost[(i - 1) * W + j] + 1;
    const left = cost[i * W + j - 1] + 1;
    let m = 0;
    let v = diag;
    if (up < v) (v = up), (m = 1);
    if (left < v) (v = left), (m = 2);
    cost[i * W + j] = v;
    move[i * W + j] = m;
  }
}
const match = new Array(R).fill(-1);
let matched = 0;
for (let i = R, j = H; i > 0 || j > 0; ) {
  const m = move[i * W + j];
  if (m === 0) {
    if (ref[i - 1].c === hyp[j - 1].c) matched++;
    match[i - 1] = j - 1;
    i--, j--;
  } else if (m === 1) i--;
  else j--;
}
const accuracy = matched / R;

// 장면의 첫 글자 / 마지막 글자 시각
const timeOf = (k, dir) => {
  for (let x = k; x >= 0 && x < R; x += dir) if (match[x] >= 0 && ref[x].c === hyp[match[x]].c) return hyp[match[x]].t;
  return null;
};
const firstT = scenes.map((_, i) => timeOf(sceneStart[i], +1));
const lastT = scenes.map((_, i) => timeOf((sceneStart[i + 1] ?? R) - 1, -1));

// 4) 경계: 앞 장면 끝 ~ 다음 장면 시작 사이에서 가장 긴 쉼의 가운데. 쉼이 없으면 그 사이 가운데.
const silLog = ff(["-i", voice, "-af", "silencedetect=noise=-35dB:d=0.12", "-f", "null", "-"]).stderr || "";
const sil = [];
let s0 = null;
for (const line of silLog.split("\n")) {
  const a = line.match(/silence_start: ([\d.]+)/);
  const b = line.match(/silence_end: ([\d.]+)/);
  if (a) s0 = parseFloat(a[1]);
  if (b && s0 !== null) sil.push({ start: s0, end: parseFloat(b[1]) }), (s0 = null);
}
const firstSound = sil[0]?.start < 0.05 ? sil[0].end : 0;
const lastSil = sil.at(-1);
const lastSound = lastSil && total - lastSil.end < 0.05 ? lastSil.start : total;
const cuts = [Math.max(0, firstSound - 0.05)];
for (let i = 0; i < scenes.length - 1; i++) {
  const lo = (lastT[i] ?? cuts.at(-1)) - 0.05;
  const hi = (firstT[i + 1] ?? lo + 0.5) + 0.25; // 받아쓰기 시각은 약간 늦게 찍히는 경향이 있어 여유
  const inside = sil
    .map((s) => ({ start: Math.max(s.start, lo), end: Math.min(s.end, hi) }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  cuts.push(inside.length ? (inside[0].start + inside[0].end) / 2 : (lo + hi) / 2);
}
cuts.push(Math.min(total, lastSound + 0.2));

// 5) 보고
console.log(`\n✂️  ${path.basename(voice)} (${total.toFixed(1)}초) → 장면 ${scenes.length}개 · 대본과 받아쓰기 일치율 ${(accuracy * 100).toFixed(0)}%`);
console.log("   장면 | 시작 → 끝 | 길이 | 1초당 글자 | 첫 마디");
const rates = scenes.map((s, i) => keep(s.narration).length / Math.max(0.3, cuts[i + 1] - cuts[i]));
const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
scenes.forEach((s, i) => console.log(`   ${s.id} | ${cuts[i].toFixed(2)} → ${cuts[i + 1].toFixed(2)} | ${(cuts[i + 1] - cuts[i]).toFixed(2)}초 | ${rates[i].toFixed(1)} | ${s.narration.slice(0, 16)}…`));
const odd = scenes.filter((_, i) => rates[i] < avg * 0.5 || rates[i] > avg * 1.7 || firstT[i] === null).map((s) => s.id);
if (accuracy < 0.7) console.log(`\n⚠️  일치율이 낮습니다. 녹음이 대본과 많이 다르거나 다른 편의 녹음일 수 있습니다.`);
if (odd.length) console.log(`⚠️  확인이 필요한 장면: ${odd.join(", ")} (말 속도가 평균과 많이 다름)`);
else console.log(`✅ 모든 장면의 말 속도가 평균(1초에 ${avg.toFixed(1)}자) 근처`);
if (dry) {
  console.log("\n(--dry: 파일은 만들지 않았습니다)");
  process.exit(0);
}

// 6) 장면별 wav 저장 + episode.json 갱신
for (const [i, s] of scenes.entries()) {
  const out = path.join(dir, `${s.id}.wav`);
  ff(["-y", "-v", "error", "-ss", cuts[i].toFixed(3), "-to", cuts[i + 1].toFixed(3), "-i", voice, "-ac", "1", "-ar", "44100", out]);
  s.audio = path.relative(path.join(VIDEO, "public"), out).split(path.sep).join("/");
  s.audioDuration = Math.round((cuts[i + 1] - cuts[i]) * 100) / 100;
  s.audioStart = Math.round(cuts[i] * 1000) / 1000; // 원본 녹음에서의 시작 시각 (단어 단위 자막용)
  s.playbackRate = 1;
  s.audioSource = path.basename(voice);
  // 글자별로 "이 장면 소리 시작부터 몇 초에 말했는지" (한글·영문 글자 기준). 화면 요소·자막·음악 연출 타이밍에 쓴다.
  const from = sceneStart[i];
  const to = sceneStart[i + 1] ?? R;
  const times = [];
  for (let x = from; x < to; x++) times.push(match[x] >= 0 && ref[x].c === hyp[match[x]].c ? hyp[match[x]].t : null);
  // 맞추지 못한 글자는 앞뒤 글자 시각 사이로 채운다
  for (let x = 0; x < times.length; x++) {
    if (times[x] !== null) continue;
    let a = x - 1;
    while (a >= 0 && times[a] === null) a--;
    let b = x + 1;
    while (b < times.length && times[b] === null) b++;
    const ta = a >= 0 ? times[a] : cuts[i];
    const tb = b < times.length ? times[b] : cuts[i + 1];
    times[x] = ta + ((tb - ta) * (x - a)) / (b - a);
  }
  s.charTimes = times.map((t) => Math.round(Math.max(0, Math.min(t - cuts[i], cuts[i + 1] - cuts[i])) * 100) / 100);
  delete s.audioHash;
}
fs.writeFileSync(file, JSON.stringify(ep, null, 2));
console.log(`\n💾 장면별 소리 ${scenes.length}개 저장, episode.json 갱신 완료`);
