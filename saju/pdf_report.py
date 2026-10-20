"""손님에게 보낼 사주 풀이 PDF — 운결 도령 분위기 (밤 배경, 금빛 제목, 붉은 포인트).

build(order, chart) → PDF 바이트.
  1쪽 표지: 도령 그림 전면 + "…○○, 너의 인생이 보인다."
  2쪽 여는 말: 도령의 한마디 + 사주 네 기둥 + 차례
  본문: 마크다운 풀이 (장 제목은 붓글씨 느낌 글꼴)
  끝 쪽: 맺는 말 + 매일 아침 구독 안내
글꼴: saju/fonts/ — 나눔고딕·나눔명조(본문, 모든 한글), 송명(제목·고정 문구, 자주 쓰는 한글 2,350자만 있음 →
      없는 글자가 섞이면 자동으로 나눔명조로 바꿔 씀). 모두 SIL 오픈 폰트 라이선스(상업 사용 가능).
"""
import io
import os
import re
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (HRFlowable, KeepTogether, NextPageTemplate, PageBreak, PageTemplate, Frame, Paragraph,
                                BaseDocTemplate, Spacer, Table, TableStyle)

import knowledge as K

BASE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(BASE, "fonts")
IMG = os.path.join(BASE, "static", "img")
for _name, _file in (("Gothic", "NanumGothic-Regular.ttf"), ("Gothic-B", "NanumGothic-Bold.ttf"),
                     ("Myeongjo", "NanumMyeongjo-Regular.ttf"), ("Myeongjo-B", "NanumMyeongjo-Bold.ttf"),
                     ("Song", "SongMyung-Regular.ttf")):
    pdfmetrics.registerFont(TTFont(_name, os.path.join(FONTS, _file)))
pdfmetrics.registerFontFamily("Gothic", normal="Gothic", bold="Gothic-B", italic="Gothic", boldItalic="Gothic-B")
_SONG_CHARS = set(pdfmetrics.getFont("Song").face.charToGlyph)


def title_font(text):
    """송명 글꼴에 모든 글자가 있으면 송명, 아니면 나눔명조 굵게 (빈 네모 방지)."""
    return "Song" if all(ord(c) in _SONG_CHARS or c.isspace() for c in text) else "Myeongjo-B"


# 밤의 색
NIGHT, NIGHT2 = colors.HexColor("#0e0b13"), colors.HexColor("#17121d")
INK, INK2, INK3 = colors.HexColor("#ece4f2"), colors.HexColor("#c3b8cf"), colors.HexColor("#8a7f96")
LINE, GOLD, GOLD2, RED = colors.HexColor("#3a3046"), colors.HexColor("#d9b26a"), colors.HexColor("#f6e7c4"), colors.HexColor("#c0283a")
ELEMENT = {"목": "#3f7d4e", "화": "#c2412d", "토": "#b8892c", "금": "#7d7f86", "수": "#2d4a7a"}

ST = {
    "body": ParagraphStyle("body", fontName="Gothic", fontSize=10.5, leading=19, textColor=INK, spaceAfter=7, wordWrap="CJK"),
    "bullet": ParagraphStyle("bullet", fontName="Gothic", fontSize=10.5, leading=18.5, textColor=INK, leftIndent=14,
                             bulletIndent=3, bulletColor=GOLD, spaceAfter=4, wordWrap="CJK"),
    "h2": ParagraphStyle("h2", fontName="Song", fontSize=19, leading=26, textColor=GOLD2, spaceBefore=8, spaceAfter=4, wordWrap="CJK"),
    "h3": ParagraphStyle("h3", fontName="Myeongjo-B", fontSize=12.5, leading=19, textColor=GOLD, spaceBefore=10, spaceAfter=5,
                         wordWrap="CJK"),
    "quote": ParagraphStyle("quote", fontName="Myeongjo", fontSize=11, leading=19, textColor=INK2, leftIndent=12,
                            spaceAfter=8, wordWrap="CJK"),
    "small": ParagraphStyle("small", fontName="Gothic", fontSize=8.5, leading=14, textColor=INK3, wordWrap="CJK"),
    "chap": ParagraphStyle("chap", fontName="Gothic-B", fontSize=8.5, leading=12, textColor=RED, spaceBefore=18),
    "voice": ParagraphStyle("voice", fontName="Song", fontSize=17, leading=28, textColor=GOLD2, alignment=TA_CENTER, wordWrap="CJK"),
    "voice_s": ParagraphStyle("voice_s", fontName="Myeongjo", fontSize=11.5, leading=21, textColor=INK2, alignment=TA_CENTER,
                              wordWrap="CJK"),
    "center": ParagraphStyle("center", fontName="Gothic", fontSize=10, leading=17, textColor=INK2, alignment=TA_CENTER, wordWrap="CJK"),
    "toc": ParagraphStyle("toc", fontName="Myeongjo", fontSize=11.5, leading=22, textColor=INK, leftIndent=40, wordWrap="CJK"),
}


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline(s):
    """마크다운 한 줄 → 문단 표기. 굵게는 금빛, 기울임은 옅은 색."""
    s = _esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r'<font name="Gothic-B" color="#f0d08a">\1</font>', s)
    s = re.sub(r"(^|[^*])\*(?!\s)(.+?)\*", r'\1<font color="#c3b8cf">\2</font>', s)
    return s


