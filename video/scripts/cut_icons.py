"""아이콘 시트(격자)를 칸마다 잘라 '선만 남긴 투명 아이콘'으로 저장한다. 무료. (2026-10-24, 장면 칸 "props" 용)

사용법:
  python3 scripts/cut_icons.py <시트.png> <열> <행> <이름1,이름2,...> [저장 폴더=public/icons]
결과: <저장 폴더>/<이름>.png — 600×600, 그림을 가운데 꽉 차게(여백 6%), 어두운 정도 = 불투명도(검은 선)
      칠판 스킨에서는 영상이 흰 선으로 뒤집어 쓴다 (components.jsx Props)
"""
import os
import sys

from PIL import Image, ImageOps

SIZE = 600


def main(sheet, cols, rows, names, out):
    os.makedirs(out, exist_ok=True)
    g = Image.open(sheet).convert("L")
    W, H = g.size
    cw, ch = W / cols, H / rows
    for i, name in enumerate(names):
        c, r = i % cols, i // cols
        cell = g.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch)))
        ink = cell.point(lambda v: 255 if v < 150 else 0)
        bb = ink.getbbox()
        if not bb:
            print("빈 칸:", name)
            continue
        art = cell.crop(bb)
        side = max(art.size)
        scale = SIZE * 0.88 / side
        art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
        alpha = ImageOps.invert(art).point(lambda v: 0 if v < 50 else min(255, int((v - 50) * 1.3)))
        icon = Image.new("RGBA", art.size, (17, 17, 17, 255))
        icon.putalpha(alpha)
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(icon, ((SIZE - art.width) // 2, (SIZE - art.height) // 2), icon)
        canvas.save(os.path.join(out, f"{name}.png"))
    print(f"✅ {len(names)}개 → {out}")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], int(a[1]), int(a[2]), a[3].split(","), a[4] if len(a) > 4 else "public/icons")
