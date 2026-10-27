"""첫 화면의 무료 '바로 보기': 생년월일만 넣으면 운결 도령이 반말로 '너는 누구인지'와 올해·오늘의 운을 짚어준다.

AI를 쓰지 않고 사주 계산 + 아래 문장으로 바로 만든다 (비용 0, 기다림 없음). 입력값은 저장하지 않는다.
마지막에 그 사람 사주에 맞춰 유료 풀이 2~3개를 추천한다 (이유까지).
"""
from datetime import date

import knowledge as K
import products
from saju_engine import compute_chart, current_luck, year_months

# 일간(태어난 날의 기운)별 — 너는 누구인가.
# 말투: 친구 같은 반말 (2026-10-27 사장님: "운결도 가볍게, 친구 같은 말투로"). 예전 '…이다/~해라' 도령 말투는 쓰지 않는다.
DM = {
    "갑": {"core": "곧게 위로 자라는 나무야. 한번 정하면 끝까지 가는 타입이지.",
          "good": ["앞장서서 길을 여는 힘", "거짓 없이 곧은 마음", "쓰러져도 다시 자라는 끈기"],
          "shadow": ["굽혀야 할 때 부러지는 고집", "남한테 기대질 못해서 혼자 지쳐"],
          "tip": "뿌리를 넓혀 봐. 혼자 크는 나무는 없어."},
    "을": {"core": "바람에 휘어도 안 꺾이는 풀이랑 덩굴이야. 부드럽게, 결국 가고 싶은 데까지 가.",
          "good": ["어디서든 살아남는 적응력", "사람을 잇는 섬세한 감각", "포기 안 하는 은근한 끈기"],
          "shadow": ["눈치 보느라 정작 네 마음은 숨겨", "기댈 곳이 흔들리면 같이 흔들려"],
          "tip": "기댈 곳 하나만 단단히 골라 봐. 그러면 끝까지 올라가."},
    "병": {"core": "하늘의 해야. 네가 있으면 거기가 밝아지고, 사람들이 모여.",
          "good": ["숨김없는 따뜻함", "분위기를 바꾸는 존재감", "먼저 시작하는 용기"],
          "shadow": ["확 타오른 만큼 빨리 지쳐", "속마음까지 다 보여 줘서 상처받아"],
          "tip": "해도 져. 쉬는 시간을 일정에 넣어 둬."},
    "정": {"core": "어둠 속 촛불이야. 크진 않아도, 한 사람은 끝까지 비춰.",
          "good": ["깊이 들여다보는 섬세함", "한 사람한테 쏟는 진심", "조용히 오래 타는 집중력"],
          "shadow": ["걱정이 많아서 밤이 길어", "작은 바람에도 마음이 흔들려"],
          "tip": "바람막이를 만들어 둬. 네 불은 지켜질 때 제일 밝아."},
    "무": {"core": "넓고 묵직한 산이야. 쉽게 안 흔들리고, 다들 너한테 기대.",
          "good": ["흔들리지 않는 믿음직함", "끝까지 책임지는 무게", "다 품어 주는 넉넉함"],
          "shadow": ["바뀌어야 할 때도 버텨", "속을 안 보여서 외로워져"],
          "tip": "가끔은 길을 내줘. 산에도 길이 있어야 사람이 와."},
    "기": {"core": "씨앗을 품는 밭의 흙이야. 사람이랑 일을 키워 내는 손을 가졌어.",
          "good": ["꼼꼼하게 챙기는 실속", "사람을 키우는 다정함", "현실을 보는 눈"],
          "shadow": ["남 챙기다 너를 까먹어", "걱정이 많아서 시작이 늦어"],
          "tip": "네 밭에도 씨 좀 뿌려. 너도 자라야지."},
    "경": {"core": "단단한 원석이자 칼이야. 옳고 그름이 분명하고, 결정이 빨라.",
          "good": ["밀어붙이는 실행력", "의리랑 정의감", "위기에 강한 배짱"],
          "shadow": ["말이 날카로워서 사람이 베여", "다듬어지기 전엔 고집으로 보여"],
          "tip": "불에 단련되는 게 네 팔자야. 힘든 시기를 너무 피하지 마."},
    "신": {"core": "잘 다듬어진 보석이야. 기준이 높고, 반짝이는 걸 알아봐.",
          "good": ["예리한 안목", "섬세한 완성도", "품위를 지키는 자존심"],
          "shadow": ["작은 흠에도 크게 다쳐", "스스로를 너무 몰아세워"],
          "tip": "맑은 물에 씻길 때 제일 빛나. 너 아껴 주는 사람 곁에 있어."},
    "임": {"core": "큰 바다랑 강이야. 품이 넓고, 멀리 봐.",
          "good": ["큰 그림을 그리는 지혜", "어디로든 흘러가는 유연함", "사람을 품는 너그러움"],
          "shadow": ["방향 없이 흘러가 버려", "속이 깊어서 아무도 몰라"],
          "tip": "둑을 세워 봐. 목표랑 마감이 있을 때 멀리 가."},
    "계": {"core": "조용히 스며드는 비랑 샘물이야. 안 보이게, 깊이 적셔.",
          "good": ["사람 마음을 읽는 직관", "조용한 공감", "포기 안 하고 스미는 인내"],
          "shadow": ["생각이 많아서 움직이는 게 늦어", "불안이 쉽게 차올라"],
          "tip": "작게라도 매일 움직여 봐. 빗방울이 모여서 강이 돼."},
}

