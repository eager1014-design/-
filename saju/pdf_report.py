"""손님에게 보낼 사주 풀이 PDF 만들기 (reportlab + 나눔 글꼴).

build(order, chart) → PDF 바이트.  표지(이름·상품·사주 네 기둥) + 본문(마크다운 풀이) + 쪽 번호.
글꼴: saju/fonts/ 의 나눔고딕·나눔명조 (SIL 오픈 폰트 라이선스, 상업 사용 가능).
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
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

import knowledge as K

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
for _name, _file in (("Gothic", "NanumGothic-Regular.ttf"), ("Gothic-B", "NanumGothic-Bold.ttf"),
                     ("Myeongjo", "NanumMyeongjo-Regular.ttf"), ("Myeongjo-B", "NanumMyeongjo-Bold.ttf")):
    pdfmetrics.registerFont(TTFont(_name, os.path.join(FONTS, _file)))
pdfmetrics.registerFontFamily("Gothic", normal="Gothic", bold="Gothic-B", italic="Gothic", boldItalic="Gothic-B")

# 사이트와 같은 색
INK, INK2, INK3 = colors.HexColor("#1f1b16"), colors.HexColor("#5b5246"), colors.HexColor("#8c8274")
LINE, PAPER, ACCENT, GOLD = colors.HexColor("#e4dccd"), colors.HexColor("#f6f1e7"), colors.HexColor("#9c2f22"), colors.HexColor("#b88a3b")
ELEMENT = {"목": "#3f7d4e", "화": "#c2412d", "토": "#b8892c", "금": "#7d7f86", "수": "#2d4a7a"}

ST = {
    "body": ParagraphStyle("body", fontName="Gothic", fontSize=10.5, leading=18.5, textColor=INK, spaceAfter=7, wordWrap="CJK"),
    "bullet": ParagraphStyle("bullet", fontName="Gothic", fontSize=10.5, leading=18, textColor=INK, leftIndent=14,
                             bulletIndent=3, spaceAfter=4, wordWrap="CJK"),
    "h2": ParagraphStyle("h2", fontName="Myeongjo-B", fontSize=15, leading=22, textColor=ACCENT, spaceBefore=16, spaceAfter=8,
                         wordWrap="CJK"),
    "h3": ParagraphStyle("h3", fontName="Myeongjo-B", fontSize=12.5, leading=19, textColor=INK, spaceBefore=10, spaceAfter=5,
                         wordWrap="CJK"),
    "quote": ParagraphStyle("quote", fontName="Myeongjo", fontSize=11, leading=19, textColor=INK2, leftIndent=12,
                            borderPadding=(2, 0, 2, 8), spaceAfter=8, wordWrap="CJK"),
    "toc": ParagraphStyle("toc", fontName="Myeongjo", fontSize=12, leading=24, textColor=INK, leftIndent=6, wordWrap="CJK"),
    "small": ParagraphStyle("small", fontName="Gothic", fontSize=8.5, leading=14, textColor=INK3, wordWrap="CJK"),
    "cover_eyebrow": ParagraphStyle("ce", fontName="Gothic-B", fontSize=10, textColor=GOLD, alignment=TA_CENTER, leading=14),
    "cover_title": ParagraphStyle("ct", fontName="Myeongjo-B", fontSize=26, leading=36, textColor=INK, alignment=TA_CENTER),
    "cover_sub": ParagraphStyle("cs", fontName="Gothic", fontSize=11, leading=18, textColor=INK2, alignment=TA_CENTER),
}


def _inline(s):
    """마크다운 한 줄 → reportlab 문단 표기. 굵게(**)는 bold, 기울임(*)은 글꼴에 없어 색으로 표시."""
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(^|[^*])\*(?!\s)(.+?)\*", r'\1<font color="#5b5246">\2</font>', s)
    return s


def markdown_flowables(text):
    out, para = [], []

    def flush():
        if para:
            out.append(Paragraph(_inline(" ".join(para)), ST["body"]))
            para.clear()

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if not line.strip():
            flush()
        elif m:
            flush()
            out.append(Paragraph(_inline(m.group(2)), ST["h2"] if len(m.group(1)) <= 2 else ST["h3"]))
        elif re.match(r"^-{3,}$", line.strip()):
            flush()
            out.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=8, spaceAfter=10))
        elif line.lstrip().startswith(">"):
            flush()
            out.append(Paragraph(_inline(line.lstrip()[1:].strip()), ST["quote"]))
        elif (b := re.match(r"^\s*(?:[-*]|(\d+)\.)\s+(.*)", line)):
            flush()
            item = re.sub(r"^\[( |x)\]\s*", lambda t: "☑ " if t.group(1).strip() else "☐ ", b.group(2), flags=re.I)
            out.append(Paragraph(_inline(item), ST["bullet"], bulletText=f"{b.group(1)}." if b.group(1) else "•"))
        else:
            para.append(line.strip())
    flush()
    return out


def pillars_table(chart):
    """사주 네 기둥 표: 시·일·월·년 (태어난 시간을 모르면 시주 칸은 비움)."""
    keys = ["hour", "day", "month", "year"]
    labels = {"hour": "시", "day": "일 (나)", "month": "월", "year": "년"}
    head, stems, branches, gods = [], [], [], []
    styles = [("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("FONT", (0, 0), (-1, 0), "Gothic", 9), ("TEXTCOLOR", (0, 0), (-1, 0), INK3),
              ("FONT", (0, 3), (-1, 3), "Gothic", 8.5), ("TEXTCOLOR", (0, 3), (-1, 3), INK2),
              ("TOPPADDING", (0, 1), (-1, 2), 7), ("BOTTOMPADDING", (0, 1), (-1, 2), 9)]
    for col, k in enumerate(keys):
        p = chart["pillars"].get(k)
        head.append(labels[k])
        if not p:
            stems.append("?"), branches.append("?"), gods.append("시간 모름")
            styles += [("TEXTCOLOR", (col, 1), (col, 2), INK3), ("FONT", (col, 1), (col, 2), "Myeongjo-B", 20)]
            continue
        # 나눔 글꼴에는 한자가 없어서 한글 글자(크게) + 오행(작게)으로 표시
        stems.append(f"{p['ko'][0]}\n{p['stem_element']}")
        branches.append(f"{p['ko'][1]}\n{p['branch_element']}")
        gods.append(f"{p['stem_god'].replace('일간(나)', '나')} · {p['branch_god']}")
        for row, el in ((1, p["stem_element"]), (2, p["branch_element"])):
            styles += [("BACKGROUND", (col, row), (col, row), colors.HexColor(ELEMENT[el])),
                       ("TEXTCOLOR", (col, row), (col, row), colors.white)]
    cells = [head, stems, branches, gods]
    # 한 칸 안에서 글자(크게)와 오행(작게)을 두 줄로
    for r in (1, 2):
        cells[r] = [Paragraph(f'<font name="Myeongjo-B" size="22">{c.split(chr(10))[0]}</font><br/>'
                              f'<font name="Gothic" size="8">{c.split(chr(10))[1] if chr(10) in c else ""}</font>',
                              ParagraphStyle("pc", alignment=TA_CENTER, leading=20,
                                             textColor=colors.white if c != "?" else INK3)) for c in cells[r]]
    t = Table(cells, colWidths=[30 * mm] * 4, rowHeights=[16, 50, 50, 18])
    styles += [("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.white),
               ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE), ("LINEABOVE", (0, 3), (-1, 3), 0.6, LINE)]
    t.setStyle(TableStyle(styles))
    return t


def _birth_text(b, pet=False):
    cal = "양력" if b.get("calendar") != "lunar" else ("음력 윤달" if b.get("leap") else "음력")
    t = f"{cal} {b['year']}년 {b['month']}월 {b['day']}일"
    t += " · 태어난 시간 모름" if b.get("hour") is None else f" {b['hour']}시 {b.get('minute') or 0}분"
    if pet:
        return t + (" · 암컷" if b.get("gender") == "female" else " · 수컷")
    return t + (" · 여성" if b.get("gender") == "female" else " · 남성")


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Gothic", 8)
    canvas.setFillColor(INK3)
    canvas.drawString(20 * mm, 12 * mm, "운결 · 사주로 보는 커리어·관계 코칭")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, str(doc.page))
    canvas.restoreState()


def _cover_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.8)
    canvas.rect(12 * mm, 12 * mm, A4[0] - 24 * mm, A4[1] - 24 * mm, stroke=1, fill=0)
    # 도장 모양 로고
    s = 18 * mm
    x, y = (A4[0] - s) / 2, A4[1] - 62 * mm
    canvas.setFillColor(ACCENT)
    canvas.roundRect(x, y, s, s, 3 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Myeongjo-B", 22)
    canvas.drawCentredString(A4[0] / 2, y + 6.5 * mm, "운결")
    canvas.restoreState()


def build(order, chart):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=22 * mm,
                            title=f"{order['name']}님의 {order['product_label']}", author="운결")
    dm = chart["day_master"]
    image = K.DAY_MASTER.get(dm["ko"], {}).get("image", "").split("(")[0].strip()  # '큰 나무(甲木)' → '큰 나무'

    story = [Spacer(1, 62 * mm),
             Paragraph("사주 풀이 리포트", ST["cover_eyebrow"]), Spacer(1, 6 * mm),
             Paragraph(f"{_inline(order['name'])}님의<br/>{_inline(order['product_label'])}", ST["cover_title"]),
             Spacer(1, 6 * mm),
             Paragraph(_inline(_birth_text(order["birth"])), ST["cover_sub"])]
    if order.get("partner"):
        p = order["partner"]
        if p.get("kind") == "pet":
            story.append(Paragraph(_inline(f"우리 아이: {p['name']} · {_birth_text(p['birth'], pet=True)}"), ST["cover_sub"]))
        else:
            story.append(Paragraph(_inline(f"함께 본 분: {p['name']} ({p.get('relation') or '관계'}) · {_birth_text(p['birth'])}"),
                                   ST["cover_sub"]))
    story += [Spacer(1, 14 * mm), pillars_table(chart), Spacer(1, 6 * mm)]
    if image:
        story.append(Paragraph(_inline(f"나를 상징하는 기운: {image}"), ST["cover_sub"]))
    story += [Spacer(1, 30 * mm),
              Paragraph(f"{date.today():%Y년 %m월 %d일} · 신청번호 {_inline(order['code'])}", ST["cover_sub"]),
              PageBreak()]
    heads = [h for h in re.findall(r"^##\s+(.+)$", order.get("content") or "", re.M)]
    if len(heads) >= 5:  # 긴 리포트는 목차 한 쪽
        story += [Paragraph("차례", ST["h2"]), Spacer(1, 4 * mm)]
        story += [Paragraph(f"{i + 1}.&nbsp;&nbsp;{_inline(h)}", ST["toc"]) for i, h in enumerate(heads)]
        story.append(PageBreak())
    story += markdown_flowables(order.get("content") or "")
    if K.DISCLAIMER not in (order.get("content") or ""):
        story += [Spacer(1, 10 * mm), KeepTogether([HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=8),
                                                    Paragraph(_inline(K.DISCLAIMER), ST["small"])])]
    doc.build(story, onFirstPage=_cover_bg, onLaterPages=_footer)
    return buf.getvalue()
