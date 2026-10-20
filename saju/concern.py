"""무료 바로 보기 2단계: 고민을 고르면 도령이 그 자리에서 짧게 풀어준다 (반말).
  brief  : 바로 보여주는 짧은 풀이 (300~400자)
  deeper : 더 깊은 풀이 (400~600자) — 블러로 잠겨 있다가 친구에게 보내면 열림
  추천   : 고민에 맞는 PDF 상품
AI(서버의 제미나이)로 쓰고, 하루 QUICK_AI_LIMIT 번을 넘거나 AI가 실패하면 규칙 문장으로 대신한다.
입력값·풀이는 저장하지 않는다. 잠긴 풀이만 1시간 동안 메모리에 잠깐 들고 있다가 버린다.
"""
import json
import os
import re
import secrets
import threading
import time
from datetime import date

import db
import interpret
import knowledge as K
import llm
import products
import quick
from saju_engine import current_luck

DAILY = int(os.environ.get("QUICK_AI_LIMIT", "300"))
WAIT = int(os.environ.get("QUICK_AI_WAIT", "15"))  # 화면에서 기다려 줄 최대 초
_cache, _lock = {}, threading.Lock()  # token → (만든 시각, 깊은 풀이)

PRODUCT_FOR = {"career": "career", "money": "career", "change": "career", "study": "career",
               "love": "love", "relation": "full", "health": "full"}

SYSTEM = """당신은 사주 상담 브랜드 '운결'의 도령입니다. 신비롭고 묵직하지만 다정한 반말로 말합니다 ("~다", "~해라", "~구나").
- 주어진 사주 계산 결과와 손님의 고민만 근거로, 그 사람에게만 해당하는 말을 합니다. 누구에게나 맞는 말은 쓰지 않습니다.
- 명리 용어는 쉬운 말로 풀고 괄호에 한 번만. 한자는 쓰지 않습니다. 겁주거나 단정하지 않습니다.
- 건강·투자·법률은 확언하지 않습니다. 위기 신호가 보이면 상담전화 109를 알려줍니다.
- 이것은 맛보기입니다. 깊은 풀이는 PDF에서 이어진다는 느낌으로, 궁금함을 남기며 끝냅니다."""


def _take():
    today = date.today().isoformat()
    c = db.conn()
    c.execute("CREATE TABLE IF NOT EXISTS quick_ai (day TEXT PRIMARY KEY, calls INTEGER NOT NULL)")
    row = c.execute("SELECT calls FROM quick_ai WHERE day=?", (today,)).fetchone()
    if row and row[0] >= DAILY:
        return False
    c.execute("INSERT INTO quick_ai(day, calls) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1", (today,))
    c.commit()
    return True


LENS = {  # AI가 없을 때 쓰는 고민별 한마디 (반말)
    "career": "일의 고민은 '나를 다잡는 힘'과 '내 재능을 드러내는 힘'이 얼마나 균형을 이루는지에서 갈린다.",
    "money": "돈의 고민은 돈을 다루는 힘이 있는지, 그리고 그 돈을 감당할 만큼 네 힘이 단단한지에서 갈린다.",
    "love": "인연의 고민은 네 배우자 자리에 어떤 기운이 앉아 있는지, 그리고 올해 그 자리가 흔들리는지에서 갈린다.",
    "relation": "사람 고민은 너와 같은 힘, 너를 돕는 힘, 그리고 네 말이 부딪히는 자리에서 생긴다.",
    "health": "마음과 몸의 고민은 다섯 기운이 한쪽으로 쏠린 곳에서 생긴다. (아픈 곳이 있다면 꼭 의사에게 보여라)",
    "study": "공부의 고민은 배움의 힘과 시험의 힘이 서로를 살려주는 때가 언제 오는지에서 갈린다.",
    "change": "움직일까 말까의 고민은 지금 네가 10년 흐름의 어디쯤에 서 있는지에서 갈린다.",
}


