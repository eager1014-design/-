"""운결 앱 — 내 일정 × 그날 기운 (2026-10-30 사장님: "먼저 사주 → 내 달력에 일정을 넣으면 그날 그 일에 맞는 기운을 알려 줘").

일정 하나(날짜 + 종류)마다: 그날 들어오는 기운(일진)이 그 일에 맞는지 좋음/보통/조심 + 한마디 + 날짜를 옮길 수 있는 일이면 앞뒤 1주에서 더 좋은 날.
AI를 쓰지 않는다 (비용 0, 바로 나옴). 일정·생일은 서버에 저장하지 않는다 — 폰(브라우저)에만 있고, 볼 때마다 보내서 계산.

점수(규칙):
  그날 천간의 십신이 그 일에 맞으면 +2, 안 맞으면 -2 / 지지 쪽 십신은 ±1
  용신(나에게 필요한 기운)이 들어오면 +1 / 내 일주와 합이면 +1 / 내 일주와 충이면 변동 큰 일은 -2, 그 밖엔 -1
  2점 이상 = 좋음, -1점 이하 = 조심, 나머지 = 보통
사주는 과학이 아니다 — 화면마다 '재미로 보는 참고용' 문구를 붙인다.

자체 점검: python3 myday.py
"""
import calendar
from datetime import date, timedelta

from calendar_feed import DAY_TITLE
from quick import TODAY_GOD, YEAR_GOD
from saju_engine import (BRANCH_ELEMENT, BRANCHES_KO, ELEMENTS, STEM_ELEMENT, STEMS_KO, _natal_lists,
                         branch_main_stem, current_luck, day_ganzhi, find_relations, ten_god)

# 그날 들어오는 기운을 쉬운 말로 (용어 대신)
GOD_PLAIN = {
    "비견": "나랑 같은 힘", "겁재": "경쟁하는 힘", "식신": "재능과 여유", "상관": "말이 튀는 힘", "편재": "큰 기회",
    "정재": "꾸준한 돈", "편관": "압박", "정관": "인정과 약속", "편인": "혼자 파고드는 힘", "정인": "도움과 서류",
}

