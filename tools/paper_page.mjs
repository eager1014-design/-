// 논문 장면(citation)에 '진짜 논문 화면'을 붙이는 Tool (2026-10-30 사장님: 실제 자료로 영상을 더 깊게).
// OpenAlex(무료 학술 DB)에서 그 논문을 찾고 → 누구나 다시 써도 되는 논문(CC BY·CC0 등)이면 PDF 를 받아
// → 첫 페이지(또는 핵심 문장이 있는 페이지)를 그림으로 뽑고 핵심 문장 줄 위치를 표시(video/scripts/pdf_quote.js)
// → 영상에서 페이지가 뜨고 카메라가 그 문장으로 다가가 형광펜이 그어짐 (scenes.jsx Citation).
// 자유 이용 논문이 아니거나 PDF 를 못 받으면 예전처럼 글자 카드로 둔다 — 남의 논문 페이지를 허락 없이 통째로 보여주지 않기 위해.
//
// 다른 Tool 에서: import { fillPaperPages, paperCreditLines } from "./paper_page.mjs"
// 시험:        node tools/paper_page.mjs <DOI> ["찾을 영어 문장"]   → .tmp/paper_test/
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEO_PUBLIC = path.join(ROOT, "video/public");
const API = "https://api.openalex.org";
const OK_LICENSE = /^(cc-by|cc-by-sa|cc0|public-domain)$/; // 상업 채널에서 다시 써도 되는 것만 (NC·ND 빼기)
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) research-video-tool" };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  return res.ok ? res.json() : null;
}

const words = (t) => new Set(String(t || "").toLowerCase().match(/[a-z]{4,}/g) || []);
// 대본의 citation 칸(doi 또는 title+year)으로 OpenAlex 논문 찾기. 제목이 대본과 너무 다르면(지어낸 DOI 등) 버림
async function findWork(s) {
  const doi = String(s.doi || "").replace(/^https?:\/\/doi\.org\//, "");
  let list = [];
  if (doi) list = [await getJson(`${API}/works/doi:${encodeURIComponent(doi)}`)].filter(Boolean);
  if (!list.length && s.title) list = (await getJson(`${API}/works?search=${encodeURIComponent(s.title)}${s.year ? `&filter=publication_year:${s.year}` : ""}&per-page=3`))?.results || [];
  if (!s.title) return list[0] || null;
  const want = words(s.title);
  return list.find((w) => { const got = words(w.title); return [...want].filter((x) => got.has(x)).length >= Math.max(1, want.size * 0.5); }) || null;
}

// 초록(OpenAlex 는 '단어 → 위치' 목록) → 문장
function abstract(inv) {
  if (!inv) return "";
  const ws = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) ws[p] = w;
  return ws.join(" ");
}
// 형광펜 칠할 문장: 대본의 quote → 초록에서 결과를 말하는 문장 → (없으면 pdf_quote 가 제목 줄로)
function pickQuote(s, w) {
  if (s.quote) return s.quote;
  const sents = abstract(w.abstract_inverted_index).split(/(?<=\.)\s+/).filter((x) => x.split(" ").length >= 8);
  return sents.find((x) => /\b(we found|results|findings|showed|suggest|indicate|revealed)\b/i.test(x)) || sents[1] || sents[0] || "";
}

async function download(url, file) {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== "%PDF-") return false; // 로그인 화면·안내 페이지면 거름
  fs.writeFileSync(file, buf);
  return true;
}

// 대본의 citation 장면마다 page(그림)·pageAspect·marks 를 채운다. 돌려주는 credits 는 설명란 출처용
export async function fillPaperPages(ep, dir, log = console.log) {
  const credits = [];
  const outDir = path.join(dir, "paper");
  for (const s of (ep.scenes || []).filter((x) => x.type === "citation" && !x.page)) {
    const cite = `${s.authors || "?"} ${s.year || ""}`.trim();
    try {
      const w = await findWork(s);
      if (!w) { log(`📄 ${cite}: 논문을 OpenAlex 에서 못 찾아서 글자 카드로`); continue; }
      const locs = [w.best_oa_location, ...(w.locations || [])].filter((l) => l?.pdf_url && OK_LICENSE.test(l.license || ""));
      if (!locs.length) { log(`📄 ${cite}: 자유 이용(CC BY 등) 논문이 아니라 글자 카드로`); continue; }
      fs.mkdirSync(outDir, { recursive: true });
      const slug = `${s.id || "c"}_${String(w.id).split("/").pop()}`;
      const pdf = path.join(outDir, `${slug}.pdf`);
      let loc = null;
      for (const l of locs) if (fs.existsSync(pdf) || (await download(l.pdf_url, pdf))) { loc = l; break; }
      if (!loc) { log(`📄 ${cite}: PDF 를 못 받아서 글자 카드로`); continue; }
      const png = path.join(outDir, `${slug}.png`);
      const r = spawnSync("osascript", ["-l", "JavaScript", path.join(ROOT, "video/scripts/pdf_quote.js"), pdf, pickQuote(s, w), png], { encoding: "utf8", timeout: 60_000 });
      const j = r.status === 0 ? JSON.parse(r.stdout.trim()) : null;
      if (!j || !fs.existsSync(png)) { log(`📄 ${cite}: 페이지 그림을 못 뽑아서 글자 카드로 (${(r.stderr || "").slice(0, 120)})`); continue; }
      Object.assign(s, { page: path.relative(VIDEO_PUBLIC, png), pageAspect: +(j.w / j.h).toFixed(3), marks: j.marks, pageFound: j.found, cast: "off" }); // 캐릭터가 페이지·글씨를 가리지 않게
      fs.rmSync(pdf, { force: true }); // 영상엔 그림만 쓰니 PDF 는 버림
      credits.push({ cite, title: w.title, license: loc.license, url: w.doi || loc.landing_page_url || loc.pdf_url, page: s.page });
      log(`📄 ${cite}: 진짜 논문 화면 (${loc.license}, ${j.found === "quote" ? "핵심 문장 형광펜" : "제목 형광펜"})`);
    } catch (e) {
      log(`📄 ${cite}: ${e.message} — 글자 카드로`);
    }
  }
  return credits;
}

export function paperCreditLines(credits) {
  return credits.map((c) => `- ${c.cite}: "${c.title}" — ${c.license.toUpperCase()}, ${c.url}`).join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [doi, quote] = process.argv.slice(2);
  if (!doi) {
    console.error('사용법: node tools/paper_page.mjs <DOI> ["찾을 영어 문장"]');
    process.exit(1);
  }
  const dir = path.join(ROOT, ".tmp/paper_test");
  const ep = { scenes: [{ id: "t", type: "citation", doi, quote }] };
  const credits = await fillPaperPages(ep, dir);
  console.log(JSON.stringify(ep.scenes[0], null, 2));
  if (credits.length) console.log(paperCreditLines(credits));
}
