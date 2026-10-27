// 고정 댓글 사주(운결) 추천 — 모든 영상에 빠짐없이 (2026-10-26 사장님: "고정댓글에 사주 한번 보라는 추천 꼭", "영상마다 그 이야기는 빼먹지 말고")
// 영상 만들기(tools/viral/longform.mjs)와 매일 쇼츠(tools/daily_short.mjs)가 같이 쓴다.
// 대본 작가(클로드)에게 주는 규칙 + 클로드가 빼먹어도 프로그램이 링크·채널 링크 안내를 반드시 붙이는 함수.
export const SAJU_LINK = "https://ai-production-1a94.up.railway.app/?src=youtube";
const CHANNEL_LINE = "(채널 프로필 링크에도 '운결'로 걸어 뒀어요)";

export const PINNED_ASK = `채널 주인이 다는 고정 댓글 4~6줄: ① 영상 핵심 한 줄 ② 시청자에게 묻는 질문 ③ 반드시 사주 추천 — 영상 주제와 이어서 '내 사주로 나에게 맞는 ○○도 볼 수 있다'는 식으로 자연스럽게, 운결(생년월일만 넣으면 성향 무료 보기) 링크 ${SAJU_LINK} 그대로 + 채널 프로필 링크에도 운결이 있다는 한 줄. 사주를 과학·연구처럼 말하지 말 것, 과장·가짜 후기 금지, 이모지 2~3개`;

export function withSaju(text = "") {
  let t = String(text).trim();
  if (!t.includes(SAJU_LINK)) t = `${t}\n\n🔮 내 기질이 궁금하다면, 사주로도 한번 봐 보세요. 생년월일만 넣으면 성향은 무료로 바로 보여드려요.\n👉 ${SAJU_LINK}`.trim();
  if (!/채널.{0,12}(프로필|링크)/.test(t)) t = `${t}\n${CHANNEL_LINE}`;
  return t;
}

// 영상 마지막 말 (2026-10-27 사장님: "기질을 파악해보고 싶으시면 한번 보셔요 — 이런 말을 모든 영상 마지막에 꼭"):
// 마지막 장면 내레이션에 '고정 댓글' 안내가 없으면 이 문장을 붙인다. 녹음 전 대본 단계에서 붙으므로 목소리에도 들어간다.
export const SAJU_OUTRO_LINE = "내 기질이 궁금하시면, 사주로 성향 보는 링크를 고정 댓글에 달아 뒀어요. 한번 보세요.";
export const OUTRO_ASK = `[영상 마지막 말 — 모든 영상에 꼭] 마지막 장면 내레이션 끝에 "기질이 궁금하면 고정 댓글에 사주로 성향 보는 링크를 달아 뒀다, 한번 보시라"는 말을 영상 흐름에 맞게 한 문장으로 (예: "${SAJU_OUTRO_LINE}"). 빠지면 프로그램이 위 예시 문장을 그대로 붙인다.`;
export function ensureSajuOutro(ep) {
  const last = ep?.scenes?.at(-1);
  if (!last) return ep;
  if (!/고정\s*댓글/.test(last.narration || "")) last.narration = `${String(last.narration || "").trim()} ${SAJU_OUTRO_LINE}`.trim();
  if (last.type === "outro") last.channel = "내 기질 무료로 보기 → 고정 댓글";
  return ep;
}
