// 흰 배경 위 캐릭터 그림에서 "바깥 흰 배경"만 투명하게 오려낸다 (캐릭터 몸 안의 흰색은 그대로). 무료.
// 사용법: node scripts/cutout.mjs <그림.png> [더 있으면 계속] → 같은 폴더에 <이름>.cut.png
// 방법: 그림 테두리에서 시작해 이어진 흰색 영역만 지운다(페인트 통 채우기와 같은 원리). 선 근처는 부드럽게.
// --cropped-bottom: 아래가 잘린 그림(어깨까지 나오는 얼굴 클로즈업)용. 아래쪽 테두리에서는 지우기를 시작하지 않아 몸 안쪽이 흰색으로 남는다 (검은 바탕에서 몸이 검게 보임, 2026-10-31)
// --close=N: 선 사이 틈이 N×2 픽셀보다 좁으면 막힌 걸로 친다 — 챗GPT 그림은 머리카락 옆이 벌어져 얼굴 안쪽까지 지워지는 일이 있음 (검은 바탕에서 얼굴이 뚫려 보임, 2026-10-31)
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const close = Number(args.find((a) => a.startsWith("--close="))?.slice(8)) || 0;
const croppedBottom = args.includes("--cropped-bottom");
if (!files.length) {
  console.error("\n❌ 그림 파일을 넣어주세요. 예: node scripts/cutout.mjs public/characters/main/think.png\n");
  process.exit(1);
}
for (const file of files) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: w, height: h, data } = png;
  const light = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); // 가장 어두운 채널
  const outside = new Uint8Array(w * h);
  // 선에서 떨어진 거리 (close 일 때만): 선을 N픽셀 두껍게 친 벽을 만들어 틈을 막는다
  const wall = new Uint8Array(w * h);
  if (close) {
    let edge = [];
    for (let i = 0; i < w * h; i++) if (light(i) < 225) (wall[i] = 1), edge.push(i);
    for (let d = 0; d < close; d++) {
      const next = [];
      for (const i of edge) {
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && !wall[j]) (wall[j] = 1), next.push(j);
      }
      edge = next;
    }
  }
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (outside[i] || light(i) < 225 || wall[i]) return; // 선(어두운 곳)에서 멈춤
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    if (!croppedBottom) push(x, h - 1);
  }
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y), push(x - 1, y), push(x, y + 1), push(x, y - 1);
  }
  // 벽 두께만큼 덜 지워진 바깥 여백을 선까지 되돌린다 (선은 넘지 않음)
  if (close) {
    let edge = [];
    for (let i = 0; i < w * h; i++) if (outside[i]) edge.push(i);
    for (let d = 0; d < close + 1; d++) {
      const next = [];
      for (const i of edge) {
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && !outside[j] && light(j) >= 225) (outside[j] = 1), next.push(j);
      }
      edge = next;
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (outside[i]) data[i * 4 + 3] = 0;
    else {
      // 바깥과 닿은 선 가장자리: 밝을수록 투명하게 (계단 현상 방지)
      const x = i % w;
      const y = (i - x) / w;
      const touch = (x > 0 && outside[i - 1]) || (x < w - 1 && outside[i + 1]) || (y > 0 && outside[i - w]) || (y < h - 1 && outside[i + w]);
      if (touch) data[i * 4 + 3] = Math.round(255 * Math.min(1, (255 - light(i)) / 120));
    }
  }
  // 남은 캐릭터 둘레의 빈 여백을 잘라낸다 (영상에서 캐릭터가 작아 보이지 않게). 사방 3% 여유.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 20) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad), y0 = Math.max(0, y0 - pad), x1 = Math.min(w - 1, x1 + pad), y1 = Math.min(h - 1, y1 + pad);
  const cut = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
  PNG.bitblt(png, cut, x0, y0, cut.width, cut.height, 0, 0);
  const out = file.replace(/\.(png|jpg|jpeg)$/i, ".cut.png");
  fs.writeFileSync(out, PNG.sync.write(cut));
  console.log(`✂️  ${path.basename(out)}`);
}
