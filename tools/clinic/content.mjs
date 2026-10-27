// 병원 콘텐츠 기획 도구 (2026-10-27, 병원 자동화 2번): 시술 키워드 하나 → 블로그 초안 + 쇼츠 대본 + 카드뉴스 5장.
// 쓰기 = 클로드(맥북 구독 claude -p, 추가 비용 없음). 다 쓰면 의료광고 위험 표현 검사(ad_rules.mjs) →
// 걸린 게 있으면 클로드에게 그 목록을 주고 한 번 고쳐 쓰게 한 뒤 다시 검사. 남은 표시는 결과에 그대로 남긴다 (사람이 마지막에 본다).
//
//   node tools/clinic/content.mjs "쌍꺼풀 붓기 관리" [--clinic="데모성형외과"] [--out=폴더]
// 결과: <폴더>/<키워드>.json (기본 .tmp/clinic/) — 블로그·쇼츠·카드뉴스·검사 결과
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check, RULES } from "./ad_rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLAUDE = process.env.CLAUDE_BIN || path.join(process.env.HOME, ".local/bin/claude");

function askClaude(prompt) {
  fs.mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
  const r = spawnSync(CLAUDE, ["-p", "--output-format", "json", "--tools", ""], { input: prompt, cwd: path.join(ROOT, ".tmp"), encoding: "utf8", timeout: 900_000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`클로드 실행 실패: ${(r.stderr || r.stdout || "").slice(-300)}`);
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  if (out.is_error) throw new Error(`클로드 오류: ${String(out.result).slice(0, 300)}`);
  const m = String(out.result).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("클로드 답에서 JSON 을 못 찾았습니다.");
  return JSON.parse(m[0]);
}

const SHAPE = `JSON 하나만:
{"blog": {"title": "검색될 키워드를 앞에 둔 제목", "body": "블로그 본문 900~1300자. 소제목 3~4개(## 로 시작), 쉬운 말, 마지막에 '개인에 따라 결과와 회복 기간이 다를 수 있으니 진료 상담에서 확인하세요' 류의 안내"},
 "shorts": {"title": "쇼츠 제목", "scenes": [{"say": "읽을 문장 1~2개", "screen": "화면 글씨 12자 이내"}]  ← 7~9장면, 40초 안팎},
 "cards": [{"title": "카드 제목 14자 이내", "text": "본문 2~3줄"}]  ← 정확히 5장, 1장=표지 질문, 5장=상담 안내}`;

const RULE_TEXT = RULES.map((r) => `- ${r.type}: ${r.why} → ${r.fix}`).join("\n");

function allText(c) {
  return [c.blog?.title, c.blog?.body, c.shorts?.title, ...(c.shorts?.scenes || []).flatMap((s) => [s.say, s.screen]), ...(c.cards || []).flatMap((x) => [x.title, x.text])].filter(Boolean).join("\n");
}

export function makeContent(keyword, { clinic = "우리 병원" } = {}) {
  const base = `너는 성형외과 콘텐츠 담당자야. 시술 주제: "${keyword}". 병원 이름: ${clinic}.
목표: 환자가 궁금해하는 정보를 정직하게 알려 주고, 상담 예약으로 자연스럽게 이어지게.
[의료광고 원칙 — 반드시 지킬 것 (의료법 제56조 취지)]
${RULE_TEXT}
- 숫자(기간·비율)는 '보통', '안팎', '개인차' 같은 말과 함께. 연구·통계 인용 금지. 가격 숫자 금지.
- 진단·처방처럼 들리는 말 금지("당신은 ○○가 필요합니다"). 의료진 상담을 권하기.`;
  let c = askClaude(`${base}\n\n${SHAPE}`);
  let hits = check(allText(c));
  let revised = false;
  if (hits.length) {
    revised = true;
    const list = [...new Set(hits.map((h) => `"${h.match}" (${h.type}: ${h.fix})`))].join("\n");
    c = askClaude(`${base}\n\n[아래 초안에서 위험 표현이 나왔어. 뜻은 살리고 이 표현들만 바꿔서 전체를 다시 줘]\n${list}\n\n[초안]\n${JSON.stringify(c)}\n\n${SHAPE}`);
    hits = check(allText(c));
  }
  return { keyword, clinic, at: new Date().toISOString(), revised, hits: hits.map(({ type, level, match, fix }) => ({ type, level, match, fix })), ...c };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
  const keyword = args.find((a) => !a.startsWith("--"));
  if (!keyword) {
    console.log('사용법: node tools/clinic/content.mjs "시술 키워드" [--clinic="병원 이름"] [--out=폴더]');
    process.exit(1);
  }
  const out = path.resolve(ROOT, flag("out") || ".tmp/clinic");
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const r = makeContent(keyword, { clinic: flag("clinic") || "우리 병원" });
  r.seconds = Math.round((Date.now() - t0) / 1000);
  const file = path.join(out, `${keyword.replace(/[\\/:*?"<>|\s]+/g, "_")}.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
  console.log(`✅ ${file}\n걸린 시간 ${r.seconds}초 · 고쳐 쓰기 ${r.revised ? "1번" : "없음"} · 남은 위험 표시 ${r.hits.length}개`);
}
