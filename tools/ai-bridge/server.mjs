// Claude Code에서 제미나이·챗GPT를 부를 수 있게 해주는 MCP 연결 프로그램.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenAI, createPartFromUri } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

// 모델 이름은 .env 에서 바꿀 수 있다. 비워두면 아래 기본값을 쓴다.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6.1-sol";

// MCP는 표준출력으로 대화하므로, 로그는 반드시 표준에러로만 보낸다.
const log = (...args) => console.error("[ai-bridge]", ...args);

function requireKey(name, where) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 가 .env 에 없습니다. ${where} 에서 키를 발급받아 .env 에 넣어주세요.`);
  }
  return value;
}

const gemini = () => new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY", "https://aistudio.google.com/apikey") });
const openai = () => new OpenAI({ apiKey: requireKey("OPENAI_API_KEY", "https://platform.openai.com/api-keys") });

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (err) => {
  log(err);
  return { isError: true, content: [{ type: "text", text: `실패: ${err?.message ?? err}` }] };
};

const VIDEO_TYPES = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo" };

async function waitUntilActive(ai, file) {
  // 제미나이는 올린 영상을 처리하는 데 시간이 걸린다. 최대 5분 기다린다.
  for (let i = 0; i < 60 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state !== "ACTIVE") throw new Error(`영상 처리가 끝나지 않았습니다 (상태: ${file.state}).`);
  return file;
}

const server = new McpServer({ name: "ai-bridge", version: "1.0.0" });

server.registerTool(
  "ask_gemini",
  {
    title: "제미나이에게 질문",
    description: "구글 제미나이에게 질문한다. 유료 API(소액)를 쓴다.",
    inputSchema: { prompt: z.string().describe("제미나이에게 보낼 질문") },
  },
  async ({ prompt }) => {
    try {
      const res = await gemini().models.generateContent({ model: GEMINI_MODEL, contents: prompt });
      return ok(res.text ?? "(빈 답변)");
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "gemini_watch_video",
  {
    title: "제미나이가 영상 보고 답하기",
    description:
      "제미나이가 영상을 직접 보고(화면+소리) 질문에 답한다. 유튜브 공개 영상 링크 또는 내 컴퓨터의 영상 파일 경로를 받는다. 자막이 없는 영상, 인스타 릴스 분석용. 유료 API를 쓰며 긴 영상일수록 비싸다.",
    inputSchema: {
      source: z.string().describe("유튜브 링크(https://www.youtube.com/watch?v=...) 또는 영상 파일 경로"),
      prompt: z.string().default("이 영상의 핵심 내용을 한국어로 요약해줘: 핵심 3줄, 주요 내용, 눈에 띄는 연출이나 훅.").describe("영상에 대해 물어볼 내용"),
    },
  },
  async ({ source, prompt }) => {
    try {
      const ai = gemini();
      let videoPart;
      if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(source)) {
        // youtu.be/ID?si=..., shorts/ID 같은 모양을 표준 watch?v=ID 로 바꾼다.
        const id = source.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{11})/)?.[1];
        if (!id) throw new Error(`유튜브 영상 ID를 찾을 수 없습니다: ${source}`);
        videoPart = { fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } };
      } else {
        const filePath = path.resolve(ROOT, source);
        const mimeType = VIDEO_TYPES[path.extname(filePath).toLowerCase()];
        if (!fs.existsSync(filePath)) throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
        if (!mimeType) throw new Error(`지원하지 않는 영상 형식입니다: ${path.extname(filePath)}`);
        log("영상 올리는 중:", filePath);
        const uploaded = await waitUntilActive(ai, await ai.files.upload({ file: filePath, config: { mimeType } }));
        videoPart = createPartFromUri(uploaded.uri, uploaded.mimeType);
      }
      const res = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [videoPart, { text: prompt }] }],
      });
      return ok(res.text ?? "(빈 답변)");
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "ask_chatgpt",
  {
    title: "챗GPT에게 질문",
    description: "OpenAI 챗GPT에게 질문한다. 두 번째 의견이 필요할 때 쓴다. 유료 API(소액)를 쓴다.",
    inputSchema: { prompt: z.string().describe("챗GPT에게 보낼 질문") },
  },
  async ({ prompt }) => {
    try {
      const res = await openai().responses.create({ model: OPENAI_MODEL, input: prompt });
      return ok(res.output_text || "(빈 답변)");
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_ai_models",
  {
    title: "쓸 수 있는 모델 목록",
    description: "제미나이·OpenAI 키로 지금 쓸 수 있는 모델 이름을 보여준다. 무료. .env 의 GEMINI_MODEL / OPENAI_MODEL 을 고를 때 쓴다.",
    inputSchema: {},
  },
  async () => {
    const lines = [`지금 설정: GEMINI_MODEL=${GEMINI_MODEL}, OPENAI_MODEL=${OPENAI_MODEL}`];
    try {
      const names = [];
      for await (const m of await gemini().models.list()) names.push(m.name.replace(/^models\//, ""));
      lines.push(`\n[제미나이]\n${names.join("\n")}`);
    } catch (e) {
      lines.push(`\n[제미나이] ${e.message}`);
    }
    try {
      const names = [];
      for await (const m of openai().models.list()) names.push(m.id);
      lines.push(`\n[OpenAI]\n${names.sort().join("\n")}`);
    } catch (e) {
      lines.push(`\n[OpenAI] ${e.message}`);
    }
    return ok(lines.join("\n"));
  },
);

await server.connect(new StdioServerTransport());
log("준비 완료");
