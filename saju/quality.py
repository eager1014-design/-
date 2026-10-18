"""사주 풀이 품질 검사 (AI 없이 코드로 채점 — 무료).

AI가 쓴 풀이가 (1) 계산 결과와 맞는지, (2) 손님 이야기를 반영했는지, (3) 뻔한 말·어려운 말을 피했는지,
(4) 형식·분량을 지켰는지, (5) 안전 안내를 했는지 검사한다.

사용:
  python3 quality.py 리포트.md --birth 1990-05-15 --hour 14 --minute 30 --gender female --story "고민 내용"
  python3 quality.py --selftest     # 일부러 틀린 예시로 검사기 자체를 확인
"""
import argparse
import re
import sys

from saju_engine import (BRANCHES_KO, STEMS_KO, compute_chart, current_luck, year_pillar_of)

GROUPS = ["비겁", "식상", "재성", "관성", "인성"]
ELEMENTS = ["목", "화", "토", "금", "수"]
BANNED = ["노력하면 좋은 결과", "긍정적인 마음", "긍정적인 마인드", "관계를 소중히", "때를 기다리면",
          "좋은 일이 생길", "모든 것은 마음먹기", "자신을 믿으세요", "최선을 다하면"]
CRISIS = ["죽고 싶", "자해", "자살", "사라지고 싶", "살기 싫"]
LENGTH = {"full": (2000, 2800), "counsel": (500, 900), "daily": (300, 500), "yearly": (1800, 2500),
          "match": (1500, 2200)}
HEADINGS = {"full": ["한눈에 보기", "## 1.", "## 2.", "## 3.", "## 4.", "용어"],
            "yearly": ["한눈에 보기", "달마다", "좋은 달", "실천"],
            "match": ["한 줄 요약", "끌리는", "부딪히", "잘 지내는"]}
MANY = r"(과다|과잉|많|넘치|넘쳐|강하게 자리|가득)"
NONE = r"(없|비어|부재|결핍)"
GROUP_WORDS = {"관성": ["관성"], "재성": ["재성"], "식상": ["식상"], "인성": ["인성"], "비겁": ["비겁"]}


def _plain_len(md):
    return len(re.sub(r"[#*>\-\s|`]", "", md))


def _sentences_with(md, word):
    return [s for s in re.split(r"(?<=[.!?。\n])", md) if word in s]


def check(md, chart, luck=None, sit=None, kind="full"):
    """{"score": 0~100, "issues": [{"level": "치명"|"주의"|"참고", "type", "message"}]}"""
    issues = []
    add = lambda level, typ, msg: issues.append({"level": level, "type": typ, "message": msg})
    sit = sit or {}
    body = md.split("이 리포트의 용어")[0]

    # 1) 과장: 타고난 십신 그룹·오행의 많다/없다 표현을 계산값과 대조
    groups = chart["ten_god_groups"]
    for g in GROUPS:
        for s in _sentences_with(body, g):
            seg = s[s.index(g):s.index(g) + 25]
            if re.search(MANY, seg) and groups[g] < 3 and "운" not in seg and "올해" not in s:
                add("치명", "과장", f"'{g}'이 많다고 썼지만 계산값은 {groups[g]}개(3개 이상일 때만 '많다'): …{seg.strip()}…")
                break
            if re.search(NONE, seg) and groups[g] > 0:
                add("치명", "과장", f"'{g}'이 없다고 썼지만 계산값은 {groups[g]}개: …{seg.strip()}…")
                break
    el = chart["elements"]
    total = sum(el.values()) or 1
    for e in ELEMENTS:
        ratio = el[e] / total
        for m in re.finditer(e + r" ?기운", body):
            seg = body[m.start():m.start() + 25]
            if re.search(r"(없|비어)", seg) and ratio > 0.1:
                add("치명", "과장", f"'{e} 기운'이 없다고 썼지만 비율은 {round(ratio * 100)}%: …{seg.strip()}…")
                break
            if re.search(r"(과다|넘치|가장 강)", seg) and ratio < 0.25:
                add("주의", "과장", f"'{e} 기운'이 강하다고 썼지만 비율은 {round(ratio * 100)}%: …{seg.strip()}…")
                break

    # 2) 간지 오류: 'YYYY년(간지)' 짝, 'N세 … 대운' 존재 여부
    for m in re.finditer(r"(\d{4})년\s*[\(（]?\s*([갑을병정무기경신임계][자축인묘진사오미신유술해])", md):
        y, gz = int(m.group(1)), m.group(2)
        s, b = year_pillar_of(y)
        if STEMS_KO[s] + BRANCHES_KO[b] != gz:
            add("치명", "간지 오류", f"{y}년은 {STEMS_KO[s]}{BRANCHES_KO[b]}년인데 '{gz}'로 썼습니다.")
    daeun = {(d["age"], d["ko"]) for d in chart["daeun"]}
    daeun_ko = {d["ko"] for d in chart["daeun"]}
    for m in re.finditer(r"(\d{1,2})세[^\n.]{0,10}?([갑을병정무기경신임계][자축인묘진사오미신유술해]) ?대운", md):
        age, gz = int(m.group(1)), m.group(2)
        if (age, gz) not in daeun:
            right = next((d["ko"] for d in chart["daeun"] if d["age"] == age), None)
            add("치명", "간지 오류", f"'{age}세 {gz} 대운'은 계산에 없습니다" + (f"(그 나이는 {right} 대운)." if right else "."))
    for m in re.finditer(r"([갑을병정무기경신임계][자축인묘진사오미신유술해]) ?대운", md):
        if m.group(1) not in daeun_ko:
            add("치명", "간지 오류", f"'{m.group(1)} 대운'은 이 사람의 대운 목록에 없습니다.")

    # 3) 내 이야기처럼: 손님 서술을 실제로 인용했는가
    story = (sit.get("story") or "").strip()
    if story and kind in ("full", "counsel", "yearly"):
        quotes = re.findall(r"[“\"‘']([^”\"’']{4,80})[”\"’']", md)
        norm = lambda t: re.sub(r"\s+", "", t)
        hits = [q for q in quotes if any(norm(q)[i:i + 6] in norm(story) for i in range(max(1, len(norm(q)) - 5)))]
        need = 2 if kind == "full" else 1
        if len(hits) < need:
            add("주의", "개인화", f"손님 이야기 인용이 {len(hits)}번뿐입니다(최소 {need}번).")

    # 4) 뻔한 말
    for p in BANNED:
        if p in md:
            add("주의", "뻔한 말", f"금지 문장 사용: '{p}'")

    # 5) 쉬운 말: 본문(용어 풀이 제외)에 한자
    hanja = re.findall(r"[一-鿿]", body)
    if len(hanja) > 2:
        add("주의", "어려운 말", f"본문에 한자 {len(hanja)}자: {''.join(hanja[:10])}…")

    # 6) 형식·분량
    lo, hi = LENGTH.get(kind, (0, 10 ** 6))
    n = _plain_len(md)
    if n < lo * 0.85 or n > hi * 1.15:
        add("주의", "분량", f"{n}자 — 목표 {lo:,}~{hi:,}자에서 많이 벗어남")
    elif n < lo or n > hi:
        add("참고", "분량", f"{n}자 — 목표 {lo:,}~{hi:,}자를 조금 벗어남")
    for h in HEADINGS.get(kind, []):
        if h not in md:
            add("주의", "형식", f"필수 소제목 '{h}' 없음")

    # 7) 안전
    if any(w in story for w in CRISIS) and not re.search(r"109|1393|1577-0199", md):
        add("치명", "안전", "위기 신호가 있는 고민인데 상담전화(109 등) 안내가 없습니다.")

    penalty = {"치명": 25, "주의": 8, "참고": 2}
    score = max(0, 100 - sum(penalty[i["level"]] for i in issues))
    return {"score": score, "issues": issues, "length": n}


