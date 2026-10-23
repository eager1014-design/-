// 아이디어 검증 (2026-10-24 사장님 요청): 부업·사업 영상/글 링크 → 제미나이가 주장·숫자·과장을 뽑고, 사장님이 이미 가진 것에 비춰 판정 → "이번 주 2시간 실험 1개" + 접기 기준.
// 아이디어를 모으는 곳이 아니라 거르는 곳. 진행 중인 실험이 있으면 새 검증을 막는다 (하나씩 끝내기).
// 저장: library.json 의 ideas (깃에 안 올라감)
import { GEMINI_MODEL, load, save } from "./core.mjs";
import { gemini, watchVideo } from "../ai-bridge/gemini.mjs";

// 사장님이 지금 가진 것 — 판정 기준. 새로 만든 게 생기면 여기에 한 줄 추가
const OWNER = `[사장님 상황]
- 코드를 직접 쓰지 않는 1인 사업가. 맥북 + AI(클로드 코드, 챗GPT 구독, 제미나이 무료 한도, 일레븐랩스 복제 목소리)로 만든다. 돈 드는 건 무료부터.
- 이미 만들어 돌리는 것: 사주 상담 웹사이트 '운결'(신청→AI 풀이→PDF→메일), 사업 지출 관리(메일·사진 영수증 → 구글 시트), 스레드 홍보 글 매일 후보, 유튜브 '예민한자립가' 매일 쇼츠 자동 제작, 떡상 콘텐츠 리서치 앱.
- 새로 시작한 일: 동네 가게 사장님 업무 자동화 대행('워크플로우 디자이너'). 명함·포트폴리오·고충 접수 폼 준비됨, 첫 손님은 아직 없음. 처음 3곳은 무료·저가로 진짜 후기 받기.
- 원칙: 이미 있는 프로그램(캐시노트 등)과 경쟁하지 않고 그 틈만. 가짜 후기·과장 광고 금지.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "영상/글 제목" },
    speaker: { type: "string", description: "화자·채널" },
    summary: { type: "array", items: { type: "string" }, description: "핵심 주장 3줄" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          how: { type: "string", description: "어떻게 돈을 버는지 한두 문장" },
          numbers: { type: "string", description: "영상에서 말한 숫자 그대로. 없으면 빈 문자열" },
          doubt: { type: "string", description: "과장·확인 불가·빠진 비용이나 위험. 없으면 빈 문자열" },
          fit: { type: "string", enum: ["이미 하는 중", "바로 가능", "준비 필요", "안 맞음"] },
          fit_reason: { type: "string", description: "사장님 상황에 비춘 이유 한 문장" },
        },
        required: ["name", "how", "numbers", "doubt", "fit", "fit_reason"],
      },
    },
    experiment: {
      type: "object",
      properties: {
        what: { type: "string", description: "이번 주 2시간 안에 할 실험 한 문장" },
        steps: { type: "array", items: { type: "string" }, description: "3단계 이내" },
        success: { type: "string", description: "이렇게 되면 계속 (숫자로)" },
        kill: { type: "string", description: "이렇게 되면 접기 (숫자로)" },
      },
      required: ["what", "steps", "success", "kill"],
    },
  },
  required: ["title", "summary", "ideas", "experiment"],
};

const prompt = (note) => `너는 냉정한 사업 검토자야. 아래 콘텐츠가 소개하는 돈 버는 방법을 한국어로 정리하고, 사장님 상황에 비춰 판정해.
- 숫자는 콘텐츠에서 말한 그대로만. 없는 내용은 지어내지 마.
- doubt 에는 본인 말뿐인 수익, 생존자 편향, 빠진 비용·시간·법적 위험을 구체적으로. 듣기 좋은 말 금지.
- fit: 사장님이 이미 하는 일이면 "이미 하는 중", 지금 가진 것으로 이번 주에 해볼 수 있으면 "바로 가능", 배우거나 돈이 더 들면 "준비 필요", 시간 대비 안 맞으면 "안 맞음".
- experiment 는 딱 1개. '바로 가능'이나 '이미 하는 중' 중 사장님에게 가장 돈에 가까운 것으로. 2시간 안에 끝나고, 결과가 숫자로 나와야 한다(예: 3곳 중 2곳이 관심). 만들기보다 진짜 손님 반응을 먼저 보는 실험을 우선.
${OWNER}${note ? `\n\n[사장님 메모 / 붙여넣은 글]\n${note.slice(0, 8000)}` : ""}`;

// 제미나이가 붐비면(503) 잠시 쉬고 다시 (2026-10-24, 몇 분씩 붐볐음)
async function retry(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !/503|UNAVAILABLE|high demand|overloaded/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

export function listIdeas() {
  return (load().ideas || []).slice().reverse();
}

export async function verifyIdea({ url = "", note = "" }) {
  url = url.trim(); note = note.trim();
  if (!url && !note) throw new Error("링크를 넣거나 글을 붙여넣어주세요.");
  const running = (load().ideas || []).find((x) => x.status === "실험 중");
  if (running) throw new Error(`진행 중인 실험이 있어요: "${running.result.experiment.what}" — 결과(효과 있음 / 접음)를 먼저 적어주세요.`);
  const youtube = /youtu\.?be/.test(url);
  if (url && !youtube && !note) throw new Error("유튜브가 아닌 링크는 내용을 직접 못 봅니다. 글이나 자막을 아래 칸에 붙여넣어주세요.");
  const r = await retry(async () => {
    if (youtube) return watchVideo(url, prompt(note), { schema: SCHEMA });
    const res = await gemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt(note) + (url ? `\n\n[링크] ${url}` : "") }] }],
      config: { responseMimeType: "application/json", responseSchema: SCHEMA },
    });
    return { text: res.text ?? "", tokens: res.usageMetadata?.totalTokenCount ?? null };
  });
  let result;
  try { result = JSON.parse(r.text); } catch { throw new Error("제미나이 답을 읽지 못했어요. 다시 눌러주세요."); }
  const db = load();
  const idea = { id: "i" + Date.now(), url, note, at: new Date().toISOString(), status: "검증됨", outcome: "", result, tokens: r.tokens };
  (db.ideas ||= []).push(idea);
  save(db);
  return idea;
}

// 검증됨 → 실험 중 → 효과 있음 / 접음 (outcome = 결과 메모)
export function setIdea(id, { status, outcome }) {
  const db = load();
  const idea = (db.ideas || []).find((x) => x.id === id);
  if (!idea) throw new Error("없는 항목입니다.");
  if (status === "실험 중" && db.ideas.some((x) => x.status === "실험 중" && x.id !== id)) throw new Error("실험은 한 번에 하나만. 진행 중인 실험을 먼저 끝내주세요.");
  if (["검증됨", "실험 중", "효과 있음", "접음"].includes(status)) idea.status = status;
  if (outcome != null) idea.outcome = String(outcome).slice(0, 2000);
  if (status === "실험 중") idea.startedAt = new Date().toISOString();
  if (["효과 있음", "접음"].includes(status)) idea.endedAt = new Date().toISOString();
  save(db);
  return idea;
}

export function deleteIdea(id) {
  const db = load();
  db.ideas = (db.ideas || []).filter((x) => x.id !== id);
  save(db);
}
