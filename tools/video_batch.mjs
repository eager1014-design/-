// 영상 여러 개를 제미나이로 차례대로 분석하는 Tool. 유료(제미나이)라서 기본은 "미리보기"만 한다.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
//
// 사용법:
//   node tools/video_batch.mjs <youtube JSON 파일 | 유튜브 링크 | 영상 파일 경로 ...> [--top=5] [--sort=views|date|as-is] [--prompt="..."] [--out=파일] [--yes]
//
//   --yes 가 없으면 돈이 들지 않는 미리보기(목록·길이·예상 토큰)만 보여준다.
//   --top    : 몇 개 분석할지 (기본: 전부)
//   --sort   : views(조회수 높은 순, 기본) / date(최신 순) / as-is(넣은 순서)
//   --prompt : 기본 분석 항목에 더해 따로 물어볼 것 (예: "HSP 채널에 적용할 점도 알려줘")
//   --mode   : analysis(기본, 여러 영상 비교용) / blueprint(영상 1개의 뼈대를 우리 장면 틀에 맞춘 설계도로)
//   --clip   : 긴 영상은 일부 구간만 분석 (초). 예: --clip=0-240 → 처음 4분만. 토큰이 그만큼 줄어든다
//   --out    : 결과 파일. 같은 파일로 다시 돌리면 이미 끝난 영상은 건너뛴다.
//              안 주면 JSON 하나를 넣었을 때는 .tmp/video_analysis_<그 파일 이름>.json, 아니면 시각으로 정한다.
//
//              --mode=blueprint 에서 .md 로 주면 사람이 읽는 설계도(.md)와 같은 이름의 .json 을 함께 저장한다.
//
// 결과: .tmp/video_analysis_*.json (영상 숫자 + 분석 결과가 한 줄에. 구글 시트 Tool이 가져다 씀)
import fs from "node:fs";
import path from "node:path";
import { SCENES_LIST } from "../video/scripts/scene-types.mjs";
import { ROOT, GEMINI_MODEL, TOKENS_PER_SECOND, friendlyError, watchVideo, youtubeId } from "./ai-bridge/gemini.mjs";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const fmt = (n) => (n === null || n === undefined ? "?" : Number(n).toLocaleString("ko-KR"));

// "1:02:03" / "4:34" → 초
function seconds(d) {
  if (!d) return null;
  return d.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
}

// 유튜브 링크만 받은 경우, 길이·조회수를 유튜브 API로 채운다 (무료, 1점). 키가 없으면 그냥 넘어간다.
async function fillFromYoutube(items) {
  const need = items.filter((v) => youtubeId(v.url) && v.duration === undefined);
  if (!need.length || !process.env.YOUTUBE_API_KEY) return;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("id", need.map((v) => youtubeId(v.url)).join(","));
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  const data = await fetch(url).then((r) => r.json()).catch(() => ({}));
  for (const x of data.items || []) {
    const v = need.find((n) => youtubeId(n.url) === x.id);
    const m = x.contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const [h, mi, s] = [m[1], m[2], m[3]].map((n) => Number(n || 0));
    Object.assign(v, {
      title: x.snippet.title,
      channel: x.snippet.channelTitle,
      published: x.snippet.publishedAt.slice(0, 10),
      views: x.statistics.viewCount === undefined ? null : Number(x.statistics.viewCount),
      duration: h ? `${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mi}:${String(s).padStart(2, "0")}`,
    });
  }
}

// 넣은 것들(JSON 파일, 링크, 영상 파일)을 영상 목록 하나로 모은다.
function collect(inputs) {
  const items = [];
  for (const input of inputs) {
    if (/^https?:\/\//.test(input)) {
      if (!youtubeId(input)) die(`유튜브 링크만 직접 넣을 수 있습니다 (인스타는 영상 파일로 내려받아 넣어주세요): ${input}`);
      items.push({ url: `https://www.youtube.com/watch?v=${youtubeId(input)}` });
      continue;
    }
    const file = path.resolve(ROOT, input);
    if (!fs.existsSync(file)) die(`파일을 찾을 수 없습니다: ${input}`);
    if (file.endsWith(".json")) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      // youtube.mjs 검색 결과는 videos, 채널 결과는 recent_videos, 인스타는 posts(영상 파일이 있는 것만)
      const list = data.videos || data.recent_videos || (data.posts || []).filter((p) => p.video_file).map((p) => ({ ...p, url: p.video_file }));
      if (!list.length) die(`이 JSON 에서 영상 목록을 찾지 못했습니다: ${input}`);
      items.push(...list);
    } else {
      items.push({ url: input, title: path.basename(input) });
    }
  }
  // 같은 영상이 두 번 들어가면 한 번만
  const seen = new Set();
  return items.filter((v) => (seen.has(v.url) ? false : seen.add(v.url)));
}

