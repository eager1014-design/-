// 내 컴퓨터에서 도는 무료 받아쓰기 프로그램(whisper.cpp)과 한국어 모델을 설치한다. 한 번만 하면 됨.
// 사용법: node scripts/setup_whisper.mjs   → video/whisper/ 에 설치 (약 1.5GB)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installWhisperCpp, downloadWhisperModel } from "@remotion/install-whisper-cpp";
import { WHISPER_MODEL, WHISPER_VERSION } from "./whisper-config.mjs";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../whisper");

await installWhisperCpp({ to: DIR, version: WHISPER_VERSION, printOutput: false });
console.log("✅ whisper.cpp 설치");
await downloadWhisperModel({ model: WHISPER_MODEL, folder: DIR, printOutput: false });
console.log(`✅ ${WHISPER_MODEL} 모델 다운로드`);
