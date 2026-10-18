"""사주 해석 엔진.

llm.py 에 설정된 AI(제미나이·챗GPT·Claude 중 사용 가능한 것)로 '상담형' 풀이를 생성하고,
모든 AI가 실패하면 지식 베이스 기반 규칙 해석으로 동작한다(오프라인 데모 가능).
"""
import knowledge as K
import llm
import quality

# 분량(글자 수) — 숫자만 바꾸면 전체 풀이 길이가 조정된다.
LEN_FULL = "2,000~2,800자"
LEN_COUNSEL = "500~900자"
LEN_DAILY = "300~500자"
LEN_YEARLY = "1,800~2,500자"
LEN_MATCH = "1,500~2,200자"

# 쉬운 말 우선 표기. 본문에서는 '쉬운 말(용어)' 형태로 쓴다.
PLAIN_GROUP = {"비겁": "나와 같은 힘", "식상": "표현하고 만들어내는 힘", "재성": "재물·결과를 다루는 힘",
               "관성": "나를 다잡는 책임의 힘", "인성": "나를 도와주고 채워주는 힘"}
PLAIN_GOD = {"비견": "동료·자립의 힘", "겁재": "경쟁·승부의 힘", "식신": "재능·여유의 힘", "상관": "표현·반항의 힘",
             "편재": "큰돈·기회의 힘", "정재": "꾸준한 돈·성실의 힘", "편관": "압박·도전의 힘", "정관": "규칙·인정의 힘",
             "편인": "직관·탐구의 힘", "정인": "배움·도움의 힘", "일간(나)": "나 자신"}
GROUP_OF = {"비견": "비겁", "겁재": "비겁", "식신": "식상", "상관": "식상", "편재": "재성", "정재": "재성",
            "편관": "관성", "정관": "관성", "편인": "인성", "정인": "인성"}

SYSTEM_PROMPT = """당신은 따뜻하고 통찰력 있는 명리 상담가 '운결'입니다. 상담 원칙:

[내 이야기처럼 — 가장 중요]
1. 반드시 [이 사주의 핵심 포인트]를 중심으로 씁니다. 이 사람에게만 해당하는 특징을 먼저, 일반론은 쓰지 않습니다.
2. 사용자가 털어놓은 상황 속 표현을 최소 2번 짧게 따옴표로 인용하고, 그것이 어떤 기운과 이어지는지 연결합니다.
   예: "‘회의 때 말을 삼키게 된다’고 하셨는데, 표현하는 힘(식상)이 원국에 하나도 없는 것과 닿아 있습니다."
3. 누구에게나 맞는 문장은 쓰지 않습니다. 금지 예: "노력하면 좋은 결과가 있을 것입니다", "긍정적인 마음가짐이 중요합니다",
   "주변 사람과의 관계를 소중히 하세요", "때를 기다리면 기회가 옵니다", "건강에 유의하세요"(근거 없이).
   이런 말이 떠오르면 대신 '언제, 무엇을, 왜(어떤 기운 때문에)'를 넣은 구체적 문장으로 바꿉니다.

[쉬운 말]
4. 명리 용어는 쉬운 말을 먼저 쓰고 괄호 안에 용어를 한 번만 붙입니다. 예: "나를 도와주는 힘(인성)", "10년마다 바뀌는 큰 흐름(대운)".
   같은 용어를 두 번째부터는 쉬운 말만 씁니다. 본문에 한자는 쓰지 않습니다.
5. 비유는 일상적인 것으로 짧게 한 번씩만 씁니다. 문장은 짧게, 한 문단은 3~4문장 이내로.

[태도와 안전]
6. 사주는 '정해진 운명'이 아니라 '타고난 기운의 지도'입니다. 겁주거나 단정하지 않습니다.
7. 건강·법률·투자는 확정적 조언 대신 전문가 상담을 권합니다. 위기 신호(자해 등)가 보이면 상담전화 109, 1393을 안내합니다.
8. 제공된 계산 결과만 사용하고, 없는 간지나 신살을 지어내지 않습니다.
   '많다·과다·넘친다·없다·부족하다' 같은 양 표현은 계산값과 [핵심 포인트]에 근거가 있을 때만 씁니다.
   (십신 그룹은 3개 이상일 때만 '많다', 0개일 때만 '없다') 올해·대운에서 들어오는 기운과 타고난 기운을 섞어 말하지 않습니다.
9. 한국어 존댓말, 마크다운. 소제목은 '## '로 시작하고, 요청한 분량을 지킵니다."""


