// 위키미디어 공용(Commons)에서 인물 사진을 가져오는 Tool. 무료, 키 필요 없음.
// 쓸 수 있는 라이선스만 받는다: 퍼블릭 도메인(PD)·CC0 우선, 그다음 CC BY / CC BY-SA (출처 표기 필요 → credits 에 적어 설명란에 넣음).
// 첫 사진은 위키데이터의 대표 사진(P18, 보통 가장 유명한 초상)으로 고른다.
//
// 사용법:
//   node tools/commons.mjs "Arthur Schopenhauer" <저장 폴더> [개수=3]
//   → <저장 폴더>/<영문이름>_1.jpg … + credits.json 에 [{file, title, author, license, url}] 추가
// 다른 Tool 에서: import { fetchPortraits } from "./commons.mjs"
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://commons.wikimedia.org/w/api.php";
const UA = { "User-Agent": "yeminhan-video-factory/1.0 (personal YouTube channel tool; eager1014@gmail.com)" };
const OK = /^(public domain|pd\b|pd-|cc0|cc by(-sa)? ?[1-4]\.0|cc-by(-sa)?-[1-4]\.0)/i;
const VIDEO_PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../video/public");
const PY = path.resolve(VIDEO_PUBLIC, "../../.venv/bin/python");
const strip = (s = "") => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// 인터넷이 잠깐 끊기면(fetch failed) 2초·5초 쉬고 다시 — 2026-10-23 첫 편에서 한 번 끊겨 사진이 빠졌음
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) });
      if (res.ok || i >= tries || res.status < 500) return res;
    } catch (e) {
      if (i >= tries) throw e;
    }
    await new Promise((r) => setTimeout(r, i === 1 ? 2000 : 5000));
  }
}

async function get(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", origin: "*", ...params })) url.searchParams.set(k, v);
  const res = await fetchRetry(url, { headers: UA });
  if (!res.ok) throw new Error(`위키미디어 오류 ${res.status}`);
  return res.json();
}

