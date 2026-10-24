"""눈동자로 캐릭터 그림 맞추기 + 입·눈 위치표(rig.json) 만들기 — 동그란 안경 캐릭터용 (2026-10-24). 무료.

왜: cut_sheet.py 는 '머리 위·귀~귀 폭'으로 맞추는데, 머리카락 몇 가닥·큰 안경이 있는 새 캐릭터는 그 기준이 흔들려
    표정마다 얼굴 위치·크기가 들쭉날쭉했다. 꽉 찬 검은 눈동자는 모든 그림에서 또렷하므로 그걸 기준으로 한다.
방법: 1) 굵은 선은 지우고 꽉 찬 덩어리만 남기는 필터(MinFilter 21) → 남는 두 점 = 눈동자
      (17 로 하면 안경테·귀가 만나는 곳까지 남아 위치가 틀어졌음)
      2) 눈동자 가운데를 (450, EYE_Y), 사이 거리를 EYE_D 로 맞춤 → 3) 눈 높이에서 귀~귀 폭을 가운데값으로 한 번 더 맞춤
      4) 눈 감은 그림처럼 눈동자가 없으면 다른 그림들의 평균 위치를 씀
      5) rig.json: 눈 = 눈동자, 입 = 눈 가운데 아래 창(+85~+160px)의 선 무게중심

사용법 (cut_sheet.py 로 자른 다음):
  python3 scripts/align_by_eyes.py public/characters/round
"""
import glob
import json
import os
import statistics
import sys

from PIL import Image, ImageFilter

EYE_D, EYE_Y, CX = 150, 400, 450


def pupils(a, box=(150, 750, 250, 600)):
    core = a.point(lambda v: 255 if v > 110 else 0).filter(ImageFilter.MinFilter(21))
    x0, x1, y0, y1 = box
    pts = [(x, y) for y in range(y0, y1, 2) for x in range(x0, x1, 2) if core.getpixel((x, y))]
    if len(pts) < 6:
        return None
    mid = statistics.median(p[0] for p in pts)
    pts = [p for p in pts if abs(p[0] - mid) < 160]  # 귀 쪽 작은 점 빼기
    L = [p for p in pts if p[0] < mid]
    R = [p for p in pts if p[0] >= mid]
    if not L or not R:
        return None
    c = lambda ps: (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps))
    l, r = c(L), c(R)
    return (l, r) if 90 < r[0] - l[0] < 260 else None


def pupil_blobs(a, box):
    """선과 떨어져 있는 꽉 찬 작은 덩어리(눈동자)를 찾는다 — 연결된 점 묶음 중 크기 15~70px, 꽉 찬 비율 0.55 이상"""
    x0, x1, y0, y1 = box
    ink = {(x, y) for y in range(y0, y1) for x in range(x0, x1) if a.getpixel((x, y)) > 110}
    seen, blobs = set(), []
    for p in ink:
        if p in seen:
            continue
        stack, comp = [p], []
        seen.add(p)
        while stack:
            q = stack.pop()
            comp.append(q)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (q[0] + d[0], q[1] + d[1])
                if n in ink and n not in seen:
                    seen.add(n)
                    stack.append(n)
        xs, ys = [c[0] for c in comp], [c[1] for c in comp]
        w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if 12 <= w <= 70 and 15 <= h <= 80 and len(comp) / (w * h) > 0.55 and min(xs) > x0 and max(xs) < x1 - 1:
            blobs.append((len(comp), sum(xs) / len(xs), sum(ys) / len(ys)))
    blobs = sorted(blobs, reverse=True)[:2]
    if len(blobs) < 2:
        return None
    (_, ax, ay), (_, bx, by) = sorted(blobs, key=lambda b: b[1])
    return (ax, ay), (bx, by)


def place(f, s, mx, my):
    for g in (f, f.replace(".png", ".fill.png")):
        if not os.path.exists(g):
            continue
        img = Image.open(g).convert("RGBA")
        big = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
        can = Image.new("RGBA", img.size, (0, 0, 0, 0))
        can.paste(big, (round(CX - mx * s), round(EYE_Y - my * s)), big)
        can.save(g)


def main(root):
    files = [f for f in sorted(glob.glob(os.path.join(root, "faces", "*.png")) + glob.glob(os.path.join(root, "poses", "*.png")))
             if not f.endswith(".fill.png") and "sheet_check" not in f]
    found = {f: pupils(Image.open(f).convert("RGBA").getchannel("A")) for f in files}
    ok = [v for v in found.values() if v]
    med = lambda fn: statistics.median(fn(v) for v in ok)
    for f in files:
        e = found[f]
        if e:
            (lx, ly), (rx, ry) = e
            place(f, EYE_D / (rx - lx), (lx + rx) / 2, (ly + ry) / 2)
        else:
            print("눈동자 없음 → 평균 위치:", f)
            place(f, EYE_D / med(lambda v: v[1][0] - v[0][0]), med(lambda v: (v[0][0] + v[1][0]) / 2), med(lambda v: (v[0][1] + v[1][1]) / 2))

    def width(f):
        a = Image.open(f).convert("RGBA").getchannel("A")
        ws = []
        for y in range(EYE_Y - 20, EYE_Y + 21, 4):
            xs = [x for x in range(CX - 320, CX + 320) if a.getpixel((x, y)) > 110]
            if xs:
                ws.append(xs[-1] - xs[0])
        return statistics.median(ws)

    W = {f: width(f) for f in files}
    target = statistics.median(W.values())
    for f in files:
        place(f, target / W[f], CX, EYE_Y)

    rig = {}
    for f in files:
        a = Image.open(f).convert("RGBA").getchannel("A")
        e = pupil_blobs(a, (CX - 170, CX + 170, EYE_Y - 60, EYE_Y + 60))  # 맞춘 뒤에는 눈 높이 근처만 (턱 괸 손·안경테 오인 방지)
        eyes = [[round(e[0][0]), round(e[0][1])], [round(e[1][0]), round(e[1][1])]] if e else [[CX - EYE_D // 2, EYE_Y], [CX + EYE_D // 2, EYE_Y]]
        mx, my = (eyes[0][0] + eyes[1][0]) // 2, (eyes[0][1] + eyes[1][1]) // 2
        pts = [(x, y) for y in range(my + 85, my + 160) for x in range(mx - 60, mx + 60) if a.getpixel((x, y)) > 145]
        mouth = [round(sum(p[0] for p in pts) / len(pts)), round(sum(p[1] for p in pts) / len(pts))] if pts else [mx, my + 110]
        key = os.path.relpath(f, root)[:-4]
        rig[key] = rig[key + ".fill"] = {"eyes": eyes, "mouth": mouth}
    json.dump(rig, open(os.path.join(root, "rig.json"), "w"), indent=1)
    print(f"✅ {len(files)}장 맞춤, 위치표: {os.path.join(root, 'rig.json')} (머리 폭 {target}px)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/characters/round")
