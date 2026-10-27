// 병원 콘텐츠 시연 페이지 만들기: business/clinic_content/template.html 에 검사 규칙(ad_rules.mjs)과
// 실제 생성물(business/clinic_content/samples/*.json)을 넣어 index.html 로 쓴다. 규칙을 고치면 이걸 다시 돌리고 아티팩트를 다시 올린다.
//   node tools/clinic/build_demo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "./ad_rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "business/clinic_content");
const sampleDir = path.join(DIR, "samples");
const samples = fs.existsSync(sampleDir)
  ? fs.readdirSync(sampleDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(sampleDir, f), "utf8")))
  : [];
// 페이지에 넣을 때 </script> 가 글 속에 있어도 깨지지 않게
const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const html = fs.readFileSync(path.join(DIR, "template.html"), "utf8")
  .replace("/*RULES*/[]", safe(RULES))
  .replace("/*SAMPLES*/[]", safe(samples.map(({ keyword, seconds, revised, hits, blog, shorts, cards }) => ({ keyword, seconds, revised, hits, blog, shorts, cards }))));
fs.writeFileSync(path.join(DIR, "index.html"), html);
console.log(`✅ ${path.relative(ROOT, path.join(DIR, "index.html"))} — 규칙 ${RULES.length}개, 예시 ${samples.length}개`);
