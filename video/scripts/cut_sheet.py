"""캐릭터 시트(표정·자세 격자 그림)를 칸마다 잘라, 모든 그림의 머리 위치·크기를 똑같이 맞춘다. 무료.

왜: 표정·손짓 그림을 바꿔 끼울 때 얼굴이 튀거나 커졌다 작아지면 안 된다.
방법: 한 시트 안의 칸들은 같은 위치·크기로 그려져 있으므로, 칸마다 따로 맞추지 않고 시트 하나에 한 번만 잰다
     (칸마다 재면 앞머리 줄을 안경으로 잘못 잡아 크기가 들쭉날쭉해짐 — 2026-10-22 실제로 터짐).
     - 크기: 머리 높이(머리카락 맨 위 ~ 머리 덩어리 아래)에서 가장 넓은 줄 = 귀~귀 폭. 칸들 중 가장 작은 값 → HEAD_W 가 되게 확대
     - 위치: 칸마다 머리카락 맨 위를 HAIR_Y, 머리 가운데를 화면 가운데로 (손이 얼굴 옆에 와도 머리 띠 안 가운데 영역만 봄)
저장은 '선만 남긴 투명 그림': 어두운 정도 = 불투명도, 색은 먹색. 흰 바탕·옷 안쪽 흰색 모두 투명이 되어 어떤 바탕색에도 자연스럽다.
(영상 안에서 mix-blend-mode: multiply 로 흰색을 녹이려 했더니 장면 묶음 안에서는 흰 사각형이 그대로 보였음 — 2026-10-22)

사용법:
  python3 scripts/cut_sheet.py <시트.png> <열> <행> <이름1,이름2,...> <저장 폴더>
  예) python3 scripts/cut_sheet.py ../.tmp/images/face_sheet.png 3 2 smile,surprised,serious,laugh,worried,kind public/characters/main/faces
결과: <저장 폴더>/<이름>.png (900×1100, 선만 남긴 투명 그림)
     + <이름>.fill.png (몸 안은 흰색으로 채운 그림 — 실사·어두운 배경 위에 '만화 캐릭터가 들어온' 느낌용)
     + <저장 폴더>/sheet_check.png (맞춘 결과를 한눈에)
"""
import os
import sys

from PIL import Image

CANVAS = (900, 1100)  # 저장 크기 (가로, 세로)
HAIR_Y = 120          # 머리카락 맨 위가 놓일 높이
HEAD_W = 330          # 귀~귀 폭
DARK = 110            # 이 값보다 어두우면 '선'


def dark(px, x, y):
    r, g, b = px[x, y][:3]
    return min(r, g, b) < DARK


def measure(cell):
    """(머리카락 맨 위 y, 머리 가운데 x, 귀~귀 폭)"""
    w, h = cell.size
    px = cell.load()
    mid = range(int(w * 0.25), int(w * 0.75))  # 손·팔이 들어오지 않는 가운데 띠
    top = next(y for y in range(h) if any(dark(px, x, y) for x in mid))
    head = range(top, min(h, top + int(h * 0.30)))
    xs = [x for y in head for x in mid if dark(px, x, y)]
    cx = (min(xs) + max(xs)) / 2
    width = 0
    for y in range(top + int(h * 0.12), min(h, top + int(h * 0.26))):  # 귀가 있는 높이
        row = [x for x in mid if dark(px, x, y)]
        if row:
            width = max(width, max(row) - min(row))
    return top, cx, width


def line_only(img):
    """흰 바탕 선화 → 먹색 선 + 투명 바탕 (어두운 정도를 불투명도로)"""
    gray = img.convert("L")
    alpha = gray.point(lambda v: 0 if v > 235 else min(255, round((235 - v) * 255 / 175)))
    out = Image.new("RGBA", img.size, (43, 42, 40, 0))
    out.putalpha(alpha)
    return out


def filled(img):
    """바깥 흰 배경만 투명, 몸 안 흰색은 그대로. 위·왼쪽·오른쪽 테두리에서만 바깥을 채운다
    (몸이 아래 테두리에 닿아 있어서, 아래에서 시작하면 옷 안까지 지워짐)."""
    gray = img.convert("L")
    w, h = gray.size
    px = gray.load()
    # 그림 아래쪽 끝(가장 낮은 선) 아래는 빈 여백 → 여기를 통해 옷 안으로 새지 않게, 채우기는 그 위에서만 하고 여백은 통째로 투명
    bottom = max(y for y in range(h) if any(px[x, y] < 110 for x in range(0, w, 2)))
    out = [[y > bottom for _ in range(w)] for y in range(h)]
    stack = [(x, 0) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y > bottom or out[y][x] or px[x, y] < 200:
            continue
        out[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    rgba = img.convert("RGBA")
    a = rgba.load()
    for y in range(h):
        for x in range(w):
            if out[y][x]:
                a[x, y] = (255, 255, 255, 0)
    return rgba


def main():
    if len(sys.argv) < 6:
        print(__doc__)
        sys.exit(1)
    sheet, cols, rows, names, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(","), sys.argv[5]
    if len(names) != cols * rows:
        sys.exit(f"이름이 {len(names)}개인데 칸은 {cols * rows}개예요.")
    img = Image.open(sheet).convert("RGB")
    cw, ch = img.width // cols, img.height // rows
    os.makedirs(out, exist_ok=True)
    cells = [img.crop(((i % cols) * cw, (i // cols) * ch, (i % cols + 1) * cw, (i // cols + 1) * ch)) for i in range(len(names))]
    ms = [measure(c) for c in cells]
    s = HEAD_W / max(1, min(m[2] for m in ms))  # 시트 전체에 같은 배율
    print(f"  배율 {s:.2f} (귀~귀 {min(m[2] for m in ms)}px → {HEAD_W}px)")
    done = []
    for name, cell, (top, cx, _) in zip(names, cells, ms):
        big = cell.resize((round(cell.width * s), round(cell.height * s)), Image.LANCZOS)
        canvas = Image.new("RGB", CANVAS, "white")
        canvas.paste(big, (round(CANVAS[0] / 2 - cx * s), round(HAIR_Y - top * s)))
        line_only(canvas).save(os.path.join(out, f"{name}.png"))
        filled(canvas).save(os.path.join(out, f"{name}.fill.png"))
        done.append(canvas)
        print(f"  {name}: 머리 위 {top}px, 가운데 {cx:.0f}px")
    # 확인용: 나란히 + 안경 줄 표시
    thumb = [d.resize((CANVAS[0] // 3, CANVAS[1] // 3)) for d in done]  # done 은 흰 바탕 원본
    check = Image.new("RGB", (thumb[0].width * len(thumb), thumb[0].height), "white")
    for i, t in enumerate(thumb):
        check.paste(t, (i * t.width, 0))
    for x in range(check.width):
        check.putpixel((x, HAIR_Y // 3), (230, 60, 60))
    check.save(os.path.join(out, "sheet_check.png"))
    print(f"✅ {len(done)}장 저장: {out}")


if __name__ == "__main__":
    main()
