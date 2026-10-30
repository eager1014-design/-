// 유튜브 업로드 Tool (YouTube Data API v3, 무료 — 업로드 1번 = 1,600점, 하루 10,000점 → 하루 6편).
// 인증 파일: 맨 위 폴더 credentials.json(구글 클라우드 "데스크톱 앱" OAuth 클라이언트) → 로그인하면 token.json 생성.
// 둘 다 .gitignore 처리됨. 이 파일에 비밀을 적지 말 것.
//
// 사용법:
//   node tools/youtube_upload.mjs login                       (처음 한 번 — 브라우저에서 사장님이 허락)
//   node tools/youtube_upload.mjs upload <영상.mp4> <정보.json>         (무엇을 올릴지 보여주기만 함)
//   node tools/youtube_upload.mjs upload <영상.mp4> <정보.json> --yes   (실제 업로드)
//   node tools/youtube_upload.mjs comment <영상 주소> <댓글.txt> --yes  (내 채널로 댓글 달기 — 고정은 스튜디오에서)
//
// 정보.json: {"title": "...", "description": "...", "tags": ["..."], "thumbnail": "썸네일.png"(선택),
//             "privacy": "private"(기본) | "unlisted" | "public", "publishAt": "2026-10-20T19:00:00+09:00"(선택, 예약),
//             "altered_content": true(AI 합성 목소리·영상을 썼을 때)}
// 주의: 구글 심사를 안 받은 개인용 연결은 유튜브가 영상을 "비공개"로 잠근다 → 스튜디오에서 사장님이 직접 공개로 바꾼다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRED = path.join(ROOT, "credentials.json");
const TOKEN = path.join(ROOT, "token.json");
// upload = 영상 올리기, force-ssl = 내 채널로 댓글 달기 (2026-10-26 고정 댓글용 — 예전 열쇠엔 없어서 한 번 다시 로그인)
// yt-analytics.readonly = 노출수·클릭률·시청 지속률 읽기 (2026-10-30 클릭률 분석용, tools/youtube_stats.mjs)
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly";

function client() {
  if (!fs.existsSync(CRED)) throw new Error("credentials.json 이 없습니다. 구글 클라우드에서 OAuth 클라이언트(데스크톱 앱)를 만들어 맨 위 폴더에 넣어주세요.");
  const c = JSON.parse(fs.readFileSync(CRED, "utf8"));
  const v = c.installed || c.web;
  if (!v?.client_id) throw new Error("credentials.json 형식이 이상합니다. '데스크톱 앱' 유형으로 다시 받아주세요.");
  return v;
}

async function tokenRequest(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok) throw new Error(`구글 로그인 실패: ${j.error_description || j.error}`);
  return j;
}

export async function login() {
  const { client_id, client_secret } = client();
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      const c = u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(c ? "<h2>연결 완료! 이 창은 닫으셔도 됩니다.</h2>" : `<h2>연결 실패: ${u.searchParams.get("error")}</h2>`);
      srv.close();
      c ? resolve({ c, port: srv.port }) : reject(new Error(`허락이 안 됐습니다: ${u.searchParams.get("error")}`));
    });
    srv.listen(0, "127.0.0.1", () => {
      srv.port = srv.address().port;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id, redirect_uri: `http://127.0.0.1:${srv.port}`, response_type: "code",
        scope: SCOPE, access_type: "offline", prompt: "consent",
      });
      console.log(`\n브라우저에서 구글 계정을 고르고 '허용'을 눌러주세요.\n(창이 안 뜨면 이 주소를 여세요)\n${auth}\n`);
      spawn("open", [auth.toString()], { stdio: "ignore" }).on("error", () => {});
    });
  });
  const t = await tokenRequest({
    code: code.c, client_id, client_secret, redirect_uri: `http://127.0.0.1:${code.port}`, grant_type: "authorization_code",
  });
  if (!t.refresh_token) throw new Error("오래 쓰는 열쇠(refresh_token)를 못 받았습니다. 다시 login 해주세요.");
  fs.writeFileSync(TOKEN, JSON.stringify({ refresh_token: t.refresh_token }, null, 2), { mode: 0o600 });
  return "로그인 완료. 이제 업로드할 수 있습니다.";
}

