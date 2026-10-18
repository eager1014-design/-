"""사주팔자(四柱八字) 계산 엔진.

- 절기는 태양 황경을 천문 계산(Meeus 저정밀 공식, 오차 수 분 이내)으로 직접 구한다.
- 년주: 입춘(황경 315°) 기준, 월주: 12절(節) 기준, 일주: 율리우스일 기준 60갑자,
  시주: 출생지 경도로 보정한 지방평균태양시 기준(23시 이후는 다음 날 자시로 처리).
- 대운: 성별·년간 음양으로 순/역행, 출생~인접 절입까지 일수 / 3 = 대운수.
"""
import math
from datetime import datetime, timedelta, date

STEMS = "甲乙丙丁戊己庚辛壬癸"
STEMS_KO = "갑을병정무기경신임계"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
BRANCHES_KO = "자축인묘진사오미신유술해"
ANIMALS = "쥐소호랑이토끼용뱀말양원숭이닭개돼지"
ANIMAL_LIST = ["쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양", "원숭이", "닭", "개", "돼지"]

ELEMENTS = ["목", "화", "토", "금", "수"]
ELEMENTS_HANJA = ["木", "火", "土", "金", "水"]
STEM_ELEMENT = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
BRANCH_ELEMENT = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4]

# 지장간(여기·중기·정기 순, 마지막이 정기)
HIDDEN_STEMS = {
    0: [8, 9], 1: [9, 7, 5], 2: [4, 2, 0], 3: [0, 1], 4: [1, 9, 4], 5: [4, 6, 2],
    6: [2, 5, 3], 7: [3, 1, 5], 8: [4, 8, 6], 9: [6, 7], 10: [7, 3, 4], 11: [4, 0, 8],
}

TEN_GODS = ["비견", "겁재", "식신", "상관", "편재", "정재", "편관", "정관", "편인", "정인"]

JIE_NAMES = ["입춘", "경칩", "청명", "입하", "망종", "소서", "입추", "백로", "한로", "입동", "대설", "소한"]

CITIES = {
    "서울": 126.98, "인천": 126.70, "수원": 127.03, "춘천": 127.73, "강릉": 128.90,
    "대전": 127.38, "청주": 127.49, "전주": 127.15, "광주": 126.85, "대구": 128.60,
    "포항": 129.37, "울산": 129.31, "부산": 129.08, "창원": 128.68, "제주": 126.53,
    "해외/모름(동경135°)": 135.0,
}


# ---------------------------------------------------------------- 천문 계산
def _jd_from_utc(dt):
    y, m = dt.year, dt.month
    d = dt.day + (dt.hour + dt.minute / 60 + dt.second / 3600) / 24
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + b - 1524.5


def sun_longitude(dt_utc):
    """시각(UTC)의 태양 겉보기 황경(도)."""
    jd = _jd_from_utc(dt_utc) + 69 / 86400  # ΔT 근사
    t = (jd - 2451545.0) / 36525
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians(357.52911 + 35999.05029 * t - 0.0001537 * t * t)
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m)
         + 0.000289 * math.sin(3 * m))
    omega = math.radians(125.04 - 1934.136 * t)
    return (l0 + c - 0.00569 - 0.00478 * math.sin(omega)) % 360


def _angle_diff(a, b):
    return (a - b + 180) % 360 - 180


def solar_term_time(year, target_lon):
    """해당 연도 근처에서 태양 황경이 target_lon 이 되는 UTC 시각."""
    # 춘분(0°)≈3/20 기준으로 대략적 위치를 잡고 뉴턴 반복
    guess = datetime(year, 3, 20) + timedelta(days=((target_lon % 360) / 360) * 365.2422)
    if target_lon >= 270:
        guess -= timedelta(days=365.2422)
    dt = guess
    for _ in range(50):
        diff = _angle_diff(target_lon, sun_longitude(dt))
        if abs(diff) < 1e-6:
            break
        dt += timedelta(days=diff / 0.98564736)
    return dt


