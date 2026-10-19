// Claude Code에서 제미나이·챗GPT를 부를 수 있게 해주는 MCP 연결 프로그램.
// 키는 프로젝트 맨 위 폴더의 .env 에서만 읽는다. 이 파일에 키를 적지 말 것.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import OpenAI from "openai";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { GEMINI_MODEL, gemini, watchVideo } from "./gemini.mjs"; // .env 도 여기서 읽는다

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6.1-sol";

// MCP는 표준출력으로 대화하므로, 로그는 반드시 표준에러로만 보낸다.
const log = (...args) => console.error("[ai-bridge]", ...args);

const openai = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 가 .env 에 없습니다. https://platform.openai.com/api-keys 에서 키를 발급받아 .env 에 넣어주세요.");
  return new OpenAI({ apiKey: key });
};

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (err) => {
  log(err);
  return { isError: true, content: [{ type: "text", text: `실패: ${err?.message ?? err}` }] };
};

const server = new McpServer({ name: "ai-bridge", version: "1.0.0" });

// 챗GPT 질문은 API 키(유료) 대신 코덱스 CLI(사장님 ChatGPT 구독)로 보낸다. 안 되면 API로 몰래 넘어가지 않고 멈춘다.
const askCodex = (prompt) =>
  new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ask-"));
    const out = path.join(dir, "answer.txt");
    const child = spawn("codex", ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir, "-o", out, "-"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", () => reject(new Error("codex 프로그램을 못 찾았습니다. 설치: npm install -g --prefix ~/.local @openai/codex")));
    child.on("close", (code) => {
      const answer = fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "";
      fs.rmSync(dir, { recursive: true, force: true });
      if (answer) return resolve(answer);
      if (/not logged in|login/i.test(err)) return reject(new Error("코덱스 로그인이 풀렸습니다. 터미널에서 `codex login` 으로 ChatGPT 계정에 다시 로그인해주세요."));
      if (/usage limit|rate limit/i.test(err)) return reject(new Error("ChatGPT 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도해주세요."));
      reject(new Error(`챗GPT(코덱스)가 답을 주지 않았습니다 (종료코드 ${code}). ${err.slice(-400)}`));
    });
    child.stdin.end(prompt);
  });

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
      const { text, tokens } = await watchVideo(source, prompt, { log });
      return ok(`${text || "(빈 답변)"}\n\n(사용 토큰 ${tokens?.toLocaleString("ko-KR") ?? "알 수 없음"})`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "ask_chatgpt",
  {
    title: "챗GPT에게 질문",
    description: "챗GPT에게 질문한다. 두 번째 의견이 필요할 때 쓴다. 사장님 ChatGPT 구독(코덱스 로그인)으로 물어서 API 요금이 없다.",
    inputSchema: { prompt: z.string().describe("챗GPT에게 보낼 질문") },
  },
  async ({ prompt }) => {
    try {
      return ok(await askCodex(prompt));
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

// 유튜브 업로드: 실제 일은 tools/youtube_upload.mjs 가 한다. 공개는 되돌리기 어려우니 confirm 없이는 미리보기만.
const yt = () => import("../youtube_upload.mjs");

server.registerTool(
  "youtube_upload",
  {
    title: "유튜브에 영상 올리기",
    description:
      "완성 영상을 사장님 유튜브 채널에 올린다. 무료(하루 약 6편). 기본은 비공개. confirm=false면 무엇을 올릴지 보여주기만 하고, 사장님이 채팅에서 '올려'라고 확인한 뒤에만 confirm=true 로 다시 부른다.",
    inputSchema: {
      video: z.string().describe("영상 파일 경로 (mp4)"),
      meta: z.string().describe("정보 JSON 경로: title, description, tags, thumbnail(선택), privacy(private 기본), publishAt(선택)"),
      confirm: z.boolean().default(false).describe("true일 때만 실제 업로드"),
    },
  },
  async ({ video, meta, confirm }) => {
    try {
      const { readMeta, describe, upload } = await yt();
      const m = readMeta(video, meta);
      if (!confirm) return ok(`${describe(video, m)}\n\n(아직 안 올림 — 사장님 확인 후 confirm=true)`);
      return ok(await upload(video, m));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
log("준비 완료");
