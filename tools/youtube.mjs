// 유튜브 검색·채널 분석 Tool (YouTube Data API v3, 무료 한도 안에서 동작).
// 키는 프로젝트 맨 위 폴더의 .env 의 YOUTUBE_API_KEY 에서만 읽는다. 이 파일에 키를 적지 말 것.
//
// 사용법:
//   node tools/youtube.mjs search "검색어" [개수=10] [--order=relevance|views|date]
//   node tools/youtube.mjs channel "@채널핸들 | 채널 링크 | UC로 시작하는 채널ID" [최근영상수=10]
//
// 한도: 하루 10,000점. search = 101점, channel = 약 3점(핸들/ID로 찾을 때). 넘어도 요금은 안 나간다.
// 결과: 화면 표 + .tmp/youtube_<종류>_<시각>.json (구글 시트 Tool이 가져다 씀)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

const API = "https://www.googleapis.com/youtube/v3";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function key() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) {
    die("유튜브 키가 없습니다. .env 파일의 YOUTUBE_API_KEY= 뒤에 키를 붙여넣고 저장해주세요.\n" +
        "   키 만드는 곳: https://console.cloud.google.com/apis/credentials");
  }
  return k;
}

async function call(endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set("key", key());
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const reason = data?.error?.errors?.[0]?.reason || data?.error?.details?.[0]?.reason || "";
  const msg = data?.error?.message || res.statusText;
  if (/quotaExceeded|dailyLimitExceeded/.test(reason)) die("오늘 유튜브 무료 한도를 다 썼습니다. 한국 시간 오후 4~5시쯤(미국 자정) 다시 채워집니다. 요금은 나가지 않습니다.");
  if (/keyInvalid|API_KEY_INVALID/.test(reason) || /API key not valid/i.test(msg)) die("유튜브 키가 틀렸습니다. .env 의 YOUTUBE_API_KEY 를 다시 복사해 넣어주세요 (앞뒤 공백 주의).");
  if (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used|is disabled/i.test(msg)) die("이 키의 구글 프로젝트에서 'YouTube Data API v3' 가 꺼져 있습니다. https://console.cloud.google.com/apis/library/youtube.googleapis.com 에서 '사용' 을 눌러주세요 (켠 뒤 1~2분 걸릴 수 있음).");
  if (/API_KEY_SERVICE_BLOCKED|forbidden/i.test(reason)) die("이 키에 유튜브 사용 권한이 없습니다. 키 설정의 'API 제한' 에 YouTube Data API v3 를 추가해주세요.");
  die(`유튜브가 요청을 거절했습니다 (${res.status} ${reason}): ${msg}`);
}

// "PT1H2M3S" → "1:02:03"
function duration(iso = "") {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const [h, mi, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}

const num = (x) => (x === undefined || x === null ? null : Number(x));
const fmt = (n) => (n === null ? "비공개" : n.toLocaleString("ko-KR"));

// 영상 ID 목록 → 숫자까지 붙은 영상 정보 (50개씩, 1점)
async function videoDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await call("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    for (const v of data.items || []) {
      out.push({
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channel_id: v.snippet.channelId,
        published: v.snippet.publishedAt.slice(0, 10),
        views: num(v.statistics.viewCount),
        likes: num(v.statistics.likeCount),
        comments: num(v.statistics.commentCount),
        duration: duration(v.contentDetails.duration),
        url: `https://www.youtube.com/watch?v=${v.id}`,
      });
    }
  }
  // videos 응답은 순서가 보장되지 않으므로 요청한 순서로 되돌린다.
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.url.split("v=")[1]) - order.get(b.url.split("v=")[1]));
}

function save(kind, data) {
  const dir = path.join(ROOT, ".tmp");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = path.join(dir, `youtube_${kind}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\n💾 저장: ${path.relative(ROOT, file)}`);
}

function printVideos(videos) {
  videos.forEach((v, i) => {
    console.log(`\n${i + 1}. ${v.title}`);
    console.log(`   ${v.channel} · ${v.published} · ${v.duration} · 조회 ${fmt(v.views)} · 좋아요 ${fmt(v.likes)} · 댓글 ${fmt(v.comments)}`);
    console.log(`   ${v.url}`);
  });
}