ELEMENT_LACK = {
    "목": "나무 기운이 비어 있어. 새로 시작할 힘이 늦게 붙어 — 아침 산책이나 새 계획 하나가 약이야.",
    "화": "불 기운이 비어 있어. 표현하고 드러내는 게 서툴러 — 작은 성과라도 남한테 보여 줘.",
    "토": "흙 기운이 비어 있어. 중심이 쉽게 흔들려 — 매일 같은 시간에 하는 습관 하나를 만들어 봐.",
    "금": "쇠 기운이 비어 있어. 끊고 정리하는 게 어려워 — 이번 주엔 딱 하나만 끝내 봐.",
    "수": "물 기운이 비어 있어. 쉬어 가는 법을 잘 몰라 — 잠이랑 혼자만의 시간은 꼭 지켜.",
}
ELEMENT_MANY = {
    "목": "나무 기운이 넘쳐. 계획은 많은데 마무리가 약할 수 있어.",
    "화": "불 기운이 넘쳐. 달아오른 만큼 빨리 지칠 수 있어.",
    "토": "흙 기운이 넘쳐. 생각이 많고 몸이 무거워질 수 있어.",
    "금": "쇠 기운이 넘쳐. 기준이 높아서 너랑 남을 몰아세울 수 있어.",
    "수": "물 기운이 넘쳐. 걱정이랑 생각이 밤새 흐를 수 있어.",
}
SHINSAL = {"도화살": "도화살이 있어. 사람들 눈길을 끄는 매력이야. 숨기지 말고, 쓰는 법을 익혀.",
           "역마살": "역마살이 있어. 한곳에 갇히면 시들어. 움직이고 떠날 때 운이 열려.",
           "화개살": "화개살이 있어. 혼자 깊이 파고드는 사람이야. 공부·예술·마음 공부가 너를 살려."}