def _generate(system, messages, max_tokens):
    text, engine = llm.generate(system, messages, max_tokens)
    return (text, engine) if text else (None, None)


def plain(term):
    """'쉬운 말(용어)' 표기."""
    word = PLAIN_GROUP.get(term) or PLAIN_GOD.get(term)
    return f"{word}({term})" if word else term


def key_points(chart, luck):
    """이 사주만의 두드러진 특징 3~5개를 쉬운 말로 뽑는다(AI가 일반론으로 흐르지 않게 하는 닻)."""
    pts = []
    el = chart["elements"]
    total = sum(el.values()) or 1
    hi_el, hi_v = max(el.items(), key=lambda x: x[1])
    lo_el, lo_v = min(el.items(), key=lambda x: x[1])
    if hi_v / total >= 0.35:
        pts.append(f"{hi_el} 기운({K.ELEMENT[hi_el]['meaning']})이 전체의 {round(hi_v / total * 100)}%로 한쪽에 크게 쏠려 있음")
    if lo_v / total <= 0.06:
        pts.append(f"{lo_el} 기운({K.ELEMENT[lo_el]['meaning']})이 거의 없음 → 이 영역은 타고나기보다 의식적으로 채워야 함")
    groups = chart["ten_god_groups"]
    for g, c in groups.items():
        if c == 0:
            pts.append(f"{plain(g)}이 원국에 하나도 없음 → 운에서 이 힘이 들어올 때 삶의 변화가 크게 체감됨")
        elif c >= 3:
            pts.append(f"{plain(g)}이 {c}개로 많음 → 삶의 중심 테마이자 과하면 그림자가 되는 힘")
    pts.append(f"나를 돕는 기운이 {round(chart['strength_ratio'] * 100)}%로 '{chart['strength']}', "
               f"균형을 맞춰주는 기운(용신)은 {chart['yongsin']}, 과하면 부담이 되는 기운(기신)은 {chart['gisin']}")
    for r in chart["relations"][:2]:
        kind = "부딪힘(충) — 변화·이동·갈등이 잦은 자리" if r["type"] == "충" else "끌어당김(합) — 인연·협력이 묶이는 자리"
        pts.append(f"원국 안의 {r['text']}({'·'.join(r['between'])}): {kind}")
    if luck:
        for name, item in (("지금의 10년 흐름(대운)", luck.get("daeun")), (f"{luck['year']['year']}년 흐름(세운)", luck["year"])):
            if item and item.get("relations"):
                pts.append(f"{name}이 원국과 {', '.join(r['text'] for r in item['relations'])}을 이룸 → 지금 체감되는 변화가 큰 시기")
        lg = {luck["year"]["stem_god"], luck["year"]["branch_god"]}
        missing = [g for g, c in groups.items() if c == 0]
        hit = [g for g in missing if any(GROUP_OF.get(x) == g for x in lg)]
        if hit:
            pts.append(f"원국에 없던 {', '.join(plain(g) for g in hit)}이 올해 운에서 들어옴 → 낯설지만 중요한 기회·과제")
    if chart["shinsal"]:
        pts.append("신살: " + ", ".join(f"{s['name']}({s['pillar']})" for s in chart["shinsal"][:3]))
    return pts[:6]


