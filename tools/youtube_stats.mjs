// 내 채널 영상 성적표 (YouTube Analytics, 무료) — 노출수·클릭률·조회수·평균 시청 비율·구독 증가를 영상마다.
// 2026-10-30 사장님: "롱폼 클릭률이 너무 안 좋다, 분석해 줘" — 스튜디오 화면을 하나씩 캡처하지 않고 숫자를 한 번에.
// 준비: node tools/youtube_upload.mjs login 을 한 번 더 (분석 읽기 권한 추가됨)
//
// 사용법: node tools/youtube_stats.mjs [일수=30]   → 화면 표 + .tmp/youtube_stats.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken } from "./youtube_upload.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const days = Number(process.argv[2]) || 30;
const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

const H = { Authorization: `Bearer ${await accessToken()}` };
async function get(url) {
  const r = await fetch(url, { headers: H });
  const j = await r.json();
  if (!r.ok) {
    const why = j.error?.message || r.status;
    if (/has not been used|disabled/i.test(why)) throw new Error(`구글 클라우드에서 'YouTube Analytics API' 를 켜야 해요: ${why}`);
    if (r.status === 403 || r.status === 401) throw new Error(`분석 권한이 없는 예전 열쇠예요 — node tools/youtube_upload.mjs login 으로 다시 로그인: ${why}`);
    throw new Error(String(why));
  }
  return j;
}

// 영상마다 지표 (노출·클릭률은 지원 안 되는 계정이면 그 두 칸만 빈칸)
async function report(metrics) {
  const q = new URLSearchParams({ ids: "channel==MINE", startDate: day(days), endDate: day(0), dimensions: "video", metrics: metrics.join(","), sort: `-${metrics[0]}`, maxResults: "50" });
  const j = await get(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`);
  const cols = j.columnHeaders.map((c) => c.name);
  return Object.fromEntries((j.rows || []).map((r) => [r[0], Object.fromEntries(cols.slice(1).map((c, i) => [c, r[i + 1]]))]));
}
const base = await report(["views", "averageViewPercentage", "averageViewDuration", "subscribersGained", "likes"]);
let reach = {};
try {
  reach = await report(["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"]);
} catch (e) {
  console.log(`(노출수·클릭률은 못 가져옴: ${e.message.slice(0, 150)})`);
}

const ids = [...new Set([...Object.keys(base), ...Object.keys(reach)])];
const info = {};
for (let i = 0; i < ids.length; i += 50) {
  const v = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(",")}`);
  for (const x of v.items) info[x.id] = { title: x.snippet.title, published: x.snippet.publishedAt.slice(0, 10), duration: x.contentDetails.duration };
}
const secs = (d) => { const m = String(d).match(/(?:(\d+)M)?(?:(\d+)S)?$/); return (+m?.[1] || 0) * 60 + (+m?.[2] || 0); };
const rows = ids.map((id) => ({ id, ...info[id], kind: secs(info[id]?.duration) > 180 ? "롱폼" : "숏폼", ...base[id], ...reach[id] }))
  .sort((a, b) => (a.kind === b.kind ? (b.views || 0) - (a.views || 0) : a.kind === "롱폼" ? -1 : 1));

console.log(`\n📊 최근 ${days}일 영상 성적 (${day(days)} ~ ${day(0)})\n`);
console.log("종류 | 올린 날 | 노출 | 클릭률 | 조회 | 평균 시청 | 구독+ | 제목");
for (const r of rows) {
  const ctr = r.videoThumbnailImpressionsClickRate;
  console.log([r.kind, r.published, r.videoThumbnailImpressions ?? "-", ctr != null ? `${(ctr * (ctr < 1 ? 100 : 1)).toFixed(1)}%` : "-", r.views ?? 0,
    r.averageViewPercentage != null ? `${r.averageViewPercentage.toFixed(0)}%(${Math.round(r.averageViewDuration)}초)` : "-", r.subscribersGained ?? 0, (r.title || r.id).slice(0, 40)].join(" | "));
}
fs.mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".tmp/youtube_stats.json"), JSON.stringify({ from: day(days), to: day(0), rows }, null, 2));
console.log("\n💾 .tmp/youtube_stats.json");
