// 채널 캐릭터가 나오는 그림을 제미나이로 그린다. 유료라서 기본은 미리보기만 한다.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
//
// 기준 그림: video/public/characters/main/ 의 이미지(png/jpg/webp, 앞에서 4장까지)를 캐릭터 기준으로 넣는다.
//
// 사용법:
//   node tools/illustrate.mjs scenes <episode.json> [--yes] [--only=s09,s18] [--force]
//       대본에서 "illustration" 칸(장면 설명)이 있는 장면마다 그림을 그려 <편 폴더>/<장면>.png 로 저장하고 scene.image 를 채운다.
//   node tools/illustrate.mjs pose <이름> "<포즈 설명>" [--yes]
//       모션그래픽 옆에 세울 캐릭터 포즈(흰 배경) → characters/main/poses/<이름>.png
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, friendlyError, gemini } from "./ai-bridge/gemini.mjs";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const CHAR_DIR = path.join(ROOT, "video", "public", "characters", "main");
const PUBLIC = path.join(ROOT, "video", "public");
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// 캐릭터 규칙: 기준 그림의 미니멀한 검은 선화를 절대 바꾸지 않는다 (색칠·3D화 금지).
const CHARACTER =
  "The main character must look EXACTLY like the reference images: a minimal hand-drawn line-art young man with round glasses, " +
  "short messy hair and a plain sweatshirt, drawn ONLY with clean thin black outlines and a pure white fill — no shading, no color, no 3D on the character. " +
  "Same proportions, same face, same line thickness as the reference.";
// 장면 그림: 환경만 부드러운 3D. 채널 색(크림·세이지·호박색)과 차분한 분위기.
const SCENE_STYLE =
  "The environment around him is a soft, stylized 3D render (rounded clay-like shapes, soft global illumination, gentle depth of field) " +
  "in a calm palette of warm cream, muted sage green and soft amber. The flat 2D line-art character sits naturally inside the 3D space (correct scale, soft contact shadow). " +
  "Simple composition with breathing room. No text, letters, logos or speech bubbles.";
// 포즈 그림: 흰 배경에 캐릭터만 (영상에서 배경과 합성)
const POSE_STYLE =
  "Only the character, full body, on a plain pure white background (#FFFFFF). No ground, no shadow, no props unless described, no text.";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function references() {
  if (!fs.existsSync(CHAR_DIR)) die("캐릭터 폴더가 없습니다: video/public/characters/main/");
  const files = fs.readdirSync(CHAR_DIR).filter((f) => TYPES[path.extname(f).toLowerCase()]).sort().slice(0, 4);
  if (!files.length) die("캐릭터 기준 그림이 없습니다. video/public/characters/main/ 에 캐릭터 그림을 넣어주세요.");
  return files.map((f) => ({
    name: f,
    part: { inlineData: { mimeType: TYPES[path.extname(f).toLowerCase()], data: fs.readFileSync(path.join(CHAR_DIR, f)).toString("base64") } },
  }));
}

async function draw(prompt, aspectRatio, refs) {
  const ai = gemini();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [...refs.map((r) => r.part), { text: prompt }] }],
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
      });
      const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!img) throw new Error(`제미나이가 그림을 돌려주지 않았습니다 (${res.candidates?.[0]?.finishReason || "이유 모름"}).`);
      return { png: Buffer.from(img.inlineData.data, "base64"), tokens: res.usageMetadata?.totalTokenCount ?? null };
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
const [cmd, ...args] = argv.filter((a) => !a.startsWith("--"));

