"""포트폴리오 원본(business/portfolio/index.html)을 Cloudflare용 사이트 폴더로 바꾼다.

- 원본은 Claude 페이지(아티팩트)용이라 그림·영상 주소가 /_blob/<id> 이고, 문서 머리(<!doctype> 등)가 없다.
- 이 도구가 머리를 붙이고 /_blob/<id> 를 assets/<id>.<확장자> 로 바꿔 business/portfolio/site/index.html 을 만든다.
- 그림·영상 파일은 business/portfolio/site/assets/ 에 있어야 한다. 없는 게 있으면 멈춘다.

사용: python3 tools/portfolio_site.py
"""
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "business/portfolio/index.html"
SITE = ROOT / "business/portfolio/site"
ASSETS = SITE / "assets"

HEAD = (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    "<style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;"
    "font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}"
    "img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n"
)
TAIL = "\n</body></html>\n"


def main():
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