# 올해(세운) 들어오는 기운 — 친구 반말 한마디. '한 해'는 대운(10년) 문장에서 '10년'으로 바뀌어 쓰인다
YEAR_GOD = {
    "비견": "나랑 같은 힘이 들어와. 혼자 서는 한 해야. 남의 결정에 너무 기대지 마.",
    "겁재": "경쟁하는 기운이 들어와. 돈이랑 사람 사이에서 뺏기기 쉬워. 큰 돈거래는 한 번 더 따져 봐.",
    "식신": "재능이랑 여유의 기운이 들어와. 잘하는 걸 꺼내 보이면 그게 기회가 돼.",
    "상관": "표현하고 바꾸고 싶은 기운이 들어와. 틀을 깨고 싶어질 거야. 말 한마디는 조심해.",
    "편재": "큰돈이랑 기회의 기운이 들어와. 판이 커지는 한 해야. 욕심이랑 무리는 구분해.",
    "정재": "꾸준한 돈이랑 결실의 기운이 들어와. 성실함이 숫자로 돌아오는 한 해야.",
    "편관": "압박이랑 도전의 기운이 들어와. 무겁지만, 버티면 한 단계 올라가.",
    "정관": "인정이랑 자리의 기운이 들어와. 승진·소속·신뢰가 쌓이는 한 해야.",
    "편인": "직관이랑 탐구의 기운이 들어와. 배우고 파고들기 좋아. 혼자 고립되지만 마.",
    "정인": "도움이랑 배움의 기운이 들어와. 도와주는 사람이 나타나고, 자격증·서류 운이 붙어.",
}
TODAY_GOD = {
    "비견": "오늘은 네 뜻대로 밀고 가 봐.", "겁재": "오늘은 돈이랑 말을 좀 아껴.", "식신": "오늘은 잘하는 거 하나 보여 줘.",
    "상관": "오늘은 하고 싶은 말이 목까지 차올라. 한 번만 삼켜.", "편재": "오늘은 뜻밖의 기회가 스쳐 가. 눈 크게 떠.",
    "정재": "오늘은 작은 일 하나를 끝까지 마무리해 봐.", "편관": "오늘은 부담이 와도 피하지 마.",
    "정관": "오늘은 약속이랑 규칙을 지키면 인정받아.", "편인": "오늘은 혼자 생각할 시간을 가져 봐.",
    "정인": "오늘은 도와 달라고 해 봐. 손 내밀어 줄 사람이 있어.",
}


def _clean(s):
    return s.split("(")[0].strip()


def recommend(chart, luck):
    """사주 모양에 맞춰 유료 풀이 2~3개 + 이유."""
    g, groups = [], chart["ten_god_groups"]
    names = {s["name"] for s in chart["shinsal"]}
    yg = luck["year"]["stem_god"]
    spouse = ("정관", "편관") if chart["input"]["gender"] == "female" else ("정재", "편재")
    if "도화살" in names or yg in spouse:
        g.append(("love", "올해 인연 기운이 움직여. 언제, 어떤 사람이 오는지 같이 보자." if yg in spouse
                  else "사람 끄는 매력을 타고났어. 그 매력이 누구한테 닿는지 보자."))
    if groups.get("관성", 0) == 0 or groups.get("식상", 0) == 0 or groups.get("재성", 0) >= 3:
        g.append(("career", "일이랑 돈에 너만의 길이 있어. 맞는 일, 버는 방식, 움직일 때를 짚어 줄게."))
    g.append(("newyear", f"{products.NY}년이 너한테 어떤 해인지, 달마다 할 일까지."))
    g.append(("daily", "매일 아침, 오늘 하루가 어디로 흐르는지. 하루 330원."))
    g.append(("life", "타고난 것부터 평생 큰 흐름까지, 제일 깊게."))
    seen, out = set(), []
    for key, why in g:
        p = products.PRODUCTS.get(key)
        if p and not p.get("hidden") and key not in seen:
            seen.add(key)
            out.append({"key": key, "label": p["label"], "price": p["price"], "why": why,
                        "subscription": bool(p.get("subscription"))})
    return out[:3]


# ---------------------------------------------------------------- 잠긴 부분 (결제하면 PDF에서, 친구에게 보내면 하나 열림)
# 진짜 결과는 잠겨 있는 동안 화면에 보내지 않는다 (가린 글씨는 모양만 비슷한 가짜 글자).
PAID_ONLY = {"turn"}  # 평생 종합 사주의 칸: 친구에게 보내도 안 열림, 결제해야 PDF로 (사장님 결정 2026-10-20)


def _months_text(ms):
    return ", ".join(f"{m}월" for m in ms) if ms else "없어"


