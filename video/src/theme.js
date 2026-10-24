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
  key: "#FFD84D", // 자막 속 키워드 색
  band: "#E0242E", // 쇼츠 제목 둘째 줄 띠
  bandRadius: 0,
};

// 편 전체 "skin": 글꼴·색 묶음. 글꼴은 SkinFont 라는 이름으로 불러오고, 없으면 Pretendard (FONT 의 순서)
// cute (2026-10-24, 사장님 참고 쇼츠 https://youtu.be/v9oeGZiRteE): 둥근 글꼴(배민 주아체, OFL) + 크림 배경 + 진한 남색 테두리 + 파스텔 포인트
export const SKINS = {
  cute: {
    font: "fonts/Jua-Regular.ttf",
    colors: { bg: "#FFF7EA", bgDeep: "#F4E7D0", card: "#FFFFFF", ink: "#2B2F4A", inkSoft: "#6B6F86", sage: "#5FB894", sageDeep: "#2F7F63", amber: "#FFE08A", terracotta: "#F2877E", key: "#FFE27A", band: "#F2877E", bandRadius: 22 },
  },
};

// 제목 띠 쇼츠 (episode.json 의 "frame"): 검은 바탕 + 위 2줄 제목(둘째 줄 빨간 띠) — 채널 최고 쇼츠 '뇌를 찍어봤더니' 틀
export const FRAME = {
  bg: "#0B0B0C",
  title: "#FFFFFF",
  red: "#E0242E", // 둘째 줄 띠
  brand: "#E8E4DC",
  boxTop: 640, // 가운데 장면 칸 위치 (1080×1920 기준). 칸 크기는 1080×608 (16:9)
  boost: 1.45, // 가운데 칸 안의 글씨·도형 확대 (가로 장면을 0.56배로 줄여 넣으므로)
  // 진행자(말하는 캐릭터)를 쓰면: 제목을 위로 올리고, 장면 칸 아래 전체를 캐릭터 자리로 (참고 쇼츠: 위 그래픽 + 아래 화자)
  presenterTitleTop: 215, // 안전 영역(y 193~1399, .claude/skills/video-production/safe_zone.md) 안으로
  presenterBoxTop: 500,
  presenterScale: 1.0, // 캐릭터 크기 (그림 900×1100 기준)
  // 가로 롱폼: 오른쪽 띠에 캐릭터, 장면은 왼쪽으로 (손짓 '가리키기'는 장면 쪽으로 팔이 들어감)
  longPresenterWidth: 440,
  longPresenterTop: 250,
  longPresenterScale: 0.75,
};

// 사주 설명 장면 (pillars·elements): 오행 다섯 색 — 채널 톤에 맞춰 채도를 낮춤
export const ELEMENTS = {
  wood: { name: "나무", emoji: "🌳", hanja: "木", color: "#6E9A63" },
  fire: { name: "불", emoji: "🔥", hanja: "火", color: "#D9714F" },
  earth: { name: "흙", emoji: "⛰️", hanja: "土", color: "#C9A25A" },
  metal: { name: "쇠", emoji: "⚙️", hanja: "金", color: "#9A9A94" },
  water: { name: "물", emoji: "💧", hanja: "水", color: "#4C7DA8" },
};

// 쇼츠·릴스 안전 영역 (1080×1920): 글씨·자막·제목·캐릭터 얼굴은 이 안에만 — 사장님 기준 그림 (2026-10-22)
export const SAFE = { left: 51, top: 193, right: 1029, bottom: 1399 };

export const FONT = "SkinFont, Pretendard";

export const FPS = 30;
export const TRANSITION_FRAMES = 12; // 장면 사이 전환 0.4초
export const SCENE_PAD_FRAMES = 18; // 목소리가 끝난 뒤 0.6초 여유 (전환보다 길어야 소리가 안 겹침)
export const CHARS_PER_SECOND = 7; // 목소리가 없을 때 길이 어림 (차분한 한국어 낭독 속도)

export const SIZES = {
  long: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
};
