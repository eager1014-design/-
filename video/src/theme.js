// 채널 "예민한자립가" 디자인 규칙. 예민한 사람에게 편안한 크림·세이지 톤.
// 색을 바꾸고 싶으면 여기만 바꾸면 모든 장면에 적용된다.
export const COLORS = {
  bg: "#F6F1E7", // 크림 배경
  bgDeep: "#ECE4D3", // 카드 그림자·구분선
  card: "#FFFDF8", // 카드 바탕
  ink: "#2B2A28", // 본문 글자
  inkSoft: "#6B665C", // 보조 글자
  sage: "#7C9A7E", // 채널 대표색
  sageDeep: "#4F6B53", // 진한 세이지 (번호·강조 제목)
  amber: "#E9B860", // 형광펜 강조 (기존 영상의 노란 강조를 부드럽게)
  terracotta: "#C8745A", // 경고·대비 (나쁜 환경, 하지 말 것)
};

export const FONT = "Pretendard";

export const FPS = 30;
export const TRANSITION_FRAMES = 12; // 장면 사이 전환 0.4초
export const SCENE_PAD_FRAMES = 18; // 목소리가 끝난 뒤 0.6초 여유 (전환보다 길어야 소리가 안 겹침)
export const CHARS_PER_SECOND = 7; // 목소리가 없을 때 길이 어림 (차분한 한국어 낭독 속도)

export const SIZES = {
  long: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
};
