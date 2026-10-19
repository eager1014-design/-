// 종이 질감 이미지를 코드로 만든다 (매 프레임 계산하지 않도록 한 번만). public/textures/grain.png
// 사용법: node scripts/make_textures.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/textures");
const SIZE = 256;

// PNG 파일 형식에 필요한 CRC 계산
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

// 회갈색 점들이 아주 옅게 흩어진 투명 이미지 (회색·알파)
const raw = Buffer.alloc(SIZE * (1 + SIZE * 2));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 2)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const o = y * (1 + SIZE * 2) + 1 + x * 2;
    raw[o] = 70 + Math.floor(Math.random() * 40);
    raw[o + 1] = Math.floor(Math.random() ** 3 * 60);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // 8비트
ihdr[9] = 4; // 회색 + 투명도
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "grain.png"), png);
console.log("🧻 textures/grain.png");