// 제미나이가 영상마다 채워줄 항목 (구글 시트의 칸이 된다)
const SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "ARRAY", items: { type: "STRING" }, description: "핵심 내용 3줄" },
    hook: { type: "STRING", description: "첫 3초에 나오는 대사와 화면을 그대로" },
    structure: { type: "STRING", description: "구성 흐름을 시간대와 함께 (예: 0:00 훅 → 0:15 문제 제기 → ...)" },
    target: { type: "STRING", description: "누구를 위한 영상인지" },
    visual_style: { type: "STRING", description: "화면 연출: 실사/그래픽, 배경 색, 자막 스타일, 컷 전환 속도" },
    audio: { type: "STRING", description: "목소리(사람/AI, 톤), 배경음악, 효과음" },
    title_pattern: { type: "STRING", description: "제목이 사람을 끄는 방식" },
    why_it_works: { type: "STRING", description: "잘된 이유 또는 안된 이유" },
    takeaways: { type: "ARRAY", items: { type: "STRING" }, description: "내 영상에 따라 할 만한 점" },
    extra: { type: "STRING", description: "추가 질문에 대한 답 (추가 질문이 없으면 빈 문자열)" },
  },
  required: ["summary", "hook", "structure", "target", "visual_style", "audio", "title_pattern", "why_it_works", "takeaways", "extra"],
};

// --mode=blueprint: 내용이 아니라 "뼈대"만 뽑는다. 우리 영상 공장의 장면 종류에 짝지어서 대본 쓰기에 바로 쓴다.
const BLUEPRINT_SCHEMA = {
  type: "OBJECT",
  properties: {
    topic: { type: "STRING", description: "이 영상의 주제 한 줄 (참고용. 우리 영상에 내용을 가져오지 않는다)" },
    hook: { type: "STRING", description: "0~5초: 무슨 말·화면으로 붙잡는지, 그리고 어떤 기법인지 (예: 고백, 반전, 질문, 숫자)" },
    preview: { type: "STRING", description: "30초 안에 '오늘 무엇을 얻는지' 예고하는 방식. 없으면 '없음'" },
    scenes: {
      type: "ARRAY",
      description: "처음부터 끝까지 장면 목록 (화면이나 말의 역할이 바뀌는 곳마다 하나)",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "STRING", description: "시작 시각 (예: 0:15)" },
          seconds: { type: "NUMBER", description: "장면 길이(초)" },
          role: { type: "STRING", description: "이 장면의 역할 (예: 훅, 문제 제기, 경험담, 근거, 비유, 할 일, 행동 요청)" },
          visual: { type: "STRING", description: "화면에 보이는 것 (실사/그래픽/글씨/캐릭터 등)" },
          says: { type: "STRING", description: "말하는 내용의 요약 한 줄 (그대로 받아 적지 말 것)" },
          transition: { type: "STRING", description: "다음 장면으로 넘어가는 방식 (컷, 효과음, 확대 등)" },
          our_scene: { type: "STRING", enum: SCENES_LIST, description: "우리 장면 종류 중 가장 가까운 것" },
        },
        required: ["start", "seconds", "role", "visual", "says", "transition", "our_scene"],
      },
    },
    pacing: { type: "STRING", description: "평균 장면 길이, 말 속도, 긴장을 올리고 내리는 리듬" },
    voice: { type: "STRING", description: "목소리 톤·말투 (사람/AI, 반말/존댓말, 감정)" },
    on_screen_text: { type: "STRING", description: "자막·화면 글씨 스타일 (크기, 강조 방식, 위치)" },
    ending: { type: "STRING", description: "끝맺음과 행동 요청 방식 (댓글 질문, 구독 등)" },
    copy_these: { type: "ARRAY", items: { type: "STRING" }, description: "구조·연출에서 따라 할 만한 점 (내용이 아니라 방법)" },
    extra: { type: "STRING", description: "추가 질문에 대한 답 (추가 질문이 없으면 빈 문자열)" },
  },
  required: ["topic", "hook", "preview", "scenes", "pacing", "voice", "on_screen_text", "ending", "copy_these", "extra"],
};

