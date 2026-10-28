"""그림(삽화·표정 선화)에서 '선 하나하나'를 뽑아 그리는 순서대로 저장한다 → 영상에서 손이 펜으로 한 줄씩 그리는 연출용 (scenes.jsx DrawStrokes).

사용법:  .venv/bin/python video/scripts/strokes.py <그림.png> [<더 많은 그림> ...]
         → 그림 옆에 <이름>.strokes.json  {"w","h","bg","paths":[{"pts":[[x,y]...],"w":굵기}]}  (좌표는 그림 픽셀)
준비:    python3 -m venv .venv && .venv/bin/pip install numpy opencv-python-headless scikit-image  (무료, 처음 한 번)

방법: 선만 골라(바탕이 어두우면 밝은 선, 밝으면 어두운 선, 투명 그림이면 불투명한 곳) → 가는 뼈대로 깎기(skeletonize)
→ 끝점·갈림길 사이를 한 획으로 따라가기 → 짧은 부스러기는 버리고 → 위에서 아래로, 직전 획 끝에서 가까운 획부터 이어 그리는 순서.
"""
import json
import sys

import cv2
import numpy as np
from skimage.morphology import skeletonize

MAX_SIDE = 900      # 계산용 크기 (클수록 섬세하지만 느림)
MIN_LEN = 10        # 이보다 짧은 획은 버림 (계산용 크기 기준 px)
MAX_PATHS = 420     # 너무 잘게 쪼개진 그림은 긴 획부터 이만큼만


def line_mask(img):
    """그림 → 선 픽셀(1)·바탕(0), 바탕색."""
    if img.shape[2] == 4 and (img[..., 3] < 250).mean() > 0.2:  # 투명 바탕 선화 (캐릭터 표정 그림)
        return (img[..., 3] > 128).astype(np.uint8), None
    rgb = img[..., :3]
    gray = cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)
    border = np.concatenate([gray[:8].ravel(), gray[-8:].ravel(), gray[:, :8].ravel(), gray[:, -8:].ravel()])
    edge = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3)])
    bg = "#%02x%02x%02x" % tuple(int(v) for v in np.median(edge, axis=0)[::-1])
    if np.median(border) < 110:  # 어두운 바탕 → 밝은 선
        m = gray > max(110, np.median(border) + 70)
    else:  # 밝은 바탕 → 어두운 선 (수채화 바탕 무늬는 덜 어두워서 빠짐)
        m = gray < min(120, np.median(border) - 70)
    return m.astype(np.uint8), bg


def trace(skel):
    """뼈대 픽셀 → 획 목록 (끝점·갈림길에서 끊음)."""
    h, w = skel.shape
    on = set(zip(*np.nonzero(skel)))
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in on]
    deg = {p: len(nb(p)) for p in on}
    used = set()  # 지나간 '이음'(두 점 쌍)
    paths = []

    def walk(a, b):
        path = [a, b]
        used.add(frozenset((a, b)))
        while deg[b] == 2:
            nxt = [q for q in nb(b) if frozenset((b, q)) not in used]
            if not nxt:
                break
            a, b = b, nxt[0]
            used.add(frozenset((a, b)))
            path.append(b)
        return path

    starts = [p for p in on if deg[p] != 2]  # 끝점·갈림길에서 출발
    for s in sorted(starts):
        for q in nb(s):
            if frozenset((s, q)) not in used:
                paths.append(walk(s, q))
    for s in sorted(on):  # 끝이 없는 고리(동그라미)
        for q in nb(s):
            if frozenset((s, q)) not in used:
                paths.append(walk(s, q))
    return paths


def order(paths):
    """위에서부터 시작해, 직전 획 끝에서 가장 가까운 획을 다음으로 (필요하면 뒤집어서)."""
    left = sorted(paths, key=lambda p: min(y for x, y in p["pts"]))
    out = [left.pop(0)]
    while left:
        ex, ey = out[-1]["pts"][-1]
        best, rev, bd = 0, False, 1e18
        for i, p in enumerate(left):
            for r, (x, y) in ((False, p["pts"][0]), (True, p["pts"][-1])):
                d = (x - ex) ** 2 + (y - ey) ** 2
                if d < bd:
                    best, rev, bd = i, r, d
        p = left.pop(best)
        out.append({**p, "pts": p["pts"][::-1]} if rev else p)
    return out


def strokes(file):
    img = cv2.imread(file, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit(f"그림을 못 읽음: {file}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    H, W = img.shape[:2]
    k = MAX_SIDE / max(H, W)
    small = cv2.resize(img, (round(W * k), round(H * k)), interpolation=cv2.INTER_AREA) if k < 1 else img
    k = min(k, 1)
    m, bg = line_mask(small)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    for i in range(1, n):  # 점·잡티 지우기
        if st[i, cv2.CC_STAT_AREA] < 12:
            m[lab == i] = 0
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    skel = skeletonize(m > 0)
    raw = trace(skel)
    paths = []
    for p in raw:
        pts = np.array([[x, y] for y, x in p], np.float32)
        if len(pts) < 2:
            continue
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
        if length < MIN_LEN:
            continue
        width = 2 * float(max(dist[y, x] for y, x in p)) + 2
        simp = cv2.approxPolyDP(pts.reshape(-1, 1, 2), 1.2, False).reshape(-1, 2)
        paths.append({"len": length, "w": round(width / k, 1), "pts": [[round(float(x) / k, 1), round(float(y) / k, 1)] for x, y in simp]})
    paths.sort(key=lambda p: -p["len"])
    ordered = order(paths[:MAX_PATHS])
    data = {"w": W, "h": H, "bg": bg, "paths": [{"pts": p["pts"], "w": p["w"]} for p in ordered]}
    out = file.rsplit(".", 1)[0] + ".strokes.json"
    json.dump(data, open(out, "w"), separators=(",", ":"))
    return out, len(data["paths"])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for f in sys.argv[1:]:
        out, n = strokes(f)
        print(f"✅ {out} — 획 {n}개")
