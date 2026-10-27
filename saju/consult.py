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
from saju_engine import compatibility, current_luck, year_months

WAIT = int(concern.os.environ.get("CONSULT_AI_WAIT", "25"))  # 상담은 길어서 고민 맛보기보다 조금 더 기다린다

# 상담 주제 → 상품, 화면에 보이는 이름. 친구 초대 무료 PDF도 이 6가지 중 하나
TOPICS = {
    "counsel": "고민 상담", "love": "연애운 · 인연", "pet": "반려동물",
    "reunion": "재회운", "match": "궁합", "career": "직업 · 재물",
}
FREE_PDF = set(TOPICS)

# 화면의 질문 (id, 도령의 질문, 고를 것들). 마지막 '하고 싶은 말'은 모든 주제에 공통
QUESTIONS = {
    "counsel": [("area", "어떤 쪽 고민이야?", ["일·진로", "돈", "사람·가족", "마음·건강", "이사·변화", "그 밖에"]),
                ("since", "그 고민, 언제부터였어?", ["최근 한 달", "몇 달째", "1년 넘게", "몇 년째 반복"])],
    "love": [("state", "지금 너는 어떤 상태야?", ["혼자야", "썸 타는 중", "연애 중", "결혼 고민 중", "헤어진 지 얼마 안 됐어"]),
             ("pattern", "연애할 때 늘 되풀이되는 게 있어?", ["늘 내가 더 좋아해", "시작이 어려워", "오래 못 가",
                                                   "안 맞는 사람만 만나", "잘 모르겠어"])],
    "pet": [("kind", "어떤 아이야?", ["강아지", "고양이", "그 밖의 아이"]),
            ("want", "그 아이 뭐가 궁금해?", ["타고난 성격", "나와의 궁합", "행동 고민", "건강 관리 리듬"])],
    "reunion": [("when", "헤어진 지 얼마나 됐어?", ["한 달 안", "1~6개월", "반년~1년", "1년 넘게"]),
                ("why", "왜 헤어졌어?", ["다툼·성격 차이", "상황·거리", "상대 마음이 식었어", "내 실수", "잘 모르겠어"]),
                ("contact", "지금 연락은 돼?", ["가끔 해", "끊겼어", "차단됐어"])],
    "match": [("relation", "그 사람은 너한테 누구야?", ["연인", "썸", "배우자", "친구", "직장 동료", "가족"])],
    "career": [("now", "지금 너는 어디쯤 있어?", ["직장인", "이직 준비", "취업 준비", "사업·자영업", "프리랜서", "학생"]),
               ("core", "제일 걸리는 건 뭐야?", ["이직·퇴사", "승진·인정", "돈 모으기", "창업·부업", "내 적성 찾기"])],
}
PARTNER = {"match": "required", "reunion": "optional", "pet": "pet"}  # 상대(또는 아이) 생년월일
STORY_Q = {
    "counsel": "한 줄이면 돼. 지금 제일 궁금한 게 뭐야?",
    "love": "어떤 사람을 만나고 싶은지, 아니면 지금 마음에 걸리는 사람 이야기를 해 줘.",
    "pet": "아이 이름이랑, 요즘 그 아이한테 마음 쓰이는 걸 말해 줘.",
    "reunion": "그 사람이랑 어떤 사이였는지, 지금 네 마음이 어떤지 말해 줘.",
    "match": "그 사람이랑 뭐가 궁금해? 잘 맞는지, 앞으로 어떨지…",
    "career": "지금 하는 일이나 하고 싶은 일, 그리고 고민을 한두 줄로 적어 줘.",
}
CONCERN_OF = {"counsel": "relation", "love": "love", "pet": "relation", "reunion": "love", "match": "love", "career": "career"}