# 일정 종류. good/bad = 그 일에 맞는·안 맞는 십신, move = 날짜를 옮길 수 있는 일(더 좋은 날을 찾아 줌), shake = 변동이 큰 일(충을 더 조심)
KINDS = {
    "contract": {"label": "부동산·계약", "good": {"정재", "정관", "정인"}, "bad": {"겁재", "상관", "편관"}, "move": True, "shake": True,
                 "tip": ["도장 찍기 좋은 날이야. 그래도 특약 한 줄은 꼭 다시 읽어.",
                         "나쁘지 않아. 서두르지 말고 서류를 한 번 더 확인해.",
                         "이날은 말이 엇갈리기 쉬워. 꼭 해야 하면 녹음이나 문자로 남겨 둬."]},
    "bank": {"label": "은행·대출", "good": {"정재", "정인", "정관"}, "bad": {"겁재", "상관"}, "move": True, "shake": False,
             "tip": ["서류가 술술 풀리는 날이야. 금리 한 번만 더 비교해 봐.",
                     "무난해. 필요한 서류 목록을 미리 챙겨 가.",
                     "이날은 돈이 새기 쉬워. 큰 결정은 집에 와서 하룻밤 자고 해."]},
    "payday": {"label": "월급날·돈 들어오는 날", "good": {"정재", "편재", "식신"}, "bad": {"겁재", "비견"}, "move": False, "shake": False,
               "tip": ["돈 기운이 좋은 날이야. 들어오자마자 저축부터 옮겨 둬.",
                       "평범한 날이야. 고정 지출부터 빼 두고 써.",
                       "이날은 돈이 빨리 나가. 장바구니는 하루 묵혀 둬."]},
    "spend": {"label": "큰 지출·투자", "good": {"정재", "편재", "식신"}, "bad": {"겁재", "비견", "상관"}, "move": True, "shake": True,
              "tip": ["판단이 맑은 날이야. 정해 둔 금액만큼만 써.",
                      "나쁘지 않아. 비교한 걸 표로 한 번 정리하고 사.",
                      "이날은 욕심이 앞서. 결제 버튼은 다음 날로 미뤄."]},
    "interview": {"label": "면접·시험", "good": {"정관", "정인", "편인", "식신"}, "bad": {"상관", "겁재"}, "move": True, "shake": False,
                  "tip": ["실력이 잘 드러나는 날이야. 준비한 대로만 해.",
                          "무난해. 첫 문장 하나만 외워 가면 편해져.",
                          "이날은 말이 앞서기 쉬워. 대답 전에 한 박자 쉬어."]},
    "meeting": {"label": "발표·미팅", "good": {"식신", "상관", "정관", "편재"}, "bad": {"편인", "겁재"}, "move": True, "shake": False,
                "tip": ["말이 잘 붙는 날이야. 하고 싶은 말을 먼저 꺼내.",
                        "평범한 날이야. 핵심 세 줄만 적어 가.",
                        "이날은 생각이 안으로 숨어. 자료를 넉넉히 챙겨 가."]},
    "date": {"label": "데이트·고백", "good": {"식신", "정재", "편재", "정관"}, "bad": {"상관", "겁재", "편인"}, "move": True, "shake": False,
             "tip": ["마음이 잘 전해지는 날이야. 솔직하게 말해 봐.",
                     "편안한 날이야. 거창한 것보다 맛있는 거 하나.",
                     "이날은 말 한마디가 날카로워져. 듣는 쪽이 되어 봐."]},
    "move": {"label": "이사·여행", "good": {"편재", "식신", "정인", "비견"}, "bad": {"겁재", "편관"}, "move": True, "shake": True,
             "tip": ["움직이기 좋은 날이야. 새 곳이 너랑 잘 맞을 거야.",
                     "무난해. 짐 목록을 하나 더 확인해.",
                     "이날은 변수가 많아. 시간을 넉넉히 잡고 귀중품은 따로 챙겨."]},
    "health": {"label": "병원·검진", "good": {"정인", "비견", "정관"}, "bad": {"편관", "상관"}, "move": True, "shake": True,
               "tip": ["몸을 돌보기 좋은 날이야. 궁금한 건 다 물어봐.",
                       "평범한 날이야. 물어볼 걸 메모해 가.",
                       "이날은 몸이 예민해. 무리한 일정은 빼 둬. (진료는 의사 말이 먼저야)"]},
    "start": {"label": "새로 시작(첫 출근·운동)", "good": {"비견", "식신", "편재", "정관"}, "bad": {"겁재", "편인"}, "move": True, "shake": False,
              "tip": ["시작하는 힘이 좋은 날이야. 첫걸음은 작게, 대신 바로.",
                      "무난해. 첫날 목표는 딱 하나만.",
                      "이날은 마음이 흔들려. 시작은 하되 큰 약속은 하지 마."]},
    "talk": {"label": "어려운 대화·사과", "good": {"정인", "식신", "정관"}, "bad": {"상관", "편관", "겁재"}, "move": True, "shake": True,
             "tip": ["진심이 통하는 날이야. 먼저 손 내밀어 봐.",
                     "나쁘지 않아. 하고 싶은 말을 한 줄로 정리해 가.",
                     "이날은 말이 엇나가기 쉬워. 꼭 해야 하면 글로 먼저 보내."]},
    "etc": {"label": "그 밖의 일", "good": {"식신", "정재", "정관", "정인"}, "bad": {"겁재", "상관"}, "move": True, "shake": False,
            "tip": ["기운이 너를 밀어주는 날이야.", "평범하게 흘러가는 날이야.", "이날은 한 박자 천천히 가."]},
}
FIT = ("좋음", "보통", "조심")

