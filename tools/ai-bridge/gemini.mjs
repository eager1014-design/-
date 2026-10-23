// 제미나이 영상 분석 공용 부품. MCP 서버(server.mjs)와 여러 개 분석 Tool(tools/video_batch.mjs)이 같이 쓴다.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, createPartFromUri } from "@google/genai";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

// 모델 이름은 .env 에서 바꿀 수 있다. 비워두면 아래 기본값을 쓴다.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// 제미나이는 영상 1초를 약 300토큰으로 센다(화면 1장 + 소리). 비용 미리보기에 쓰는 어림값.
export const TOKENS_PER_SECOND = 300;

export function gemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 가 .env 에 없습니다. https://aistudio.google.com/apikey 에서 키를 발급받아 .env 에 넣어주세요.");
  return new GoogleGenAI({ apiKey: key });
}

const VIDEO_TYPES = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo" };

// youtu.be/ID?si=..., shorts/ID 같은 모양에서 영상 ID만 뽑는다. 유튜브 링크가 아니면 null.
export function youtubeId(source) {
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(source)) return null;
  const id = source.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{11})/)?.[1];
  if (!id) throw new Error(`유튜브 영상 ID를 찾을 수 없습니다: ${source}`);
  return id;
}

async function waitUntilActive(ai, file) {
  // 제미나이는 올린 영상을 처리하는 데 시간이 걸린다. 최대 5분 기다린다.
  for (let i = 0; i < 60 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state !== "ACTIVE") throw new Error(`영상 처리가 끝나지 않았습니다 (상태: ${file.state}).`);
  return file;
}

async function videoPart(ai, source, log) {
  const id = youtubeId(source);
  if (id) return { fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } };

  const filePath = path.resolve(ROOT, source);
  const mimeType = VIDEO_TYPES[path.extname(filePath).toLowerCase()];
  if (!fs.existsSync(filePath)) throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  if (!mimeType) throw new Error(`지원하지 않는 영상 형식입니다: ${path.extname(filePath)}`);
  log("영상 올리는 중:", filePath);
  const uploaded = await waitUntilActive(ai, await ai.files.upload({ file: filePath, config: { mimeType } }));
  return createPartFromUri(uploaded.uri, uploaded.mimeType);
}

// 제미나이가 영상을 보고 답한다. schema 를 주면 그 모양의 JSON 으로 답하게 한다.
// 돌려주는 값: { text, tokens } — tokens 는 실제로 쓴 토큰 수(요금 기준).
// clip: { start, end } (초) — 긴 영상은 일부 구간만 보내서 토큰을 아낀다
export async function watchVideo(source, prompt, { schema, log = () => {}, clip } = {}) {
  const ai = gemini();
  const part = await videoPart(ai, source, log);
  if (clip) part.videoMetadata = { startOffset: `${clip.start}s`, endOffset: `${clip.end}s` };
  const config = schema ? { responseMimeType: "application/json", responseSchema: schema } : undefined;
  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [part, { text: prompt }] }],
    config,
  });
  return { text: res.text ?? "", tokens: res.usageMetadata?.totalTokenCount ?? null };
}

// 제미나이 오류를 사장님이 이해할 수 있는 말로 바꾼다.
export function friendlyError(e) {
  const m = String(e?.message ?? e);
  if (/free_tier/i.test(m) && /limit: 0/.test(m))
    return "이 기능은 제미나이 무료 등급에서 막혀 있습니다 (한도 0). Google AI Studio 에서 결제(유료 등급)를 켜야 쓸 수 있습니다: https://aistudio.google.com/usage";
  if (/quota exceeded|RESOURCE_EXHAUSTED|429/i.test(m)) return "제미나이 사용 한도를 넘었습니다. 잠시(분 단위) 또는 내일(일 단위) 다시 시도하세요. 자세히: https://ai.dev/rate-limit";
  if (/503|UNAVAILABLE|high demand/i.test(m)) return "제미나이 서버가 잠깐 붐빕니다. 잠시 뒤 다시 시도하세요 (요금 없음).";
  if (/API key not valid|API_KEY_INVALID/i.test(m)) return "제미나이 키가 틀렸습니다. .env 의 GEMINI_API_KEY 를 확인하세요.";
  return m.slice(0, 300);
}
