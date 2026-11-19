"""포트폴리오 원본(business/portfolio/index.html)을 Cloudflare용 사이트 폴더로 바꾼다.

- 원본은 Claude 페이지(아티팩트)용이라 그림·영상 주소가 /_blob/<id> 이고, 문서 머리(<!doctype> 등)가 없다.
- 이 도구가 머리를 붙이고 /_blob/<id> 를 assets/<id>.<확장자> 로 바꿔 business/portfolio/site/index.html 을 만든다.
- 그림·영상 파일은 business/portfolio/site/assets/ 에 있어야 한다. 없는 게 있으면 멈춘다.

- PWA(폰 홈 화면 앱): site/ 의 manifest.webmanifest · sw.js · pwa.js 를 머리에 연결한다.
  아이콘(site/icons/)과 공유 미리보기 그림(site/assets/og.png)이 없으면 만들고, --icons 를 주면 다시 만든다.

사용: python3 tools/portfolio_site.py [--icons]
"""
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "business/portfolio/index.html"
SITE = ROOT / "business/portfolio/site"
ASSETS = SITE / "assets"

SITE_URL = "https://cheon-workflow.eager1014.workers.dev"
DESC = "사장님이 매일 손으로 하던 일, 자동으로 돌아가게 만듭니다. 워크플로우 디자이너 · 개발자 천성준의 포트폴리오."
NAVY, BLUE, PAPER = "#14233A", "#6FA8FF", "#F4F6F9"
HEAD = (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    f'<meta name="description" content="{DESC}">'
    f'<meta name="theme-color" content="{NAVY}">'
    '<link rel="manifest" href="manifest.webmanifest">'
    '<link rel="icon" href="icons/icon-192.png" type="image/png">'
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-title" content="천성준 자동화">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
    '<meta property="og:type" content="website"><meta property="og:locale" content="ko_KR">'
    '<meta property="og:title" content="천성준 · 가게 업무 자동화 포트폴리오">'
    f'<meta property="og:description" content="{DESC}">'
    f'<meta property="og:url" content="{SITE_URL}/">'
    f'<meta property="og:image" content="{SITE_URL}/assets/og.png">'
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    '<meta name="twitter:card" content="summary_large_image">'
    '<script src="pwa.js" defer></script>'
    "<style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;"
    "font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}"
    "img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n"
)
TAIL = "\n</body></html>\n"


def make_icons():
    """앱 아이콘(남색 바탕 + 흰 '천' + 파란 밑줄)과 카톡·문자 공유 미리보기 그림을 만든다. 명함(남색 테마)과 같은 색."""
    from PIL import Image, ImageDraw, ImageFont
    serif = str(ROOT / "business/fonts/NotoSerifKR[wght].ttf")
    gothic = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

    def f_serif(px, w="Bold"):
        f = ImageFont.truetype(serif, px)
        f.set_variation_by_name(w)
        return f

    def icon(size, safe):  # safe = 글자가 들어갈 가운데 비율 (maskable 은 0.6)
        im = Image.new("RGB", (size, size), NAVY)
        d = ImageDraw.Draw(im)
        f = f_serif(round(size * 0.5 * safe / 0.8))
        bb = d.textbbox((0, 0), "천", font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        bar_h, gap = max(2, round(size * 0.022 * safe / 0.8)), round(size * 0.06 * safe / 0.8)
        top = (size - (th + gap + bar_h)) / 2 - bb[1]
        d.text(((size - tw) / 2 - bb[0], top), "천", font=f, fill="#FFFFFF")
        bw = round(tw * 0.55)
        by = top + bb[3] + gap
        d.rectangle([(size - bw) / 2, by, (size + bw) / 2, by + bar_h], fill=BLUE)
        return im

    out = SITE / "icons"
    out.mkdir(exist_ok=True)
    icon(192, 0.8).save(out / "icon-192.png", optimize=True)
    icon(512, 0.8).save(out / "icon-512.png", optimize=True)
    icon(512, 0.6).save(out / "icon-maskable-512.png", optimize=True)
    icon(180, 0.8).save(out / "apple-touch-icon.png", optimize=True)

    # 공유 미리보기 1200×630
    og = Image.new("RGB", (1200, 630), NAVY)
    d = ImageDraw.Draw(og)
    d.rectangle([0, 0, 1200, 630], fill=NAVY)
    d.text((90, 92), "WORKFLOW DESIGNER & DEVELOPER", font=ImageFont.truetype(gothic, 26, index=4), fill=BLUE)
    d.text((90, 160), "사장님 없으면", font=f_serif(74, "SemiBold"), fill="#FFFFFF")
    d.text((90, 258), "가게가 안 돌아가죠?", font=f_serif(74, "SemiBold"), fill="#FFFFFF")
    d.rectangle([90, 380, 210, 386], fill=BLUE)
    d.text((90, 418), "매일 손으로 하던 일을, 알아서 돌아가는 시스템으로.", font=ImageFont.truetype(gothic, 32, index=2), fill="#C3D3EA")
    d.text((90, 520), "천성준 · William Cheon", font=f_serif(34, "Medium"), fill="#FFFFFF")
    og.paste(icon(120, 0.8), (990, 470))
    og.save(ASSETS / "og.png", optimize=True)
    print(f"아이콘·공유 그림 만듦: {out}, {ASSETS / 'og.png'}")


def main():
    if "--icons" in sys.argv or not (SITE / "icons/icon-512.png").exists() or not (ASSETS / "og.png").exists():
        make_icons()
    html = SRC.read_text(encoding="utf-8")
    files = {p.stem: p.name for p in ASSETS.iterdir() if p.is_file()} if ASSETS.exists() else {}
    missing = []

    def swap(m):
        aid = m.group(1)
        if aid not in files:
            missing.append(aid)
            return m.group(0)
        return f"assets/{files[aid]}"

    html = re.sub(r"/_blob/([0-9a-f]{32})", swap, html)
    if missing:
        sys.exit(
            "그림·영상 파일이 없습니다: " + ", ".join(sorted(set(missing)))
            + "\n→ 포트폴리오 아티팩트에서 받아 business/portfolio/site/assets/ 에 넣으세요."
        )
    if not html.lstrip().lower().startswith("<!doctype"):
        html = HEAD + html + TAIL
    # 눈에 안 보이는 만든 시각 — 사이트에 반영됐는지 확인용 (curl ... | grep portfolio-built)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    html = html.replace("<head>", f'<head><meta name="portfolio-built" content="{stamp}">', 1)
    (SITE / "index.html").write_text(html, encoding="utf-8")
    print(f"완료: {SITE / 'index.html'} (그림·영상 {len(files)}개, 만든 시각 {stamp})")


if __name__ == "__main__":
    main()