# 운세 달력(일정과 상관없는 그날 자체): 할 것 / 조심할 것 (그날 천간의 십신 기준, 친구 반말)
DAY_DO = {
    "비견": "네 방식대로 밀고 가 봐. 혼자 하는 일이 잘 풀려.", "겁재": "돈 쓰기 전에 하루만 기다려 봐.",
    "식신": "잘하는 걸 하나 보여 줘. 맛있는 거 먹고 쉬어도 좋아.", "상관": "떠오르는 생각을 메모해 둬. 아이디어가 잘 나와.",
    "편재": "새 사람, 새 제안에 한 번 '좋아'라고 해 봐.", "정재": "미뤄 둔 일 하나 끝내고, 돈 정리해 봐.",
    "편관": "피하고 싶던 일, 오늘 정면으로 하면 오히려 빨리 끝나.", "정관": "약속·서류·시간을 지키면 인정받아.",
    "편인": "혼자 공부하거나 생각 정리하기 좋아.", "정인": "도와 달라고 해 봐. 서류 일도 잘 풀려.",
}
DAY_DONT = {
    "비견": "고집 싸움은 피해. 이겨도 남는 게 없어.", "겁재": "돈 빌려주기·내기·충동구매는 오늘 말고.",
    "식신": "너무 늘어지면 해야 할 걸 놓쳐.", "상관": "윗사람한테 바로 반박하는 말은 한 번 삼켜.",
    "편재": "큰돈 거는 건 한 번 더 따져.", "정재": "새 일 벌이기보다 하던 걸 마무리해.",
    "편관": "무리한 약속이랑 밤샘은 몸이 먼저 지쳐.", "정관": "규칙 어기는 지름길은 오늘 꼭 걸려.",
    "편인": "혼자 오해하지 말고 궁금하면 물어봐.", "정인": "받기만 하고 고맙다는 말 잊지 마.",
}
CLASH_NOTE = "너랑 부딪는 날이야. 큰 결정이나 이동은 하루 미루면 편해."

