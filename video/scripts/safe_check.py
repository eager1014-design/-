"""세로 쇼츠가 안전 영역(앱 화면이 덮지 않는 곳) 안에 들어오는지 눈으로 확인하는 그림을 만든다. 무료.

장면마다 끝 무렵 한 프레임을 뽑아 안전 영역 선(빨강)을 긋고, 한 장(safe_check.png)으로 이어 붙인다.
안전 영역 값: .claude/skills/video-production/safe_zone.md (x 51~1029, y 193~1399)

사용법: python3 scripts/safe_check.py public/episodes/<편>/episode.json [저장 폴더=../.tmp/safe_check]
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw

SAFE = (51, 193, 1029, 1399)
ep_path = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join("..", ".tmp", "safe_check")
os.makedirs(out, exist_ok=True)

# 장면 시작 프레임 계산은 영상 공장(timing.js)이 하는 그대로
frames = subprocess.run(["node", "--input-type=module", "-e", f"""
import fs from 'node:fs'; import {{applyPace, sceneFrames}} from './src/timing.js'; import {{TRANSITION_FRAMES}} from './src/theme.js';
const ep=JSON.parse(fs.readFileSync('{ep_path}','utf8')); let st=0; const out=[];
for (const s of applyPace(ep.scenes, ep.pace)) {{ const f=sceneFrames(s); out.push([s.id, st+Math.round(f*0.8)]); st+=f-TRANSITION_FRAMES; }}
console.log(JSON.stringify(out));"""], capture_output=True, text=True, check=True).stdout
shots = []
for sid, f in json.loads(frames):
    png = os.path.join(out, f"{sid}.png")
    subprocess.run(["npx", "remotion", "still", "Episode", png, f"--props={ep_path}", f"--frame={f}", "--log=error"], capture_output=True)
    im = Image.open(png).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle(SAFE, outline=(255, 40, 40), width=6)
    shots.append(im.resize((im.width // 3, im.height // 3)))
    print(f"  {sid} (프레임 {f})")
sheet = Image.new("RGB", (shots[0].width * len(shots), shots[0].height), "white")
for i, s in enumerate(shots):
    sheet.paste(s, (i * s.width, 0))
sheet.save(os.path.join(out, "safe_check.png"))
print(f"✅ {os.path.join(out, 'safe_check.png')} — 빨간 선 밖에 글씨·자막·얼굴이 있으면 고칠 것")