def _font_para(text, style):
    """송명 글꼴 스타일이면 글자가 다 있는지 보고, 없으면 나눔명조로."""
    if style.fontName == "Song" and title_font(text) != "Song":
        style = ParagraphStyle(style.name + "_fb", parent=style, fontName="Myeongjo-B")
    return Paragraph(_esc(text), style)


def markdown_flowables(text):
    out, para, n = [], [], 0

    def flush():
        if para:
            out.append(Paragraph(_inline(" ".join(para)), ST["body"]))
            para.clear()

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if not line.strip():
            flush()
        elif m and len(m.group(1)) <= 2:
            flush()
            n += 1
            out.append(KeepTogether([Paragraph(f"CHAPTER {n:02d}", ST["chap"]), _font_para(m.group(2), ST["h2"]),
                                     HRFlowable(width="18%", thickness=1.2, color=RED, spaceBefore=2, spaceAfter=10, hAlign="LEFT")]))
        elif m:
            flush()
            out.append(Paragraph(_inline(m.group(2)), ST["h3"]))
        elif re.match(r"^-{3,}$", line.strip()):
            flush()
            out.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=8, spaceAfter=10))
        elif line.lstrip().startswith(">"):
            flush()
            out.append(Paragraph(_inline(line.lstrip()[1:].strip()), ST["quote"]))
        elif (b := re.match(r"^\s*(?:[-*]|(\d+)\.)\s+(.*)", line)):
            flush()
            item = re.sub(r"^\[( |x)\]\s*", lambda t: "☑ " if t.group(1).strip() else "☐ ", b.group(2), flags=re.I)
            out.append(Paragraph(_inline(item), ST["bullet"], bulletText=f"{b.group(1)}." if b.group(1) else "◆"))
        else:
            para.append(line.strip())
    flush()
    return out


