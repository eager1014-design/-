// Freesound 에서 CC0(마음대로 써도 되는 공짜) 효과음만 찾아서 받는 Tool. 무료, 키 필요 없음.
// 받는 파일은 Freesound 고음질 미리듣기 mp3(128kbps) — 원본은 로그인이 필요해서. 효과음 용도로는 충분.
//
// 사용법:
//   node tools/freesound.mjs pick <이름>=<영어 검색어> [<이름>=<검색어> ...] [--max=2.5] [--yes]
//       검색어마다 CC0·짧은(기본 2.5초 이하) 소리 중 다운로드 많은 1등을 고른다.
//       --yes 가 없으면 고른 목록만 보여준다(받지 않음). --yes 면 video/public/sfx/<이름>.mp3 로 받는다.
//   예: node tools/freesound.mjs pick click="mouse click" swipe="swoosh" --yes
// 받은 출처는 video/public/sfx/SOURCES.md 에 자동으로 적는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SFX = path.join(ROOT, "video", "public", "sfx");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const max = Number(args.find((a) => a.startsWith("--max="))?.slice(6) || 2.5);
const pairs = args.filter((a) => !a.startsWith("--") && a.includes("=")).map((a) => a.split(/=(.*)/s).slice(0, 2));
if (args[0] !== "pick" || !pairs.length) {
  console.error('사용법: node tools/freesound.mjs pick click="mouse click" [--yes]');
  process.exit(1);
}

async function search(q) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}` +
    `&f=${encodeURIComponent(`license:"Creative Commons 0" duration:[0 TO ${max}]`)}&s=${encodeURIComponent("Downloads (most first)")}`;
  let res;
  // 빨리 연달아 물으면 429(너무 많음)로 막는다 → 쉬었다가 다시 (2026-10-19 실제로 터짐)
  for (let i = 0; i < 4; i++) {
    await sleep(3000 + i * 5000);
    res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status !== 429) break;
  }
  if (!res.ok) throw new Error(`Freesound 검색 실패 (${res.status})`);
  const html = await res.text();
  return [...html.matchAll(/<div\s+class="bw-player"([\s\S]*?)tabindex/g)].map((m) => {
    const a = (k) => m[1].match(new RegExp(`data-${k}="([^"]*)"`))?.[1];
    return { id: a("sound-id"), user: a("username"), title: a("title"), sec: Number(a("duration")), downloads: Number(a("num-downloads")), mp3: a("mp3")?.replace("-lq.mp3", "-hq.mp3") };
  }).filter((s) => s.mp3 && s.sec <= max);
}

fs.mkdirSync(SFX, { recursive: true });
const credits = [];
const used = new Set(); // 검색어가 달라도 같은 소리가 1등이면 다음 것을 쓴다
for (const [name, q] of pairs) {
  const file = path.join(SFX, `${name}.mp3`);
  if (fs.existsSync(file)) { console.log(`⏭  ${name}: 이미 있음 (건너뜀)`); continue; }
  const s = (await search(q)).find((x) => !used.has(x.id));
  if (s) used.add(s.id);
  if (!s) { console.log(`❓ ${name}: "${q}" 로 CC0·${max}초 이하 소리를 못 찾음 → 검색어를 바꿔보세요`); continue; }
  const line = `${name}.mp3 — "${s.title}" by ${s.user}, ${s.sec.toFixed(1)}초, 다운로드 ${s.downloads.toLocaleString()} · https://freesound.org/s/${s.id}/ (CC0)`;
  if (!yes) { console.log(`👀 ${line}`); continue; }
  const r = await fetch(s.mp3, { headers: { "User-Agent": UA } });
  if (!r.ok) { console.log(`❌ ${name}: 받기 실패 (${r.status})`); continue; }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`✅ ${line}`);
  credits.push(`- ${line}`);
}
if (credits.length) {
  const src = path.join(SFX, "SOURCES.md");
  if (!fs.existsSync(src)) fs.writeFileSync(src, "# 효과음 출처 (전부 CC0 — 출처 표시 의무 없음, 기록용)\n\n");
  fs.appendFileSync(src, credits.join("\n") + "\n");
}
if (!yes) console.log("\n(미리보기만 했습니다. 받으려면 끝에 --yes)");