def chart_summary(chart, luck):
    """LLM 에 넘길 사주 요약 텍스트."""
    lines = []
    i = chart["input"]
    lines.append(f"출생: {i['year']}-{i['month']:02d}-{i['day']:02d} "
                 + (f"{i['hour']:02d}:{i['minute']:02d}" if i["time_known"] else "(시간 모름)")
                 + f" / {'남' if i['gender']=='male' else '여'} / {i['city']} (시간보정 {chart['time_correction_min']}분)")
    for k in chart["order"]:
        p = chart["pillars"][k]
        hid = ",".join(h["stem"] + "(" + h["god"] + ")" for h in p["hidden"])
        lines.append(f"{p['label']}: {p['ko']} 천간 {p['stem_element']}·{p['stem_god']} / "
                     f"지지 {p['branch_element']}·{p['branch_god']} / 지장간 {hid}")
    dm = chart["day_master"]
    lines.append(f"일간: {dm['ko']} ({'양' if dm['yang'] else '음'}{dm['element']}) — 상징: {K.DAY_MASTER[dm['ko']]['image']}")
    lines.append("오행 분포(가중): " + ", ".join(f"{k} {v}" for k, v in chart["elements"].items()))
    lines.append("십신 그룹: " + ", ".join(f"{k} {v}" for k, v in chart["ten_god_groups"].items()))
    lines.append(f"신강약: {chart['strength']} (지지율 {chart['strength_ratio']}) / 용신(억부 간이): {chart['yongsin']} / 기신: {chart['gisin']}")
    if chart["relations"]:
        lines.append("원국 합충: " + ", ".join(r["text"] + "(" + "-".join(r["between"]) + ")" for r in chart["relations"]))
    if chart["shinsal"]:
        lines.append("신살: " + ", ".join(f"{s['name']}({s['pillar']})" for s in chart["shinsal"]))
    lines.append("대운(" + ("순행" if chart["daeun_forward"] else "역행") + "): "
                 + " → ".join(f"{d['age']}세 {d['ko']}" for d in chart["daeun"]))
    if luck:
        d = luck["daeun"]
        if d:
            lines.append(f"현재 대운: {d['ko']} {d['age']}세~ / 천간 {d['stem_god']}, 지지 {d['branch_god']}"
                         + (" / 원국과 " + ", ".join(r["text"] for r in d["relations"]) if d["relations"] else ""))
        nxt = luck.get("next_daeun")
        if nxt:
            lines.append(f"다음 대운: {nxt['age']}세({nxt['start_year']}년경) {nxt['ko']} / {nxt['stem_god']}·{nxt['branch_god']}")
        y = luck["year"]
        lines.append(f"{y['year']}년 세운: {y['ko']} / 천간 {y['stem_god']}, 지지 {y['branch_god']}"
                     + (" / 원국과 " + ", ".join(r["text"] for r in y["relations"]) if y["relations"] else ""))
        m = luck["month"]
        lines.append(f"이번 달 월운: {m['ko']} / {m['stem_god']}·{m['branch_god']}")
        lines.append(f"오늘({luck['today']}) 일진: {luck['day']['ko']} / {luck['day']['stem_god']}·{luck['day']['branch_god']}")
        lines.append(f"현재 나이(한국식): {luck['age']}세")
    lines.append("\n[이 사주의 핵심 포인트 — 풀이의 중심]")
    lines += [f"- {p}" for p in key_points(chart, luck)]
    return "\n".join(lines)


def situation_text(sit):
    concern = K.CONCERNS.get(sit.get("concern", ""), {}).get("label", sit.get("concern", ""))
    parts = [f"직업/상태: {sit.get('job','')}", f"주요 고민 분야: {concern}",
             f"현재 상황과 고민(본인 서술): {sit.get('story','')}"]
    if sit.get("mood"):
        parts.append(f"요즘 마음 상태: {sit['mood']}")
    if sit.get("goal"):
        parts.append(f"원하는 결과: {sit['goal']}")
    return "\n".join(parts)


def _result(text, engine, fallback, qc=None):
    """qc=(chart, luck, sit, kind) 를 주면 AI 풀이를 자동 채점해 서버 로그에 남긴다(손님 화면에는 안 보임)."""
    if text:
        if qc:
            try:
                r = quality.check(text, *qc)
                print(f"[품질] {qc[3]} {engine} — {quality.report_text(r, excerpts=False)}")
            except Exception as e:  # 검사기 오류가 풀이 제공을 막으면 안 됨
                print(f"[품질] 검사 실패: {e}")
        return {"engine": engine, "markdown": text}
    return {"engine": "rules", "markdown": fallback()}


# ---------------------------------------------------------------- 메인 풀이
def full_reading(chart, luck, sit, name=""):
    prompt = f"""다음은 {name or '상담자'}님의 사주 계산 결과와 현재 상황입니다.

[사주 계산 결과]
{chart_summary(chart, luck)}

[현재 상황]
{situation_text(sit)}

아래 구성으로 상담 리포트를 작성하세요. 전체 {LEN_FULL}.
## 한눈에 보기
  (이 사람만의 핵심을 3줄 불릿으로. 각 줄은 '특징 → 그래서 지금 내 삶에서 어떻게 나타나는지' 형태. 40자 내외)
## 1. 나는 어떤 사람인가 (약 500자)
  (일간의 상징과 핵심 포인트의 쏠림·부족을 엮어서. 강점 하나, 그림자 하나를 사용자 상황과 연결)
## 2. 지금 내 고민은 어디서 오는가 (약 600자)
  (사용자 서술을 인용하며, 원국의 어떤 특징 + 지금의 대운·세운이 이 고민을 만들고 있는지. '왜 하필 지금인지'까지)
## 3. 올해와 앞으로의 흐름 (약 500자)
  (현재 대운·세운·이번 달의 성격, 다음 대운 전환 시기, 기회의 시기와 조심할 시기를 연·월 단위로)
## 4. 그래서 이렇게 해보세요 (약 600자)
  (균형을 맞춰주는 기운(용신)을 쓰는 법을 고민에 맞춰. '이번 주 / 이번 달 / 올해' 체크리스트 각 1~2개, 모두 구체적인 행동)
## 이 리포트의 용어
  (본문에 나온 명리 용어 최대 5개를 '용어: 한 줄 풀이' 형태로)
마지막에 두 문장 이내의 따뜻한 정리."""
    text, engine = _generate(SYSTEM_PROMPT, [{"role": "user", "content": prompt}], 4000)
    return _result(text, engine, lambda: _rule_reading(chart, luck, sit, name), (chart, luck, sit, "full"))


