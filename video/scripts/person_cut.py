"""인물 사진에서 사람만 오려 투명 PNG 로 → 영상 '사진 오려 붙이기'(scenes.jsx Photo 의 cutout) 용. 무료 (rembg, 처음 한 번 받아 둔 모델).

사용법:  .venv/bin/python video/scripts/person_cut.py <사진.jpg> [더 ...]   → 같은 폴더에 <이름>.cut.png
방법: 사람 전용 모델(u2net_human_seg)로 오리고, 가장 큰 덩어리(사람)만 남김 — 옆의 잡티·글씨 조각은 버림.
흑백 옛날 사진도 됨. 사람을 못 찾으면(남은 면적 5% 미만) 파일을 안 만들고 끝 코드 2.
"""
import sys

import cv2
import numpy as np
from rembg import new_session, remove

session = new_session("u2net_human_seg")
fail = 0
for f in sys.argv[1:]:
    img = cv2.imread(f, cv2.IMREAD_COLOR)
    if img is None:
        print(f"❌ 못 읽음: {f}")
        fail = 1
        continue
    out = np.array(remove(img, session=session))  # BGRA (복사본이어야 고칠 수 있음)
    a = out[..., 3]
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > 128).astype(np.uint8))
    if n < 2 or st[1:, cv2.CC_STAT_AREA].max() < 0.05 * a.size:
        print(f"❓ 사람을 못 찾음: {f}")
        fail = 2
        continue
    keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    big = cv2.dilate((lab == keep).astype(np.uint8), np.ones((5, 5), np.uint8))
    out[..., 3] = (a * big).astype(np.uint8)
    ys, xs = np.nonzero(out[..., 3] > 10)  # 사람 둘레로 잘라냄
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    dst = f.rsplit(".", 1)[0] + ".cut.png"
    cv2.imwrite(dst, out)
    print(f"✅ {dst} ({out.shape[1]}x{out.shape[0]})")
sys.exit(fail)