SYSTEM = """당신은 사주 상담 브랜드 '운결'의 도령입니다. 친한 친구처럼 가볍고 다정한 반말로 말합니다 ("~야", "~해 봐", "~지?"). 예스러운 말투("~느냐", "~해라", "~주마", "~구나")는 쓰지 않습니다. (2026-10-27 사장님: 친구 같은 말투)
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
    core = f"{said}너는 「{image}」 같은 사람이야. {dm['core']} 이 고민도 결국 네 그 성격에서 시작됐을 거야."
    why = (f"{lens} 네 사주에서 걸리는 건 '{dm['shadow'][0]}'야. 같은 고민이 되풀이된다면, 상황보다 이 습관이 먼저 움직였기 때문이야. "
           f"그리고 '{dm['shadow'][1]}' — 이것도 같이 봐 줘.")
    if topic in ("match", "reunion") and partner_chart:
        comp = compatibility(chart, partner_chart)
        hit = [p["text"] for p in comp["pairs"][:2]]
        why += (f" 두 사람 사주 사이에 '{', '.join(hit)}' 자리가 보여. 합은 끌림이고 충은 부딪힘이야." if hit else
                " 두 사람 사주는 크게 부딪히는 자리가 없어. 문제는 사주보다 말이랑 타이밍이야.")
    if topic == "pet" and partner_chart:
        why = (f"그 아이는 「{quick._clean(K.DAY_MASTER[partner_chart['day_master']['ko']]['image'])}」의 기운을 타고났어 (재미로 보는 거야). "
               f"너는 {image}. 서로 다른 결이라 서로를 채워 줘. 아픈 데가 보이면 꼭 수의사한테 보여 줘.")
    do = f"{dm['tip']} 네 무기는 '{dm['good'][0]}'야. 이번 고민에도 그걸 먼저 꺼내 써 봐."
    when = f"올해 {y['year']}년({y['ko']})의 기운은 이래 — {year_text} 달마다 언제 움직이고 언제 기다릴지는 PDF에 정확히 적어 줄게."
    return {"core": core, "why": why, "do": do, "when": when}


SECTIONS = [("core", "핵심"), ("why", "진짜 이유"), ("do", "이렇게 해 봐"), ("when", "때")]


# PDF의 남은 장: 손님에게 '이 장에서 무엇을 알려주는지' 쉬운 말로 (돈을 써볼 만하다고 느끼게, 그러나 과장 없이)
SELL = {
    "질문에 대한 답": "네 질문에 대한 결론부터. 그렇게 보는 사주의 근거 2~3가지를 네 상황에 하나씩 이어서",
    "앞으로 이렇게 해보세요": "앞으로 12개월 중 이 질문에 힘이 실리는 달, 그리고 바로 해볼 행동 3가지",
    "나의 연애 기질": "네가 어떤 사람에게 끌리는지, 연애할 때 늘 나오는 강점과 버릇",
    "연애가 꼬였던 이유": "네 사주의 부딪히는 자리와 쏠린 기운이 연애에서 어떤 장면으로 나왔는지",
    "인연이 들어오는 시기": "인연의 기운이 들어오는 달을 '몇 년 몇 월, 왜'로. 조심할 달까지",
    "좋은 인연을 만나는 법": "만남이 생기기 쉬운 곳과 상황, 너와 맞는 사람의 특징, 체크리스트",
    "우리 아이의 타고난 기질": "아이가 타고난 성격을 따뜻하게 (재미로 보는 풀이)",
    "좋아하는 것과 스트레스 포인트": "아이에게 맞는 놀이·산책·환경, 예민해지는 순간과 달래는 법",
    "보호자와의 궁합": "너와 아이가 서로 채워주는 점, 맞춰줄 점",
    "올해 함께 행복하게 보내는 법": "올해 함께 하면 좋은 것, 특별히 챙겨줄 시기",
    "두 사람의 관계 구조": "두 사람이 어떤 모양의 관계인지 사주로",
    "헤어짐은 어디서 왔나": "누구 탓이 아니라, 그때의 운에서 무엇이 부딪혔는지",
    "다시 이어질 수 있는 시기": "앞으로 24개월 중 관계가 다시 움직이기 쉬운 달과 그 이유",
    "재회를 위한 행동과 놓아줄 신호": "다가갈 때의 말과 타이밍, 하지 말아야 할 것, 그리고 정직하게 '놓아줄 신호'",
    "한눈에 보는 두 사람": "두 사람의 관계를 한 문장으로",
    "서로 끌리는 점": "두 사주가 서로를 채우는 자리, 실제 장면 예시와 함께",
    "부딪히기 쉬운 장면": "말투·결정·돈·시간 중 어디서 부딪히는지 구체적으로",
    "돈과 생활 방식": "돈 쓰는 법과 생활 리듬의 차이, 미리 정해두면 좋은 규칙",
    "앞으로 2년, 두 사람의 흐름": "올해와 내년, 가까워지는 시기와 조심할 시기",
    "잘 지내는 법": "누가 무엇을 하면 좋은지 행동 5가지",
    "타고난 일 기질": "네가 일하는 방식, 맞는 일과 환경, 강점과 약점",
    "돈을 버는 방식": "월급형·사업형·전문가형 중 너의 방식, 돈이 새는 버릇",
    "지금의 일 운": "지금의 10년 흐름과 올해의 일 운을 네 고민에 이어서",
    "이직·창업·승진의 시기": "앞으로 24개월 중 움직일 달과 버틸 달을 '몇 년 몇 월, 왜'로",
    "돈과 커리어 실천법": "네 사주에 맞는 일 습관·돈 관리 습관, 이번 달 체크리스트",
}


def _facts(chart, luck):
    """PDF에 들어갈 사실을 미리 '개수'로만 (정답인 달은 PDF에). quick.locked_sections 와 같은 계산."""
    ym = year_months(chart, products.NY)
    good = [m for m in ym if m["yongsin_hit"] and not m["clash"]]
    care = [m for m in ym if m["clash"]]
    love = next((x for x in quick.locked_sections(chart, luck) if x["id"] == "love"), {"text": ""})
    return {"good": len(good), "care": len(care), "love": love["text"].count("월"), "ny": products.NY}


def _hint(title, f):
    """그 장에 대해 '네 사주에서 이미 보이는 것' 한 줄."""
    if "인연" in title and "시기" in title:
        return (f"네 사주에 앞으로 인연 기운이 들어오는 달이 {f['love']}번 보여. 그게 언제인지는 이 장에 적었어."
                if f["love"] else "앞으로 1년 남짓 인연 흐름이 보여. 언제 움직일지 이 장에 적었어.")
    if any(k in title for k in ("시기", "흐름", "앞으로 이렇게")):
        return f"네 사주에 {f['ny']}년 힘이 붙는 달이 {f['good']}번, 부딪힘을 조심할 달이 {f['care']}번 보여. 몇 월인지, 왜인지 이 장에 적었어."
    if any(k in title for k in ("법", "행동", "실천")):
        return "읽고 끝나지 않게, 네 사주에 맞춰 바로 해 볼 것들로 마무리했어."
    return ""


def _preview_n(toc):
    """PDF 미리 읽기로 보여줄 장 수: 앞의 2장 (장이 2개뿐이면 1장). 나머지는 제목만."""
    return 1 if len(toc) <= 2 else 2


def _rule_preview(chart, toc, n):
    """AI가 없을 때 PDF 앞 장들의 첫머리를 사주 계산으로 (반말)."""
    dm = quick.DM[chart["day_master"]["ko"]]
    image = quick._clean(K.DAY_MASTER[chart["day_master"]["ko"]]["image"])
    el = chart["elements_simple"]
    lack = [e for e, v in el.items() if v == 0]
    many = [e for e, v in el.items() if v >= 3]
    note = quick.ELEMENT_LACK[lack[0]] if lack else (quick.ELEMENT_MANY[many[0]] if many else "")
    lines = [f"너는 「{image}」 같은 사람이야. {dm['core']} 이 장은 네가 가진 '{dm['good'][1]}'에서 시작해.",
             (f"{note} " if note else "") + f"그리고 '{dm['shadow'][0]}' — 여기가 같은 일이 되풀이되는 자리야."]
    return lines[:n]


def reading(topic, birth, chart_of_birth, answers, story, partner=None):
    """partner: {"name", "birth"(parse_birth 결과)} 또는 None."""
    topic = topic if topic in TOPICS else "counsel"
    answers = answers if isinstance(answers, dict) else {}
    story = re.sub(r"\s+", " ", (story or "").strip())[:500]
    chart = chart_of_birth(birth)
    luck = current_luck(chart)
    partner_chart = chart_of_birth(partner["birth"]) if partner and partner.get("birth") else None
    out, engine = None, "rules"
    toc = products.toc(products.PRODUCTS[topic])
    n = _preview_n(toc)
    chap = "\n".join(f"{i + 1}. {c['t']} — {c['d']}" for i, c in enumerate(toc[:n]))
    peek = None
    if llm.available() and concern._take():
        prompt = f"""[상담 주제] {TOPICS[topic]}

