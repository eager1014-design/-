"""긴 풀이 만들기: 상품 목차(products.py)의 장마다 AI를 따로 불러 길고 깊게 쓰고, 하나로 합친다.

한 번에 길게 쓰라고 하면 뒤로 갈수록 얕아지므로, 장별로 나눠 쓰되
모든 장에 '전체 목차와 각 장이 맡은 범위'를 알려줘서 내용이 겹치지 않게 한다.
장은 최대 4개씩 동시에 쓴다 (프리미엄 13장 ≈ 1~2분).
AI가 꺼져 있으면 interpret.py 의 기본(규칙) 풀이로 대신한다.
"""
from concurrent.futures import ThreadPoolExecutor

import interpret
import knowledge as K
import llm
import products
from saju_engine import (BRANCHES_KO, ELEMENTS, BRANCH_ELEMENT, STEM_ELEMENT, STEMS_KO, branch_main_stem,
                         compatibility, current_luck, ten_god, year_months, year_pillar_of)

WORKERS = 4

CHAPTER_RULES = """
[긴 리포트 작성 규칙]
- 지금은 여러 장으로 된 리포트 중 '한 장'만 씁니다. 장 제목(## )은 쓰지 마세요 — 제가 붙입니다. 소제목이 필요하면 ### 를 씁니다.
- 다른 장이 맡은 내용은 쓰지 않습니다(목차 참고). 이 장의 지시에 집중해 깊게 씁니다.
- 요청 분량을 꼭 채웁니다. 일반론으로 채우지 말고, 계산 자료와 사용자 이야기로 채웁니다.
- 시기를 말할 때는 제공된 월운·세운·대운 자료에 있는 것만 '몇 년 몇 월'로 씁니다."""


def _year_line(chart, y):
    s, b = year_pillar_of(y)
    ds = chart["day_master"]["stem"]
    return (f"{y}년 세운: {STEMS_KO[s]}{BRANCHES_KO[b]} ({ELEMENTS[STEM_ELEMENT[s]]}·{ELEMENTS[BRANCH_ELEMENT[b]]}) / "
            f"{ten_god(ds, s)}·{ten_god(ds, branch_main_stem(b))}")


def _daeun_text(chart, luck):
    cur = (luck.get("daeun") or {}).get("age")
    return "\n".join(f"- {d['age']}세({d['start_year']}년~): {d['ko']} / {d['stem_god']}·{d['branch_god']}"
                     + (" ← 지금" if d["age"] == cur else "") for d in chart["daeun"])


def gift_context(order, chart, luck, giver_chart):
    """선물용 설명서: 주인공 = 선물 받는 사람(partner), 선물하는 사람(주문자)은 호환성·마음 전하기에만."""
    rec, giver = order["partner"], order["name"]
    comp = compatibility(giver_chart, chart)
    return "\n\n".join([
        f"[선물 받는 사람 {rec['name']}님 사주 — 이 설명서의 주인공]\n{interpret.chart_summary(chart, luck)}",
        f"[선물하는 사람] {giver}님 · 관계: {rec.get('relation') or '소중한 사람'}\n{interpret.chart_summary(giver_chart, None)}",
        f"[{giver}님과 {rec['name']}님의 궁합 계산]\n{interpret.match_summary(comp, rec['name'])}",
        f"[선물하는 사람이 적은 말]\n{interpret.situation_text(order['situation'])}",
        f"※ 설명서는 선물하는 {giver}님이 읽고 {rec['name']}님에게 건네는 글입니다. {rec['name']}님을 3인칭('이 제품', '{rec['name']}님')으로 쓰세요."])


def build_context(order, chart, luck, partner_chart=None):
    """모든 장이 함께 보는 자료."""
    p = products.PRODUCTS[order["product"]]
    if p.get("gift") and partner_chart is not None:
        return gift_context(order, chart, luck, partner_chart)
    name = order["name"]
    parts = [f"[{name}님 사주 계산 결과]\n{interpret.chart_summary(chart, luck)}",
             f"[{name}님 현재 상황]\n{interpret.situation_text(order['situation'])}"]
    partner = order.get("partner")
    if partner and partner_chart:
        comp = compatibility(chart, partner_chart)
        who = f"반려동물 {partner['name']}" if p["partner"] == "pet" else f"{partner['name']}님({partner.get('relation') or '상대'})"
        parts.append(f"[{who} 사주]\n{interpret.chart_summary(partner_chart, None)}")
        parts.append(f"[{name}님과 {who}의 궁합 계산]\n{interpret.match_summary(comp, partner['name'])}")
        if p["partner"] == "pet":
            parts.append("※ 반려동물 사주는 사람 명리를 재미로 응용한 것입니다. 성별 칸의 남/여는 수컷/암컷입니다.")
    cur = luck["year"]["year"]
    if "months" in p["data"]:
        for y in (cur, cur + 1):
            parts.append(f"[{_year_line(chart, y)} — 월별 흐름]\n{interpret.months_text(year_months(chart, y))}")
    if "newyear" in p["data"]:
        ny = products.NY
        parts.append(f"[신년 {_year_line(chart, ny)} — 12달 흐름 (입춘부터)]\n{interpret.months_text(year_months(chart, ny))}")
    if "daeun" in p["data"]:
        parts.append(f"[대운 전체 (10년 단위 큰 흐름)]\n{_daeun_text(chart, luck)}")
    return "\n\n".join(parts)


