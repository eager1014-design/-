// 유튜브 오디오 보관함 효과음을 내려받아 video/sfx/<분류>/ 에 저장하고 목록(index.json)을 만든다.
// 입력: 브라우저에서 뽑은 JSON 파일 — [{id,t(제목),d(초),c(분류),l(라이선스),a(출처표기),u(다운로드 주소)}]
//   (브라우저 도구 결과 파일 형식 [{type,text:"BEGINJSON[...]ENDJSON"}] 도 그대로 받는다)
// 사용: node tools/sfx_download.mjs <json파일> [동시받기수=8]
// 주의: 다운로드 주소는 약 10분 뒤 만료된다. 뽑자마자 바로 돌릴 것.
import fs from "node:fs";
import path from "node:path";

const [src, par = "8"] = process.argv.slice(2);
if (!src) { console.error("사용: node tools/sfx_download.mjs <json파일> [동시받기수]"); process.exit(1); }

const OUT = path.resolve(import.meta.dirname, "../video/sfx");
const INDEX = path.join(OUT, "index.json");

let data = JSON.parse(fs.readFileSync(src, "utf8"));
if (data[0]?.type === "text") {
  // 브라우저 도구 결과 파일: text 안에 따옴표로 한 번 더 싸인 문자열이 들어 있다
  const text = data.map((d) => d.text).join("");
  const inner = text.slice(text.indexOf("BEGINJSON") + 9, text.indexOf("ENDJSON"));
  data = JSON.parse(JSON.parse(`"${inner}"`));
}
const items = data;

const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, "utf8")) : {};
const safe = (s) => String(s || "untitled").replace(/[\/\\:*?"<>|]/g, "_").trim().slice(0, 80);

let ok = 0, skip = 0, fail = 0;
async function one(x) {
  const cat = (x.c || "etc").toLowerCase();
  const file = path.join(cat, `${safe(x.t)}_${x.id}.mp3`);
  if (fs.existsSync(path.join(OUT, file))) { skip++; return; }
  // 동시에 많이 받으면 연결이 끊기는 일이 있어 3번까지 다시 시도한다 (2026-10-19 16개 동시 → 30개 끊김)
  for (let tryNo = 1; tryNo <= 3; tryNo++) {
    try {
      const r = await fetch(x.u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.join(OUT, cat), { recursive: true });
      fs.writeFileSync(path.join(OUT, file), buf);
      index[x.id] = { title: x.t, seconds: Number(x.d), category: cat, license: x.l, attribution: x.a || null, file };
      ok++;
      return;
    } catch (e) {
      if (tryNo === 3) { fail++; console.error("실패:", x.t, e.message); }
      else await new Promise((r) => setTimeout(r, 2000 * tryNo));
    }
  }
}

const queue = [...items];
await Promise.all(Array.from({ length: Number(par) }, async () => { while (queue.length) await one(queue.shift()); }));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));
console.log(`완료: 새로 ${ok}개, 이미 있음 ${skip}개, 실패 ${fail}개 (총 보관 ${Object.keys(index).length}개)`);