# 하루 깊게 보기 (2026-10-30 사장님: "하루라도 기운을 깊게 세세하게"). AI 없이 그날 계산값을 겹겹이 풀어 쓴다.
# 1) 그날의 중심 기운(천간 십신) 풀이
DAY_DEEP = {
    "비견": "오늘은 너랑 똑같은 힘이 하나 더 들어와. 어깨에 힘이 들어가고 '내가 해 볼게'라는 마음이 커지는 날이야. 혼자 밀고 가는 일, 내 페이스로 하는 일에 속도가 붙어. 대신 같은 힘끼리 부딪치기 쉬워서, 비슷한 사람이랑 자존심 싸움이 붙을 수 있어.",
    "겁재": "오늘은 내 걸 나눠 가지려는 힘이 들어와. 사람이 모이고 활기는 도는데, 그만큼 돈이랑 몫이 새기 쉬워. 누가 부탁하면 거절이 어려워지고, 지갑이 쉽게 열려. 경쟁이 붙으면 이기고 싶은 마음이 앞서니까, 숫자는 한 번 더 보고 움직여.",
    "식신": "오늘은 내 안에 있는 걸 밖으로 꺼내는 힘이 들어와. 손이 풀리고, 말이 부드럽고, 먹고 쉬는 것도 즐거운 날이야. 잘하는 걸 하면 결과가 자연스럽게 따라와. 마음에 여유가 생겨서 사람들도 너를 편하게 느껴.",
    "상관": "오늘은 표현하고 바꾸고 싶은 힘이 세게 들어와. 머리가 빠르게 돌고 아이디어가 쏟아져. 답답한 규칙이나 윗사람 말이 유난히 거슬릴 수 있어. 그 힘을 만드는 데 쓰면 좋은 날이고, 말로 쏘면 나중에 수습할 일이 생겨.",
    "편재": "오늘은 크게 움직이는 돈과 기회의 힘이 들어와. 새 사람, 새 제안, 뜻밖의 연락이 스쳐 가는 날이야. 발이 넓어지고 판이 커져. 다만 들어오는 만큼 나가는 것도 커서, 기분 따라 크게 쓰거나 거는 건 조심해.",
    "정재": "오늘은 차곡차곡 쌓이는 돈과 결실의 힘이 들어와. 꼼꼼하게 챙기고 마무리하는 일이 잘 맞아. 큰 한 방보다는 작은 정리, 밀린 계산, 약속한 걸 끝내는 날이야. 성실하게 한 만큼 손에 남아.",
    "편관": "오늘은 밖에서 누르는 힘이 들어와. 일이 몰리거나, 갑자기 책임질 일이 생기거나, 누가 나를 시험하는 느낌이 들 수 있어. 무겁지만 이걸 버티고 해내면 한 단계 올라가. 피하면 더 커져서 돌아오니까, 정면으로 짧게 끝내.",
    "정관": "오늘은 질서와 인정의 힘이 들어와. 약속, 규칙, 서류, 출근 시간처럼 '정해진 것'을 지키면 신뢰가 쌓이는 날이야. 윗사람이나 조직과 관계가 부드러워. 반대로 지름길이나 꼼수는 꼭 티가 나.",
    "편인": "오늘은 안으로 파고드는 힘이 들어와. 직감이 날카롭고, 혼자 생각하고 공부하는 게 잘 돼. 대신 사람 만나는 게 귀찮고, 혼자 오해하거나 걱정이 커지기 쉬워. 마음이 가라앉으면 몸부터 좀 움직여.",
    "정인": "오늘은 받는 힘, 채워지는 힘이 들어와. 도와주는 사람, 좋은 조언, 서류나 자격 일이 잘 풀리는 날이야. 배우고 기대도 괜찮은 날이니까 혼자 다 하려고 하지 마. 마음도 한결 편안해져.",
}
# 2) 그날 바닥에 깔린 기운(지지 십신) — 겉으론 안 보여도 하루 내내 깔려 있는 흐름
DAY_UNDER = {
    "비견": "바닥엔 '내 뜻대로'가 깔려 있어. 남이 정해 주는 대로 하면 답답할 거야.",
    "겁재": "바닥엔 경쟁심이 깔려 있어. 비교하는 마음이 올라오면 잠깐 내려놔.",
    "식신": "바닥엔 여유가 깔려 있어. 서두르지 않아도 하루가 굴러가.",
    "상관": "바닥엔 하고 싶은 말이 깔려 있어. 메모로 먼저 풀어 두면 편해.",
    "편재": "바닥엔 바깥으로 나가고 싶은 마음이 깔려 있어. 잠깐이라도 바람 쐬어.",
    "정재": "바닥엔 챙기고 정리하고 싶은 마음이 깔려 있어. 책상부터 치우면 머리도 맑아져.",
    "편관": "바닥엔 긴장이 깔려 있어. 어깨랑 턱에 힘 들어가 있는지 한 번씩 봐.",
    "정관": "바닥엔 잘해야 한다는 마음이 깔려 있어. 너무 반듯하게만 하려다 지치지 마.",
    "편인": "바닥엔 생각이 깔려 있어. 걱정이 길어지면 종이에 적고 덮어 둬.",
    "정인": "바닥엔 기대고 싶은 마음이 깔려 있어. 편한 사람한테 연락해 봐.",
}
# 3) 분야별 한 줄: 일 · 돈 · 사람 · 몸과 마음
DAY_AREA = {
    "비견": ("혼자 맡은 일, 내 방식대로 하는 일이 잘 풀려.", "같이 내는 돈, 나눠 내는 돈에서 손해 보기 쉬워.", "친구·동료랑 가까워지지만 고집이 부딪칠 수 있어.", "에너지가 넘쳐. 운동으로 풀면 딱 좋아."),
    "겁재": ("경쟁이 붙어. 남과 비교하지 말고 내 몫만 챙겨.", "충동구매·빌려주기·내기는 오늘 말고.", "사람은 많이 모이는데 진짜 내 편은 몇 없어.", "들뜨기 쉬워. 밤늦게까지 무리하지 마."),
    "식신": ("손에 익은 일, 만드는 일에서 결과가 나와.", "들어오는 돈이 편안하게 흘러. 맛있는 데 써도 괜찮아.", "말이 부드러워서 분위기를 살려.", "잘 먹고 잘 쉬는 게 오늘의 일이야."),
    "상관": ("아이디어 내고 바꾸는 일엔 좋고, 보고·결재 자리는 말조심.", "재주로 버는 돈은 좋은데, 기분 따라 쓰는 돈이 커.", "솔직함이 날카롭게 들릴 수 있어. 한 박자 쉬고 말해.", "머리가 바빠서 잠이 얕아질 수 있어."),
    "편재": ("영업·만남·새 제안처럼 밖으로 뛰는 일이 잘 맞아.", "기회가 오지만 큰돈은 하루 생각하고.", "새 사람을 만날 기회가 생겨. 먼저 인사해 봐.", "돌아다니느라 피곤해져. 물 자주 마셔."),
    "정재": ("정리·계산·마감처럼 꼼꼼한 일이 잘 돼.", "아끼고 모으기 좋은 날. 가계부 한 번 열어 봐.", "약속 지키는 모습이 믿음을 줘.", "규칙적으로 먹고 자면 컨디션이 안정돼."),
    "편관": ("일이 몰려. 제일 무거운 것 하나부터 끝내.", "책임 때문에 나가는 돈이 생길 수 있어.", "누가 나를 시험하는 느낌이 들어도 감정으로 받지 마.", "긴장으로 몸이 굳어. 스트레칭 꼭 해."),
    "정관": ("보고·면접·서류처럼 공식적인 자리가 잘 풀려.", "월급처럼 정해진 돈은 안정적이야.", "예의 바르게 대하면 좋은 인상을 남겨.", "생활 리듬을 지키는 게 제일 좋은 약이야."),
    "편인": ("혼자 파고드는 일, 공부, 기획이 잘 돼.", "돈 계산보다 배움에 쓰는 돈이 남아.", "혼자 있고 싶어져. 연락 늦어지는 건 미리 말해 둬.", "생각이 많아져. 산책으로 머리를 비워."),
    "정인": ("배우고 도움받는 일이 잘 풀려. 모르는 건 물어봐.", "서류·계약·문서로 들어오는 이득이 있어.", "윗사람이나 어른의 도움이 닿아.", "몸과 마음이 쉬고 싶어 해. 일찍 자."),
}
PILLAR_AREA = {"년주": "가족·윗사람", "월주": "일·직장", "일주": "너 자신·가까운 사람", "시주": "앞으로의 계획·아랫사람"}
ELEMENT_NAME = {"목": "나무", "화": "불", "토": "흙", "금": "쇠", "수": "물"}
LUCKY = {"목": ("초록", "동쪽"), "화": ("빨강", "남쪽"), "토": ("노랑·베이지", "가운데(집·사무실)"), "금": ("흰색·은색", "서쪽"), "수": ("검정·남색", "북쪽")}
# 그날 자체의 좋음: 대부분에게 무난히 좋은 기운 + 필요한 기운 + 손잡는 날. '조심'은 나와 부딪는 날(충)만 — 한 달 2~3일 (겁주지 않게)
DAY_GOOD = {"식신", "정재", "정관", "정인", "편재"}
MAX_EVENTS = 60
WEEKDAY = "월화수목금토일"