export async function accessToken() {
  if (!fs.existsSync(TOKEN)) throw new Error("아직 로그인 안 됨. 터미널에서 `node tools/youtube_upload.mjs login` 을 한 번 실행해주세요.");
  const { client_id, client_secret } = client();
  const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN, "utf8"));
  try {
    return (await tokenRequest({ client_id, client_secret, refresh_token, grant_type: "refresh_token" })).access_token;
  } catch (e) {
    // 구글 "테스트" 상태 앱은 7일마다 열쇠가 만료된다
    throw new Error(`${e.message} — 열쇠가 만료됐습니다. \`node tools/youtube_upload.mjs login\` 으로 다시 로그인해주세요.`);
  }
}

export function readMeta(video, metaPath) {
  if (!fs.existsSync(video)) throw new Error(`영상 파일이 없습니다: ${video}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  if (!meta.title) throw new Error("정보.json 에 title(제목)이 없습니다.");
  if (meta.title.length > 100) throw new Error(`제목이 ${meta.title.length}자입니다. 유튜브는 100자까지.`);
  if ((meta.description || "").length > 5000) throw new Error("설명란은 5,000자까지입니다.");
  const tagLen = (meta.tags || []).join(",").length;
  if (tagLen > 500) throw new Error(`태그 합계가 ${tagLen}자입니다. 500자까지.`);
  if (meta.thumbnail) {
    meta.thumbnail = path.resolve(path.dirname(metaPath), meta.thumbnail);
    if (!fs.existsSync(meta.thumbnail)) throw new Error(`썸네일 파일이 없습니다: ${meta.thumbnail}`);
    if (fs.statSync(meta.thumbnail).size > 2 * 1024 * 1024) throw new Error("썸네일은 2MB 이하여야 합니다.");
  }
  meta.privacy = meta.publishAt ? "private" : meta.privacy || "private";
  return meta;
}

export function describe(video, meta) {
  const mb = (fs.statSync(video).size / 1024 / 1024).toFixed(1);
  return [
    `영상: ${video} (${mb}MB)`,
    `제목: ${meta.title}`,
    `공개: ${meta.privacy}${meta.publishAt ? ` (예약 ${meta.publishAt})` : ""}`,
    `태그: ${(meta.tags || []).join(", ") || "없음"}`,
    `썸네일: ${meta.thumbnail || "없음"}`,
    `설명란 첫 줄: ${(meta.description || "").split("\n")[0]}`,
  ].join("\n");
}

export async function upload(video, meta) {
  const token = await accessToken();
  const size = fs.statSync(video).size;
  const body = {
    snippet: {
      title: meta.title, description: meta.description || "", tags: meta.tags || [],
      categoryId: meta.categoryId || "22", defaultLanguage: "ko", defaultAudioLanguage: "ko",
    },
    status: {
      privacyStatus: meta.privacy, selfDeclaredMadeForKids: false,
      // AI 복제 목소리 등을 쓰면 "변경되거나 합성된 콘텐츠: 예"
      containsSyntheticMedia: Boolean(meta.altered_content),
      ...(meta.publishAt ? { publishAt: new Date(meta.publishAt).toISOString() } : {}),
    },
  };
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/*", "x-upload-content-length": String(size),
    },
    body: JSON.stringify(body),
  });
  if (!start.ok) throw new Error(`업로드 시작 실패: ${await explain(start)}`);
  const put = await fetch(start.headers.get("location"), {
    method: "PUT", headers: { "content-type": "video/*" }, body: await fs.openAsBlob(video),
  });
  if (!put.ok) throw new Error(`영상 전송 실패: ${await explain(put)}`);
  const v = await put.json();
  const lines = [`업로드 완료: https://youtu.be/${v.id}`, `스튜디오: https://studio.youtube.com/video/${v.id}/edit`, `공개 상태: ${v.status?.privacyStatus}`];

  if (meta.thumbnail) {
    const ext = path.extname(meta.thumbnail).toLowerCase();
    const t = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${v.id}&uploadType=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": ext === ".png" ? "image/png" : "image/jpeg" },
      body: fs.readFileSync(meta.thumbnail),
    });
    lines.push(t.ok ? "썸네일: 넣음" : `썸네일: 실패 — ${await explain(t)} (채널 전화번호 인증이 안 돼 있으면 썸네일이 막힙니다)`);
  }
  return lines.join("\n");
}

