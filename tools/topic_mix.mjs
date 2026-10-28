// 주제 폭넓게 돌리기 (2026-10-26 사장님: "계속 비슷한 주제(연락 빈도 등)로 만들어진다, 폭넓게") —
// 매일 쇼츠(tools/daily_short.mjs)와 영상 만들기(tools/viral/longform.mjs)가 같이 쓴다.
// 주제 '영역'을 돌려 가며 고르고(최근에 쓴 영역은 건너뜀), 최근 만든 영상 제목을 대본 작가에게 보여줘 겹치지 않게 한다.
// 떡상 틀(정체성 호출·위험 신호·반전·숫자 리스트)은 어느 영역에나 씌울 수 있는 '말하는 방식'으로만 쓴다.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./viral/core.mjs";

export const TOPIC_AREAS = [
  { key: "relation", name: "인간관계·손절", ex: "호의를 권리로 아는 사람, 가스라이팅 말버릇" },
  { key: "love", name: "연애·이별", ex: "회피형이 마음 열 때 하는 행동, 이별 후 뇌에서 일어나는 일" },
  { key: "work", name: "직장·일", ex: "회의에서 말 못 하는 사람의 진짜 이유, 맞는 일의 조건" },
  { key: "money", name: "돈·소비 심리", ex: "할부 안 하는 사람의 심리, 스트레스 받으면 쇼핑하는 이유" },
  { key: "saju", name: "사주·오행", ex: "일간별 성격·연애 스타일, 올해 조심할 인연" },
  { key: "people", name: "철학자·심리학자·위인", ex: "쇼펜하우어·칼 융·에픽테토스·반 고흐 한 명" },
  { key: "brain", name: "뇌·몸과 마음", ex: "잠 못 드는 밤 뇌의 상태, 뇌가 미루기를 좋아하는 이유" },
  { key: "habit", name: "습관·일상 행동 심리", ex: "약속 시간 늘 일찍 가는 사람, 혼잣말하는 사람" },
  { key: "family", name: "가족·어린 시절", ex: "맏이로 자란 사람 특징, 부모님 말 한마디가 오래 남는 이유" },
  { key: "growth", name: "자존감·다시 일어서기", ex: "바닥에서 다시 시작할 때 버리는 것 3가지" },
  { key: "experiment", name: "유명한 심리 실험", ex: "마시멜로 실험의 반전, 방관자 효과" },
];

// 최근 만든 영상(매일 쇼츠 + 영상 만들기) 제목·영역, 새것부터
export function recentVideos(limit = 14) {
  const read = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } }).filter(Boolean) : []);
  const daily = read(path.join(DATA_DIR, "daily")).filter((d) => d.idea).map((d) => ({ at: d.date, title: d.idea.title, area: d.area }));
  const long = read(path.join(DATA_DIR, "longform")).filter((p) => p.plan || p.episode).map((p) => ({ at: (p.createdAt || "").slice(0, 10), title: p.plan?.titles?.[0] || p.title, area: p.area }));
  return [...daily, ...long].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, limit);
}

// 오늘의 영역: 최근 영상에서 안 쓴 영역 중 날짜로 돌려 고른다 (전부 썼으면 가장 오래전에 쓴 것)
export function pickArea(seed = 0, skip = []) {
  const recent = recentVideos(TOPIC_AREAS.length - 1).map((v) => v.area).filter(Boolean);
  const free = TOPIC_AREAS.filter((a) => !recent.includes(a.key) && !skip.includes(a.key));
  const pool = free.length ? free : TOPIC_AREAS;
  return pool[Math.abs(seed) % pool.length];
}

export const recentList = (exceptTitle) => recentVideos().filter((v) => v.title !== exceptTitle).map((v) => `- ${v.at}: ${v.title}`).join("\n") || "(없음)";

export const AREA_LIST = TOPIC_AREAS.map((a) => `${a.key}=${a.name}`).join(" · ");