if (cmd === "pose") {
  const [name, desc] = args;
  if (!name || !desc) die('사용법: node tools/illustrate.mjs pose <이름> "<포즈 설명>" [--yes]');
  const refs = references();
  console.log(`\n🧍 포즈 "${name}": ${desc}\n   기준 그림: ${refs.map((r) => r.name).join(", ")} · 모델 ${MODEL}`);
  if (!flags.yes) {
    console.log("\n👀 미리보기만 했습니다 (요금 없음). 실제로 그리려면 --yes (그림 1장)");
    process.exit(0);
  }
  const prompt = `${CHARACTER}\n${POSE_STYLE}\nPose: ${desc}`;
  let png, tokens;
  try {
    ({ png, tokens } = await draw(prompt, "1:1", refs));
  } catch (e) {
    die(friendlyError(e));
  }
  const out = path.join(CHAR_DIR, "poses", `${name}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`\n✅ 저장: ${path.relative(ROOT, out)} (토큰 ${tokens ?? "?"})`);
  process.exit(0);
}

if (cmd !== "scenes") die('사용법:\n   node tools/illustrate.mjs scenes <episode.json> [--yes] [--only=…]\n   node tools/illustrate.mjs pose <이름> "<포즈 설명>" [--yes]');

const file = path.resolve(ROOT, args[0] || "");
if (!args[0] || !fs.existsSync(file)) die("대본 파일을 넣어주세요. 예: node tools/illustrate.mjs scenes video/public/episodes/ep01/episode.json");
const ep = JSON.parse(fs.readFileSync(file, "utf8"));
const dir = path.dirname(file);
const aspect = ep.format === "short" ? "9:16" : "16:9";
const only = flags.only ? new Set(flags.only.split(",")) : null;
const refs = references();
const refHash = crypto.createHash("sha1").update(refs.map((r) => r.part.inlineData.data).join("")).digest("hex").slice(0, 8);
const hashOf = (s) => crypto.createHash("sha1").update(JSON.stringify([MODEL, refHash, aspect, s.illustration])).digest("hex").slice(0, 12);

const todo = ep.scenes.filter((s) => {
  if (!s.illustration) return false;
  if (only && !only.has(s.id)) return false;
  if (flags.force) return true;
  return !(s.image && s.imageHash === hashOf(s) && fs.existsSync(path.join(PUBLIC, s.image)));
});

console.log(`\n🎨 그릴 장면 ${todo.length}개 · 비율 ${aspect} · 모델 ${MODEL}`);
console.log(`   캐릭터 기준 그림: ${refs.map((r) => r.name).join(", ")}`);
todo.forEach((s) => console.log(`   ${s.id}: ${s.illustration}`));
if (!todo.length) {
  console.log("✅ 새로 그릴 장면이 없습니다. (장면에 \"illustration\": \"장면 설명\" 을 넣으면 그 장면을 그립니다)");
  process.exit(0);
}
if (!flags.yes) {
  console.log(`\n👀 미리보기만 했습니다 (요금 없음). 그림 ${todo.length}장을 실제로 그리려면 끝에 --yes`);
  process.exit(0);
}

let tokens = 0;
let failed = 0;
for (const [i, s] of todo.entries()) {
  process.stdout.write(`\n[${i + 1}/${todo.length}] ${s.id} … `);
  try {
    const prompt = `${CHARACTER}\n${SCENE_STYLE}\nScene: ${s.illustration}`;
    const out = await draw(prompt, aspect, refs);
    const name = `${s.id}.png`;
    fs.writeFileSync(path.join(dir, name), out.png);
    s.image = path.relative(PUBLIC, path.join(dir, name)).split(path.sep).join("/");
    s.imageHash = hashOf(s);
    tokens += out.tokens || 0;
    console.log("완료");
  } catch (e) {
    failed++;
    console.log(`실패: ${friendlyError(e)}`);
    if (/무료 등급/.test(friendlyError(e))) break; // 같은 이유로 다 실패하므로 멈춘다
  }
  fs.writeFileSync(file, JSON.stringify(ep, null, 2)); // 하나 끝날 때마다 저장
}
console.log(`\n✅ 끝: 성공 ${todo.length - failed}장, 실패 ${failed}장 · 쓴 토큰 ${tokens.toLocaleString("ko-KR")}`);
if (failed) console.log("   실패한 장면은 같은 명령으로 다시 돌리면 그것만 다시 그립니다.");
