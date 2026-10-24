// 소리·자막 원칙 (2026-10-24, 사장님이 Vrew 에 쓰던 프롬프트를 영상 공장 규칙으로 옮김) — 매일 쇼츠(daily_short)·영상 만들기(longform)가 같이 쓴다.
// 대본 작가(클로드)에게 주는 규칙 글 + 대본의 music_plan(분위기 구간)을 실제 곡 파일로 바꾸는 함수.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MUSIC_INDEX = path.join(ROOT, "video/public/music/index.json");

export const SOUND_RULES = (sections) => `[소리·강조 자막 원칙 — 꼭 지킬 것]
1) 효과음: 장면마다 "sfx": [{"name": "이름", "cue": "그 장면 내레이션 속 단어"}] 로 0~1개(한 문장에 최대 1개), 영상 전체로는 2~4초에 하나꼴.
   cue 는 문장 첫 단어(문장 시작 직전에 울림)로. 같은 소리를 세 번 넘게 쓰지 말 것.
   - 질문·호기심·반전: thud(쿵) · drum(쿠궁) · heartbeat(심장)
   - 숫자·결론·핵심: thud(쿵) · camera(찰칵) · ding(띵)
   - 장면·문맥 전환: whoosh(휘익) · swipe(슉) · pageturn(스윽)
   - 희망·다짐·긍정 전환: ding(띵) · correct(띵동) · sparkle(반짝) · bell(띵)
   - 그 밖에: scratch(반전 직전 긁힘) · gasp(헉) · sigh(한숨) · tick(째깍) · notification(알림) · typing(타자)
2) 감정 구간: 이혼·약·바닥·부모님·고백 이야기를 하는 장면은 "emotion": true 로 표시 → 효과음·강조 색이 자동으로 빠지고 음악이 낮아짐. 여기엔 sfx·punch 넣지 말 것.
   그중 가장 무거운 고백 한 문장은 "musicMute": true (음악 완전히 멈춤).
3) 가장 중요한 문장(영상에 1~2개)의 장면에는 "pauseBefore": 0.7 → 그 앞에 0.7초 무음.
4) 강조 자막: 5초 구간마다 가장 중요한 말 하나를 골라 그 장면에 "punch": [{"text": "핵심 2~8자, 강조 단어는 **두 별표**", "at": "그 장면 내레이션 속 단어", "kind": "number|turn|hope|question|emotion"}].
   중요도: 숫자·사실(number) > 감정의 핵심 단어 > 반전·깨달음(turn) > 다짐(hope)·질문(question). 감정 구간이면 kind "emotion"(색 없음). 강조할 게 없으면 넣지 말 것.
   hook·statement·bigNumber·chapter·outro·shrink 처럼 이미 큰 글씨가 나오는 장면에는 punch 를 넣지 말 것 (겹침). 효과음·움직임은 kind 에 맞춰 자동.
5) 배경음악: "music_plan": [{"from": "장면 id", "mood": "분위기"}] 로 흐름마다 곡을 바꿈 (${sections}). 바뀌는 곳은 1.5초 자동 페이드.
   분위기: tense(긴장감 있는 잔잔한 비트 — 오프닝·훅) · sad(느린 피아노·앰비언트 — 과거 고백) · playful(밝아지는 비트 — 깨달음·전환) · hopeful(따뜻한 희망 — 다짐·마무리) · calm(잔잔).
6) 자막은 자동(한 줄 15자, 흰 글씨+검은 테두리, 말하는 순간에 맞춤) — 따로 쓸 것 없음.`;

// music_plan [{from, mood}] → musicSections [{from, file}] (분위기마다 곡 하나, 최근 쓴 곡·같은 편 안 중복은 피함)
export function pickSections(plan = [], scenes = [], recent = [], seed = 0) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(MUSIC_INDEX, "utf8")); } catch {}
  if (!list.length) return [];
  const ids = new Set(scenes.map((s) => s.id));
  const used = new Set();
  const out = [];
  for (const [i, p] of (plan.length ? plan : [{ from: scenes[0]?.id, mood: "calm" }]).entries()) {
    if (!ids.has(p.from)) continue;
    const fresh = (m) => !used.has(m.file) && !recent.includes(m.file);
    const pool = [list.filter((m) => m.mood === p.mood && fresh(m)), list.filter((m) => m.mood === p.mood && !used.has(m.file)), list.filter(fresh), list].find((x) => x.length);
    const pick = pool[(seed + i) % pool.length];
    used.add(pick.file);
    out.push({ from: p.from, file: pick.file, mood: p.mood });
  }
  return out;
}