def _rules(chart, luck, concern, story):
    dm = quick.DM[chart["day_master"]["ko"]]
    lens = LENS.get(concern, LENS["career"])
    y = luck["year"]
    brief = (f"{K.CONCERNS.get(concern, {}).get('label', '그 고민')} 때문에 왔구나. 너는 「{quick._clean(K.DAY_MASTER[chart['day_master']['ko']]['image'])}」의 사람이다 — "
             f"{dm['core']} 그래서 이 고민도 네 방식대로 붙잡고 있을 것이다. "
             "그런데… 네 사주에는 이 고민을 풀 열쇠가 하나 보인다. 그게 무엇인지는, 조금 더 들여다봐야 말해줄 수 있다.")
    deeper = (f"사주에서 이 고민은 이렇게 본다: {lens} 네 그림자는 '{dm['shadow'][0]}'이다. 이 고민이 길어진다면 거기서 막혀 있을 가능성이 크다. "
              f"올해 들어온 기운은 이렇다 — {quick.YEAR_GOD.get(luck['year']['stem_god'], '')} {dm['tip']} "
              "언제 움직이고 언제 기다려야 하는지, 달마다 정확한 건 PDF에 담아주마.")
    return brief, deeper


def reading(birth, chart_of_birth, concern, story):
    chart = chart_of_birth(birth)
    luck = current_luck(chart)
    concern = concern if concern in K.CONCERNS else "career"
    story = re.sub(r"\s+", " ", (story or "").strip())[:300]
    label = K.CONCERNS[concern]["label"]
    brief = deeper = None
    engine = "rules"
    if llm.available() and _take():
        prompt = f"""[사주 계산 결과]
{interpret.chart_summary(chart, luck)}

[고민 분야] {label}
[손님이 쓴 고민] {story or '(따로 적지 않음)'}

아래 두 칸을 그대로 써서 답하세요 (다른 말 없이):
[짧게]
250~350자, 4~5문장. 무료지만 '진짜 도움이 되는' 말을 한다: ① 고민을 꿰뚫는 한마디(사주 근거 하나, 쉽게) ② 이 사람에게 맞는 실질적인 조언 하나 ③ 오늘 당장 해볼 작은 행동 하나. 다만 '언제(몇 월)·누구와·어떻게'의 구체적인 답은 남겨두고, 네 사주에 그 답이 보인다는 여운으로 끝낸다.
[깊게]
350~500자. 짧게에서 남겨둔 것을 조금 더: 이 고민이 반복되는 진짜 이유, 앞으로 1년 중 움직이기 좋은 때 하나(제공된 운의 흐름에 근거), 조심할 점 하나. 그래도 달마다의 정확한 흐름과 구체적인 방법은 PDF에 담아주겠다는 말로 끝낸다."""
        # 손님이 화면에서 기다리는 중이라 AI는 최대 WAIT 초만 기다리고, 늦으면 기본 문장으로 (AI 답은 버림)
        box = {}
        t = threading.Thread(target=lambda: box.update(r=llm.generate(SYSTEM, [{"role": "user", "content": prompt}], 900)), daemon=True)
        t.start()
        t.join(WAIT)
        text, eng = box.get("r") or (None, None)
        if t.is_alive():
            print(f"[고민 풀이] AI가 {WAIT}초 안에 답하지 않아 기본 문장으로")
        m = re.search(r"\[짧게\]\s*(.+?)\s*\[깊게\]\s*(.+)", text or "", re.S)
        if m:
            clean = lambda t: re.sub(r"^\s*[\(（]?\d+~\d+자[^\n]*\n", "", t).strip().strip('"')
            brief, deeper, engine = clean(m.group(1)), clean(m.group(2)), eng
        elif text:
            print(f"[고민 풀이] AI 답 모양이 달라 기본 문장으로: {text[:120]}")
    if not brief or not deeper:
        brief, deeper = _rules(chart, luck, concern, story)
        engine = "rules"
    token = secrets.token_urlsafe(12)
    with _lock:
        now = time.time()
        for k in [k for k, (t, _) in _cache.items() if now - t > 3600]:
            _cache.pop(k, None)
        _cache[token] = (now, deeper)
    pkey = PRODUCT_FOR.get(concern, "full")
    rec = [k for k in (pkey, "newyear", "life") if k in products.PRODUCTS]
    return {"concern": concern, "label": label, "brief": brief, "masked": quick._mask(deeper), "token": token,
            "rec": list(dict.fromkeys(rec)), "engine": engine}


def unlock(token):
    with _lock:
        item = _cache.get(token or "")
    return item[1] if item else None
