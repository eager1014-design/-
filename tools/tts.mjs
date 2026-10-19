// 대본(episode.json)의 내레이션을 제미나이 AI 목소리로 만든다. 유료라서 기본은 미리보기만 한다.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
//
// 사용법:
//   node tools/tts.mjs <episode.json> [--yes] [--only=s01,s02] [--force]
//       장면마다 목소리 파일(wav)을 만들고 episode.json 에 audio·audioDuration 을 채운다.
//       이미 만든 장면은 내레이션·목소리 설정이 바뀌지 않았으면 건너뛴다 (돈 두 번 안 나감). --force 는 다시 만든다.
//   node tools/tts.mjs voices "읽어볼 문장" [--yes] [--voices=Charon,Algieba,...]
//       같은 문장을 여러 목소리로 만들어 비교한다 → .tmp/voices/
//
// 목소리 설정 (episode.json 의 "voice", 없으면 .env → 기본값):
//   name  : 목소리 이름 (.env GEMINI_TTS_VOICE, 기본 Charon)
//   style : 전체 말투 지시 (영어가 가장 잘 먹힘)
//   speed : 재생 속도 (1.05 = 5% 빠르게, 음 높이는 그대로)
//   장면별로 "direction": "slower, with a pause before the last sentence" 처럼 말투를 더할 수 있다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, friendlyError, gemini } from "./ai-bridge/gemini.mjs";

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE || "Charon";
const DEFAULT_STYLE =
  "Read this Korean narration like a calm, warm man in his thirties sincerely sharing his own story with one friend. Natural pace, slightly slow, gentle pauses at commas, never theatrical";
const RATE = 24000; // 제미나이 음성 출력: 24kHz, 16비트, 모노

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function wav(pcm) {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

// 앞뒤의 무음을 잘라낸다 (장면 사이가 늘어지지 않게). 앞 0.05초, 뒤 0.15초만 남김.
function trimSilence(pcm) {
  const n = pcm.length / 2;
  const loud = (i) => Math.abs(pcm.readInt16LE(i * 2)) > 600;
  let a = 0;
  while (a < n && !loud(a)) a++;
  let b = n - 1;
  while (b > a && !loud(b)) b--;
  a = Math.max(0, a - RATE * 0.05);
  b = Math.min(n - 1, b + RATE * 0.15);
  return pcm.subarray(Math.floor(a) * 2, Math.floor(b + 1) * 2);
}

async function speak(textToRead, voiceName, style) {
  const ai = gemini();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: [{ parts: [{ text: `${style}:\n${textToRead}` }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      });
      const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!data) throw new Error("제미나이가 소리를 돌려주지 않았습니다.");
      return { pcm: trimSilence(Buffer.from(data, "base64")), tokens: res.usageMetadata?.totalTokenCount ?? null };
    } catch (e) {
      // 잠깐 붐빌 때(503·429)는 30초 쉬고 한 번 더. 이 경우 요금은 나가지 않는다.
      if (attempt < 2 && !/limit: 0|PerDay|quota exceeded/i.test(e.message) && /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(e.message)) {
        process.stdout.write("붐벼서 30초 뒤 다시 … ");
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      throw e;
    }
  }
}

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.length ? v.join("=") : true];
}));
const args = argv.filter((a) => !a.startsWith("--"));

// ---- 목소리 비교 ----
if (args[0] === "voices") {
  const line = args[1] || "회사를 일곱 번 그만뒀습니다. 저는 제가 고장 난 줄 알았어요.";
  const voices = (flags.voices || "Charon,Algieba,Iapetus,Achird,Sadaltager,Umbriel").split(",");
  console.log(`\n🎙  목소리 ${voices.length}개로 같은 문장 만들기 · 모델 ${MODEL}\n   "${line}"`);
  if (!flags.yes) {
    console.log(`\n👀 미리보기만 했습니다 (요금 없음). 글자 ${line.length}자 × ${voices.length}번. 실제로 만들려면 --yes`);
    process.exit(0);
  }
  const dir = path.join(ROOT, ".tmp", "voices");
  fs.mkdirSync(dir, { recursive: true });
  for (const v of voices) {
    process.stdout.write(`\n${v} … `);
    try {
      const { pcm } = await speak(line, v, DEFAULT_STYLE);
      fs.writeFileSync(path.join(dir, `${v}.wav`), wav(pcm));
      console.log(`완료 (${(pcm.length / 2 / RATE).toFixed(1)}초)`);
    } catch (e) {
      console.log(`실패: ${friendlyError(e)}`);
    }
  }
  console.log(`\n💾 저장: ${path.relative(ROOT, dir)}/  (파일을 더블클릭해서 들어보세요)`);
  process.exit(0);
}

