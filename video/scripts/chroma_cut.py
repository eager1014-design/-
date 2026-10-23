"""초록 배경(#00FF00) 캐릭터 시트를 칸마다 잘라 초록을 지우고 투명 PNG 로 저장한다. 무료.

챗GPT로 실사풍 캐릭터를 그릴 때 '완전 초록 배경'으로 그리게 하면, 머리카락처럼 어두운 부분도 깨끗하게 오려진다
(검은 배경으로 그리면 검은 머리까지 지워짐). 가장자리에 남는 초록 기운(번짐)도 빼 준다.
한 시트 안 칸들은 같은 위치로 그려지므로 모든 칸을 같은 크기·같은 자리로 자른다 → 바꿔 끼워도 몸이 튀지 않음.

사용법: python3 scripts/chroma_cut.py <시트.png> <열> <행> <이름1,이름2,...> <저장 폴더>
"""
import os
import sys

from PIL import Image


def key(cell):
    rgba = cell.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            green = g - max(r, b)  # 초록이 다른 색보다 얼마나 센가
            if green > 90:
                px[x, y] = (0, 0, 0, 0)
            elif green > 25:
                a = round(255 * (1 - (green - 25) / 65))
                px[x, y] = (r, max(r, b), b, a)  # 가장자리 초록 번짐 빼기
            elif green > 0:
                px[x, y] = (r, max(r, b), b, 255)
    return rgba


sheet, cols, rows, names, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(","), sys.argv[5]
img = Image.open(sheet).convert("RGB")
cw, ch = img.width // cols, img.height // rows
os.makedirs(out, exist_ok=True)
cut = [key(img.crop(((i % cols) * cw, (i // cols) * ch, (i % cols + 1) * cw, (i // cols + 1) * ch))) for i in range(len(names))]
# 모든 칸에서 사람이 있는 영역을 합쳐서 같은 상자로 자름
boxes = [c.getbbox() for c in cut]
box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
for name, c in zip(names, cut):
    c.crop(box).save(os.path.join(out, f"{name}.png"))
print(f"✅ {len(names)}장 저장: {out} (크기 {box[2] - box[0]}×{box[3] - box[1]})")