def pillars_table(chart):
    """사주 네 기둥: 시·일·월·년 (시간을 모르면 시주 칸은 ?)."""
    keys = ["hour", "day", "month", "year"]
    labels = {"hour": "시", "day": "일 (나)", "month": "월", "year": "년"}
    head, stems, branches, gods = [], [], [], []
    styles = [("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("FONT", (0, 0), (-1, 0), "Gothic", 9), ("TEXTCOLOR", (0, 0), (-1, 0), INK3),
              ("FONT", (0, 3), (-1, 3), "Gothic", 8.5), ("TEXTCOLOR", (0, 3), (-1, 3), INK2),
              ("BACKGROUND", (0, 0), (-1, 0), NIGHT2), ("BACKGROUND", (0, 3), (-1, 3), NIGHT2)]
    for col, k in enumerate(keys):
        p = chart["pillars"].get(k)
        head.append(labels[k])
        if not p:
            stems.append("?"), branches.append("?"), gods.append("시간 모름")
            styles += [("BACKGROUND", (col, 1), (col, 2), NIGHT2)]
            continue
        stems.append(f"{p['ko'][0]}\n{p['stem_element']}")
        branches.append(f"{p['ko'][1]}\n{p['branch_element']}")
        gods.append(f"{p['stem_god'].replace('일간(나)', '나')} · {p['branch_god']}")
        for row, el in ((1, p["stem_element"]), (2, p["branch_element"])):
            styles += [("BACKGROUND", (col, row), (col, row), colors.HexColor(ELEMENT[el]))]
    cells = [head, stems, branches, gods]
    for r in (1, 2):
        cells[r] = [Paragraph(f'<font name="Myeongjo-B" size="22">{c.split(chr(10))[0]}</font><br/>'
                              f'<font name="Gothic" size="8">{c.split(chr(10))[1] if chr(10) in c else ""}</font>',
                              ParagraphStyle("pc", alignment=TA_CENTER, leading=20, textColor=colors.white if c != "?" else INK3))
                    for c in cells[r]]
    t = Table(cells, colWidths=[30 * mm] * 4, rowHeights=[16, 50, 50, 18])
    styles += [("BOX", (0, 0), (-1, -1), 0.8, GOLD), ("INNERGRID", (0, 0), (-1, -1), 0.6, NIGHT)]
    t.setStyle(TableStyle(styles))
    return t


def _birth_text(b, pet=False):
    cal = "양력" if b.get("calendar") != "lunar" else ("음력 윤달" if b.get("leap") else "음력")
    t = f"{cal} {b['year']}년 {b['month']}월 {b['day']}일"
    t += " · 태어난 시간 모름" if b.get("hour") is None else f" {b['hour']}시 {b.get('minute') or 0}분"
    if pet:
        return t + (" · 암컷" if b.get("gender") == "female" else " · 수컷")
    return t + (" · 여성" if b.get("gender") == "female" else " · 남성")


# ---------------------------------------------------------------- 쪽 배경
W, H = A4


def _night(canvas):
    canvas.setFillColor(NIGHT)
    canvas.rect(0, 0, W, H, stroke=0, fill=1)


def _fade(canvas, y0, y1, color=NIGHT, top_dark=False, steps=40):
    """y0~y1 구간에 투명→진한 그라데이션 (그림 위 글씨가 잘 보이게)."""
    canvas.saveState()
    canvas.setFillColor(color)
    h = (y1 - y0) / steps
    for i in range(steps):
        a = (i + 1) / steps
        canvas.setFillAlpha(a if top_dark else 1 - a)
        canvas.rect(0, y0 + i * h, W, h + 0.5, stroke=0, fill=1)
    canvas.restoreState()


def _cover(canvas, doc):
    _night(canvas)
    img = ImageReader(os.path.join(IMG, "dory.jpg"))
    iw, ih = img.getSize()
    scale = max(W / iw, H / ih)  # 쪽을 꽉 채우게 (양옆을 잘라냄)
    dw, dh = iw * scale, ih * scale
    canvas.drawImage(img, (W - dw) / 2, H - dh, dw, dh)
    _fade(canvas, 0, H * 0.48)                   # 아래쪽을 어둡게
    _fade(canvas, H * 0.86, H, top_dark=True)     # 위쪽도 살짝
    canvas.saveState()
    canvas.setFillColor(RED)
    canvas.setFont("Song", 13)
    canvas.drawCentredString(W / 2, H - 22 * mm, "운   결")
    o = doc.order
    name = o["name"]
    canvas.setFillColor(GOLD2)
    f = title_font(f"…{name},")
    canvas.setFont(f, 30)
    canvas.drawCentredString(W / 2, 78 * mm, f"…{name},")
    canvas.setFont("Song", 38)
    canvas.drawCentredString(W / 2, 60 * mm, "너의 인생이 보인다.")
    canvas.setFillColor(INK2)
    canvas.setFont("Myeongjo", 12)
    canvas.drawCentredString(W / 2, 44 * mm, o["product_label"])
    canvas.setFillColor(INK3)
    canvas.setFont("Gothic", 8.5)
    canvas.drawCentredString(W / 2, 22 * mm, f"{date.today():%Y. %m. %d}  ·  신청번호 {o['code']}  ·  운결 사주 풀이")
    canvas.restoreState()


def _page(canvas, doc):
    _night(canvas)
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(20 * mm, H - 14 * mm, W - 20 * mm, H - 14 * mm)
    canvas.setFillColor(RED)
    canvas.setFont("Song", 9)
    canvas.drawString(20 * mm, H - 11.5 * mm, "운 결")
    canvas.setFillColor(INK3)
    canvas.setFont("Gothic", 7.5)
    canvas.drawRightString(W - 20 * mm, H - 11.5 * mm, f"{doc.order['name']}님의 {doc.order['product_label'].split(' (')[0]}")
    canvas.setFillColor(GOLD)
    canvas.setFont("Myeongjo", 9)
    canvas.drawCentredString(W / 2, 11 * mm, f"— {doc.page} —")
    canvas.restoreState()


def _closing_bg(canvas, doc):
    _page(canvas, doc)
    path = os.path.join(IMG, "toon", "moon.jpg")
    if os.path.exists(path):
        img = ImageReader(path)
        iw, ih = img.getSize()
        dw = W - 40 * mm
        dh = dw * ih / iw
        canvas.drawImage(img, 20 * mm, H - 22 * mm - dh, dw, dh)


class _Doc(BaseDocTemplate):
    def __init__(self, buf, order, **kw):
        super().__init__(buf, pagesize=A4, **kw)
        self.order = order
        body = Frame(22 * mm, 20 * mm, W - 44 * mm, H - 40 * mm, id="body")
        self.addPageTemplates([PageTemplate("cover", [Frame(0, 0, W, H, id="c")], onPage=_cover),
                               PageTemplate("page", [body], onPage=_page),
                               PageTemplate("closing", [Frame(22 * mm, 20 * mm, W - 44 * mm, H - 40 * mm - 75 * mm, id="cl")],
                                            onPage=_closing_bg)])


def build(order, chart):
    buf = io.BytesIO()
    doc = _Doc(buf, order, title=f"{order['name']}님의 {order['product_label']}", author="운결")
    name = order["name"]
    image = K.DAY_MASTER.get(chart["day_master"]["ko"], {}).get("image", "").split("(")[0].strip()
    story = [NextPageTemplate("page"), PageBreak()]
    # 여는 말
    story += [Spacer(1, 18 * mm), _font_para(f"…왔구나, {name}.", ST["voice"]), Spacer(1, 4 * mm),
              Paragraph("네가 태어난 날을 들여다봤다.<br/>네 기운이 어디에 쏠려 있고, 지금 어떤 흐름 위에 서 있는지.<br/>"
                        "천천히 읽어라. 다 읽고 나면, 오늘 할 일 하나는 보일 것이다.", ST["voice_s"]),
              Spacer(1, 12 * mm)]
    who = _birth_text(order["birth"])
    if order.get("partner"):
        p = order["partner"]
        who += (f"<br/>우리 아이: {_esc(p['name'])} · {_birth_text(p['birth'], pet=True)}" if p.get("kind") == "pet"
                else f"<br/>함께 본 사람: {_esc(p['name'])} ({_esc(p.get('relation') or '관계')}) · {_birth_text(p['birth'])}")
    story += [Paragraph(who, ST["center"]), Spacer(1, 6 * mm), pillars_table(chart), Spacer(1, 5 * mm)]
    if image:
        story.append(Paragraph(f'너를 상징하는 기운 — <font color="#f0d08a">{_esc(image)}</font>', ST["center"]))
    heads = re.findall(r"^##\s+(.+)$", order.get("content") or "", re.M)
    if len(heads) >= 3:
        story += [Spacer(1, 12 * mm), Paragraph("차 례", ParagraphStyle("tt", parent=ST["voice"], fontSize=14)), Spacer(1, 3 * mm)]
        story += [Paragraph(f'<font color="#c0283a">{i + 1:02d}</font>&nbsp;&nbsp;&nbsp;{_esc(h)}', ST["toc"])
                  for i, h in enumerate(heads)]
    story.append(PageBreak())
    # 본문
    story += markdown_flowables(order.get("content") or "")
    # 맺는 말
    url = os.environ.get("PUBLIC_URL", "").rstrip("/")
    import products  # 구독 가격은 상품 목록에서
    price = products.PRODUCTS.get("daily", {}).get("price", 9900)
    story += [NextPageTemplate("closing"), PageBreak(), Spacer(1, 8 * mm),
              _font_para("…여기까지가, 지금 보이는 너의 길이다.", ST["voice"]), Spacer(1, 4 * mm),
              Paragraph("사주는 정해진 운명이 아니라, 타고난 기운의 지도다.<br/>어느 길로 걸을지는 오늘의 네가 정한다.", ST["voice_s"]),
              Spacer(1, 12 * mm),
              HRFlowable(width="40%", thickness=0.8, color=GOLD, spaceAfter=10),
              Paragraph('<font color="#f0d08a">매일 아침, 너의 하루가 궁금하다면</font>', ST["center"]),
              Paragraph(f"아침 7시마다 네 사주로 본 오늘의 기운과 할 일을 메일로 보내주마. 월 {price:,}원, 하루 {round(price / 30):,}원."
                        + (f'<br/><font color="#d9b26a">{_esc(url)}/?p=daily</font>' if url.startswith("http") else ""), ST["center"]),
              Spacer(1, 10 * mm),
              Paragraph("궁금한 점은 풀이를 받은 메일에 답장으로 물어봐라.", ST["center"]),
              Spacer(1, 8 * mm), Paragraph(_esc(K.DISCLAIMER), ParagraphStyle("dc", parent=ST["small"], alignment=TA_CENTER))]
    doc.build(story)
    return buf.getvalue()
