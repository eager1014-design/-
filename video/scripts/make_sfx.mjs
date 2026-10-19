// 효과음을 코드로 직접 만든다 (저작권 걱정 없음). public/sfx/ 에 wav 로 저장.
// 사용법: node scripts/make_sfx.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/sfx");
const RATE = 44100;

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 모노
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}

function make(seconds, fn) {
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => fn(i / RATE, seconds));
}

// 뽁: 높은 음에서 빠르게 내려가는 짧고 둥근 소리
const pop = make(0.12, (t, d) => {
  const f = 900 * Math.exp(-t * 28) + 380;
  const env = Math.min(1, t / 0.003) * Math.exp(-t * 38);
  return Math.sin(2 * Math.PI * f * t) * env * 0.8;
});

// 슉: 부드럽게 커졌다 작아지는 바람 소리 (잡음을 저역 통과)
let lp = 0;
const whoosh = make(0.4, (t, d) => {
  const x = t / d;
  const env = Math.sin(Math.PI * Math.pow(x, 0.7)) ** 2;
  const cutoff = 0.04 + 0.18 * Math.sin(Math.PI * x);
  lp += cutoff * (Math.random() * 2 - 1 - lp);
  return lp * env * 2.2;
});

// 띵: 핵심 문장용 부드러운 종소리
const chime = make(1.2, (t) => {
  const env = Math.min(1, t / 0.005) * Math.exp(-t * 3.2);
  return (Math.sin(2 * Math.PI * 1046.5 * t) * 0.5 + Math.sin(2 * Math.PI * 1568 * t) * 0.25 + Math.sin(2 * Math.PI * 2093 * t) * 0.12) * env * 0.6;
});

fs.mkdirSync(OUT, { recursive: true });
for (const [name, s] of Object.entries({ pop, whoosh, chime })) {
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(s));
  console.log(`🔊 ${name}.wav`);
}
