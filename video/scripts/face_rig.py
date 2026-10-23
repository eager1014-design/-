"""말하는 캐릭터용 얼굴 위치표(rig.json) 만들기 — 그림마다 눈동자·입의 정확한 위치를 잰다. 무료.

cut_sheet.py 로 맞춘 그림(900×1100, 머리 위치 같음)에서, 정해진 창 안의 검은 점 무게중심을 찾는다.
영상에서는 이 위치에 입(목소리 크기만큼 열림)과 눈 깜빡임을 그린다.

사용법: python3 scripts/face_rig.py public/characters/main
결과: public/characters/main/rig.json  {"faces/smile": {"eyes": [[x,y],[x,y]], "mouth": [x,y]}, ...}
"""
import glob
import json
import os
import sys

from PIL import Image

WIN = {"eyeL": (394, 421, 328, 366), "eyeR": (486, 513, 328, 366), "mouth": (415, 490, 400, 445)}


def centroid(px, box):
    x0, x1, y0, y1 = box
    pts = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if px[x, y] > 145]
    if not pts:
        return [(x0 + x1) // 2, (y0 + y1) // 2]
    return [round(sum(p[0] for p in pts) / len(pts)), round(sum(p[1] for p in pts) / len(pts))]


root = sys.argv[1] if len(sys.argv) > 1 else "public/characters/main"
rig = {}
for f in sorted(glob.glob(os.path.join(root, "faces", "*.png")) + glob.glob(os.path.join(root, "poses", "*.png"))):
    if f.endswith("sheet_check.png"):
        continue
    im = Image.open(f)
    # 선 = 진한 곳. 투명 그림(cut_sheet 결과)은 불투명도가, 흰 바탕 그림은 어두운 정도가 '진함'
    ink = im.getchannel("A") if im.mode == "RGBA" else im.convert("L").point(lambda v: 255 - v)
    px = ink.load()
    key = os.path.relpath(f, root)[:-4]
    rig[key] = {"eyes": [centroid(px, WIN["eyeL"]), centroid(px, WIN["eyeR"])], "mouth": centroid(px, WIN["mouth"])}
json.dump(rig, open(os.path.join(root, "rig.json"), "w"), indent=1)
print(f"✅ {len(rig)}장 위치 저장: {os.path.join(root, 'rig.json')}")