def counsel(chart, luck, sit, history, question, name=""):
    """후속 상담(대화형). history: [{role, content}]"""
    context = f"""[상담자 사주]\n{chart_summary(chart, luck)}\n\n[상담자 현재 상황]\n{situation_text(sit)}"""
    msgs = [{"role": "user", "content": context + "\n\n위 내용을 바탕으로 이어지는 질문에 답해주세요."},
            {"role": "assistant", "content": "네, 사주와 현재 상황을 모두 숙지했습니다. 편하게 물어보세요."}]
    for h in history[-10:]:
        msgs.append({"role": h["role"], "content": h["content"]})
    msgs.append({"role": "user", "content": question})
    system = SYSTEM_PROMPT + f"""
대화형 상담입니다. {LEN_COUNSEL}로 답하세요. 질문에 대한 답을 첫 문장에 먼저 말하고,
그 근거가 되는 기운을 한두 개만 짚은 뒤, 마지막에 '오늘 해볼 한 가지'를 제안하세요. 소제목은 2개 이하."""
    text, engine = _generate(system, msgs, 1800)
    return _result(text, engine, lambda: _rule_counsel(chart, luck, sit, question), (chart, luck, sit, "counsel"))


def daily(chart, luck, sit):
    d = luck["day"]
    prompt = f"""[사주]\n{chart_summary(chart, luck)}\n\n[현재 상황]\n{situation_text(sit)}\n
오늘의 일진 {d['ko']}이 이 사람의 원국과 만나 만드는 하루를 {LEN_DAILY}로 풀어주세요.
## 오늘의 기운 (2~3문장) / ## 오늘 고민과 관련해 (사용자 고민과 연결, 2~3문장) / ## 오늘의 한 가지 행동 / ## 행운 포인트(색·방향·시간대 한 줄)"""
    text, engine = _generate(SYSTEM_PROMPT, [{"role": "user", "content": prompt}], 1000)
    return _result(text, engine, lambda: _rule_daily(chart, luck), (chart, luck, sit, "daily"))


# ---------------------------------------------------------------- 규칙 기반 해석
def _top(d, n=2, reverse=True):
    return sorted(d.items(), key=lambda x: x[1], reverse=reverse)[:n]