// 위키데이터 대표 사진 파일 이름 (없으면 null)
async function wikidataImage(name) {
  const s = await fetchRetry(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=1`, { headers: UA }).then((r) => r.json());
  const id = s.search?.[0]?.id;
  if (!id) return null;
  const e = await fetchRetry(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, { headers: UA }).then((r) => r.json());
  return e.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
}

function info(page) {
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  const license = strip(m.LicenseShortName?.value || "");
  return {
    title: page.title, license, author: strip(m.Artist?.value || "").slice(0, 120) || "unknown",
    pd: /public domain|^pd|cc0/i.test(license), ok: OK.test(license),
    url: ii.thumburl || ii.url, page: ii.descriptionurl, w: ii.width, h: ii.height, mime: ii.mime,
  };
}

async function details(titles) {
  if (!titles.length) return [];
  const d = await get({ action: "query", titles: titles.join("|"), prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "1600" });
  return Object.values(d.query?.pages || {}).map(info).filter(Boolean);
}

export async function fetchPortraits(name, outDir, count = 3) {
  const picked = [];
  const main = await wikidataImage(name).catch(() => null);
  if (main) picked.push(...(await details([`File:${main}`])));
  const s = await get({ action: "query", list: "search", srsearch: `${name} portrait filetype:bitmap`, srnamespace: "6", srlimit: "30" });
  const more = await details((s.query?.search || []).map((x) => x.title).slice(0, 30));
  for (const m of more) if (!picked.some((p) => p.title === m.title)) picked.push(m);
  // 쓸 수 있는 것만, 퍼블릭 도메인 먼저, 너무 작은 그림·로고·서명은 빼기
  const usable = picked.filter((p) => p.ok && /jpeg|png/.test(p.mime) && p.w >= 400 && p.h >= 400 && !/signature|autograph|logo|coat of arms|grave|tomb/i.test(p.title))
    .sort((a, b) => (a === picked[0] ? -1 : b === picked[0] ? 1 : 0) || Number(b.pd) - Number(a.pd));
  fs.mkdirSync(outDir, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const saved = [];
  for (const p of usable.slice(0, count)) {
    const ext = /png/.test(p.mime) ? "png" : "jpg";
    const file = path.join(outDir, `${slug}_${saved.length + 1}.${ext}`);
    const res = await fetchRetry(p.url, { headers: UA }).catch(() => null);
    if (!res) continue;
    if (!res.ok) continue;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    saved.push({ file, name, title: p.title.replace(/^File:/, ""), author: p.author, license: p.license, url: p.page, aspect: +(p.w / p.h).toFixed(3) });
  }
  const creditsFile = path.join(outDir, "credits.json");
  const old = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, "utf8")) : [];
  fs.writeFileSync(creditsFile, JSON.stringify([...old.filter((c) => !saved.some((s) => s.file === c.file)), ...saved], null, 2));
  return saved;
}

// 사진 속 그 사람 얼굴 위치 (제미나이, 사진 1장 ≈ 1천 토큰) → { x, y, r } 사진 기준 0~1. 못 찾으면 null
export async function locateFace(file, name) {
  const { gemini, GEMINI_MODEL } = await import("./ai-bridge/gemini.mjs");
  const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  const res = await gemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: fs.readFileSync(file).toString("base64") } },
      { text: `이 사진에서 ${name} 의 얼굴 가운데 위치를 사진 폭·높이 기준 0~1 비율로 알려줘. r 은 얼굴을 감쌀 원의 반지름(사진 긴 변 기준 비율). 여러 명이면 ${name} 만. 없으면 found=false.` }] }],
    config: { responseMimeType: "application/json", responseSchema: { type: "object", properties: { found: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, r: { type: "number" } }, required: ["found"] } },
  });
  const j = JSON.parse(res.text || "{}");
  return j.found && j.x >= 0 && j.x <= 1 && j.y >= 0 && j.y <= 1 ? { x: j.x, y: j.y, r: Math.min(0.3, Math.max(0.05, j.r || 0.12)) } : null;
}

// 설명란에 붙일 사진 출처 (퍼블릭 도메인도 예의상 적는다)
export function creditLines(credits) {
  return credits.map((c) => `- ${c.name}: "${c.title}" — ${c.author}, ${c.license}, Wikimedia Commons ${c.url}`).join("\n");
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
// 대본의 photo 장면(person)에 사진을 채운다. 못 받은 장면은 이모지 이야기 장면으로 바꿔 두고(photoPending) 다음에 다시 시도.
// 돌려주는 credits 는 설명란 출처(creditLines)용. 오늘의 영상·롱폼 공통.
export async function fillPhotos(ep, dir, log = console.log) {
  // photoPending: 예전에 사진을 못 받아 이모지로 바꿔 둔 장면 → 다시 사진 장면으로
  for (const s of ep.scenes) if (s.photoPending && s.person) { Object.assign(s, { type: "photo" }); delete s.emoji; delete s.photoPending; }
  const scenes = ep.scenes.filter((s) => s.type === "photo" && !s.image);
  if (!scenes.length) return [];
  const imgDir = path.join(dir, "img");
  const credits = [];
  for (const person of [...new Set(scenes.map((s) => s.person).filter(Boolean))]) {
    const mine = scenes.filter((s) => s.person === person);
    let got = [];
    try { got = await fetchPortraits(person, imgDir, mine.length); } catch (e) { log(`⚠️ ${person} 사진 받기 실패: ${e.message}`); }
    log(`📷 ${person} 사진 ${got.length}장 (${got.map((g) => g.license).join(", ") || "없음"})`);
    for (const [i, s] of mine.entries()) {
      const g = got[i % Math.max(1, got.length)];
      if (!g) continue;
      s.image = path.relative(VIDEO_PUBLIC, g.file);
      s.aspect = g.aspect;
      if (s.cutout) { // 사진 오려 붙이기: 사람만 오린 투명 PNG (2026-10-30). 못 오리면 보통 액자 사진으로
        const cut = g.file.replace(/\.\w+$/, ".cut.png");
        if (!fs.existsSync(cut)) spawnSync(PY, [path.resolve(VIDEO_PUBLIC, "../scripts/person_cut.py"), g.file], { stdio: "ignore", timeout: 180_000 });
        if (fs.existsSync(cut)) {
          const b = fs.readFileSync(cut); // PNG 머리말의 폭·높이
          Object.assign(s, { cutoutImage: path.relative(VIDEO_PUBLIC, cut), cutAspect: +(b.readUInt32BE(16) / b.readUInt32BE(20)).toFixed(3) });
        } else log(`⚠️ ${person} 사진에서 사람을 못 오려서 액자 사진으로 둠`);
      }
      if (s.circle) { // 얼굴 위치는 실제로 화면에 쓰는 그림(오린 그림이 있으면 그것) 기준
        const face = await withTimeout(locateFace(s.cutoutImage ? path.join(VIDEO_PUBLIC, s.cutoutImage) : g.file, person).catch(() => null), 45_000);
        Object.assign(s.circle, face || { x: 0.5, y: s.cutoutImage ? 0.2 : 0.28, r: 0.16 });
      }
      if (!credits.some((c) => c.file === g.file)) credits.push(g);
    }
  }
  for (const s of ep.scenes) {
    if (s.type === "photo" && !s.image) Object.assign(s, { type: "story", emoji: "📜", photoPending: true });
  }
  return credits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, out, n] = process.argv.slice(2);
  if (!name || !out) {
    console.error('사용법: node tools/commons.mjs "Arthur Schopenhauer" <저장 폴더> [개수=3]');
    process.exit(1);
  }
  const saved = await fetchPortraits(name, path.resolve(out), Number(n) || 3);
  if (!saved.length) console.log(`❓ "${name}" 의 쓸 수 있는 사진을 못 찾음`);
  for (const s of saved) console.log(`✅ ${path.basename(s.file)} — ${s.title} (${s.license}, ${s.author})`);
}
