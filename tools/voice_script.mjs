// 일레븐랩스에 붙여넣는 녹음 대본 (2026-11-02 사장님 예시 형식): 문단 하나 = 장면 하나, 말투가 바뀌는 문단 앞에만 [curious] 같은 태그, 쉬는 곳은 [short pause].
// 태그는 녹음용으로만 붙인다 — 자막·장면 자르기는 태그 없는 narration 을 쓴다.
export const VOICE_TAGS = ["curious", "explaining", "thoughtful", "encouraging", "serious", "reassuring", "guiding", "lighthearted", "warm", "upbeat", "questioning", "friendly"];
const LIMIT = 5000; // 일레븐랩스 한 번에 넣을 수 있는 글자 수

export const stripVoiceTags = (text) => String(text || "").replace(/\[[a-z ]+\]\s*/gi, "").trim();

// 대본 작가에게 주는 규칙 (영상 만들기 대본 공통)
export const VOICE_RULE = `[일레븐랩스 녹음 규칙 — 대본을 그대로 붙여넣어 녹음함]
- 장면에 "voiceTag": 말투가 바뀌는 장면에만 ${VOICE_TAGS.join("·")} 중 하나. 매 장면 붙이지 말 것(같은 말투가 이어지면 생략). narration 안에는 대괄호 태그를 쓰지 말 것.
- 큰 흐름이 바뀌는 장면(chapter 의 시작, 가장 중요한 문장 앞)은 "pauseBefore" 로 표시 — 녹음 대본에 [short pause] 로 들어감.
- 읽는 그대로 쓸 것: 숫자는 한글("칠백쉰여덟 명", "사십삼 퍼센트"), 영어 약자도 소리대로("에이 태그", "엘아이"). 괄호·별표·제목·번호 표시 금지.
- 연구를 말할 땐 한계도 한 문장으로("소규모 연구라 모두의 모습이라고 할 순 없어요"), 내 해석은 연구와 구분해서 말할 것("여기부터는 제 해석이에요").`;

// 장면들 → 문단 목록
function paragraphs(scenes) {
  return (scenes || []).filter((s) => s.narration?.trim()).map((s) => {
    const pause = s.pauseBefore || s.type === "chapter" ? "[short pause] " : "";
    const tag = VOICE_TAGS.includes(s.voiceTag) ? `[${s.voiceTag}] ` : "";
    return `${pause}${tag}${stripVoiceTags(s.narration)}`;
  });
}

export const voiceScript = (scenes) => paragraphs(scenes).join("\n\n");

// 5,000자를 넘으면 문단 경계에서 나눠 파트별로 붙여넣게 한다. 파트 첫 문단엔 그때까지의 말투 태그가 없을 수 있어도 문장은 안 끊긴다
export function voiceParts(scenes) {
  const parts = [];
  let cur = "";
  for (const para of paragraphs(scenes)) {
    if (cur && cur.length + para.length + 2 > LIMIT) { parts.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) parts.push(cur);
  return parts;
}