def _rule_reading(chart, luck, sit, name):
    dm = chart["day_master"]
    info = K.DAY_MASTER[dm["ko"]]
    el = chart["elements"]
    strong_el = _top(el, 1)[0][0]
    weak_el = _top(el, 1, reverse=False)[0][0]
    yong = chart["yongsin"]
    groups = chart["ten_god_groups"]
    many = [g for g, c in groups.items() if c >= 3]
    none = [g for g, c in groups.items() if c == 0]
    concern = K.CONCERNS.get(sit.get("concern"), K.CONCERNS["career"])
    nm = name or "상담자"
    out = []

    out.append(f"## 1. 나의 타고난 기운 — 일간과 원국 이해하기\n\n"
               f"{nm}님은 **{dm['ko']}{dm['element']} 일간**, 상징으로는 **{info['image'].split('(')[0]}**입니다. "
               f"사주에서 태어난 날의 천간(일간)은 '나 자신'을 뜻하고, 나머지 일곱 글자는 나를 둘러싼 환경입니다.\n\n"
               f"{info['nature']}\n\n- **강점**: {info['strength']}\n- **그림자**: {info['shadow']}\n\n"
               f"오행 분포를 보면 **{strong_el}({K.ELEMENT[strong_el]['meaning']})** 기운이 가장 강하고 "
               f"**{weak_el}({K.ELEMENT[weak_el]['meaning']})** 기운이 가장 약합니다. "
               f"{K.ELEMENT[strong_el]['excess']} 반대로 {weak_el} 기운이 부족하면 {K.ELEMENT[weak_el]['lack']}\n\n"
               f"> **나를 돕는 기운의 양(신강·신약)**: 나를 돕는 기운이 사주 안에 얼마나 있는지를 보는 것입니다. "
               f"{nm}님은 **{chart['strength']}**으로, "
               + ("에너지가 넉넉해 이를 밖으로 쓰고 결과로 바꾸는 활동(표현·재물·책임)이 운을 엽니다." if chart["strength_ratio"] >= 0.5
                  else "에너지를 아껴 쓰고, 배움·조력자·휴식으로 나를 채워줄 때 운이 열립니다.")
               + f"\n\n> **균형을 맞춰주는 기운(용신) = {yong}**: 내 사주에 '약' 같은 기운입니다. {yong} 기운({K.ELEMENT[yong]['meaning']})을 생활 속에서 의식적으로 늘리는 것이 개운의 핵심입니다.")

    lines = []
    for g in many:
        lines.append(f"- **{plain(g)}이 많음** — {K.GROUP[g]}이(가) 삶의 중심 테마입니다. ")
    for g in none:
        lines.append(f"- **{plain(g)}이 없음** — {K.GROUP[g]}은(는) 타고나기보다 후천적으로 '배워서' 채우는 영역입니다. 운에서 들어올 때 크게 체감됩니다.")
    top_gods = _top(chart["ten_god_counts"], 3)
    for g, c in top_gods:
        t = K.TEN_GOD[g]
        lines.append(f"- **{PLAIN_GOD.get(g, g)}({g})** ×{c}: 긍정적으로 쓰면 {t['plus']}, 과하면 {t['minus']}. 삶에서는 {t['life']}로 나타납니다.")
    for s in chart["shinsal"]:
        lines.append(f"- **{s['name']}** ({s['pillar']}): {K.SHINSAL[s['name']]}")
    for r in chart["relations"]:
        meaning = "부딪히고 움직이는 기운 — 변화·이동·갈등이 생기기 쉬운 자리" if r["type"] == "충" else "끌어당기고 묶이는 기운 — 인연·협력이 생기는 자리"
        lines.append(f"- **{r['text']}** ({'·'.join(r['between'])}): {meaning}")
    out.append("## 2. 내 사주 속 다섯 가지 힘 — 십신으로 읽는 삶의 패턴\n\n"
               "사주 속 글자들은 나와의 관계에 따라 열 가지 힘(십신)으로 나뉩니다. 어떤 힘이 많고 적은지가 곧 삶의 패턴이 됩니다.\n\n" + "\n".join(lines))

    sec = ["## 3. 지금 내가 서 있는 자리 — 현재 대운과 올해의 흐름\n"]
    if luck["daeun"]:
        d = luck["daeun"]
        sec.append(f"**10년마다 바뀌는 큰 흐름(대운)**은 인생의 계절입니다. 지금은 **{d['ko']} 대운**({d['age']}세~)으로, "
                   f"**{PLAIN_GOD.get(d['stem_god'], d['stem_god'])}**과 **{PLAIN_GOD.get(d['branch_god'], d['branch_god'])}**이 함께 들어오는 시기입니다.\n\n- {K.LUCK_GOD[d['stem_god']]}\n- {K.LUCK_GOD[d['branch_god']]}")
        if d["relations"]:
            sec.append("- 대운이 원국과 " + ", ".join(r["text"] for r in d["relations"]) + "을(를) 이루어, 삶의 구조에 변화가 들어오는 10년입니다.")
    y = luck["year"]
    sec.append(f"\n**{y['year']}년 {y['ko']}년** — 올해는 **{PLAIN_GOD.get(y['stem_god'], y['stem_god'])}({y['stem_god']})**이 앞에 서는 해입니다. {K.LUCK_GOD[y['stem_god']]}")
    if y["relations"]:
        sec.append("올해는 원국과 " + ", ".join(r["text"] for r in y["relations"]) + "이(가) 일어나 체감되는 변화가 큰 해입니다.")
    out.append("\n".join(sec))

    story = sit.get("story", "").strip()
    match = [g for g in concern["gods"] if g in chart["ten_god_counts"] or any(s["name"] == g for s in chart["shinsal"])]
    luck_gods = {y["stem_god"], y["branch_god"]} | ({luck["daeun"]["stem_god"], luck["daeun"]["branch_god"]} if luck["daeun"] else set())
    active = [g for g in concern["gods"] if g in luck_gods]
    out.append(f"## 4. 지금의 고민을 사주로 읽다 — {concern['label']}\n\n"
               + (f"> \"{story[:200]}\"\n\n" if story else "")
               + f"{concern['label']} 문제를 사주로 볼 때는 {concern['lens']}\n\n"
               + (f"{nm}님의 원국에는 이 고민과 직결되는 **{', '.join(match)}** 기운이 있어, 이 주제가 인생에서 반복적으로 중요하게 등장합니다. " if match
                  else f"{nm}님의 원국에는 이 고민과 직결되는 기운이 약해, 이 영역은 '타고난 감'보다 '방법과 시스템'으로 풀어야 하는 영역입니다. ")
               + (f"그리고 지금 운에서 **{', '.join(active)}** 기운이 들어와 있어, 이 고민이 유독 지금 크게 느껴지는 것은 자연스러운 흐름입니다." if active
                  else "지금 운에서는 이 주제를 직접 건드리는 기운이 강하지 않으니, 서두르기보다 준비하는 시기로 보는 것이 좋습니다."))

    yi = K.ELEMENT[yong]
    out.append(f"## 5. 나아갈 방향 — 기운을 쓰는 법\n\n{info['advice']}\n\n"
               f"**균형 기운 {yong} 채우기**: {yi['boost']}\n\n"
               f"- [ ] 이번 주: 고민을 한 문장으로 정리하고, {yi['meaning']}에 해당하는 작은 행동 1가지 실행\n"
               f"- [ ] 이번 달: {yi['direction']}·{yi['color']} 등 용신 환경을 생활에 배치, 조언을 구할 사람 1명 만나기\n"
               f"- [ ] 올해: {K.LUCK_GOD[y['stem_god']].split('.')[0]} — 이 흐름에 맞는 목표 하나에 집중")

    nxt = luck.get("next_daeun")
    out.append("## 6. 앞으로의 타이밍\n\n"
               + (f"다음 대운은 **{nxt['age']}세({nxt['start_year']}년경) {nxt['ko']}({nxt['hanja']})** — {nxt['stem_god']}·{nxt['branch_god']}의 10년으로 바뀝니다. "
                  f"{K.LUCK_GOD[nxt['stem_god']]}" if nxt else "")
               + f"\n\n---\n\n{K.DISCLAIMER}\n\n*※ 현재 기본 해석 엔진으로 생성되었습니다. AI 상담 엔진을 연결하면 고민 내용을 반영한 더 깊은 맞춤 풀이가 제공됩니다.*")
    return "\n\n".join(out)


