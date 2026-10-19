// ElevenLabs 로 배경음악·효과음을 만든다. 사장님 ElevenLabs 구독 크레딧을 쓰므로 기본은 미리보기만 한다.
// 키는 프로젝트 맨 위 폴더의 .env 의 ELEVENLABS_API_KEY 에서만 읽는다. 이 파일에 키를 적지 말 것.
//
// 사용법:
//   node tools/elevenlabs.mjs music <이름> "<음악 설명(영어가 잘 됨)>" --seconds=230 [--model=music_v2_5] [--yes]
//       → video/public/music/<이름>.mp3   (가사 없는 연주곡으로 고정)
//   node tools/elevenlabs.mjs sfx <이름> "<효과음 설명>" [--seconds=1.5] [--yes]
//       → video/public/sfx/<이름>.mp3
//   node tools/elevenlabs.mjs voices      → 쓸 수 있는 목소리 목록 (무료)
//   node tools/elevenlabs.mjs narrate <episode.json> [--voice=<ID>] [--model=eleven_v3] [--yes]
//       → 내레이션 전체를 한 번에 녹음해서 편 폴더 voice_full.mp3 (그 다음 video/scripts/split_voice.mjs 로 장면별 자르기)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const API = "https://api.elevenlabs.io";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function key() {
  const k = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!k) die("ELEVENLABS_API_KEY 가 .env 에 없습니다. https://elevenlabs.io/app/settings/api-keys 에서 키를 만들어 넣어주세요.");
  return k;
}

function explain(status, body) {
  const d = body?.detail;
  const msg = typeof d === "string" ? d : d?.message || JSON.stringify(body).slice(0, 300);
  if (status === 401 && /missing the permission (\w+)/.test(msg)) {
    const perm = msg.match(/missing the permission (\w+)/)[1];
    return `키에 "${perm}" 권한이 없습니다. ElevenLabs → API Keys → 이 키 수정 → 해당 권한을 켜주세요.`;
  }
  if (status === 401) return "ElevenLabs 키가 틀렸습니다. .env 의 ELEVENLABS_API_KEY 를 확인하세요.";
  if (/quota|credits|insufficient/i.test(msg)) return `ElevenLabs 크레딧이 부족합니다: ${msg}`;
  if (status === 403) return `이 기능을 지금 요금제에서 쓸 수 없습니다: ${msg}`;
  return `ElevenLabs 가 거절했습니다 (${status}): ${msg}`;
}

async function post(endpoint, body, query = "") {
  const res = await fetch(`${API}${endpoint}${query}`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(explain(res.status, await res.json().catch(() => ({}))));
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    cost: res.headers.get("x-character-count") || res.headers.get("character-cost") || null,
  };
}

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.length ? v.join("=") : true];
}));
const [cmd, name, prompt] = argv.filter((a) => !a.startsWith("--"));

if (cmd === "voices") {
  const res = await fetch(`${API}/v1/voices`, { headers: { "xi-api-key": key() } });
  if (!res.ok) die(explain(res.status, await res.json().catch(() => ({}))));
  const { voices } = await res.json();
  console.log(`\n🎙  목소리 ${voices.length}개`);
  for (const v of voices) console.log(`   ${v.voice_id} | ${v.name} | ${v.category}${v.labels?.language ? ` | ${v.labels.language}` : ""}`);
  process.exit(0);
}