function blueprintPrompt(v, extra) {
  const facts = [v.title && `제목: ${v.title}`, v.duration && `길이: ${v.duration}`].filter(Boolean).join(", ");
  return `너는 영상 편집 구조를 분석하는 전문가다. 이 영상의 내용이 아니라 "뼈대"(훅, 장면 순서, 장면 길이, 전환, 말투, 화면 글씨)를 한국어로 분석해줘.${facts ? ` (${facts})` : ""}` +
    `\n대사를 그대로 받아 적지 말고 역할과 요약만 적어라. 이 설계도로 전혀 다른 주제의 새 영상을 만든다.` +
    `\n우리 장면 종류: hook(첫 문장들), statement(한 문장 강조), roadmap(순서 예고), chapter(챕터 시작), bigNumber(큰 숫자), citation(연구 출처), compare(좌우 비교), checklist(체크 목록), bars(막대 차트), story(이야기·그림 장면), outro(마무리 질문).` +
    `\n추가 질문: ${extra || "없음"}`;
}

// 설계도 JSON → 사람이 읽는 reference.md
function blueprintMarkdown(row) {
  const b = row.analysis;
  const lines = [
    `# 참고 영상 설계도`,
    ``,
    `- 원본: ${row.title || ""} ${row.url}`,
    `- 분석: ${row.analyzed_at.slice(0, 10)} · ${GEMINI_MODEL}`,
    `- ⚠️ 구조만 참고. 원본의 문장·이야기·화면은 쓰지 않는다`,
    ``,
    `## 원본 주제 (참고용)`, b.topic, ``,
    `## 훅 (0~5초)`, b.hook, ``,
    `## 예고 방식`, b.preview, ``,
    `## 장면 순서`,
    `| 시작 | 초 | 역할 | 화면 | 말 (요약) | 전환 | 우리 장면 |`,
    `|---|---|---|---|---|---|---|`,
    ...b.scenes.map((s) => `| ${[s.start, s.seconds, s.role, s.visual, s.says, s.transition, s.our_scene].map((x) => String(x).replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`),
    ``,
    `## 속도`, b.pacing, ``,
    `## 목소리`, b.voice, ``,
    `## 화면 글씨`, b.on_screen_text, ``,
    `## 끝맺음`, b.ending, ``,
    `## 따라 할 점`, ...b.copy_these.map((x) => `- ${x}`),
  ];
  if (b.extra) lines.push(``, `## 추가 질문 답`, b.extra);
  return lines.join("\n") + "\n";
}

function promptFor(v, extra) {
  const facts = [v.title && `제목: ${v.title}`, v.views != null && `조회수: ${v.views}`, v.duration && `길이: ${v.duration}`].filter(Boolean).join(", ");
  return `너는 유튜브 영상 분석 전문가다. 이 영상을 보고 한국어로 짧고 구체적으로 분석해줘.${facts ? ` (${facts})` : ""}` +
    `\n추가 질문: ${extra || "없음"}`;
}

function load(out) {
  if (!fs.existsSync(out)) return null;
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

function save(out, data) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
}

// ---- 시작 ----
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.length ? v.join("=") : true];
}));
const inputs = argv.filter((a) => !a.startsWith("--"));
const mode = flags.mode || "analysis";
if (!["analysis", "blueprint"].includes(mode)) die("--mode 는 analysis(기본) 또는 blueprint(설계도) 입니다.");
if (!inputs.length) die("분석할 것을 넣어주세요. 예: node tools/video_batch.mjs .tmp/youtube_channel_….json --top=5");

let items = collect(inputs);
await fillFromYoutube(items);

const sort = flags.sort || "views";
if (sort === "views") items.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
else if (sort === "date") items.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
else if (sort !== "as-is") die("--sort 는 views(조회수), date(최신), as-is(넣은 순서) 중 하나입니다.");
if (flags.top) items = items.slice(0, Math.max(1, Number(flags.top) || 1));
if (mode === "blueprint" && items.length !== 1) die(`설계도는 영상 1개씩 만듭니다 (지금 ${items.length}개). --top=1 을 붙이거나 영상 하나만 넣어주세요.`);

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const defaultName = inputs.length === 1 && inputs[0].endsWith(".json") ? path.basename(inputs[0]) : `${stamp}.json`;
const outArg = path.resolve(ROOT, flags.out || path.join(".tmp", `${mode === "blueprint" ? "video_blueprint" : "video_analysis"}_${defaultName.replace(/^youtube_/, "")}`));
const mdOut = mode === "blueprint" && outArg.endsWith(".md") ? outArg : null;
const out = mdOut ? mdOut.replace(/\.md$/, ".json") : outArg;

const previous = load(out);
const done = new Map((previous?.results || []).filter((r) => r.analysis).map((r) => [r.url, r]));
const todo = items.filter((v) => !done.has(v.url));

