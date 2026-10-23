// ChatGPT 이미지 생성(코덱스 CLI 경유). 사장님 ChatGPT 구독 한도 안에서 그리므로 API 키·별도 요금이 없다.
// 먼저 한 번: `codex login` (ChatGPT 계정으로 로그인)
// 주의: 무료(free) 계정이면 코덱스에 그림 도구(image_gen)가 아예 안 열려서 "도구를 찾지 못했다"는 답만 온다 (2026-10-19 확인).
//
// 사용법:
//   node tools/gpt_image.mjs "<그림 설명>" [--out=.tmp/images/이름.png] [--size=1024x1024|1536x1024|1024x1536] [--ref=기준그림.png,...]
//   --ref 로 넣은 그림은 참고(캐릭터·스타일 기준)로 같이 보낸다.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const IMG = /\.(png|jpe?g|webp)$/i;

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const prompt = args.filter((a) => !a.startsWith("--")).join(" ").trim();
if (!prompt) die('그림 설명을 넣어주세요. 예: node tools/gpt_image.mjs "창가에 앉은 고양이, 수채화"');

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const out = path.resolve(ROOT, opt("out") || `.tmp/images/gpt_${stamp}.png`);
const size = opt("size");
const refs = (opt("ref") || "").split(",").filter(Boolean).map((r) => path.resolve(ROOT, r));
for (const r of refs) if (!fs.existsSync(r)) die(`기준 그림이 없습니다: ${r}`);
fs.mkdirSync(path.dirname(out), { recursive: true });

// 코덱스가 만든 그림은 ~/.codex/generated_images/ 아래에 저장된다. 실행 뒤 새로 생긴 그림 파일을 찾는다.
// (~/.codex 전체를 뒤지면 코덱스 내부 아이콘을 잘못 집는다 — 2026-10-19 실제로 터짐)
const GEN_DIR = path.join(CODEX_HOME, "generated_images");
function imagesUnder(dir, since, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) imagesUnder(p, since, found);
    else if (IMG.test(e.name) && fs.statSync(p).mtimeMs >= since) found.push(p);
  }
  return found;
}

function run(cmd, argv) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const instruction =
  `Use your built-in image generation tool to create exactly ONE image. Do not write code, do not run shell commands, do not draw with scripts.` +
  (size ? ` Size: ${size}.` : "") +
  (refs.length ? " Use the attached image(s) as visual reference." : "") +
  `\n\nImage description:\n${prompt}`;

const since = Date.now() - 1000;
console.log("🎨 ChatGPT로 그리는 중... (보통 30초~2분)");
const res = await run("codex", [
  "exec", "--json", "--skip-git-repo-check", "--ephemeral",
  "-s", "read-only", "-C", path.dirname(out),
  // 요청 글은 반드시 -i 보다 앞에: -i 는 뒤에 오는 값을 전부 그림 파일로 먹어서, 글이 뒤에 있으면
  // "No prompt provided via stdin" 으로 실패한다 (2026-10-22 --ref 쓸 때 실제로 터짐)
  instruction,
  ...refs.flatMap((r) => ["-i", r]),
]);

if (res.code === -1) die("codex 프로그램을 못 찾았습니다. 설치: npm install -g --prefix ~/.local @openai/codex");
const log = res.stdout + res.stderr;
if (/not logged in|unauthorized|401|login/i.test(res.stderr) && res.code !== 0) die("코덱스 로그인이 필요합니다. 터미널에서 `codex login` 을 실행해 ChatGPT 계정으로 로그인하세요.");
if (/usage limit|rate limit|quota/i.test(log)) die("ChatGPT 이미지 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.\n" + res.stderr.slice(-500));

// 1순위: 실행 기록(JSON)에 나온 그림 경로나 그림 데이터. 2순위: ~/.codex 와 출력 폴더에 새로 생긴 그림.
let saved = null;
for (const line of res.stdout.split("\n")) {
  if (!line.trim().startsWith("{")) continue;
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  const s = JSON.stringify(ev);
  const b64 = s.match(/"(?:result|b64_json|image_base64|data)":"([A-Za-z0-9+/=]{1000,})"/)?.[1];
  if (b64) { fs.writeFileSync(out, Buffer.from(b64, "base64")); saved = out; }
}
if (!saved) {
  const fresh = imagesUnder(GEN_DIR, since)
    .filter((p) => p !== out)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (fresh[0]) { fs.copyFileSync(fresh[0], out); saved = out; }
}

fs.mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".tmp", "gpt_image_last.log"), log);
if (!saved) {
  die(`그림을 받지 못했습니다 (종료코드 ${res.code}). 기록: .tmp/gpt_image_last.log\n` + res.stderr.slice(-800));
}
console.log(`✅ 저장: ${path.relative(ROOT, saved)}`);
