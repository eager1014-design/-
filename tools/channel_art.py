"""유튜브 채널 아트·프로필 사진 만들기 Tool — 신뢰 파랑 + 새 캐릭터(동그란 안경) (2026-10-24)

사용법:
  python3 tools/channel_art.py [--name=예민한자립가] [--tagline="예민한 사람을 위한 쉬운 심리학"] [--out=폴더]
  → business/channel/<폴더>/banner.png (2560×1440, 모든 기기 안전 영역 1546×423 안에 글씨·캐릭터)
     profile.png (800×800, 유튜브가 동그랗게 자름) · preview.png (안전 영역 점선 표시)
캐릭터 그림: business/character/<hair|bald>_<자세>.fill.png
글꼴: 검은고딕(Black Han Sans, OFL) — video/public/fonts
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
arg = lambda k, d: next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith(f"--{k}=")), d)
NAME = arg("name", "예민한자립가")
TAGLINE = arg("tagline", "예민한 사람을 위한 쉬운 심리학")
OUT = os.path.join(ROOT, "business", "channel", arg("out", "blue"))
BLUE, BLUE_DEEP, WHITE, INK = "#2160D6", "#163F94", "#FFFFFF", "#15223B"
TITLE_FONT = os.path.join(ROOT, "video", "public", "fonts", "BlackHanSans-Regular.ttf")
BODY_FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
CHAR = os.path.join(ROOT, "business", "character")


def char(name, height):
    im = Image.open(os.path.join(CHAR, f"{name}.fill.png")).convert("RGBA")
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def banner():
    W, H = 2560, 1440
    SW, SH = 1546, 423  # 모든 기기에서 보이는 가운데 안전 영역
    sx, sy = (W - SW) // 2, (H - SH) // 2
    im = Image.new("RGB", (W, H), BLUE)
    d = ImageDraw.Draw(im)
    # 바탕: 아주 옅은 점무늬 (단순함 유지)
    for yy in range(0, H, 64):
        for xx in range(0 if (yy // 64) % 2 else 32, W, 64):
            d.ellipse([xx - 3, yy - 3, xx + 3, yy + 3], fill="#2A69DC")
    c = char("hair_explain", 400)
    cx = sx + SW - c.width - 30
    im.paste(c, (cx, sy + SH - c.height + 6), c)
    tf = ImageFont.truetype(TITLE_FONT, 150)
    bf = ImageFont.truetype(BODY_FONT, 56, index=4)
    tx = sx + 40
    d.text((tx, sy + 70), NAME, font=tf, fill=WHITE)
    d.text((tx + 4, sy + 262), TAGLINE, font=bf, fill="#DCE7FB")
    return im, (sx, sy, SW, SH)


def profile():
    S = 800
    im = Image.new("RGB", (S, S), BLUE)
    c = char("hair_happy", 1150)  # 얼굴이 동그라미를 꽉 채우게 크게 → 위쪽만 보이게
    im.paste(c, ((S - c.width) // 2, 110), c)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    b, (sx, sy, SW, SH) = banner()
    b.save(os.path.join(OUT, "banner.png"))
    p = profile()
    p.save(os.path.join(OUT, "profile.png"))
    pv = b.copy()
    d = ImageDraw.Draw(pv)
    for k in range(sx, sx + SW, 30):
        d.line([k, sy, k + 15, sy], fill="#FF3B30", width=4)
        d.line([k, sy + SH, k + 15, sy + SH], fill="#FF3B30", width=4)
    pv = pv.resize((1280, 720))
    circ = Image.new("L", (800, 800), 0)
    ImageDraw.Draw(circ).ellipse([0, 0, 800, 800], fill=255)
    small = p.copy()
    small.putalpha(circ)
    small = small.resize((220, 220))
    pv.paste(small, (40, 470), small)
    pv.save(os.path.join(OUT, "preview.png"))
    print(f"✅ {OUT}\n   banner.png (2560×1440) · profile.png (800×800) · preview.png (빨간 점선 = 모든 기기 안전 영역, 왼쪽 아래 = 프로필 동그라미)")


if __name__ == "__main__":
    main()
