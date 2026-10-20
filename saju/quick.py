"""첫 화면의 무료 '바로 보기': 생년월일만 넣으면 운결 도령이 반말로 '너는 누구인지'와 올해·오늘의 운을 짚어준다.

AI를 쓰지 않고 사주 계산 + 아래 문장으로 바로 만든다 (비용 0, 기다림 없음). 입력값은 저장하지 않는다.
마지막에 그 사람 사주에 맞춰 유료 풀이 2~3개를 추천한다 (이유까지).
"""
from datetime import date

import knowledge as K
import products
from saju_engine import compute_chart, current_luck, year_months

# 일간(태어난 날의 기운)별 — 너는 누구인가
DM = {
    "갑": {"core": "곧게 위로 뻗는 나무다. 한번 정한 길은 끝까지 간다.",
          "good": ["앞장서서 길을 여는 힘", "거짓 없이 곧은 마음", "쓰러져도 다시 자라는 끈기"],
          "shadow": ["굽혀야 할 때 부러지는 고집", "남에게 기대지 못해 혼자 지친다"],
          "tip": "뿌리를 넓혀라. 혼자 크는 나무는 없다."},
    "을": {"core": "바람에 휘어도 꺾이지 않는 풀과 덩굴이다. 부드럽게, 결국 닿고 싶은 곳에 닿는다.",
          "good": ["어디서든 살아남는 적응력", "사람을 잇는 섬세한 감각", "포기하지 않는 은근한 끈기"],
          "shadow": ["눈치를 보느라 정작 네 마음을 숨긴다", "기댈 곳이 흔들리면 같이 흔들린다"],
          "tip": "기댈 곳 하나를 단단히 골라라. 그러면 끝까지 오른다."},
    "병": {"core": "하늘의 태양이다. 네가 있는 곳은 밝아지고, 사람들이 모인다.",
          "good": ["숨김없는 따뜻함", "분위기를 바꾸는 존재감", "시작하는 용기"],
          "shadow": ["불타오른 만큼 빨리 지친다", "속마음까지 다 보여줘 상처받는다"],
          "tip": "해도 진다. 쉬는 시간을 일정에 넣어라."},
    "정": {"core": "어둠 속의 촛불이다. 크진 않아도, 한 사람을 끝까지 비춘다.",
          "good": ["깊이 들여다보는 섬세함", "한 사람에게 쏟는 진심", "조용히 오래 타는 집중력"],
          "shadow": ["걱정이 많아 밤이 길다", "작은 바람에도 마음이 흔들린다"],
          "tip": "바람막이를 만들어라. 네 불은 지켜질 때 가장 밝다."},
    "무": {"core": "넓고 묵직한 산이다. 쉽게 움직이지 않고, 모두가 너에게 기댄다.",
          "good": ["흔들리지 않는 믿음직함", "끝까지 책임지는 무게", "다 품어주는 넉넉함"],
          "shadow": ["변해야 할 때도 버틴다", "속을 안 보여 외로워진다"],
          "tip": "가끔은 길을 내줘라. 산에도 길이 있어야 사람이 온다."},
    "기": {"core": "씨앗을 품는 밭의 흙이다. 사람과 일을 키워내는 손을 가졌다.",
          "good": ["꼼꼼하게 챙기는 실속", "사람을 키우는 다정함", "현실을 보는 눈"],
          "shadow": ["남 챙기다 너를 잊는다", "걱정이 많아 시작이 늦다"],
          "tip": "네 밭에도 씨를 뿌려라. 너도 자라야 한다."},
    "경": {"core": "단단한 원석이자 칼이다. 옳고 그름이 분명하고, 결단이 빠르다.",
          "good": ["밀어붙이는 실행력", "의리와 정의감", "위기에 강한 담력"],
          "shadow": ["말이 날카로워 사람을 벤다", "다듬어지기 전엔 고집으로 보인다"],
          "tip": "불에 단련되는 게 네 운명이다. 힘든 시기를 피하지 마라."},
    "신": {"core": "잘 다듬어진 보석이다. 기준이 높고, 빛나는 걸 알아본다.",
          "good": ["예리한 안목", "섬세한 완성도", "품위를 지키는 자존심"],
          "shadow": ["작은 흠에도 크게 다친다", "스스로를 너무 몰아세운다"],
          "tip": "맑은 물에 씻길 때 가장 빛난다. 너를 아껴주는 사람 곁에 있어라."},
    "임": {"core": "큰 바다와 강이다. 품이 넓고, 멀리 본다.",
          "good": ["큰 그림을 그리는 지혜", "어디든 흘러가는 유연함", "사람을 품는 너그러움"],
          "shadow": ["방향 없이 흘러가 버린다", "속이 깊어 아무도 모른다"],
          "tip": "둑을 세워라. 목표와 마감이 있을 때 멀리 간다."},
    "계": {"core": "조용히 스미는 비와 샘물이다. 보이지 않게, 깊이 적신다.",
          "good": ["사람 마음을 읽는 직관", "조용한 공감", "포기하지 않고 스미는 인내"],
          "shadow": ["생각이 많아 실행이 늦다", "불안이 쉽게 차오른다"],
          "tip": "작게라도 매일 움직여라. 빗방울이 모여 강이 된다."},
}