def _rule_counsel(chart, luck, sit, question):
    y = luck["year"]
    m = luck["month"]
    yong = chart["yongsin"]
    return (f"## 질문에 대한 사주적 관점\n\n질문하신 **\"{question[:120]}\"**에 대해, 지금 흐름을 기준으로 말씀드립니다.\n\n"
            f"이번 달 월운은 **{m['ko']}({m['stem_god']}·{m['branch_god']})**, 올해는 **{y['ko']}({y['stem_god']})**의 흐름입니다. "
            f"{K.LUCK_GOD[m['stem_god']]}\n\n"
            f"## 조언\n\n{chart['strength']} 사주에 용신은 **{yong}**입니다. 결정을 내릴 때 '{K.ELEMENT[yong]['meaning']}'에 가까운 선택지를 우선 고려해 보세요.\n\n"
            f"**오늘의 행동**: {K.ELEMENT[yong]['boost'].split(',')[0]}\n\n"
            f"*※ 지금은 기본 해석 엔진으로 답했습니다. AI 상담 엔진이 연결되면 질문 내용에 맞춘 대화형 상담이 제공됩니다.*")


def _rule_daily(chart, luck):
    d = luck["day"]
    yong = chart["yongsin"]
    good = d["stem_element"] == yong or d["branch_element"] == yong
    yi = K.ELEMENT[yong]
    return (f"## 오늘의 기운\n\n오늘은 **{d['ko']}일**, 나에게는 **{PLAIN_GOD.get(d['stem_god'], d['stem_god'])}({d['stem_god']})**이 들어오는 날입니다. "
            f"{K.LUCK_GOD[d['stem_god']]}\n\n"
            + ("용신 기운이 들어오는 날이라 적극적으로 움직이기 좋습니다.\n\n" if good else "용신 기운이 약한 날이니 큰 결정보다 정리와 준비에 집중하세요.\n\n")
            + (f"원국과 {', '.join(dict.fromkeys(r['text'] for r in d['relations']))}이(가) 있어 변화나 만남이 생기기 쉽습니다.\n\n" if d["relations"] else "")
            + f"## 오늘의 한 가지 행동\n\n{yi['boost'].split(',')[0]}\n\n## 행운 포인트\n\n색: {yi['color']} · 방향: {yi['direction']}")