def jie_around(dt_utc):
    """출생 시각 직전·직후의 절(節) 시각."""
    lon = sun_longitude(dt_utc)
    idx = int(((lon - 315) % 360) // 30)  # 0=입춘 구간
    prev_lon = (315 + idx * 30) % 360
    prev = solar_term_time(dt_utc.year, prev_lon)
    while prev > dt_utc:
        prev -= timedelta(days=365.2422)
        prev = _refine(prev, prev_lon)
    while prev + timedelta(days=40) < dt_utc:
        prev += timedelta(days=365.2422)
        prev = _refine(prev, prev_lon)
    nxt = _refine(prev + timedelta(days=30.4), (prev_lon + 30) % 360)
    return (prev, JIE_NAMES[idx]), (nxt, JIE_NAMES[(idx + 1) % 12])


def _refine(dt, target):
    for _ in range(50):
        diff = _angle_diff(target, sun_longitude(dt))
        if abs(diff) < 1e-6:
            break
        dt += timedelta(days=diff / 0.98564736)
    return dt


# ---------------------------------------------------------------- 한국 시간대
def korea_utc_offset(local_dt):
    """역사적 한국 표준시/서머타임 반영 UTC 오프셋(시간)."""
    d = local_dt
    if datetime(1954, 3, 21) <= d < datetime(1961, 8, 10):
        off = 8.5
    else:
        off = 9.0
    dst = [
        (datetime(1987, 5, 10, 2), datetime(1987, 10, 11, 3)),
        (datetime(1988, 5, 8, 2), datetime(1988, 10, 9, 3)),
        (datetime(1955, 5, 5), datetime(1955, 9, 9)),
        (datetime(1956, 5, 20), datetime(1956, 9, 30)),
        (datetime(1957, 5, 5), datetime(1957, 9, 22)),
        (datetime(1958, 5, 4), datetime(1958, 9, 21)),
        (datetime(1959, 5, 3), datetime(1959, 9, 20)),
        (datetime(1960, 5, 1), datetime(1960, 9, 18)),
    ]
    for s, e in dst:
        if s <= d < e:
            off += 1
            break
    return off


# ---------------------------------------------------------------- 기본 함수
def pillar(stem, branch):
    return {
        "stem": stem, "branch": branch,
        "hanja": STEMS[stem] + BRANCHES[branch],
        "ko": STEMS_KO[stem] + BRANCHES_KO[branch],
        "stem_element": ELEMENTS[STEM_ELEMENT[stem]],
        "branch_element": ELEMENTS[BRANCH_ELEMENT[branch]],
        "stem_yang": stem % 2 == 0,
        "branch_yang": branch % 2 == 0,
    }


def ganzhi_index(stem, branch):
    for i in range(60):
        if i % 10 == stem and i % 12 == branch:
            return i
    raise ValueError


def day_ganzhi(d):
    jdn = d.toordinal() + 1721425  # proleptic Gregorian → JDN
    idx = (jdn + 49) % 60
    return idx % 10, idx % 12


def ten_god(day_stem, other_stem):
    me, ot = STEM_ELEMENT[day_stem], STEM_ELEMENT[other_stem]
    same_pol = (day_stem % 2) == (other_stem % 2)
    rel = (ot - me) % 5  # 0 같음, 1 내가 생, 2 내가 극, 3 나를 극, 4 나를 생
    base = {0: 0, 1: 2, 2: 4, 3: 6, 4: 8}[rel]
    return TEN_GODS[base + (0 if same_pol else 1)]


def branch_main_stem(branch):
    return HIDDEN_STEMS[branch][-1]


def element_relation(me, other):
    rel = (other - me) % 5
    return ["비겁", "식상", "재성", "관성", "인성"][rel]


# ---------------------------------------------------------------- 신살·합충
CLASH = {frozenset(p) for p in [(0, 6), (1, 7), (2, 8), (3, 9), (4, 10), (5, 11)]}
SIX_HARMONY = {frozenset(p): e for p, e in [((0, 1), 2), ((2, 11), 0), ((3, 10), 1),
                                            ((4, 9), 3), ((5, 8), 4), ((6, 7), 1)]}
STEM_HARMONY = {frozenset(p): e for p, e in [((0, 5), 2), ((1, 6), 3), ((2, 7), 4),
                                             ((3, 8), 0), ((4, 9), 1)]}
SAMHAP_GROUP = {8: 0, 0: 0, 4: 0, 2: 1, 6: 1, 10: 1, 5: 2, 9: 2, 1: 2, 11: 3, 3: 3, 7: 3}
YEOKMA = [2, 8, 11, 5]   # 申子辰→寅, 寅午戌→申, 巳酉丑→亥, 亥卯未→巳
DOHWA = [9, 3, 6, 0]
HWAGAE = [4, 10, 1, 7]


def find_relations(branches, stems, labels):
    rels = []
    n = len(branches)
    for i in range(n):
        for j in range(i + 1, n):
            pair = frozenset((branches[i], branches[j]))
            if pair in CLASH:
                rels.append({"type": "충", "between": [labels[i], labels[j]],
                             "text": f"{BRANCHES_KO[branches[i]]}{BRANCHES_KO[branches[j]]}충"})
            if pair in SIX_HARMONY:
                rels.append({"type": "합", "between": [labels[i], labels[j]],
                             "text": f"{BRANCHES_KO[branches[i]]}{BRANCHES_KO[branches[j]]}합({ELEMENTS[SIX_HARMONY[pair]]})"})
            sp = frozenset((stems[i], stems[j]))
            if stems[i] != stems[j] and sp in STEM_HARMONY:
                rels.append({"type": "천간합", "between": [labels[i], labels[j]],
                             "text": f"{STEMS_KO[stems[i]]}{STEMS_KO[stems[j]]}합({ELEMENTS[STEM_HARMONY[sp]]})"})
    return rels


def shinsal(branches, labels, day_branch, year_branch):
    out = []
    for base_name, base in (("일지", day_branch), ("년지", year_branch)):
        g = SAMHAP_GROUP[base]
        for name, table in (("역마살", YEOKMA), ("도화살", DOHWA), ("화개살", HWAGAE)):
            for b, lab in zip(branches, labels):
                if b == table[g] and not any(o["name"] == name and o["pillar"] == lab for o in out):
                    out.append({"name": name, "pillar": lab, "basis": base_name})
    return out


# ---------------------------------------------------------------- 메인 계산
def compute_chart(year, month, day, hour=None, minute=0, gender="male", city="서울",
                  calendar="solar"):
    if calendar != "solar":
        raise ValueError("현재는 양력 생일만 지원합니다.")
    time_known = hour is not None
    h = hour if time_known else 12
    local = datetime(year, month, day, h, minute)
    offset = korea_utc_offset(local)
    utc = local - timedelta(hours=offset)
    lon = CITIES.get(city, 126.98)
    lmt = utc + timedelta(hours=lon / 15)  # 지방평균태양시
    correction_min = round((lmt - local).total_seconds() / 60)

    # 년주 (입춘 기준)
    y = utc.year
    ipchun = solar_term_time(y, 315)
    if utc < ipchun:
        y -= 1
    ys, yb = (y - 4) % 10, (y - 4) % 12

    # 월주 (절 기준)
    slon = sun_longitude(utc)
    m_idx = int(((slon - 315) % 360) // 30)  # 0=寅월
    mb = (m_idx + 2) % 12
    ms = (ys * 2 + 2 + m_idx) % 10

    # 일주 (지방시 23시 이후 → 다음날)
    day_date = lmt.date()
    if time_known and lmt.hour >= 23:
        day_date = day_date + timedelta(days=1)
    ds, db = day_ganzhi(day_date)

    pillars = {"year": pillar(ys, yb), "month": pillar(ms, mb), "day": pillar(ds, db)}
    if time_known:
        hb = ((lmt.hour + 1) // 2) % 12
        hs = (ds * 2 + hb) % 10
        pillars["hour"] = pillar(hs, hb)

    order = [k for k in ("hour", "day", "month", "year") if k in pillars]
    labels_ko = {"hour": "시주", "day": "일주", "month": "월주", "year": "년주"}

    # 십신
    for k in order:
        p = pillars[k]
        p["stem_god"] = "일간(나)" if k == "day" else ten_god(ds, p["stem"])
        p["branch_god"] = ten_god(ds, branch_main_stem(p["branch"]))
        p["hidden"] = [{"stem": STEMS_KO[s] + STEMS[s], "god": ten_god(ds, s),
                        "element": ELEMENTS[STEM_ELEMENT[s]]} for s in HIDDEN_STEMS[p["branch"]]]
        p["label"] = labels_ko[k]

    # 오행 분포 (천간 1, 지지 1 + 지장간 가중)
    counts = [0.0] * 5
    simple = [0] * 5
    for k in order:
        p = pillars[k]
        counts[STEM_ELEMENT[p["stem"]]] += 1
        simple[STEM_ELEMENT[p["stem"]]] += 1
        simple[BRANCH_ELEMENT[p["branch"]]] += 1
        hs_list = HIDDEN_STEMS[p["branch"]]
        weights = [0.3, 0.7] if len(hs_list) == 2 else [0.2, 0.2, 0.6]
        for s, w in zip(hs_list, weights):
            counts[STEM_ELEMENT[s]] += w * (1.5 if k == "month" else 1)

    # 신강·신약 (득령·득지·득세 가중)
    me = STEM_ELEMENT[ds]
    support = {me, (me - 1) % 5}
    score = total = 0.0
    for k in order:
        p = pillars[k]
        if k != "day":
            total += 1
            if STEM_ELEMENT[p["stem"]] in support:
                score += 1
        w = 3 if k == "month" else (1.5 if k == "day" else 1)
        total += w
        if BRANCH_ELEMENT[p["branch"]] in support:
            score += w
    ratio = score / total
    if ratio >= 0.62:
        strength = "신강"
    elif ratio >= 0.5:
        strength = "중화(약간 강)"
    elif ratio >= 0.38:
        strength = "중화(약간 약)"
    else:
        strength = "신약"

    # 용신(억부 기준 간이 판단)
    def el_score(e):
        return counts[e]
    if ratio >= 0.5:
        cand = [(me + 1) % 5, (me + 2) % 5, (me + 3) % 5]  # 식상·재·관
    else:
        cand = [(me - 1) % 5, me]  # 인성·비겁
    yongsin = min(cand, key=el_score)
    gisin = max([(me - 1) % 5, me] if ratio >= 0.5 else [(me + 1) % 5, (me + 2) % 5, (me + 3) % 5],
                key=el_score)

    branches = [pillars[k]["branch"] for k in order]
    stems = [pillars[k]["stem"] for k in order]
    labels = [labels_ko[k] for k in order]
    relations = find_relations(branches, stems, labels)
    sals = shinsal(branches, labels, db, yb)

    # 대운
    yang_year = ys % 2 == 0
    forward = (gender == "male") == yang_year
    (prev_jie, prev_name), (next_jie, next_name) = jie_around(utc)
    days = ((next_jie - utc) if forward else (utc - prev_jie)).total_seconds() / 86400
    start_age = max(1, round(days / 3))
    month_idx60 = ganzhi_index(ms, mb)
    daeun = []
    for i in range(1, 11):
        idx = (month_idx60 + (i if forward else -i)) % 60
        s, b = idx % 10, idx % 12
        age = start_age + (i - 1) * 10
        daeun.append({
            "age": age, "start_year": year + age - 1,
            "hanja": STEMS[s] + BRANCHES[b], "ko": STEMS_KO[s] + BRANCHES_KO[b],
            "stem_god": ten_god(ds, s), "branch_god": ten_god(ds, branch_main_stem(b)),
            "stem_element": ELEMENTS[STEM_ELEMENT[s]], "branch_element": ELEMENTS[BRANCH_ELEMENT[b]],
            "stem": s, "branch": b,
        })

    god_counts = {}
    for k in order:
        p = pillars[k]
        for g in ([p["stem_god"]] if k != "day" else []) + [p["branch_god"]]:
            god_counts[g] = god_counts.get(g, 0) + 1
    group_counts = {"비겁": 0, "식상": 0, "재성": 0, "관성": 0, "인성": 0}
    for g, c in god_counts.items():
        idx = TEN_GODS.index(g) // 2
        group_counts[["비겁", "식상", "재성", "관성", "인성"][idx]] += c

    return {
        "input": {"year": year, "month": month, "day": day, "hour": hour, "minute": minute,
                  "gender": gender, "city": city, "time_known": time_known},
        "time_correction_min": correction_min,
        "utc_offset": offset,
        "pillars": pillars, "order": order,
        "day_master": {"stem": ds, "hanja": STEMS[ds], "ko": STEMS_KO[ds],
                       "element": ELEMENTS[me], "yang": ds % 2 == 0},
        "animal": ANIMAL_LIST[yb],
        "elements": {ELEMENTS[i]: round(counts[i], 1) for i in range(5)},
        "elements_simple": {ELEMENTS[i]: simple[i] for i in range(5)},
        "strength": strength, "strength_ratio": round(ratio, 2),
        "yongsin": ELEMENTS[yongsin], "gisin": ELEMENTS[gisin],
        "ten_god_counts": god_counts, "ten_god_groups": group_counts,
        "relations": relations, "shinsal": sals,
        "daeun": daeun, "daeun_forward": forward, "daeun_start_age": start_age,
        "jie": {"prev": prev_name, "next": next_name},
    }


def year_pillar_of(y):
    return (y - 4) % 10, (y - 4) % 12


def current_luck(chart, today=None):
    """현재 대운·세운·월운·일진과 원국과의 관계."""
    today = today or date.today()
    ds = chart["day_master"]["stem"]
    birth_year = chart["input"]["year"]
    age = today.year - birth_year + 1  # 한국식 나이(대운 기준)
    cur = None
    for d in chart["daeun"]:
        if d["age"] <= age:
            cur = d
    nxt = next((d for d in chart["daeun"] if d["age"] > age), None)

    # 세운: 입춘 전이면 전년도
    y = today.year
    if datetime(today.year, today.month, today.day, 12) < solar_term_time(today.year, 315) + timedelta(hours=9):
        y -= 1
    ys, yb = year_pillar_of(y)
    # 월운
    slon = sun_longitude(datetime(today.year, today.month, today.day, 3))
    m_idx = int(((slon - 315) % 360) // 30)
    mb = (m_idx + 2) % 12
    ms = (ys * 2 + 2 + m_idx) % 10
    tds, tdb = day_ganzhi(today)

    natal_br = [chart["pillars"][k]["branch"] for k in chart["order"]]
    natal_st = [chart["pillars"][k]["stem"] for k in chart["order"]]
    natal_lab = [chart["pillars"][k]["label"] for k in chart["order"]]

    def luck(s, b, name):
        rel = find_relations(natal_br + [b], natal_st + [s], natal_lab + [name])
        rel = [r for r in rel if name in r["between"]]
        return {"hanja": STEMS[s] + BRANCHES[b], "ko": STEMS_KO[s] + BRANCHES_KO[b],
                "stem_god": ten_god(ds, s), "branch_god": ten_god(ds, branch_main_stem(b)),
                "stem_element": ELEMENTS[STEM_ELEMENT[s]], "branch_element": ELEMENTS[BRANCH_ELEMENT[b]],
                "relations": rel}

    out = {
        "today": today.isoformat(), "age": age,
        "daeun": dict(cur, **{"relations": luck(cur["stem"], cur["branch"], "대운")["relations"]}) if cur else None,
        "next_daeun": nxt,
        "year": dict(luck(ys, yb, "세운"), year=y),
        "month": luck(ms, mb, "월운"),
        "day": luck(tds, tdb, "일진"),
    }
    return out


def _natal_lists(chart):
    order = chart["order"]
    return ([chart["pillars"][k]["branch"] for k in order], [chart["pillars"][k]["stem"] for k in order],
            [chart["pillars"][k]["label"] for k in order])


def year_months(chart, year):
    """year 년(입춘~다음 입춘)의 12달: 시작일, 간지, 십신, 원국과의 합·충."""
    ds = chart["day_master"]["stem"]
    ys, _ = year_pillar_of(year)
    natal_br, natal_st, natal_lab = _natal_lists(chart)
    yongsin = chart["yongsin"]
    out = []
    for i in range(12):
        lon = (315 + i * 30) % 360
        start = solar_term_time(year + (1 if i == 11 else 0), lon) + timedelta(hours=9)  # KST
        s, b = (ys * 2 + 2 + i) % 10, (i + 2) % 12
        rel = find_relations(natal_br + [b], natal_st + [s], natal_lab + ["월운"])
        rel = list({r["text"]: r for r in rel if "월운" in r["between"]}.values())
        se, be = ELEMENTS[STEM_ELEMENT[s]], ELEMENTS[BRANCH_ELEMENT[b]]
        out.append({
            "index": i, "jie": JIE_NAMES[i], "start": start.strftime("%Y-%m-%d"),
            "solar_month": start.month,
            "hanja": STEMS[s] + BRANCHES[b], "ko": STEMS_KO[s] + BRANCHES_KO[b],
            "stem_god": ten_god(ds, s), "branch_god": ten_god(ds, branch_main_stem(b)),
            "stem_element": se, "branch_element": be,
            "relations": rel, "yongsin_hit": yongsin in (se, be),
            "clash": any(r["type"] == "충" for r in rel),
        })
    return out


def compatibility(a, b):
    """두 사주(a=나, b=상대)의 궁합 요소."""
    da, db_ = a["day_master"]["stem"], b["day_master"]["stem"]
    pa, pb = a["pillars"], b["pillars"]
    out = {"stem_harmony": None, "pairs": [], "complement": [], "overlap": [],
           "a_to_b": ten_god(da, db_), "b_to_a": ten_god(db_, da)}
    sp = frozenset((da, db_))
    if da != db_ and sp in STEM_HARMONY:
        out["stem_harmony"] = f"{STEMS_KO[da]}{STEMS_KO[db_]}합({ELEMENTS[STEM_HARMONY[sp]]})"
    # 서로의 지지 사이 합·충 (일지끼리가 가장 중요)
    weight = {"day": 3, "month": 2, "year": 1, "hour": 1}
    for ka in a["order"]:
        for kb in b["order"]:
            x, y = pa[ka]["branch"], pb[kb]["branch"]
            pair = frozenset((x, y))
            kind = "충" if pair in CLASH else ("합" if pair in SIX_HARMONY else None)
            if kind:
                out["pairs"].append({"type": kind, "mine": pa[ka]["label"], "theirs": pb[kb]["label"],
                                     "text": f"{BRANCHES_KO[x]}{BRANCHES_KO[y]}{kind}",
                                     "weight": weight[ka] * weight[kb] // 1})
    out["pairs"].sort(key=lambda r: -r["weight"])
    # 오행 보완: 내게 부족한 기운이 상대에게 많은지
    ea, eb = a["elements"], b["elements"]
    ta, tb = sum(ea.values()) or 1, sum(eb.values()) or 1
    for e in ELEMENTS:
        ra, rb = ea[e] / ta, eb[e] / tb
        if ra < 0.12 and rb >= 0.22:
            out["complement"].append({"element": e, "who": "상대가 나를"})
        elif rb < 0.12 and ra >= 0.22:
            out["complement"].append({"element": e, "who": "내가 상대를"})
        elif ra >= 0.3 and rb >= 0.3:
            out["overlap"].append(e)
    out["yongsin_from_partner"] = eb[a["yongsin"]] / tb >= 0.22
    out["yongsin_to_partner"] = ea[b["yongsin"]] / ta >= 0.22
    score = 60
    score += 8 if out["stem_harmony"] else 0
    for r in out["pairs"][:4]:
        score += (2 if r["type"] == "합" else -3) * min(r["weight"], 3)
    score += 5 * len(out["complement"]) + (6 if out["yongsin_from_partner"] else 0) + (6 if out["yongsin_to_partner"] else 0)
    score -= 3 * len(out["overlap"])
    out["score"] = max(30, min(98, score))
    return out


if __name__ == "__main__":
    import json
    print(day_ganzhi(date(1949, 10, 1)), "expect (0,0) 갑자")
    print(day_ganzhi(date(2000, 1, 1)), "expect (4,6) 무오")
    t = solar_term_time(2024, 315) + timedelta(hours=9)
    print("2024 입춘 KST", t, "expect 2024-02-04 17:27")
    t = solar_term_time(2026, 315) + timedelta(hours=9)
    print("2026 입춘 KST", t, "expect 2026-02-04 05:02")
    c = compute_chart(1990, 5, 15, 14, 30, "female", "서울")
    print([c["pillars"][k]["ko"] for k in c["order"]], c["strength"], c["yongsin"], c["daeun_start_age"])
    print(json.dumps(current_luck(c), ensure_ascii=False)[:400])