ELEMENT_LACK = {
    "목": "나무의 기운이 비었다. 새로 시작할 힘이 늦게 붙는다 — 아침 산책, 새 계획 하나가 약이다.",
    "화": "불의 기운이 비었다. 표현하고 드러내는 게 서툴다 — 작은 성과라도 남에게 보여라.",
    "토": "흙의 기운이 비었다. 중심이 쉽게 흔들린다 — 매일 같은 시간의 습관 하나를 만들어라.",
    "금": "쇠의 기운이 비었다. 끊고 정리하는 게 어렵다 — 이번 주에 하나만 끝내라.",
    "수": "물의 기운이 비었다. 쉬어가는 법을 모른다 — 잠과 혼자만의 시간을 지켜라.",
}
ELEMENT_MANY = {
    "목": "나무의 기운이 넘친다. 계획은 많은데 마무리가 약할 수 있다.",
    "화": "불의 기운이 넘친다. 달아오른 만큼 빨리 지칠 수 있다.",
    "토": "흙의 기운이 넘친다. 생각이 많고 움직임이 무거워질 수 있다.",
    "금": "쇠의 기운이 넘친다. 기준이 높아 스스로와 남을 몰아세울 수 있다.",
    "수": "물의 기운이 넘친다. 걱정과 생각이 밤새 흐를 수 있다.",
}
SHINSAL = {"도화살": "도화살이 있다. 사람의 눈길을 끄는 매력이다. 숨기지 마라, 쓰는 법을 배워라.",
           "역마살": "역마살이 있다. 한곳에 갇히면 시든다. 움직이고 떠날 때 운이 열린다.",
           "화개살": "화개살이 있다. 혼자 깊이 파고드는 사람이다. 공부·예술·마음 공부가 너를 살린다."}

