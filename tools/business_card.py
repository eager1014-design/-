"""명함 만들기 Tool — 인쇄소에 바로 맡길 수 있는 앞·뒷면 (90×50mm, 사방 2mm 재단 여유, 300dpi).

사용법:
  python3 tools/business_card.py [--theme=gold|noir|light] [--name-en="William Cheon"] [--out=폴더이름]   → business/card/<폴더>/
  python3 tools/business_card.py --theme=gold --strong --out=final-gold   → 사장님 최종 명함
  python3 tools/business_card.py --theme=gold --out=final-gold --menu   → 같은 폴더에 한 장짜리 자동화 메뉴판(A5) menu.png·menu_print.pdf 에 front.png, back.png, card_print.pdf(2쪽), preview.png
  gold(검정+금색만, 사장님 최종 선택 2026-10-23) · noir(검정+보라·청록 빛 번짐) · light(처음 버전, 회백색+초록)
내용(이름·직업·연락처·QR 주소)은 아래 CARD 에서 고친다. QR 은 segno(pip install --user segno).
글꼴은 맥 기본 한글 글꼴(Apple SD Gothic Neo)이라 인쇄 파일에 그림으로 박혀서 글꼴 없는 인쇄소에서도 그대로 나온다.
"""
import os
import random
import sys
import segno
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--theme=")), "noir")
OUT_NAME = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--out=")), THEME)
OUT = os.path.join(ROOT, "business", "card", OUT_NAME)

CARD = {
    "name": "천성준",
    "name_en": next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--name-en=")), "William Cheon"),
    "title": "워크플로우 디자이너 · 개발자",
    "title_en": "WORKFLOW DESIGNER & DEVELOPER",
    "tagline": ["사장님이 매일 손으로 하던 일,", "자동으로 돌아가게 만듭니다."],
    "contacts": [("T", "010-4763-7063"), ("K", "카카오톡 eager1014"), ("E", "eager1014@gmail.com")],
    "back_title": ["사장님 없으면", "가게가 안 돌아가죠?"],
    # 사장님 입에서 나오는 말 + 실제로 만들어 드릴 수 있는 것만 (2026-10-23 사장님: "키워드가 안 와닿는다")
    # 2026-10-24: 엑셀·장부 → 카톡 주문·예약 (매출 장부는 캐시노트 같은 무료 앱이 이미 해 줌 — 이미 있는 프로그램이 못 하는 틈만)
    "back_items": ["카톡으로 온 주문·예약 옮겨 적기", "하나에 10분 걸리는 리뷰 답글", "신상·메뉴 사진마다 쓰는 설명 글", "알바에게 같은 걸 또 설명하기", "있는 줄도 몰랐던 지원금"],
    "qr_url": "https://claude.ai/artifact/HfrXKBoNL643BggQ1Tpy8n",
    "qr_label": "내 가게 귀찮은 일 골라보기",
    "form_url": "https://script.google.com/macros/s/AKfycbxVgmsZq-YnQhNeOqFIgum5Pz9MyR7ZLxbgQ0hesh_VD8DcrLgYLuL-QdB20gzsBvNp/exec",
    # 한 장짜리 자동화 메뉴판 (python3 tools/business_card.py --menu)
    "menu": [
        ("매출·지출 월간 리포트", "포스·카드·배달앱·영수증을 모아 “이번 달 얼마 남았지?”를 한 장으로", "매주 엑셀 옮겨 적기", "매달 1일 리포트가 메일로"),
        ("리뷰 답글 초안", "네이버·배민·구글 리뷰에 사장님 말투로 답글 초안", "리뷰마다 고민하며 쓰기", "확인하고 붙여넣기만"),
        ("예약 리마인드 · 노쇼 관리", "전날 안내 문자, 노쇼 손님 기록", "일일이 전화·문자", "자동 안내 + 노쇼 표시"),
        ("매일 홍보 글", "인스타·블로그·스레드 글 후보를 아침마다", "매일 뭘 올릴지 고민", "아침에 골라서 올리기"),
        ("지원사업·정책자금 알림", "우리 가게에 해당하는 공고만 골라 알림", "공고를 몰라서 놓침", "해당 공고만 알림"),
    ],
}

DPI = 300
MM = DPI / 25.4
BLEED = 2  # mm
W, H = round((90 + 2 * BLEED) * MM), round((50 + 2 * BLEED) * MM)
SAFE = round((BLEED + 4) * MM)  # 재단선 안쪽 4mm 까지만 글씨