async function search(query, count = 10, order = "relevance") {
  if (!query) die('검색어를 넣어주세요. 예: node tools/youtube.mjs search "사주" 10');
  const orders = { relevance: "relevance", views: "viewCount", date: "date" };
  if (!orders[order]) die("--order 는 relevance(관련도), views(조회수), date(최신) 중 하나입니다.");
  count = Math.min(Math.max(Number(count) || 10, 1), 50);

  const data = await call("search", {
    part: "snippet", type: "video", q: query, maxResults: count,
    order: orders[order], regionCode: "KR", relevanceLanguage: "ko",
  });
  const ids = (data.items || []).map((x) => x.id.videoId).filter(Boolean);
  if (!ids.length) die(`"${query}" 로 찾은 영상이 없습니다.`);
  const videos = await videoDetails(ids);

  console.log(`\n🔎 "${query}" 검색 결과 ${videos.length}개 (정렬: ${order})`);
  printVideos(videos);
  save("search", { query, order, searched_at: new Date().toISOString(), videos });
}

// 채널 입력을 해석: @핸들, 링크, UC… ID. 그 외 이름은 채널 검색(100점)으로 찾는다.
async function findChannel(input) {
  const s = input.trim();
  const part = "snippet,statistics,contentDetails";
  let m;
  if ((m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/)) || (m = s.match(/^(UC[\w-]{22})$/))) {
    return (await call("channels", { part, id: m[1] })).items?.[0];
  }
  if ((m = s.match(/youtube\.com\/(@[^/?#]+)/)) || (m = s.match(/^(@[^/?#\s]+)$/))) {
    const handle = decodeURIComponent(m[1]);
    const hit = (await call("channels", { part, forHandle: handle })).items?.[0];
    if (hit) return hit;
    console.log(`(${handle} 핸들이 없어서 채널 이름으로 검색합니다 — 100점 사용)`);
    return byName(handle.slice(1), part);
  }
  console.log(`(핸들이 아니라서 채널 이름으로 검색합니다 — 100점 사용)`);
  return byName(s, part);
}

async function byName(name, part) {
  const found = await call("search", { part: "snippet", type: "channel", q: name, maxResults: 1, regionCode: "KR" });
  const id = found.items?.[0]?.id?.channelId;
  return id ? (await call("channels", { part, id })).items?.[0] : undefined;
}

async function channel(input, recent = 10) {
  if (!input) die('채널을 넣어주세요. 예: node tools/youtube.mjs channel "@채널핸들"');
  recent = Math.min(Math.max(Number(recent) || 10, 1), 50);
  const ch = await findChannel(input);
  if (!ch) die(`"${input}" 채널을 찾지 못했습니다. 유튜브 채널 페이지 주소(youtube.com/@...)를 그대로 넣어보세요.`);

  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const list = uploads ? await call("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: recent }) : { items: [] };
  const videos = await videoDetails((list.items || []).map((x) => x.contentDetails.videoId));

  const counted = videos.filter((v) => v.views !== null);
  const avg = counted.length ? Math.round(counted.reduce((a, v) => a + v.views, 0) / counted.length) : null;
  const info = {
    name: ch.snippet.title,
    handle: ch.snippet.customUrl || null,
    url: `https://www.youtube.com/channel/${ch.id}`,
    created: ch.snippet.publishedAt.slice(0, 10),
    subscribers: ch.statistics.hiddenSubscriberCount ? null : num(ch.statistics.subscriberCount),
    total_views: num(ch.statistics.viewCount),
    video_count: num(ch.statistics.videoCount),
    recent_avg_views: avg,
  };

  console.log(`\n📺 ${info.name} ${info.handle || ""}`);
  console.log(`   구독자 ${fmt(info.subscribers)} · 총 조회 ${fmt(info.total_views)} · 영상 ${fmt(info.video_count)}개 · 개설 ${info.created}`);
  console.log(`   최근 ${videos.length}개 영상 평균 조회 ${fmt(avg)}`);
  console.log(`   ${info.url}`);
  printVideos(videos);
  save("channel", { channel: info, checked_at: new Date().toISOString(), recent_videos: videos });
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const args = rest.filter((a) => !a.startsWith("--"));

if (cmd === "search") await search(args[0], args[1], flags.order);
else if (cmd === "channel") await channel(args[0], args[1]);
else die('사용법:\n   node tools/youtube.mjs search "검색어" [개수] [--order=relevance|views|date]\n   node tools/youtube.mjs channel "@채널핸들" [최근영상수]');