// 내 채널 이름으로 댓글 달기 (영상이 공개·일부 공개여야 함 — 비공개 영상엔 댓글이 안 달림).
// '고정'은 유튜브가 API 로 열어 두지 않아서 사장님이 스튜디오에서 ⋮ → 고정 (2026-10-26)
export const videoId = (s) => String(s).match(/(?:youtu\.be\/|v=|shorts\/|video\/)([\w-]{11})/)?.[1] || (/^[\w-]{11}$/.test(s) ? s : null);
export async function comment(video, text) {
  const id = videoId(video);
  if (!id) throw new Error(`영상 주소가 이상합니다: ${video}`);
  if (!String(text).trim()) throw new Error("댓글 내용이 비었습니다.");
  const token = await accessToken();
  const r = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ snippet: { videoId: id, topLevelComment: { snippet: { textOriginal: String(text).trim() } } } }),
  });
  if (!r.ok) throw new Error(`댓글 달기 실패: ${await explain(r)}`);
  const c = await r.json();
  return [`댓글 달림: https://www.youtube.com/watch?v=${id}&lc=${c.id}`, `고정하기: 스튜디오 → 댓글 → 이 댓글 ⋮ → 고정`].join("\n");
}

async function explain(r) {
  const text = await r.text();
  try {
    const e = JSON.parse(text).error;
    const reason = e?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") return "오늘 업로드 한도(하루 약 6편)를 다 썼습니다. 내일 다시.";
    if (reason === "uploadLimitExceeded") return "유튜브 채널 업로드 한도를 넘었습니다. 하루 뒤 다시.";
    if (reason === "insufficientPermissions" || r.status === 401) return "댓글 권한이 없는 예전 열쇠예요 — `node tools/youtube_upload.mjs login` 으로 한 번 다시 로그인해 주세요.";
    if (["commentsDisabled", "forbidden", "videoNotFound"].includes(reason)) return `영상이 아직 비공개이거나 댓글이 꺼져 있어요 (${reason}). 스튜디오에서 공개(또는 일부 공개)로 바꾼 뒤 다시.`;
    return `${r.status} ${reason || ""} ${e?.message || ""}`.trim();
  } catch {
    return `${r.status} ${text.slice(0, 300)}`;
  }
}

// 터미널에서 직접 실행할 때
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, video, metaPath] = process.argv.slice(2);
  try {
    if (cmd === "login") console.log(await login());
    else if (cmd === "comment" && video && metaPath) {
      const text = fs.readFileSync(metaPath, "utf8");
      console.log(`영상: ${video}\n댓글:\n${text}`);
      if (!process.argv.includes("--yes")) console.log("\n(확인만 함. 실제로 달려면 끝에 --yes)");
      else console.log(`\n${await comment(video, text)}`);
    }
    else if (cmd === "upload" && video && metaPath) {
      const meta = readMeta(video, metaPath);
      console.log(describe(video, meta));
      if (!process.argv.includes("--yes")) console.log("\n(확인만 함. 실제로 올리려면 끝에 --yes)");
      else console.log(`\n${await upload(video, meta)}`);
    } else console.log("사용: login | upload <영상.mp4> <정보.json> [--yes]");
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}