PAPER, INK, MUTED, ACCENT, ACCENT_SOFT, MARK = "#F2F4F1", "#17212A", "#5B6670", "#0E7A68", "#DCEFEA", "#FFE27A"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
WEIGHT = {"regular": 0, "medium": 2, "semibold": 4, "bold": 6, "light": 8}


def font(size_pt, weight="regular"):
    return ImageFont.truetype(FONT, round(size_pt * DPI / 72), index=WEIGHT[weight])


def front():
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    # 왼쪽 세로 띠 (재단 여유까지 칠함)
    d.rectangle([0, 0, round((BLEED + 2.2) * MM), H], fill=ACCENT)
    x = SAFE + round(1.5 * MM)
    y = SAFE
    d.text((x, y), CARD["title_en"], font=font(6.2, "semibold"), fill=ACCENT, spacing=0)
    y += round(5.2 * MM)
    d.text((x, y), CARD["name"], font=font(19, "bold"), fill=INK)
    name_w = d.textlength(CARD["name"], font=font(19, "bold"))
    d.text((x + name_w + round(3 * MM), y + round(3.1 * MM)), CARD["title"], font=font(8, "medium"), fill=MUTED)
    y += round(10.5 * MM)
    # 한 줄 약속 (둘째 줄에 형광펜)
    l1, l2 = CARD["tagline"]
    f = font(8.2, "medium")
    d.text((x, y), l1, font=f, fill=INK)
    y += round(4.4 * MM)
    w2 = d.textlength(l2, font=f)
    d.rectangle([x - 4, y + round(2.1 * MM), x + w2 + 4, y + round(3.7 * MM)], fill=MARK)
    d.text((x, y), l2, font=f, fill=INK)
    # 연락처 (아래 정렬)
    fc, fl = font(7.2, "medium"), font(6, "bold")
    yy = H - SAFE - round(3.6 * MM) * len(CARD["contacts"]) + round(0.6 * MM)
    for label, value in CARD["contacts"]:
        d.text((x, yy + 6), label, font=fl, fill=ACCENT)
        d.text((x + round(4 * MM), yy), value, font=fc, fill=INK)
        yy += round(3.6 * MM)
    return im


def back():
    im = Image.new("RGB", (W, H), ACCENT)
    d = ImageDraw.Draw(im)
    # QR (흰 바탕 상자, 오른쪽)
    qr = segno.make(CARD["qr_url"], error="m")
    size = round(24 * MM)
    tmp = os.path.join(OUT, "_qr.png")
    qr.save(tmp, scale=20, border=2, dark=INK, light="#FFFFFF")
    q = Image.open(tmp).convert("RGB").resize((size, size), Image.NEAREST)
    os.remove(tmp)
    qx, qy = W - SAFE - size, SAFE + round(1 * MM)
    im.paste(q, (qx, qy))
    fl = font(6.4, "semibold")
    lw = d.textlength(CARD["qr_label"], font=fl)
    d.text((qx + (size - lw) / 2, qy + size + round(1.6 * MM)), CARD["qr_label"], font=fl, fill="#FFFFFF")
    # 왼쪽 글
    x, y = SAFE, SAFE
    ft = font(10.5, "bold")
    for line in CARD["back_title"]:
        d.text((x, y), line, font=ft, fill="#FFFFFF")
        y += round(5.4 * MM)
    y += round(2.2 * MM)
    fi = font(6.8, "medium")
    for item in CARD["back_items"]:
        d.ellipse([x, y + round(1.2 * MM), x + round(1.3 * MM), y + round(2.5 * MM)], fill=MARK)
        d.text((x + round(2.6 * MM), y), item, font=fi, fill=ACCENT_SOFT)
        y += round(3.5 * MM)
    return im


# 고급 세리프 글꼴 (구글 폰트, 무료·상업 사용 가능 OFL) — business/fonts/ 에 받아 둠
FONT_DIR = os.path.join(ROOT, "business", "fonts")


# --strong: (2026-10-23 사장님 최종, 고운바탕·나눔명조와 비교 후 노토명조 유지) 글씨를 한 단계 굵고 밝게, 한글 이름을 크게 (검정 바탕에 얇은 글씨는 인쇄하면 잉크가 번져 묻힘)
STRONG = "--strong" in sys.argv
BUMP = {"Light": "Regular", "Regular": "Medium", "Medium": "SemiBold", "SemiBold": "Bold"}