// 미리보기: 목록·길이·예상 토큰
const clip = flags.clip ? (() => {
  const [a, b] = String(flags.clip).split("-").map(Number);
  if (!(b > a && a >= 0)) die("--clip 은 '시작초-끝초' 입니다. 예: --clip=0-240");
  return { start: a, end: b };
})() : null;
const secs = todo.map((v) => (clip ? Math.min(clip.end, seconds(v.duration) ?? clip.end) - clip.start : seconds(v.duration)));
const known = secs.filter((s) => s !== null);
const totalSec = known.reduce((a, s) => a + s, 0);
console.log(`\n🎬 분석할 영상 ${todo.length}개${done.size ? ` (이미 끝난 ${done.size}개는 건너뜀)` : ""} · 모델 ${GEMINI_MODEL}`);
todo.forEach((v, i) => console.log(`${String(i + 1).padStart(2)}. ${v.title || v.url} · ${v.duration || "길이 모름"} · 조회 ${fmt(v.views)}\n    ${v.url}`));
const mins = Math.round(totalSec / 60);
console.log(`\n⏱  ${clip ? `구간 ${clip.start}~${clip.end}초만 · ` : ""}길이 합계 약 ${mins}분${known.length < todo.length ? ` (길이를 모르는 영상 ${todo.length - known.length}개 제외)` : ""}`);
console.log(`💰 예상 토큰 약 ${fmt(totalSec * TOKENS_PER_SECOND)} (영상 1초 ≈ ${TOKENS_PER_SECOND}토큰, 어림값)`);
console.log(`💾 결과 파일: ${path.relative(ROOT, mdOut || out)}`);

if (!todo.length) {
  // 이미 분석한 설계도는 돈 들이지 않고 .md 만 다시 만든다
  if (mdOut) fs.writeFileSync(mdOut, blueprintMarkdown([...done.values()][0]));
  console.log("\n✅ 새로 분석할 영상이 없습니다.");
  process.exit(0);
}
if (!flags.yes) {
  console.log("\n👀 미리보기만 했습니다 (요금 없음). 실제로 분석하려면 끝에 --yes 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const data = previous || { created_at: new Date().toISOString(), model: GEMINI_MODEL, mode, inputs, results: [] };
data.prompt_extra = flags.prompt || data.prompt_extra || "";
let usedTokens = 0;
let failed = 0;

for (const [i, v] of todo.entries()) {
  process.stdout.write(`\n[${i + 1}/${todo.length}] ${v.title || v.url} … `);
  const row = { ...v, analyzed_at: new Date().toISOString() };
  try {
    let result;
    // 제미나이가 잠깐 붐빌 때(503·429)는 30초 쉬고 한 번 더 해본다. 이 경우 요금은 나가지 않는다.
    for (let attempt = 1; ; attempt++) {
      try {
        const prompt = mode === "blueprint" ? blueprintPrompt(v, flags.prompt) : promptFor(v, flags.prompt);
        result = await watchVideo(v.url, prompt, { clip, schema: mode === "blueprint" ? BLUEPRINT_SCHEMA : SCHEMA, log: (...a) => process.stdout.write(`${a.join(" ")} … `) });
        break;
      } catch (e) {
        if (attempt < 2 && !/limit: 0|PerDay|quota exceeded/i.test(e.message) && /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(e.message)) {
          process.stdout.write("붐벼서 30초 뒤 다시 … ");
          await new Promise((r) => setTimeout(r, 30000));
          continue;
        }
        throw e;
      }
    }
    row.analysis = JSON.parse(result.text);
    row.tokens = result.tokens;
    usedTokens += result.tokens || 0;
    console.log(`완료 (토큰 ${fmt(result.tokens)})`);
    if (mode === "blueprint") {
      console.log(`   훅: ${row.analysis.hook}\n   장면 ${row.analysis.scenes.length}개: ${row.analysis.scenes.map((s) => s.our_scene).join(" → ")}`);
      if (mdOut) fs.writeFileSync(mdOut, blueprintMarkdown(row));
    } else console.log(`   • ${row.analysis.summary.join("\n   • ")}`);
  } catch (e) {
    failed++;
    row.error = friendlyError(e);
    console.log(`실패: ${row.error}`);
  }
  data.results = [...data.results.filter((r) => r.url !== v.url), row];
  data.updated_at = new Date().toISOString();
  save(out, data); // 하나 끝날 때마다 저장 — 중간에 끊겨도 다시 돌리면 이어서 한다
}

console.log(`\n✅ 끝: 성공 ${todo.length - failed}개, 실패 ${failed}개 · 이번에 쓴 토큰 ${fmt(usedTokens)}`);
console.log(`💾 저장: ${path.relative(ROOT, out)}${mdOut ? ` · ${path.relative(ROOT, mdOut)}` : ""}`);
if (failed) console.log("   실패한 영상은 같은 명령으로 다시 돌리면 그것만 다시 시도합니다.");
