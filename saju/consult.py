"""상담 페이지(/consult): 도령이 몇 가지를 묻고, 손님의 사주 + 답을 근거로 그 자리에서 제대로 상담해준다 (반말).
가벼운 풀이 6종(고민상담·연애운·반려동물·재회·궁합·직업재물)마다 묻는 것이 다르다. 상담 내용은 잠그지 않고 다 보여준다.
더 정확한 '달마다의 흐름·구체적 방법'은 PDF(유료, 또는 친구가 와서 사주를 보면 1개 무료)로.

AI(서버의 제미나이)로 쓰고, 하루 QUICK_AI_LIMIT 번(고민 맛보기와 같이 셈)을 넘거나 AI가 늦으면 규칙 문장으로 대신한다.
입력값·상담 내용은 저장하지 않는다.
"""
import re
import threading

import concern
import interpret
import knowledge as K
import llm
import products
import quick
from saju_engine import compatibility, current_luck

WAIT = int(concern.os.environ.get("CONSULT_AI_WAIT", "25"))  # 상담은 길어서 고민 맛보기보다 조금 더 기다린다

# 상담 주제 → 상품, 화면에 보이는 이름. 친구 초대 무료 PDF도 이 6가지 중 하나
TOPICS = {
    "counsel": "고민 상담", "love": "연애운 · 인연", "pet": "반려동물",
    "reunion": "재회운", "match": "궁합", "career": "직업 · 재물",
}
FREE_PDF = set(TOPICS)

# 화면의 질문 (id, 도령의 질문, 고를 것들). 마지막 '하고 싶은 말'은 모든 주제에 공통
QUESTIONS = {
    "counsel": [("area", "어떤 쪽 고민이냐?", ["일·진로", "돈", "사람·가족", "마음·건강", "이사·변화", "그 밖에"]),
                ("since", "그 고민, 언제부터였느냐?", ["최근 한 달", "몇 달째", "1년 넘게", "몇 년째 반복"])],
    "love": [("state", "지금 너는 어떤 상태냐?", ["혼자다", "썸 타는 중", "연애 중", "결혼을 고민 중", "헤어진 지 얼마 안 됐다"]),
             ("pattern", "연애할 때 늘 되풀이되는 게 있느냐?", ["늘 내가 더 좋아한다", "시작이 어렵다", "오래 못 간다",
                                                   "맞지 않는 사람만 만난다", "잘 모르겠다"])],
    "pet": [("kind", "어떤 아이냐?", ["강아지", "고양이", "그 밖의 아이"]),
            ("want", "그 아이에 대해 무엇이 궁금하냐?", ["타고난 성격", "나와의 궁합", "행동 고민", "건강 관리 리듬"])],
    "reunion": [("when", "헤어진 지 얼마나 됐느냐?", ["한 달 안", "1~6개월", "반년~1년", "1년 넘게"]),
                ("why", "왜 헤어졌느냐?", ["다툼·성격 차이", "상황·거리", "상대 마음이 식었다", "내 실수", "잘 모르겠다"]),
                ("contact", "지금 연락은 닿느냐?", ["가끔 한다", "끊겼다", "차단됐다"])],
    "match": [("relation", "그 사람은 너에게 누구냐?", ["연인", "썸", "배우자", "친구", "직장 동료", "가족"])],
    "career": [("now", "지금 너는 어디에 서 있느냐?", ["직장인", "이직 준비", "취업 준비", "사업·자영업", "프리랜서", "학생"]),
               ("core", "가장 걸리는 건 무엇이냐?", ["이직·퇴사", "승진·인정", "돈 모으기", "창업·부업", "내 적성 찾기"])],
}
PARTNER = {"match": "required", "reunion": "optional", "pet": "pet"}  # 상대(또는 아이) 생년월일
STORY_Q = {
    "counsel": "한 줄이면 된다. 지금 가장 궁금한 게 무엇이냐?",
    "love": "어떤 사람을 만나고 싶은지, 아니면 지금 마음에 걸리는 사람 이야기를 해봐라.",
    "pet": "아이 이름과, 요즘 그 아이에 대해 마음 쓰이는 걸 말해봐라.",
    "reunion": "그 사람과 어떤 사이였는지, 지금 네 마음이 어떤지 말해봐라.",
    "match": "그 사람과 무엇이 궁금하냐? 잘 맞는지, 앞으로 어떨지…",
    "career": "지금 하는 일이나 하고 싶은 일, 그리고 고민을 한두 줄로.",
}
CONCERN_OF = {"counsel": "relation", "love": "love", "pet": "relation", "reunion": "love", "match": "love", "career": "career"}