def serif(size_pt, weight="Light", latin=False):
    if STRONG and not latin:
        weight = BUMP.get(weight, weight)
    f = ImageFont.truetype(os.path.join(FONT_DIR, "CormorantGaramond[wght].ttf" if latin else "NotoSerifKR[wght].ttf"), round(size_pt * DPI / 72))
    f.set_variation_by_name(weight)
    return f


def spaced(d, xy, text, f, fill, gap_mm):
    """자간을 넓혀 한 글자씩 쓴다 (작은 영문 제목용)."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + round(gap_mm * MM)
    return x


# ── noir: 거의 검은 바탕 + 보라·청록 빛 번짐 + 상아색 글씨 + 샴페인 골드 ──
# 테마별 색: ivory = 주 글씨, gold = 강조(선·작은 제목), muted = 보조 글씨, glow_f/glow_b = 앞·뒷면 빛 번짐
PALETTES = {
    "noir": {"bg": (12, 12, 16), "ivory": "#EDE7DC", "muted": "#8F8A82", "gold": "#CBB386", "line": "#3A3A42",
             "glow_f": [(0.92, 0.05, 0.30, (58, 34, 92)), (0.70, 1.05, 0.26, (14, 70, 74)), (0.05, 0.55, 0.12, (30, 24, 46))],
             "glow_b": [(0.10, 0.10, 0.26, (14, 66, 72)), (0.95, 0.95, 0.30, (62, 36, 96))]},
    # 2026-10-23 사장님: "검은색이랑 금색만" — 깊은 검정 + 아주 옅은 따뜻한 빛 + 금색 글씨
    "gold": {"bg": (9, 9, 10), "ivory": "#E8D7A6", "muted": "#9E8B5E", "gold": "#C9A45C", "line": "#3A3426",
             "glow_f": [(0.85, 0.10, 0.30, (26, 22, 15))], "glow_b": [(0.15, 0.90, 0.30, (26, 22, 15))]},
}
NOIR = dict(PALETTES.get(THEME, PALETTES["noir"]))
if STRONG and THEME == "gold":
    NOIR.update(ivory="#F3E6C2", muted="#C9B07A", gold="#D6B46A")


def haze(glows, seed):
    """검은 바탕에 흐릿한 빛 덩어리들을 번지게 하고 아주 고운 입자(필름 느낌)를 얹는다."""
    im = Image.new("RGB", (W, H), NOIR["bg"])
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for (cx, cy, r, color) in glows:
        d.ellipse([cx * W - r * W, cy * H - r * W, cx * W + r * W, cy * H + r * W], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(W * 0.11))
    im = ImageChops.add(im, layer)
    rnd = random.Random(seed)
    noise = Image.effect_noise((W, H), 18).convert("RGB")
    im = Image.blend(im, ImageChops.multiply(im, noise.point(lambda v: 200 + v // 5)), 0.35)
    return im


def front_noir():
    im = haze(NOIR["glow_f"], 1)
    d = ImageDraw.Draw(im)
    x, y = SAFE + round(1 * MM), SAFE + round(0.2 * MM)
    spaced(d, (x, y), CARD["title_en"], serif(6.2, "SemiBold", latin=True), NOIR["gold"], 0.7)
    y += round(5.6 * MM)
    d.text((x, y), CARD["name_en"], font=serif(25, "Regular" if STRONG else "Light", latin=True), fill=NOIR["ivory"])
    y += round(11.4 * MM)
    if STRONG:  # 한글 이름을 크게, 직업은 옆에 금색으로
        fn = serif(10.5, "Regular")
        d.text((x, y - round(0.8 * MM)), CARD["name"], font=fn, fill=NOIR["ivory"])
        d.text((x + d.textlength(CARD["name"], font=fn) + round(2.6 * MM), y + round(0.9 * MM)), CARD["title"], font=serif(6.6, "Light"), fill=NOIR["gold"])
        y += round(0.8 * MM)
    else:
        d.text((x, y), f"{CARD['name']}   ·   {CARD['title']}", font=serif(6.6, "Light"), fill=NOIR["muted"])
    y2 = y + round(5.2 * MM)
    d.line([x, y2, x + round(14 * MM), y2], fill=NOIR["gold"], width=2)
    yy = y2 + round(2.6 * MM)
    for line in CARD["tagline"]:
        d.text((x, yy), line, font=serif(6.2, "Light"), fill=NOIR["ivory"])
        yy += round(3.4 * MM)
    # 연락처: 오른쪽 아래 정렬. Cormorant 숫자는 옛날식(0·1 이 o·I 처럼 보임)이라 숫자가 또렷한 명조체로
    rows = [v for _, v in CARD["contacts"]]
    ry = H - SAFE - round(3.3 * MM) * len(rows) + round(0.2 * MM)
    for v in rows:
        f = serif(6.4, "Light")
        tw = d.textlength(v, font=f)
        d.text((W - SAFE - tw, ry), v, font=f, fill=NOIR["ivory"])
        ry += round(3.3 * MM)
    return im


def back_noir():
    im = haze(NOIR["glow_b"], 2)
    d = ImageDraw.Draw(im)
    # QR: 상아색 작은 카드 위 (어두운 바탕에서도 모든 폰이 읽게 '밝은 바탕·어두운 점')
    size = round(19 * MM)
    pad = round(2.2 * MM)
    qr = segno.make(CARD["qr_url"], error="m")
    tmp = os.path.join(OUT, "_qr.png")
    qr.save(tmp, scale=20, border=1, dark="#14141A", light=NOIR["ivory"])
    q = Image.open(tmp).convert("RGB").resize((size, size), Image.NEAREST)
    os.remove(tmp)
    bx2, by1 = W - SAFE, SAFE
    bx1, by2 = bx2 - size - 2 * pad, by1 + size + 2 * pad
    d.rounded_rectangle([bx1, by1, bx2, by2], radius=round(1.6 * MM), fill=NOIR["ivory"])
    im.paste(q, (bx1 + pad, by1 + pad))
    fl = serif(5.4, "Regular")
    lw = d.textlength(CARD["qr_label"], font=fl)
    d.text(((bx1 + bx2) / 2 - lw / 2, by2 + round(1.8 * MM)), CARD["qr_label"], font=fl, fill=NOIR["gold"])
    x, y = SAFE + round(1 * MM), SAFE + round(0.2 * MM)
    for line in CARD["back_title"]:
        d.text((x, y), line, font=serif(9, "Light"), fill=NOIR["ivory"])
        y += round(5.2 * MM)
    y += round(2.4 * MM)
    d.line([x, y, x + round(10 * MM), y], fill=NOIR["gold"], width=2)
    y += round(2.8 * MM)
    fi = serif(5.8, "Light")
    for item in CARD["back_items"]:
        d.text((x, y), "—", font=fi, fill=NOIR["gold"])
        d.text((x + round(3.2 * MM), y), item, font=fi, fill=NOIR["ivory"])
        y += round(3.1 * MM)
    # 맨 아래 작은 서명
    spaced(d, (x, H - SAFE - round(2.4 * MM)), CARD["name_en"].upper(), serif(5.2, "Medium", latin=True), NOIR["gold"], 0.6)
    return im


def menu_sheet():
    """한 장짜리 자동화 메뉴판 (A5 세로 148×210mm, 사방 2mm 재단 여유, 검정+금색). 가게에서 보여주고 체크받는 용도."""
    MW, MH = round(152 * MM), round(214 * MM)
    global W, H
    W0, H0 = W, H
    W, H = MW, MH
    im = haze([(0.85, 0.08, 0.35, (26, 22, 15)), (0.1, 0.95, 0.35, (22, 19, 13))], 3)
    W, H = W0, H0
    d = ImageDraw.Draw(im)
    S = round((2 + 9) * MM)
    x, y = S, S
    spaced(d, (x, y), "AUTOMATION MENU", serif(8, "SemiBold", latin=True), NOIR["gold"], 1.0)
    y += round(9 * MM)
    d.text((x, y), "사장님, 이 중에", font=serif(21, "Light"), fill=NOIR["ivory"])
    y += round(10 * MM)
    d.text((x, y), "제일 귀찮은 일 하나만 골라주세요.", font=serif(21, "Light"), fill=NOIR["ivory"])
    y += round(12.5 * MM)
    d.line([x, y, x + round(22 * MM), y], fill=NOIR["gold"], width=4)
    y += round(8 * MM)
    box = round(5.2 * MM)
    for i, (name, desc, before, after) in enumerate(CARD["menu"], 1):
        d.rectangle([x, y + round(1 * MM), x + box, y + round(1 * MM) + box], outline=NOIR["gold"], width=4)
        tx = x + box + round(5 * MM)
        d.text((tx, y), f"{i:02d}", font=serif(10, "Medium", latin=True), fill=NOIR["gold"])
        d.text((tx + round(10 * MM), y - round(0.4 * MM)), name, font=serif(13, "Regular"), fill=NOIR["ivory"])
        d.text((tx + round(10 * MM), y + round(7.2 * MM)), desc, font=serif(8.4, "Light"), fill=NOIR["muted"])
        bx = tx + round(10 * MM)
        by = y + round(12.6 * MM)
        fs = serif(7.6, "Light")
        d.text((bx, by), before, font=fs, fill=NOIR["muted"])
        bw = d.textlength(before, font=fs)
        d.text((bx + bw + round(2.5 * MM), by), "→", font=fs, fill=NOIR["gold"])
        d.text((bx + bw + round(7 * MM), by), after, font=fs, fill=NOIR["ivory"])
        y += round(23 * MM)
    # 아래: 직접 쓰는 칸 + QR(고충 적는 창) + 서명
    d.text((x, y), "여기 없는 일이라면 —", font=serif(9, "Light"), fill=NOIR["ivory"])
    y += round(7 * MM)
    for _ in range(2):
        d.line([x, y, MW - S - round(36 * MM), y], fill=NOIR["line"], width=3)
        y += round(8 * MM)
    size = round(25 * MM)
    pad = round(2.2 * MM)
    qr = segno.make(CARD["form_url"], error="m")
    tmp = os.path.join(OUT, "_qr2.png")
    qr.save(tmp, scale=20, border=1, dark="#14141A", light=NOIR["ivory"])
    q = Image.open(tmp).convert("RGB").resize((size, size), Image.NEAREST)
    os.remove(tmp)
    bx2, by2 = MW - S, MH - S - round(7 * MM)
    bx1, by1 = bx2 - size - 2 * pad, by2 - size - 2 * pad
    d.rounded_rectangle([bx1, by1, bx2, by2], radius=round(2 * MM), fill=NOIR["ivory"])
    im.paste(q, (bx1 + pad, by1 + pad))
    fl = serif(7, "Regular")
    t = "폰으로 찍어서 적기"
    d.text(((bx1 + bx2) / 2 - d.textlength(t, font=fl) / 2, by2 + round(2 * MM)), t, font=fl, fill=NOIR["gold"])
    sy = MH - S - round(14 * MM)
    d.text((x, sy), CARD["name_en"], font=serif(15, "Light", latin=True), fill=NOIR["ivory"])
    d.text((x, sy + round(8 * MM)), f"{CARD['name']} · {CARD['title']} · {CARD['contacts'][0][1]} · 카톡 {CARD['contacts'][1][1].split()[-1]}", font=serif(7, "Light"), fill=NOIR["muted"])
    im.save(os.path.join(OUT, "menu.png"), dpi=(DPI, DPI))
    im.save(os.path.join(OUT, "menu_print.pdf"), resolution=DPI)
    im.resize((MW // 3, MH // 3)).save(os.path.join(OUT, "menu_preview.png"))
    print(f"✅ 메뉴판: {OUT}/menu.png · menu_print.pdf (A5 148×210mm + 사방 2mm 재단 여유)")


# ── cute: 흰 바탕 + 신뢰 파랑 + 동그란 안경 캐릭터 (2026-10-24 사장님: "조금 귀엽게, 단순하게, 뭘 하는 사람인지 알 수 있게") ──
# 캐릭터 그림: business/character/<hair|bald>_<basic|happy|surprised|think|explain>.fill.png (챗GPT로 그려 오려낸 것)
BLUE, BLUE_DEEP, BLUE_SOFT, CUTE_INK = "#2160D6", "#163F94", "#E8F0FD", "#15223B"
CHAR_DIR = os.path.join(ROOT, "business", "character")
JUA = os.path.join(ROOT, "video", "public", "fonts", "Jua-Regular.ttf")


def jua(size_pt):
    return ImageFont.truetype(JUA, round(size_pt * DPI / 72))


def char_img(name, height_mm):
    im = Image.open(os.path.join(CHAR_DIR, f"{name}.fill.png")).convert("RGBA")
    h = round(height_mm * MM)
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def front_cute():
    # 2026-10-24 다시: 요소를 줄이고 정돈 — 대표·이름·하는 일 한 줄·연락처, 캐릭터는 오른쪽 아래 작게
    im = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(im)
    x, y = SAFE + round(0.5 * MM), SAFE + round(0.8 * MM)
    d.rectangle([0, 0, W, round((BLEED + 1.6) * MM)], fill=BLUE)  # 위쪽 파란 띠
    d.text((x, y + round(1.2 * MM)), "대표", font=font(7, "semibold"), fill=BLUE)
    y += round(5.4 * MM)
    d.text((x, y), CARD["name"], font=font(21, "bold"), fill=CUTE_INK)
    nw = d.textlength(CARD["name"], font=font(21, "bold"))
    d.text((x + nw + round(2.6 * MM), y + round(4.3 * MM)), CARD["name_en"], font=font(7, "medium"), fill="#8A96A8")
    y += round(10.6 * MM)
    d.text((x, y), CARD["title"], font=font(7.2, "semibold"), fill=BLUE)
    y += round(4.4 * MM)
    d.text((x, y), "매일 손으로 하던 일을 자동으로", font=font(7.2, "medium"), fill=CUTE_INK)
    yy = H - SAFE - round(3.3 * MM) * len(CARD["contacts"]) + round(0.4 * MM)
    for _, v in CARD["contacts"]:
        d.text((x, yy), v, font=font(6.2, "regular"), fill="#4A5870")
        yy += round(3.3 * MM)
    c = char_img("hair_explain", 30)
    im.paste(c, (W - SAFE - c.width + round(2 * MM), H - round(BLEED * MM) - c.height - round(3 * MM)), c)
    return im


def back_cute():
    # 파란 바탕 + 질문 한 줄 + QR. 캐릭터는 질문 아래 작게
    im = Image.new("RGB", (W, H), BLUE)
    d = ImageDraw.Draw(im)
    x, y = SAFE + round(0.5 * MM), SAFE + round(3 * MM)
    for line in ["사장님,", "뭐가 제일", "귀찮으세요?"]:
        d.text((x, y), line, font=font(13, "bold"), fill="#FFFFFF")
        y += round(6.6 * MM)
    c = char_img("hair_think", 15)
    im.paste(c, (x, H - round(BLEED * MM) - c.height - round(3 * MM)), c)
    size, pad = round(19 * MM), round(2 * MM)
    qr = segno.make(CARD["qr_url"], error="m")
    tmp = os.path.join(OUT, "_qr.png")
    qr.save(tmp, scale=20, border=1, dark=CUTE_INK, light="#FFFFFF")
    q = Image.open(tmp).convert("RGB").resize((size, size), Image.NEAREST)
    os.remove(tmp)
    bx2, by1 = W - SAFE, SAFE + round(2 * MM)
    bx1, by2 = bx2 - size - 2 * pad, by1 + size + 2 * pad
    d.rounded_rectangle([bx1, by1, bx2, by2], radius=round(2.4 * MM), fill="#FFFFFF")
    im.paste(q, (bx1 + pad, by1 + pad))
    fl = font(6, "semibold")
    t = "귀찮은 일 골라보기"
    d.text(((bx1 + bx2) / 2 - d.textlength(t, font=fl) / 2, by2 + round(1.6 * MM)), t, font=fl, fill="#FFFFFF")
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    f, b = (front_cute(), back_cute()) if THEME == "cute" else (front_noir(), back_noir()) if THEME in PALETTES else (front(), back())
    f.save(os.path.join(OUT, "front.png"), dpi=(DPI, DPI))
    b.save(os.path.join(OUT, "back.png"), dpi=(DPI, DPI))
    f.save(os.path.join(OUT, "card_print.pdf"), save_all=True, append_images=[b], resolution=DPI)
    # 미리보기: 재단선(점선) 표시 + 앞뒤 나란히
    pv = Image.new("RGB", (W * 2 + 60, H + 40), "#FFFFFF")
    for i, im in enumerate([f, b]):
        c = im.copy()
        dd = ImageDraw.Draw(c)
        t = round(BLEED * MM)
        for k in range(0, W, 24):
            dd.line([k, t, k + 12, t], fill="#FF3B30", width=2)
            dd.line([k, H - t, k + 12, H - t], fill="#FF3B30", width=2)
        for k in range(0, H, 24):
            dd.line([t, k, t, k + 12], fill="#FF3B30", width=2)
            dd.line([W - t, k, W - t, k + 12], fill="#FF3B30", width=2)
        pv.paste(c, (20 + i * (W + 20), 20))
    pv.save(os.path.join(OUT, "preview.png"))
    print(f"✅ {OUT}\n   front.png · back.png · card_print.pdf (인쇄용, 94×54mm = 90×50mm + 사방 2mm 재단 여유) · preview.png (빨간 점선 = 재단선)")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    menu_sheet() if "--menu" in sys.argv else main()