def report_text(result, excerpts=True):
    """excerpts=False: 서버 로그용 — 풀이 원문 조각(손님 고민이 섞일 수 있음)을 빼고 항목만."""
    lines = [f"품질 점수: {result['score']}점 (글자 수 {result['length']:,})"]
    if not result["issues"]:
        lines.append("  문제 없음 ✅")
    for i in result["issues"]:
        icon = {"치명": "❌", "주의": "⚠️", "참고": "ℹ️"}[i["level"]]
        msg = i["message"] if excerpts else i["message"].split(": …")[0].split("…")[0]
        lines.append(f"  {icon} [{i['type']}] {msg}")
    return "\n".join(lines)


def _selftest():
    c = compute_chart(1990, 5, 15, 14, 30, "female", "서울")
    lk = current_luck(c)
    sit = {"story": "회의 때 의견이 묵살돼서 말을 삼키게 됩니다. 죽고 싶다는 생각도 들어요."}
    bad = ("## 한눈에 보기\n- 관성 과다로 답답합니다.\n## 1. 나\n재성이 많아 돈복이 있습니다. 목 기운이 없습니다. 庚金 일간.\n"
           "## 2. 고민\n노력하면 좋은 결과가 있을 것입니다.\n## 3. 흐름\n2027년(무신년)에 바뀌고 43세 갑자 대운이 옵니다.\n")
    r = check(bad, c, lk, sit)
    print(report_text(r))
    types = {i["type"] for i in r["issues"]}
    expect = {"과장", "간지 오류", "개인화", "뻔한 말", "안전", "분량", "형식"}
    missing = expect - types
    print("\n자체 검사:", "통과 ✅" if not missing else f"놓친 항목 {missing} ❌")
    return not missing


def main():
    ap = argparse.ArgumentParser(description="사주 풀이 품질 검사")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--birth", help="양력 YYYY-MM-DD")
    ap.add_argument("--hour", type=int)
    ap.add_argument("--minute", type=int, default=0)
    ap.add_argument("--gender", default="female")
    ap.add_argument("--city", default="서울")
    ap.add_argument("--story", default="")
    ap.add_argument("--kind", default="full", choices=list(LENGTH))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if _selftest() else 1)
    if not (a.file and a.birth):
        ap.error("파일과 --birth 가 필요합니다.")
    y, m, d = map(int, a.birth.split("-"))
    c = compute_chart(y, m, d, a.hour, a.minute, a.gender, a.city)
    print(report_text(check(open(a.file, encoding="utf-8").read(), c, current_luck(c), {"story": a.story}, a.kind)))


if __name__ == "__main__":
    main()