// ---- 대본 전체 ----
if (!args[0]) die("대본 파일을 넣어주세요. 예: node tools/tts.mjs video/public/episodes/<편>/episode.json");
const file = path.resolve(ROOT, args[0]);
if (!fs.existsSync(file)) die(`파일을 찾을 수 없습니다: ${args[0]}`);
const episode = JSON.parse(fs.readFileSync(file, "utf8"));
const publicDir = path.join(ROOT, "video", "public");
if (!file.startsWith(publicDir + path.sep)) die("대본은 video/public/episodes/<편>/ 안에 있어야 합니다 (영상 프로그램이 목소리 파일을 찾을 수 있게).");
const episodeDir = path.dirname(file);

const voice = { name: DEFAULT_VOICE, style: DEFAULT_STYLE, speed: 1, ...(episode.voice || {}) };
const only = flags.only ? new Set(flags.only.split(",")) : null;
const hashOf = (s) => crypto.createHash("sha1").update(JSON.stringify([MODEL, voice.name, voice.style, s.direction || "", s.narration])).digest("hex").slice(0, 12);

const todo = episode.scenes.filter((s) => {
  if (!s.narration?.trim()) return false;
  if (only && !only.has(s.id)) return false;
  if (flags.force) return true;
  return !(s.audio && s.audioHash === hashOf(s) && fs.existsSync(path.join(publicDir, s.audio)));
});

const chars = todo.reduce((a, s) => a + s.narration.length, 0);
console.log(`\n🎙  목소리 만들 장면 ${todo.length}개 / 전체 ${episode.scenes.length}개 · 목소리 ${voice.name} · 모델 ${MODEL}`);
todo.forEach((s) => console.log(`  ${s.id} (${s.narration.length}자) ${s.narration.slice(0, 50)}${s.narration.length > 50 ? "…" : ""}`));
console.log(`\n📝 글자 합계 ${chars.toLocaleString("ko-KR")}자 → 목소리 약 ${Math.round(chars / 7)}초 (어림값)`);
if (!todo.length) {
  console.log("✅ 새로 만들 목소리가 없습니다.");
  process.exit(0);
}
if (!flags.yes) {
  console.log("\n👀 미리보기만 했습니다 (요금 없음). 실제로 만들려면 끝에 --yes 를 붙여 다시 실행하세요.");
  process.exit(0);
}

let tokens = 0;
let failed = 0;
for (const [i, s] of todo.entries()) {
  process.stdout.write(`\n[${i + 1}/${todo.length}] ${s.id} … `);
  try {
    const style = s.direction ? `${voice.style}. For this part: ${s.direction}` : voice.style;
    const out = await speak(s.narration, voice.name, style);
    const name = `${s.id}.wav`;
    fs.writeFileSync(path.join(episodeDir, name), wav(out.pcm));
    const seconds = out.pcm.length / 2 / RATE;
    s.audio = path.relative(publicDir, path.join(episodeDir, name)).split(path.sep).join("/");
    s.audioDuration = Math.round((seconds / voice.speed) * 100) / 100;
    s.playbackRate = voice.speed;
    s.audioHash = hashOf(s);
    tokens += out.tokens || 0;
    console.log(`완료 (${s.audioDuration}초)`);
  } catch (e) {
    failed++;
    console.log(`실패: ${friendlyError(e)}`);
  }
  fs.writeFileSync(file, JSON.stringify(episode, null, 2)); // 하나 끝날 때마다 저장
}

const total = episode.scenes.reduce((a, s) => a + (s.audioDuration || 0), 0);
console.log(`\n✅ 끝: 성공 ${todo.length - failed}개, 실패 ${failed}개 · 쓴 토큰 ${tokens.toLocaleString("ko-KR")} · 목소리 전체 ${Math.round(total)}초`);
if (failed) console.log("   실패한 장면은 같은 명령으로 다시 돌리면 그것만 다시 만듭니다.");