def kinds_public():
    return [{"key": k, "label": v["label"]} for k, v in KINDS.items()]


def day_info(chart, d):
    """그날의 일진과 내 사주(원국)와의 관계 — current_luck 의 '일진' 부분만 가볍게."""
    ds = chart["day_master"]["stem"]
    s, b = day_ganzhi(d)
    natal_br, natal_st, natal_lab = _natal_lists(chart)
    rel = [r for r in find_relations(natal_br + [b], natal_st + [s], natal_lab + ["일진"]) if "일진" in r["between"]]
    return {"ko": STEMS_KO[s] + BRANCHES_KO[b], "stem_god": ten_god(ds, s), "branch_god": ten_god(ds, branch_main_stem(b)),
            "elements": {ELEMENTS[STEM_ELEMENT[s]], ELEMENTS[BRANCH_ELEMENT[b]]}, "relations": rel,
            "clash_me": any(r["type"] == "충" and "일주" in r["between"] for r in rel),
            "harmony_me": any(r["type"] in ("합", "천간합") and "일주" in r["between"] for r in rel)}


def score(chart, info, kind):
    k = KINDS[kind]
    pts, why = 0, []
    if info["stem_god"] in k["good"]:
        pts += 2
        why.append(f"이 일에 맞는 기운({GOD_PLAIN[info['stem_god']]})이 들어와")
    elif info["stem_god"] in k["bad"]:
        pts -= 2
        why.append(f"이 일엔 거슬리는 기운({GOD_PLAIN[info['stem_god']]})이 들어와")
    if info["branch_god"] in k["good"]:
        pts += 1
    elif info["branch_god"] in k["bad"]:
        pts -= 1
    if chart["yongsin"] in info["elements"]:
        pts += 1
        why.append("너한테 필요한 기운이 채워지는 날이야")
    if info["harmony_me"]:
        pts += 1
        why.append("너랑 손잡는 날이야")
    if info["clash_me"]:
        pts -= 2 if k["shake"] else 1
        why.append("너랑 부딪는 날이라 변동이 커")
    fit = "좋음" if pts >= 2 else "조심" if pts <= -1 else "보통"
    return pts, fit, why