[손님 사주 계산 결과]
{interpret.chart_summary(chart, luck)}
{_partner_text(topic, chart, partner or {}, partner_chart)}
[도령이 묻고 손님이 고른 답]
{_answers_text(topic, answers)}

[손님이 직접 한 말] {story or '(따로 적지 않음)'}

아래 다섯 칸을 그대로 써서 답하세요 (다른 말 없이). 앞의 네 칸은 합쳐 900~1300자.
[핵심]
손님의 고민에 대한 도령의 답을 먼저 말한다. 손님이 고른 답과 한 말을 짚으며, 사주 근거 하나로. 3~4문장.
[진짜 이유]
이 고민이 생기고 반복되는 진짜 이유를 사주로 설명한다 (성향·기운의 쏠림·올해 흐름 중 해당되는 것). 4~5문장.
[이렇게 해 봐]
이 사람에게만 맞는 구체적인 조언 2~3가지. 오늘 당장 할 수 있는 작은 행동 하나 포함.
[때]
제공된 운의 흐름에 근거해 앞으로 1년 중 움직이기 좋은 때와 조심할 때를 하나씩. 달마다의 자세한 흐름은 PDF에 담아주겠다는 말로 끝낸다.
[PDF 맛보기]
이 손님이 받을 PDF의 앞 {n}개 장을 미리 조금 읽어주는 것이다. 아래 장마다 그 장의 첫머리처럼 이 사람의 사주로 2문장씩, 한 줄에 하나. 형식 "장 번호. 내용":
{chap}"""
        box = {}
        t = threading.Thread(target=lambda: box.update(r=llm.generate(SYSTEM, [{"role": "user", "content": prompt}], 1800)),
                             daemon=True)
        t.start()
        t.join(WAIT)
        text, eng = box.get("r") or (None, None)
        if t.is_alive():
            print(f"[상담] AI가 {WAIT}초 안에 답하지 않아 기본 문장으로")
        text, _, tail = (text or "").partition("[PDF 맛보기]")
        m = re.search(r"\[핵심\]\s*(.+?)\s*\[진짜 이유\]\s*(.+?)\s*\[이렇게 해 봐\]\s*(.+?)\s*\[때\]\s*(.+)", text, re.S)
        if m:
            out = {k: m.group(i + 1).strip().strip('"') for i, (k, _) in enumerate(SECTIONS)}
            engine = eng
            got = dict(re.findall(r"^\s*(\d)\.\s*(.+)$", tail, re.M))
            if all(str(i + 1) in got for i in range(n)):
                peek = [re.sub(r"^[^—:]{0,30}[—:]\s*", "", got[str(i + 1)]).strip() for i in range(n)]
        elif text:
            print(f"[상담] AI 답 모양이 달라 기본 문장으로: {text[:120]}")
    if not out:
        out = _rules(topic, chart, luck, answers, story, partner or {}, partner_chart)
    if not peek:
        peek = _rule_preview(chart, toc, n)
    facts = _facts(chart, luck)
    return {"topic": topic, "label": TOPICS[topic], "image": quick._clean(K.DAY_MASTER[chart["day_master"]["ko"]]["image"]),
            "sections": [{"id": k, "title": t, "text": out[k]} for k, t in SECTIONS], "engine": engine,
            "product": topic, "price": products.PRODUCTS[topic]["price"],
            # PDF 미리 읽기: 앞 장들은 이 사람 사주로 조금, 나머지는 제목만
            "preview": [{"t": c["t"], "text": peek[i]} for i, c in enumerate(toc[:n])],
            "rest": [{"t": c["t"], "what": SELL.get(c["t"], c["d"]), "chars": c["chars"], "hint": _hint(c["t"], facts)}
                     for c in toc[n:]],
            "pages": products.PRODUCTS[topic]["pages"], "total_chars": sum(c["chars"] for c in toc)}
