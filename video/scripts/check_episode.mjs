// 대본(episode.json) 검사: 장면 종류, 화면 요소의 등장 시점 단어(cue)가 내레이션에 실제로 있는지, 예상 길이.
// 사용법: node scripts/check_episode.mjs public/episodes/<편>/episode.json
import fs from "node:fs";
import { SCENES_LIST } from "./scene-types.mjs";
import { sceneFrames, totalFrames, voiceSeconds } from "../src/timing.js";
import { FPS } from "../src/theme.js";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("\n❌ 대본 파일을 넣어주세요. 예: node scripts/check_episode.mjs public/episodes/ep01/episode.json\n");
  process.exit(1);
}
const ep = JSON.parse(fs.readFileSync(file, "utf8"));
const problems = [];
const cuesOf = (s) => {
  const out = [];
  const visit = (x) => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) (/cue$/i.test(k) && typeof v === "string" ? out.push(v) : visit(v));
  };
  visit(s);
  return out;
};
ep.scenes.forEach((s, i) => {
  const where = `${s.id || `장면 ${i + 1}`}`;
  if (!SCENES_LIST.includes(s.type)) problems.push(`${where}: 모르는 장면 종류 "${s.type}"`);
  if (!s.narration?.trim()) problems.push(`${where}: 내레이션이 비어 있음`);
  for (const d of [].concat(s.musicDrop || [])) for (const c of [d.at, d.until].filter(Boolean)) if (!(s.narration || "").includes(c)) problems.push(`${where}: 음악 연출 단어 "${c}" 가 내레이션에 없음`);
  for (const c of cuesOf(s)) if (!(s.narration || "").includes(c)) problems.push(`${where}: 등장 단어 "${c}" 가 내레이션에 없음`);
  // 첫 화면 요소가 너무 늦게 나오면 화면이 비어 보인다 (제목·머리글이 처음부터 있으면 괜찮음)
  const always = s.kicker || s.title || ["chapter", "story"].includes(s.type) && (s.emoji || s.image || s.video);
  const cues = cuesOf(s).map((c) => (s.narration || "").indexOf(c)).filter((x) => x >= 0);
  if (!always && cues.length) {
    const before = (s.narration || "").slice(0, Math.min(...cues)).replace(/\s/g, "").length;
    const plain = (s.narration || "").replace(/\s/g, "").length || 1;
    const wait = (before / plain) * voiceSeconds(s);
    if (wait > 2.5) problems.push(`${where}: 첫 화면 요소가 ${wait.toFixed(1)}초 뒤에 나와 화면이 비어 보임 → kicker(머리글)를 넣거나 cue 를 앞 단어로`);
  }
  // 말하는 캐릭터: 표정·손짓 이름과 바뀌는 단어 확인
  for (const [k, dir] of [["face", "faces"], ["gesture", "poses"]]) {
    const v = s[k];
    if (!v) continue;
    for (const x of typeof v === "string" ? [{ is: v }] : v) {
      if (x.at && !(s.narration || "").includes(x.at)) problems.push(`${where}: ${k} 바뀌는 단어 "${x.at}" 가 내레이션에 없음`);
      if (x.is !== "none" && !fs.existsSync(new URL(`../public/characters/main/${dir}/${x.is}.png`, import.meta.url))) problems.push(`${where}: ${k} "${x.is}" 그림이 없음 (characters/main/${dir}/)`);
    }
  }
  for (const c of typeof s.cast === "string" ? [{ pos: s.cast }] : s.cast || []) {
    if (c.at && !(s.narration || "").includes(c.at)) problems.push(`${where}: cast 바뀌는 단어 "${c.at}" 가 내레이션에 없음`);
    if (!["right", "left", "center", "corner", "off"].includes(c.pos)) problems.push(`${where}: cast 자리 "${c.pos}" 를 모름 (right·left·center·corner·off)`);
  }
  for (const c of s.comments || []) {
    if (c.at && !(s.narration || "").includes(c.at)) problems.push(`${where}: 댓글 나타나는 단어 "${c.at}" 가 내레이션에 없음`);
    if ((c.text || "").length > 24) problems.push(`${where}: 댓글 "${c.text}" 이 너무 김 (24자 이내)`);
  }
  if (s.audio && !fs.existsSync(new URL(`../public/${s.audio}`, import.meta.url))) problems.push(`${where}: 목소리 파일 없음 (${s.audio})`);
});
// 제목 띠 쇼츠: 위 제목은 2줄, 한 줄 14자 이내 (넘으면 화면 밖으로 나감)
if (ep.frame) {
  const t = ep.frame.title || [];
  if (ep.format !== "short") problems.push(`frame(제목 띠)은 세로 쇼츠 전용 → "format": "short" 로`);
  if (t.length !== 2) problems.push(`frame.title 은 2줄이어야 함 (지금 ${t.length}줄)`);
  t.forEach((l, i) => l.length > 14 && problems.push(`frame.title ${i + 1}째 줄 "${l}" 이 ${l.length}자 → 14자 이내로`));
}
const secs = totalFrames(ep.scenes) / FPS;
const voiced = ep.scenes.filter((s) => s.audioDuration).length;
console.log(`\n🎬 ${ep.title}`);
console.log(`   장면 ${ep.scenes.length}개 · 예상 길이 ${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초 · 목소리 완성 ${voiced}/${ep.scenes.length}${voiced < ep.scenes.length ? " (나머지는 글자 수로 어림)" : ""}`);
const chars = ep.scenes.reduce((a, s) => a + (s.narration || "").length, 0);
console.log(`   내레이션 ${chars.toLocaleString("ko-KR")}자`);
if (problems.length) {
  console.log(`\n⚠️  고칠 것 ${problems.length}개:`);
  problems.forEach((p) => console.log(`   - ${p}`));
  process.exit(1);
}
console.log("\n✅ 문제 없음");