# 올해(세운) 들어오는 기운 — 반말 한마디
YEAR_GOD = {
    "비견": "나와 같은 힘이 들어온다. 혼자 서는 해다. 남의 결정에 기대지 마라.",
    "겁재": "경쟁의 기운이 들어온다. 돈과 사람 사이에서 빼앗기기 쉽다. 큰 돈거래는 한 번 더 따져라.",
    "식신": "재능과 여유의 기운이 들어온다. 잘하는 걸 꺼내 보이면 그게 기회가 된다.",
    "상관": "표현과 변화의 기운이 들어온다. 틀을 깨고 싶어진다. 말 한마디는 조심해라.",
    "편재": "큰돈과 기회의 기운이 들어온다. 판이 커지는 해다. 욕심과 무리를 구분해라.",
    "정재": "꾸준한 돈과 결실의 기운이 들어온다. 성실함이 숫자로 돌아오는 해다.",
    "편관": "압박과 도전의 기운이 들어온다. 무겁지만, 버티면 한 단계 오른다.",
    "정관": "인정과 자리의 기운이 들어온다. 승진·소속·신뢰가 쌓이는 해다.",
    "편인": "직관과 탐구의 기운이 들어온다. 배우고 파고들기 좋다. 혼자 고립되진 마라.",
    "정인": "도움과 배움의 기운이 들어온다. 귀인이 나타나고, 자격과 문서에 운이 붙는다.",
}
TODAY_GOD = {
    "비견": "오늘은 네 뜻대로 밀고 가라.", "겁재": "오늘은 돈과 말을 아껴라.", "식신": "오늘은 잘하는 걸 하나 보여줘라.",
    "상관": "오늘은 하고 싶은 말이 목까지 차오른다. 한 번 삼켜라.", "편재": "오늘은 뜻밖의 기회가 스친다. 눈을 떠라.",
    "정재": "오늘은 작은 일 하나를 끝까지 마무리해라.", "편관": "오늘은 부담이 오지만 피하지 마라.",
    "정관": "오늘은 약속과 규칙을 지키면 인정받는다.", "편인": "오늘은 혼자 생각할 시간을 가져라.",
    "정인": "오늘은 도움을 청해라. 손 내미는 사람이 있다.",
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
        g.append(("love", "올해 인연의 기운이 움직인다. 언제, 어떤 사람이 오는지 들여다봐라." if yg in spouse
                  else "도화의 매력을 타고났다. 그 매력이 누구에게 닿는지 봐라."))
    if groups.get("관성", 0) == 0 or groups.get("식상", 0) == 0 or groups.get("재성", 0) >= 3:
        g.append(("career", "일과 돈에 너만의 길이 있다. 맞는 일, 버는 방식, 움직일 때를 짚어주마."))
    g.append(("newyear", f"{products.NY}년이 너에게 어떤 해인지, 달마다 할 일까지."))
    g.append(("daily", "매일 아침, 오늘 너의 하루가 어디로 흐르는지. 하루 330원."))
    g.append(("life", "타고난 것부터 평생의 큰 흐름까지, 가장 깊게."))
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
UNLOCK_BY_SHARE = "love"  # 친구에게 링크를 보내면 열어주는 칸


def _months_text(ms):
    return ", ".join(f"{m}월" for m in ms) if ms else "없다"


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
                    "text": f"{nd['age']}세, {nd['start_year']}년부터 10년의 큰 흐름이 바뀐다. "
                            + YEAR_GOD.get(g, "").replace("해다", "시기다").replace("해", "시기")})
    out.append({"id": "months", "title": f"{ny}년, 좋은 달과 조심할 달", "product": "newyear",
                "text": f"{ny}년 힘이 붙는 달은 {_months_text(good)}, 부딪힘을 조심할 달은 {_months_text(care)}다. "
                        "중요한 시작은 좋은 달에 잡아라."})
    out.append({"id": "love", "title": "인연이 들어오는 때", "product": "love",
                "text": (f"너에게 인연의 기운이 들어오는 때는 {', '.join(love)}. 이때 새로운 만남을 피하지 마라."
                         if love else "앞으로 1년 남짓은 새 인연보다 지금 곁의 사람을 돌볼 때다. 큰 인연의 흐름은 더 뒤에 온다.")})
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
                    "share_unlock": x["id"] == UNLOCK_BY_SHARE} for x in locked_sections(chart, luck)],
    }


def unlock(birth, chart_of_birth, section):
    """친구에게 링크를 보낸 뒤 여는 칸 하나 (UNLOCK_BY_SHARE 만)."""
    if section != UNLOCK_BY_SHARE:
        return None
    chart = chart_of_birth(birth)
    return next((x["text"] for x in locked_sections(chart, current_luck(chart)) if x["id"] == section), None)