SYSTEM = """당신은 사주 상담 브랜드 '운결'의 도령입니다. 신비롭고 묵직하지만 다정한 반말로 말합니다 ("~다", "~해라", "~구나").
- 지금은 손님과 마주 앉은 상담입니다. 손님이 고른 답과 직접 쓴 말에 정면으로 답합니다. 누구에게나 맞는 말은 쓰지 않습니다.
- 주어진 사주 계산 결과만 근거로 합니다. 계산에 없는 것을 지어내거나 과장하지 않습니다 ('없다', '과다' 같은 단정 금지).
- 명리 용어는 쉬운 말로 풀고 괄호에 한 번만. 한자는 쓰지 않습니다. 겁주거나 운명을 단정하지 않습니다.
- 건강·투자·법률은 확언하지 않습니다. 위기 신호(죽고 싶다 등)가 보이면 따뜻하게 받아주고 상담전화 109를 알려줍니다.
- 반려동물은 '재미로 보는' 풀이입니다. 아픈 곳은 꼭 수의사에게 보이라고 합니다."""


def questions():
    """화면에 내려줄 질문지 (주제마다)."""
    return {k: {"label": TOPICS[k], "q": [{"id": i, "ask": a, "opts": o} for i, a, o in QUESTIONS[k]],
                "story": STORY_Q[k], "partner": PARTNER.get(k), "concern": CONCERN_OF[k], "price": products.PRODUCTS[k]["price"],
                "pages": products.PRODUCTS[k]["pages"]} for k in TOPICS}


def _answers_text(topic, answers):
    lines = []
    for qid, ask, opts in QUESTIONS[topic]:
        v = str(answers.get(qid) or "").strip()[:40]
        if v:
            lines.append(f"- {ask} → {v}")
    return "\n".join(lines) or "- (고른 답 없음)"


def _partner_text(topic, chart, partner, partner_chart):
    if not partner_chart:
        return ""
    if topic == "pet":
        img = quick._clean(K.DAY_MASTER[partner_chart["day_master"]["ko"]]["image"])
        return f"\n[반려동물 '{partner.get('name') or '우리 아이'}'의 사주 (재미로)]\n일간: {partner_chart['day_master']['ko']} — {img}\n"
    comp = compatibility(chart, partner_chart)
    name = partner.get("name") or "상대"
    return (f"\n[{name}의 사주]\n{interpret.chart_summary(partner_chart, None)}\n\n[두 사람의 궁합 계산]\n"
            f"{interpret.match_summary(comp, name)}\n")


def _rules(topic, chart, luck, answers, story, partner, partner_chart):
    """AI가 없을 때: 사주 계산 + 손님이 고른 답으로 만드는 상담 (반말)."""
    dm = quick.DM[chart["day_master"]["ko"]]
    image = quick._clean(K.DAY_MASTER[chart["day_master"]["ko"]]["image"])
    y = luck["year"]
    year_text = quick.YEAR_GOD.get(y["stem_god"], "")
    lens = concern.LENS.get(CONCERN_OF[topic], "")
    picked = [str(answers.get(qid) or "") for qid, _, _ in QUESTIONS[topic] if answers.get(qid)]
    said = f"네가 '{' · '.join(picked)}'라고 했지. " if picked else ""
    core = f"{said}너는 「{image}」의 사람이다. {dm['core']} 이 고민도 결국 네 그 성정에서 시작됐다."
    why = (f"{lens} 네 사주에서 걸리는 건 '{dm['shadow'][0]}'이다. 같은 고민이 되풀이된다면, 상황보다 이 습관이 먼저 움직였기 때문이다. "
           f"그리고 '{dm['shadow'][1]}' — 이것도 함께 보아라.")
    if topic in ("match", "reunion") and partner_chart:
        comp = compatibility(chart, partner_chart)
        hit = [p["text"] for p in comp["pairs"][:2]]
        why += (f" 두 사람 사주 사이에는 '{', '.join(hit)}'의 자리가 보인다. 합은 끌림이고 충은 부딪힘이다." if hit else
                " 두 사람 사주는 크게 부딪히는 자리가 없다. 문제는 사주보다 말과 때다.")
    if topic == "pet" and partner_chart:
        why = (f"그 아이는 「{quick._clean(K.DAY_MASTER[partner_chart['day_master']['ko']]['image'])}」의 기운을 타고났다 (재미로 보는 거다). "
               f"너는 {image}. 서로 다른 결이라 서로를 채운다. 아픈 곳이 보이면 꼭 수의사에게 보여라.")
    do = f"{dm['tip']} 네 무기는 '{dm['good'][0]}'이다. 이번 고민에도 그걸 먼저 꺼내 써라."
    when = f"올해 {y['year']}년({y['ko']})의 기운은 이렇다 — {year_text} 달마다 언제 움직이고 언제 기다릴지는 PDF에 정확히 적어주마."
    return {"core": core, "why": why, "do": do, "when": when}