def _label(d):
    return f"{d.month}/{d.day}({WEEKDAY[d.weekday()]})"


def read_event(chart, ev, today):
    d, kind = ev["date"], ev["kind"]
    info = day_info(chart, d)
    pts, fit, why = score(chart, info, kind)
    k = KINDS[kind]
    out = {"id": ev.get("id"), "date": d.isoformat(), "day": _label(d), "kind": kind, "kind_label": k["label"],
           "ganzhi": info["ko"], "title": DAY_TITLE.get(info["stem_god"], ""), "fit": fit, "score": pts,
           "why": why, "tip": k["tip"][FIT.index(fit)],
           "mood": TODAY_GOD.get(info["stem_god"], "").replace("오늘은 ", "이날은 " if d != today else "오늘은 "), "better": []}
    if k["move"] and fit != "좋음":  # 옮길 수 있는 일이면 앞뒤 1주에서 더 좋은 날 (지난 날은 빼고)
        cands = []
        for off in range(-7, 8):
            c = d + timedelta(days=off)
            if off == 0 or c < today:
                continue
            p, f, _ = score(chart, day_info(chart, c), kind)
            if f == "좋음":
                cands.append((-p, abs(off), c))
        out["better"] = [{"date": c.isoformat(), "day": _label(c)} for _, _, c in sorted(cands)[:2]]
    return out


def parse_events(raw, today):
    """화면에서 온 일정 목록 → [{id, date, kind}]. 이상한 건 조용히 버림 (지난 30일 ~ 앞으로 1년만)."""
    out = []
    for e in (raw or [])[:MAX_EVENTS]:
        try:
            d = date.fromisoformat(str(e.get("date")))
        except (ValueError, AttributeError):
            continue
        if e.get("kind") not in KINDS or not today - timedelta(days=30) <= d <= today + timedelta(days=366):
            continue
        out.append({"id": str(e.get("id") or "")[:40], "date": d, "kind": e["kind"]})
    return out