def locked_sections(chart, luck):
    ny = products.NY
    nd = luck.get("next_daeun") or {}
    ym = year_months(chart, ny)
    good = [m["solar_month"] for m in ym if m["yongsin_hit"] and not m["clash"]][:3]
    care = [m["solar_month"] for m in ym if m["clash"]][:3]
    spouse = ("정관", "편관") if chart["input"]["gender"] == "female" else ("정재", "편재")
    love = []
    for y in (luck["year"]["year"], ny):
        for m in year_months(chart, y):
            ym_date = (y + (1 if m["solar_month"] == 1 else 0), m["solar_month"])
            if ym_date >= (date.today().year, date.today().month) and (m["stem_god"] in spouse or m["branch_god"] in spouse):
                love.append(f"{ym_date[0]}년 {ym_date[1]}월")
    love = list(dict.fromkeys(love))[:3]
    out = []
    if nd:
        g = nd["stem_god"]
        out.append({"id": "turn", "title": "네 인생의 다음 전환점", "product": "life",
                    "text": f"{nd['age']}세, {nd['start_year']}년부터 10년의 큰 흐름이 바뀌어. "
                            + YEAR_GOD.get(g, "").replace("한 해", "10년")})
    out.append({"id": "months", "title": f"{ny}년, 좋은 달과 조심할 달", "product": "newyear",
                "text": f"{ny}년 힘이 붙는 달은 {_months_text(good)}, 부딪힘을 조심할 달은 {_months_text(care)}야. "
                        "중요한 시작은 좋은 달에 잡아."})
    out.append({"id": "love", "title": "인연이 들어오는 때", "product": "love",
                "text": (f"너한테 인연 기운이 들어오는 때는 {', '.join(love)}. 이때 새 만남을 피하지 마."
                         if love else "앞으로 1년 남짓은 새 인연보다 지금 곁에 있는 사람을 챙길 때야. 큰 인연 흐름은 좀 더 뒤에 와.")})
    return out


def _mask(text):
    """잠긴 글: 글자 수와 모양만 비슷하게 (숫자·내용은 가림)."""
    out = []
    for i, c in enumerate(text):
        if c == " ":
            out.append(" ")
        elif c in ",.":
            out.append("·")
        elif i < 3 and not c.isdigit():  # 앞 두세 글자만 살짝 (숫자는 언제나 가림)
            out.append(c)
        else:
            out.append("█")
    return "".join(out)


def reading(birth, chart_of_birth):
    """birth: server.parse_birth 결과 → 화면에 그릴 내용."""
    chart = chart_of_birth(birth)
    luck = current_luck(chart)
    dm = chart["day_master"]["ko"]
    d = DM[dm]
    image = _clean(K.DAY_MASTER[dm]["image"])
    el = chart["elements_simple"]
    lack = [e for e, n in el.items() if n == 0]
    many = [e for e, n in el.items() if n >= 3]
    notes = [ELEMENT_LACK[e] for e in lack[:2]] + [ELEMENT_MANY[e] for e in many[:1]]
    stars = [SHINSAL[n] for n in dict.fromkeys(s["name"] for s in chart["shinsal"]) if n in SHINSAL]
    y, t = luck["year"], luck["day"]
    return {
        "birth_text": f"{birth['year']}년 {birth['month']}월 {birth['day']}일",
        "image": image, "core": d["core"], "good": d["good"], "shadow": d["shadow"], "tip": d["tip"],
        "elements": el, "notes": notes, "stars": stars[:2],
        "year": {"year": y["year"], "ko": y["ko"], "god": y["stem_god"], "text": YEAR_GOD.get(y["stem_god"], "")},
        "today": {"date": date.today().strftime("%m월 %d일"), "ko": t["ko"], "text": TODAY_GOD.get(t["stem_god"], "")},
        "recs": recommend(chart, luck),
        "locked": [{"id": x["id"], "title": x["title"], "masked": _mask(x["text"]), "product": x["product"],
                    "label": products.PRODUCTS[x["product"]]["label"], "price": products.PRODUCTS[x["product"]]["price"],
                    "share_unlock": x["id"] not in PAID_ONLY} for x in locked_sections(chart, luck)],
    }


def unlock(birth, chart_of_birth, section):
    """친구에게 링크를 보낸 뒤 화면의 잠긴 칸을 연다 (평생 종합 칸은 제외)."""
    if section in PAID_ONLY:
        return None
    chart = chart_of_birth(birth)
    return next((x["text"] for x in locked_sections(chart, current_luck(chart)) if x["id"] == section), None)