# ---------------------------------------------------------------- 올해·월별 운세
def months_text(months):
    lines = []
    for m in months:
        rel = ", ".join(r["text"] for r in m["relations"])
        lines.append(f"- {m['solar_month']}월({m['jie']} {m['start']}~): {m['ko']} / {m['stem_god']}·{m['branch_god']}"
                     + (f" / 원국과 {rel}" if rel else "") + (" / 균형 기운(용신)이 들어옴" if m["yongsin_hit"] else ""))
    return "\n".join(lines)


def yearly(chart, luck, sit, months, year, name=""):
    prompt = f"""다음은 {name or '상담자'}님의 사주와 현재 상황, 그리고 {year}년 12달의 흐름입니다.

[사주 계산 결과]
{chart_summary(chart, luck)}

[현재 상황]
{situation_text(sit)}

[{year}년 월별 흐름 (입춘부터, 각 달은 절기 날짜에 시작)]
{months_text(months)}

{year}년 운세를 {LEN_YEARLY}로 작성하세요.
## {year}년 한눈에 보기
  (올해의 성격을 한 문장 + 핵심 키워드 3개)
## 올해의 큰 흐름 (약 500자)
  (세운이 원국·현재 대운과 만나 만드는 환경, 사용자 고민과의 연결)
## 달마다 보기
  (12달 각각 불릿 한 줄씩: '**N월** — 성격 한 마디: 구체적으로 할 일·조심할 일'. 50~80자. 용신이 들어오는 달·충이 있는 달은 꼭 이유를 짚기)
## 좋은 달과 조심할 달
  (좋은 달 2~3개, 조심할 달 2~3개를 이유와 함께)
## 올해의 실천 세 가지
  (고민에 맞춘 구체적인 행동 3개, 각각 언제 하면 좋은지)"""
    text, engine = _generate(SYSTEM_PROMPT, [{"role": "user", "content": prompt}], 3500)
    return _result(text, engine, lambda: _rule_yearly(chart, luck, months, year, name), (chart, luck, sit, "yearly"))


def _rule_yearly(chart, luck, months, year, name):
    y = luck["year"]
    good = [m for m in months if m["yongsin_hit"] and not m["clash"]]
    care = [m for m in months if m["clash"]]
    out = [f"## {year}년 한눈에 보기\n\n{year}년은 {name or '상담자'}님에게 **{PLAIN_GOD.get(y['stem_god'], y['stem_god'])}({y['stem_god']})**이 "
           f"앞에 서는 해입니다. {K.LUCK_GOD.get(y['stem_god'], '')}"]
    lines = []
    for m in months:
        mood = "부딪힘과 변화가 있는 달" if m["clash"] else ("균형 기운이 들어와 힘이 붙는 달" if m["yongsin_hit"] else "흐름을 고르는 달")
        lines.append(f"- **{m['solar_month']}월** ({m['jie']} {m['start'][5:].replace('-', '/')}~, {m['ko']}) — {mood}. "
                     f"{K.LUCK_GOD.get(m['stem_god'], '').split('.')[0]}.")
    out.append("## 달마다 보기\n\n" + "\n".join(lines))
    out.append("## 좋은 달과 조심할 달\n\n"
               + (f"- 좋은 달: {', '.join(str(m['solar_month']) + '월' for m in good[:3])} — 균형을 맞춰주는 기운({chart['yongsin']})이 들어옵니다. 중요한 시작·만남을 이때 잡아보세요.\n" if good else "")
               + (f"- 조심할 달: {', '.join(str(m['solar_month']) + '월' for m in care[:3])} — 원국과 부딪히는 기운이 있어 변화·갈등이 생기기 쉽습니다. 큰 결정은 한 번 더 확인하세요." if care else ""))
    out.append(f"---\n\n{K.DISCLAIMER}\n\n*※ 현재 기본 해석 엔진으로 생성되었습니다.*")
    return "\n\n".join(out)