def day_fit(chart, info):
    if info["clash_me"]:
        return "조심"
    pts = (2 if info["stem_god"] in DAY_GOOD else 0) + (1 if info["branch_god"] in DAY_GOOD else 0)
    pts += (chart["yongsin"] in info["elements"]) + info["harmony_me"]
    return "좋음" if pts >= 3 else "보통"


def deep(chart, info, is_today=True):
    """하루 깊게 보기: 중심 기운 · 바닥 기운 · 나에게 필요한/부담되는 기운 · 삶의 어느 부분과 합·충 · 분야별 · 행운 포인트."""
    g, ug = info["stem_god"], info["branch_god"]
    ys, gs = chart["yongsin"], chart["gisin"]
    if ys in info["elements"]:
        el = f"너한테 모자란 {ELEMENT_NAME[ys]} 기운이 채워지는 날이야. 평소보다 숨이 덜 차고, 하던 일이 한결 수월하게 느껴질 거야."
    elif gs in info["elements"]:
        el = f"너한테 이미 넘치는 {ELEMENT_NAME[gs]} 기운이 더 들어오는 날이야. 같은 일도 조금 더 버겁게 느껴질 수 있으니 일정을 하나 덜어 둬."
    else:
        el = "너한테 크게 넘치지도 모자라지도 않은 기운이야. 평소 리듬대로 가면 돼."
    links = []
    for r in info["relations"]:
        other = next((x for x in r["between"] if x != "일진"), "")
        area = PILLAR_AREA.get(other)
        if not area:
            continue
        if r["type"] == "충":
            links.append(f"{area} 쪽이 흔들려. 갑작스러운 변화나 부딪힘이 생겨도 크게 받아들이지 말고 하루만 지켜봐.")
        else:
            links.append(f"{area} 쪽이랑 손잡는 날이야. 그쪽 사람한테 먼저 연락하거나 부탁하면 잘 풀려.")
    work, money, people, body = DAY_AREA.get(g, ("", "", "", ""))
    color, way = LUCKY[ys]
    core = DAY_DEEP.get(g, "")
    return {"core": core if is_today else core.replace("오늘은", "이날은", 1), "under": DAY_UNDER.get(ug, "") if ug != g else "", "element": el,
            "links": list(dict.fromkeys(links)),
            "areas": [{"k": "일", "v": work}, {"k": "돈", "v": money}, {"k": "사람", "v": people}, {"k": "몸과 마음", "v": body}],
            "lucky": f"{color} 계열 옷이나 소품, {way}. 너한테 필요한 {ELEMENT_NAME[ys]} 기운을 채워 주는 것들이야."}


def month(chart, year, mon, today=None):
    """운세 달력 한 달: 날마다 제목·좋음/보통/조심·할 것·조심할 것 + 이달 흐름 한 줄(그달 15일의 월운)."""
    today = today or date.today()
    days = []
    for n in range(1, calendar.monthrange(year, mon)[1] + 1):
        d = date(year, mon, n)
        info = day_info(chart, d)
        g = info["stem_god"]
        days.append({"date": d.isoformat(), "n": n, "dow": d.weekday(), "fit": day_fit(chart, info),
                     "title": DAY_TITLE.get(g, ""), "ganzhi": info["ko"], "do": DAY_DO.get(g, ""),
                     "dont": CLASH_NOTE if info["clash_me"] else DAY_DONT.get(g, ""), "past": d < today,
                     "deep": deep(chart, info, d == today)})
    flow = current_luck(chart, date(year, mon, 15))["month"]
    return {"year": year, "month": mon, "days": days,
            "flow": YEAR_GOD.get(flow["stem_god"], "").replace("한 해", "한 달"),
            "count": {f: sum(x["fit"] == f for x in days) for f in FIT}}