if (cmd === "narrate") {
  // 대본(episode.json)의 내레이션 전체를 한 번에 녹음 → 편 폴더 voice_full.mp3
  // (장면별로 따로 녹음하면 장면마다 톤이 흔들려서 통으로 녹음한다. 자르기는 video/scripts/split_voice.mjs, 무료)
  const file = path.resolve(name || "");
  if (!name || !fs.existsSync(file)) die("사용법: node tools/elevenlabs.mjs narrate <episode.json> [--voice=<목소리ID>] [--model=<모델>] [--yes]");
  const episode = JSON.parse(fs.readFileSync(file, "utf8"));
  const voiceId = flags.voice || episode.voice?.id;
  if (!voiceId) die('목소리가 없습니다. episode.json 에 "voice": {"provider": "elevenlabs", "id": "…"} 를 넣거나 --voice=<ID> (ID는 node tools/elevenlabs.mjs voices)');
  const model = flags.model || episode.voice?.model || "eleven_v3";
  // 문단 하나 = 장면 하나. 문단 사이 쉼이 장면 경계가 된다
  const text = episode.scenes.map((s) => s.narration.trim()).join("\n\n");
  if (text.length > 5000) die(`대본이 ${text.length}자입니다. 한 번에 5,000자까지라서 나눠서 녹음해야 합니다.`);
  const out = path.join(path.dirname(file), "voice_full.mp3");
  const hash = (await import("node:crypto")).createHash("sha1").update(JSON.stringify([text, voiceId, model])).digest("hex").slice(0, 12);

  console.log(`\n🎙  "${episode.title || path.basename(path.dirname(file))}" 통녹음\n   목소리 ${episode.voice?.name || voiceId} · 모델 ${model}\n   장면 ${episode.scenes.length}개 · ${text.length}자 (≈ 크레딧 ${text.length}, 모델에 따라 다름)\n   저장: ${path.relative(ROOT, out)}`);
  if (episode.voiceFull?.hash === hash && fs.existsSync(out)) {
    console.log("\n✅ 같은 대본·같은 목소리로 이미 녹음했습니다 (크레딧 안 씀). 다시 하려면 voice_full.mp3 를 지우세요.");
    process.exit(0);
  }
  if (!flags.yes) {
    console.log("\n👀 미리보기만 했습니다 (크레딧 안 씀). 실제로 녹음하려면 끝에 --yes");
    process.exit(0);
  }
  console.log("\n⏳ 녹음 중… (1분 안팎)");
  const { audio, cost } = await post(`/v1/text-to-speech/${voiceId}`, { text, model_id: model, language_code: "ko" }, "?output_format=mp3_44100_128");
  fs.writeFileSync(out, audio);
  episode.voiceFull = { hash, voice: voiceId, model, recorded_at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(episode, null, 2));
  console.log(`✅ 저장: ${path.relative(ROOT, out)} (${(audio.length / 1024).toFixed(0)}KB${cost ? `, 사용 크레딧 ${cost}` : ""})`);
  console.log(`   다음: cd video && node scripts/split_voice.mjs ${path.relative(path.join(ROOT, "video"), file)} --dry`);
  process.exit(0);
}

if (!["music", "sfx"].includes(cmd) || !name || !prompt) {
  die('사용법:\n   node tools/elevenlabs.mjs music <이름> "<음악 설명>" --seconds=230 [--yes]\n   node tools/elevenlabs.mjs sfx <이름> "<효과음 설명>" [--seconds=1.5] [--yes]\n   node tools/elevenlabs.mjs voices');
}
if (!/^[\w-]+$/.test(name)) die("이름은 영어·숫자·-·_ 만 써주세요 (파일 이름이 됩니다).");

const seconds = flags.seconds ? Number(flags.seconds) : null;
const dir = path.join(ROOT, "video", "public", cmd === "music" ? "music" : "sfx");
const out = path.join(dir, `${name}.mp3`);

if (cmd === "music") {
  if (seconds !== null && (seconds < 3 || seconds > 600)) die("음악 길이는 3~600초입니다.");
  const model = flags.model || "music_v2_5";
  console.log(`\n🎵 배경음악 "${name}" · ${seconds ? `${seconds}초` : "길이 자동"} · 모델 ${model} · 연주곡\n   설명: ${prompt}\n   저장: ${path.relative(ROOT, out)}`);
  if (!flags.yes) {
    console.log("\n👀 미리보기만 했습니다 (크레딧 안 씀). 실제로 만들려면 끝에 --yes");
    process.exit(0);
  }
  console.log("\n⏳ 만드는 중… (길이에 따라 1~3분)");
  const { audio, cost } = await post("/v1/music", {
    prompt,
    model_id: model,
    force_instrumental: true,
    ...(seconds ? { music_length_ms: Math.round(seconds * 1000) } : {}),
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, audio);
  console.log(`✅ 저장: ${path.relative(ROOT, out)} (${(audio.length / 1024 / 1024).toFixed(1)}MB${cost ? `, 사용 크레딧 ${cost}` : ""})`);
} else {
  if (seconds !== null && (seconds < 0.5 || seconds > 30)) die("효과음 길이는 0.5~30초입니다.");
  console.log(`\n🔊 효과음 "${name}" · ${seconds ? `${seconds}초` : "길이 자동"}\n   설명: ${prompt}\n   저장: ${path.relative(ROOT, out)}`);
  if (!flags.yes) {
    console.log("\n👀 미리보기만 했습니다 (크레딧 안 씀). 실제로 만들려면 끝에 --yes");
    process.exit(0);
  }
  const { audio, cost } = await post("/v1/sound-generation", {
    text: prompt,
    model_id: "eleven_text_to_sound_v2",
    prompt_influence: 0.5,
    ...(seconds ? { duration_seconds: seconds } : {}),
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, audio);
  console.log(`✅ 저장: ${path.relative(ROOT, out)}${cost ? ` (사용 크레딧 ${cost})` : ""}`);
}