SECTIONS = [("core", "핵심"), ("why", "진짜 이유"), ("do", "이렇게 해라"), ("when", "때")]


def reading(topic, birth, chart_of_birth, answers, story, partner=None):
    """partner: {"name", "birth"(parse_birth 결과)} 또는 None."""
    topic = topic if topic in TOPICS else "counsel"
    answers = answers if isinstance(answers, dict) else {}
    story = re.sub(r"\s+", " ", (story or "").strip())[:500]
    chart = chart_of_birth(birth)
    luck = current_luck(chart)
    partner_chart = chart_of_birth(partner["birth"]) if partner and partner.get("birth") else None
    out, engine = None, "rules"
    if llm.available() and concern._take():
        prompt = f"""[상담 주제] {TOPICS[topic]}

[손님 사주 계산 결과]
{interpret.chart_summary(chart, luck)}
{_partner_text(topic, chart, partner or {}, partner_chart)}
[도령이 묻고 손님이 고른 답]
{_answers_text(topic, answers)}

[손님이 직접 한 말] {story or '(따로 적지 않음)'}

아래 네 칸을 그대로 써서 답하세요 (다른 말 없이). 전부 합쳐 900~1300자.
[핵심]
손님의 고민에 대한 도령의 답을 먼저 말한다. 손님이 고른 답과 한 말을 짚으며, 사주 근거 하나로. 3~4문장.
[진짜 이유]
이 고민이 생기고 반복되는 진짜 이유를 사주로 설명한다 (성향·기운의 쏠림·올해 흐름 중 해당되는 것). 4~5문장.
[이렇게 해라]
이 사람에게만 맞는 구체적인 조언 2~3가지. 오늘 당장 할 수 있는 작은 행동 하나 포함.
[때]
제공된 운의 흐름에 근거해 앞으로 1년 중 움직이기 좋은 때와 조심할 때를 하나씩. 달마다의 자세한 흐름은 PDF에 담아주겠다는 말로 끝낸다."""
        box = {}
        t = threading.Thread(target=lambda: box.update(r=llm.generate(SYSTEM, [{"role": "user", "content": prompt}], 1800)),
                             daemon=True)
        t.start()
        t.join(WAIT)
        text, eng = box.get("r") or (None, None)
        if t.is_alive():
            print(f"[상담] AI가 {WAIT}초 안에 답하지 않아 기본 문장으로")
        m = re.search(r"\[핵심\]\s*(.+?)\s*\[진짜 이유\]\s*(.+?)\s*\[이렇게 해라\]\s*(.+?)\s*\[때\]\s*(.+)", text or "", re.S)
        if m:
            out = {k: m.group(i + 1).strip().strip('"') for i, (k, _) in enumerate(SECTIONS)}
            engine = eng
        elif text:
            print(f"[상담] AI 답 모양이 달라 기본 문장으로: {text[:120]}")
    if not out:
        out = _rules(topic, chart, luck, answers, story, partner or {}, partner_chart)
    return {"topic": topic, "label": TOPICS[topic], "image": quick._clean(K.DAY_MASTER[chart["day_master"]["ko"]]["image"]),
            "sections": [{"id": k, "title": t, "text": out[k]} for k, t in SECTIONS], "engine": engine,
            "product": topic, "price": products.PRODUCTS[topic]["price"]}
