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
    brief = (f"{K.CONCERNS.get(concern, {}).get('label', '그 고민')} 때문에 왔구나. 너는 {quick._clean(K.DAY_MASTER[chart['day_master']['ko']]['image'])}다 — "
             f"{dm['core']} 그래서 이 고민도 네 방식대로 붙잡고 있을 것이다. "
             f"올해는 {quick.YEAR_GOD.get(y['stem_god'], '')}")
    deeper = (f"사주에서 이 고민은 이렇게 본다: {lens} 네 그림자는 '{dm['shadow'][0]}'이다. 이 고민이 길어진다면 거기서 막혀 있을 가능성이 크다. "
              f"{dm['tip']} 언제 움직이고 언제 기다려야 하는지는, 달마다의 흐름까지 봐야 정확히 말해줄 수 있다.")
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

JSON 으로만 답하세요: {{"brief": "...", "deeper": "..."}}
- brief: 150~250자, 3~4문장. 답을 주지 말고 '궁금하게' 만든다. ① 고민을 꿰뚫는 한마디(사주 근거 하나, 쉽게) ② "그런데 네 사주에는 이 고민을 풀 열쇠가 하나 보인다" 같은 예고 ③ 그 열쇠가 무엇인지는 말하지 않고 끝낸다.
- deeper: 300~450자. brief 에서 예고한 열쇠를 조금 보여준다: 이 고민이 반복되는 진짜 이유 하나, 앞으로 1년 중 움직이기 좋은 때 하나(제공된 운의 흐름에 근거). 다 말하지 말고 "언제, 어떻게 움직일지 달마다 정확한 건 PDF에 담아주마"로 끝낸다."""
        text, eng = llm.generate(SYSTEM, [{"role": "user", "content": prompt}], 1500)
        m = re.search(r"\{.*\}", text or "", re.S)
        try:
            d = json.loads(m.group(0)) if m else {}
            brief, deeper, engine = d.get("brief", "").strip(), d.get("deeper", "").strip(), eng
        except ValueError:
            pass
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
