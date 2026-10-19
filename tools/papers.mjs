// 논문이 진짜 있는지 확인하는 Tool (OpenAlex 무료 학술 DB, 키 필요 없음).
// 영상 대본에 넣는 연구 인용은 반드시 여기서 확인된 것만 쓴다 — AI가 지어낸 연구를 막기 위해.
//
// 사용법:
//   node tools/papers.mjs search "검색어(영어가 잘 됨)" [개수=8] [--cited]   → 관련도 순 (--cited: 인용 많은 순)
//   node tools/papers.mjs doi 10.1037/0022-3514.73.2.345            → 그 논문 하나 자세히 (초록 포함)
//
// 결과: 화면 + .tmp/papers_<종류>_<시각>.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.openalex.org";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "research-tool (mailto:research@example.com)" } });
  if (res.status === 404) die("그런 논문을 찾지 못했습니다. DOI 를 다시 확인해주세요.");
  if (!res.ok) die(`OpenAlex 가 요청을 거절했습니다 (${res.status}). 잠시 뒤 다시 해보세요.`);
  return res.json();
}

// OpenAlex 는 초록을 "단어 → 위치" 목록으로 준다. 문장으로 되돌린다.
function abstract(inv) {
  if (!inv) return null;
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ");
}

function simplify(w) {
  const names = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
  const last = (n) => n.split(" ").at(-1);
  const short = names.length <= 2 ? names.map(last).join(" & ") : `${last(names[0])} 외`;
  return {
    title: w.title,
    authors: names,
    cite_as: `${short}, ${w.publication_year}`,
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || null,
    cited_by: w.cited_by_count,
    doi: w.doi || null,
    open_access_url: w.open_access?.oa_url || null,
    abstract: abstract(w.abstract_inverted_index),
  };
}

function save(kind, data) {
  const dir = path.join(ROOT, ".tmp");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = path.join(dir, `papers_${kind}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\n💾 저장: ${path.relative(ROOT, file)}`);
}

function print(p, i, withAbstract) {
  console.log(`\n${i !== undefined ? `${i + 1}. ` : ""}${p.title}`);
  console.log(`   ${p.cite_as} · ${p.journal || "학술지 정보 없음"} · 인용 ${p.cited_by.toLocaleString("ko-KR")}회`);
  if (p.doi) console.log(`   ${p.doi}`);
  if (withAbstract) console.log(`\n   [초록] ${p.abstract || "(초록 없음 — 원문 링크에서 확인)"}`);
}

const argv = process.argv.slice(2);
const cited = argv.includes("--cited");
const [cmd, ...rest] = argv.filter((a) => !a.startsWith("--"));
if (cmd === "search") {
  const q = rest[0];
  if (!q) die('검색어를 넣어주세요. 예: node tools/papers.mjs search "highly sensitive person fMRI"');
  const n = Math.min(Math.max(Number(rest[1]) || 8, 1), 25);
  const data = await get(`${API}/works?search=${encodeURIComponent(q)}${cited ? "&sort=cited_by_count:desc" : ""}&per-page=${n}`);
  const list = (data.results || []).map(simplify);
  if (!list.length) die(`"${q}" 로 찾은 논문이 없습니다. 영어 검색어로 바꿔보세요.`);
  console.log(`\n📚 "${q}" 논문 ${list.length}개 (${cited ? "인용 많은 순" : "관련도 순"})`);
  list.forEach((p, i) => print(p, i, false));
  save("search", { query: q, searched_at: new Date().toISOString(), papers: list });
} else if (cmd === "doi") {
  const doi = (rest[0] || "").replace(/^https?:\/\/doi\.org\//, "");
  if (!doi) die("DOI 를 넣어주세요. 예: node tools/papers.mjs doi 10.1037/0022-3514.73.2.345");
  const p = simplify(await get(`${API}/works/doi:${encodeURIComponent(doi)}`));
  print(p, undefined, true);
  save("doi", p);
} else {
  die('사용법:\n   node tools/papers.mjs search "검색어" [개수]\n   node tools/papers.mjs doi <DOI>');
}