def reading(chart, events, today=None, ym=None):
    today = today or date.today()
    info = day_info(chart, today)
    week = []
    for i in range(7):  # 이번 주 한눈에: 날마다 짧은 제목
        d = today + timedelta(days=i)
        di = day_info(chart, d)
        week.append({"date": d.isoformat(), "day": _label(d), "title": DAY_TITLE.get(di["stem_god"], ""), "clash": di["clash_me"]})
    return {"today": {"date": today.isoformat(), "day": _label(today), "ganzhi": info["ko"],
                      "title": DAY_TITLE.get(info["stem_god"], ""), "mood": TODAY_GOD.get(info["stem_god"], ""),
                      "clash": info["clash_me"]},
            "week": week,
            "events": sorted((read_event(chart, e, today) for e in events), key=lambda x: x["date"]),
            "month": month(chart, *(ym or (today.year, today.month)), today=today),
            "kinds": kinds_public()}


def parse_month(raw, today):
    """'2026-11' → (2026, 11). 지난 1년 ~ 앞으로 2년만, 아니면 이번 달."""
    try:
        y, m = (int(x) for x in str(raw).split("-")[:2])
        if 1 <= m <= 12 and -12 <= (y - today.year) * 12 + m - today.month <= 24:
            return y, m
    except ValueError:
        pass
    return today.year, today.month


if __name__ == "__main__":
    import time

    from saju_engine import compute_chart
    chart = compute_chart(1994, 10, 14, 8, 30, "male", "서울")
    t0 = date(2026, 11, 2)
    evs = parse_events([{"id": "a", "date": (t0 + timedelta(days=i % 40)).isoformat(), "kind": list(KINDS)[i % len(KINDS)]}
                        for i in range(60)] + [{"date": "nope", "kind": "bank"}, {"date": "2026-11-03", "kind": "hack"}], t0)
    assert len(evs) == 60, "이상한 일정을 못 걸러냄"
    s = time.time()
    r = reading(chart, evs, t0)
    took = time.time() - s
    assert len(r["events"]) == 60 and len(r["week"]) == 7
    fits = [e["fit"] for e in r["events"]]
    assert all(f in FIT for f in fits) and len(set(fits)) > 1, f"좋음/보통/조심이 고르게 안 나옴: {fits}"
    assert all(b["date"] >= t0.isoformat() for e in r["events"] for b in e["better"]), "지난 날을 더 좋은 날로 추천함"
    assert all(not e["better"] for e in r["events"] if e["kind"] == "payday"), "월급날은 옮길 수 없는데 추천함"
    # 한 달 동안 종류별로 좋음/조심이 몇 번인지 — 한쪽으로 쏠리면 규칙을 다시 볼 것
    for k in KINDS:
        days30 = [score(chart, day_info(chart, t0 + timedelta(days=i)), k)[1] for i in range(30)]
        print(f"{KINDS[k]['label']:<14} 좋음 {days30.count('좋음'):>2} · 보통 {days30.count('보통'):>2} · 조심 {days30.count('조심'):>2}")
    for y, m in ((2026, 11), (2026, 12), (2027, 1)):
        mo = month(chart, y, m, t0)
        print(f"{y}-{m} 달력: {mo['count']} · 흐름: {mo['flow']}")
        assert 0 < mo["count"]["좋음"] and mo["count"]["조심"] <= 6, "달력 좋음/조심이 쏠림"
    import json
    d0 = month(chart, 2026, 11, t0)["days"][0]
    print(json.dumps(d0["deep"], ensure_ascii=False, indent=1))
    assert d0["deep"]["core"] and len(d0["deep"]["areas"]) == 4
    assert any(x["deep"]["links"] for x in month(chart, 2026, 11, t0)["days"]), "합·충 풀이가 한 번도 안 나옴"
    assert parse_month("2026-12", t0) == (2026, 12) and parse_month("2030-1", t0) == (2026, 11) and parse_month("x", t0) == (2026, 11)
    print(r["today"], r["events"][0], sep="\n")
    print(f"✅ 자체 점검 통과 (일정 60개 계산 {took:.2f}초)")