# ---------------------------------------------------------------- 궁합
def match_summary(comp, partner_name):
    lines = [f"내가 {partner_name}님에게: {plain(comp['b_to_a'])} / {partner_name}님이 나에게: {plain(comp['a_to_b'])}",
             f"일간끼리의 합: {comp['stem_harmony'] or '없음'}"]
    if comp["pairs"]:
        lines.append("서로의 지지 합·충(중요한 순): " + ", ".join(f"{p['text']}(내 {p['mine']}-상대 {p['theirs']})" for p in comp["pairs"][:5]))
    for c in comp["complement"]:
        lines.append(f"오행 보완: {c['who']} {c['element']} 기운으로 채워줌")
    if comp["overlap"]:
        lines.append("둘 다 많은 기운(부딪히기 쉬움): " + ", ".join(comp["overlap"]))
    lines.append(f"상대가 내 균형 기운(용신)을 가졌는지: {'예' if comp['yongsin_from_partner'] else '아니오'} / "
                 f"내가 상대의 균형 기운을 가졌는지: {'예' if comp['yongsin_to_partner'] else '아니오'}")
    lines.append(f"참고 점수: {comp['score']}점(100점 만점, 계산 요소의 합)")
    return "\n".join(lines)


def match_reading(chart, luck, sit, partner, comp, name, partner_name, relation):
    prompt = f"""{name or '상담자'}님과 {partner_name}님의 궁합입니다. 관계: {relation or '미입력'}

[{name or '상담자'}님 사주]
{chart_summary(chart, luck)}

[{partner_name}님 사주]
{chart_summary(partner, None)}

[두 사주의 궁합 계산]
{match_summary(comp, partner_name)}

[{name or '상담자'}님의 현재 상황]
{situation_text(sit)}

궁합 풀이를 {LEN_MATCH}로 작성하세요. 관계({relation or '일반'})에 맞는 말투와 예시를 쓰세요.
## 한 줄 요약 (두 사람 관계를 한 문장으로)
## 서로 끌리는 점 (약 400자, 계산된 합·보완 근거)
## 부딪히기 쉬운 점 (약 400자, 계산된 충·겹치는 기운 근거, 실제로 어떤 장면에서 부딪히는지)
## 잘 지내는 법 (구체적 행동 3~4개, 각각 누가 무엇을)
점수는 참고용으로 한 번만 언급하고, 관계를 단정하지 마세요."""
    text, engine = _generate(SYSTEM_PROMPT, [{"role": "user", "content": prompt}], 3000)
    return _result(text, engine, lambda: _rule_match(chart, partner, comp, name, partner_name), (chart, luck, sit, "match"))


def _rule_match(chart, partner, comp, name, partner_name):
    me, you = name or "나", partner_name
    a_info = K.DAY_MASTER[chart["day_master"]["ko"]]["image"].split("(")[0]
    b_info = K.DAY_MASTER[partner["day_master"]["ko"]]["image"].split("(")[0]
    harm = [p for p in comp["pairs"] if p["type"] == "합"]
    clash = [p for p in comp["pairs"] if p["type"] == "충"]
    out = [f"## 한 줄 요약\n\n**{a_info}**({me})과 **{b_info}**({you})의 만남 — 참고 점수 {comp['score']}점",
           f"## 서로 끌리는 점\n\n- {you}님은 {me}님에게 **{PLAIN_GOD.get(comp['a_to_b'], comp['a_to_b'])}({comp['a_to_b']})**으로 다가오는 사람입니다."
           + (f"\n- 두 사람의 중심 글자가 서로 끌어당깁니다({comp['stem_harmony']})." if comp["stem_harmony"] else "")
           + "".join(f"\n- {c['who']} {c['element']} 기운으로 채워줍니다." for c in comp["complement"])
           + "".join(f"\n- {p['text']}: 내 {p['mine']}와 상대 {p['theirs']}가 끌어당깁니다." for p in harm[:2]),
           "## 부딪히기 쉬운 점\n\n"
           + ("".join(f"- {p['text']}: 내 {p['mine']}와 상대 {p['theirs']}가 부딪힙니다. 생활 리듬·결정 방식에서 마찰이 생기기 쉽습니다.\n" for p in clash[:2])
              or "- 두드러지게 부딪히는 자리는 적습니다.\n")
           + (f"- 둘 다 {', '.join(comp['overlap'])} 기운이 많아 같은 지점에서 고집이 겹칠 수 있습니다." if comp["overlap"] else ""),
           "## 잘 지내는 법\n\n- 중요한 결정은 하루 묵힌 뒤 함께 정하기\n- 서로가 채워주는 기운을 말로 인정해 주기\n- 부딪히는 주제(돈·시간·생활 방식)는 미리 규칙으로 정해두기",
           f"---\n\n{K.DISCLAIMER}\n\n*※ 현재 기본 해석 엔진으로 생성되었습니다.*"]
    return "\n\n".join(out)