def _tidy(text):
    """AI가 인용을 겹따옴표로 감싸는 버릇 정리 (“‘예민한 편’” → “예민한 편”)."""
    import re
    return re.sub(r"[“\"]\s*[‘']([^’'”\"]{1,80})[’']\s*[”\"]", r"“\1”", text)


def _chapter(context, toc, i, title, instruction, chars, name, style=""):
    prompt = f"""{context}

[이 리포트의 전체 목차 — 각 장이 맡은 범위]
{toc}

이번에 쓸 장: {i + 1}장 「{title}」
지시: {instruction}
분량: 약 {chars:,}자 (공백 포함). {name}님에게 직접 말하듯 존댓말로."""
    text, engine = llm.generate(interpret.SYSTEM_PROMPT + CHAPTER_RULES + ("\n" + style if style else ""),
                                [{"role": "user", "content": prompt}], max(1500, int(chars * 1.8)))
    if not text:  # 한 장만 비는 일이 있어 한 번 더 (2026-10-27 미리보기에서 7장 중 1장이 빔)
        text, engine = llm.generate(interpret.SYSTEM_PROMPT + CHAPTER_RULES + ("\n" + style if style else ""),
                                    [{"role": "user", "content": prompt}], max(1500, int(chars * 1.8)))
    if text:
        lines = text.strip().split("\n")
        if lines and lines[0].lstrip().startswith("#") and title.split(" ")[0] in lines[0]:
            lines = lines[1:]  # AI가 장 제목을 또 쓴 경우 제거
        text = _tidy("\n".join(lines).strip())
    return text, engine


def _rules(order, chart, luck, partner_chart):
    """AI가 꺼져 있을 때: 상품 성격에 맞는 기존 기본 풀이."""
    kind, sit, name = order["product"], order["situation"], order["name"]
    if kind == "counsel":
        return interpret._rule_counsel(chart, luck, sit, sit["story"])
    if kind in ("newyear", "yearly"):
        y = products.NY if kind == "newyear" else luck["year"]["year"]
        return interpret._rule_yearly(chart, luck, year_months(chart, y), y, name)
    if partner_chart is not None:
        return interpret._rule_match(chart, partner_chart, compatibility(chart, partner_chart), name, order["partner"]["name"])
    return interpret._rule_reading(chart, luck, sit, name)


def generate(order, chart, partner_chart=None, progress=None):
    """→ {"markdown", "engine"}. progress(끝난 장 수, 전체 장 수) 를 장마다 부른다."""
    p = products.PRODUCTS[order["product"]]
    if p.get("gift") and partner_chart is not None:
        chart, partner_chart = partner_chart, chart  # 선물용: 받는 사람 사주가 주인공, 주문자 사주는 호환성용
    luck = current_luck(chart)
    chapters = p["chapters"]
    if not chapters or not llm.available():
        return {"markdown": _rules(order, chart, luck, partner_chart), "engine": "rules"}
    context = build_context(order, chart, luck, partner_chart)
    toc = "\n".join(f"{i + 1}. {t} — {ins[:60]}" for i, (t, ins, _) in enumerate(chapters))
    results = [None] * len(chapters)
    done = [0]

    def work(i):
        t, ins, chars = chapters[i]
        reader = f"선물하는 {order['name']}" if p.get("gift") else order["name"]
        results[i] = _chapter(context, toc, i, t, ins, chars, reader, p.get("style", ""))
        done[0] += 1
        if progress:
            progress(done[0], len(chapters))

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(work, range(len(chapters))))
    out, engines, missing = [], set(), 0
    for (title, _, _), (text, engine) in zip(chapters, results):
        if not text:
            missing += 1
            text = "*(이 장은 AI 응답이 없어 비어 있습니다. '풀이 다시 만들기'를 누르거나 직접 써 주세요.)*"
        else:
            engines.add(engine)
        out.append(f"## {title}\n\n{text}")
    out.append(f"---\n\n{K.DISCLAIMER}")
    engine = ", ".join(sorted(engines)) or "none"
    if missing:
        engine += f" (빈 장 {missing}개)"
        print(f"[긴 풀이] {order['code']} 빈 장 {missing}/{len(chapters)}")
    return {"markdown": "\n\n".join(out), "engine": engine}
