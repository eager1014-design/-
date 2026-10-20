"""홍보 센터: 채널별 홍보 글 후보 만들기 → 사장님 승인 → 스레드는 자동 게시, 인스타·당근은 복사해서 올리기.

채널마다 신청서 링크에 ?src=채널 을 붙여서, 어느 채널에서 손님이 왔는지 신청 목록에서 보이게 한다.
글 후보는 llm.py 의 AI(제미나이 등)로 만든다 — 유료 호출 1회에 후보 여러 개.
"""
import json
import os
import random
import re
import threading
import time
from datetime import date, datetime, timedelta

import db
import knowledge as K
import llm
from saju_engine import STEMS_KO, BRANCHES_KO, ELEMENTS, STEM_ELEMENT, BRANCH_ELEMENT, day_ganzhi

CHANNELS = {
    "threads": {"label": "스레드", "limit": 500, "auto": True,
                "guide": "스레드: 150~400자(500자 넘으면 안 됨). 첫 줄은 스크롤을 멈추게 하는 한 문장 — 익숙한 장면으로 시작해 "
                         "새로운 해석으로 끝낸다(예: '속을 알 수 없는 남자에게만 끌린다면, 사주에 이 기운이 강할 수 있어요'). "
                         "한 줄은 짧게, 줄바꿈 많이. '나도 그래' 하게 만드는 특징 3~4개 목록이 잘 먹힌다. "
                         "본문에서 상품을 팔지 않는다(신청서 링크는 첫 댓글에 따로 달림). 해시태그 0~1개. "
                         "마지막 줄은 댓글을 부르는 질문(예: '여러분 일간은 뭐예요? 댓글로 남겨주세요'). 생년월일을 공개 댓글로 달라고 하지 않는다."},
    "instagram": {"label": "인스타그램", "limit": 2200, "auto": False,
                  "guide": "인스타그램 캡션: 300~600자. 첫 줄 훅, 3~5줄 본문, '프로필 링크에서 신청' 안내, 해시태그 5~8개(맨 끝). "
                           "그리고 이미지에 들어갈 문구를 [카드] 로 시작하는 줄에 2~4장 분량으로 따로 적는다(장마다 15자 내외 한 줄)."},
    "daangn": {"label": "당근", "limit": 1500, "auto": False,
               "guide": "당근(동네 생활·비즈 프로필 소식): 동네 이웃에게 말하듯 담백하게 300~500자. 과장·자극 표현 금지. "
                        "처음 이용하는 분이 이해할 수 있게 '무엇을, 얼마에, 어떻게 받는지'를 분명히. 해시태그 없음."},
}

# 스레드에서 잘 되는 사주 계정 조사(2026-10) 결과를 반영: 연애·끌림, 신살, 띠·일간 자가진단, 절기 기운이 반응이 좋고
# 판매 글은 적게(대략 공감 1 : 전문 6 : 개인 이야기 3), 판매는 프로필·댓글 링크로.
THEMES = {
    "love": "연애·끌림 (어떤 사람에게 끌리는지, 연애가 꼬이는 이유를 일간·관성·도화살 등으로. 공감 장면으로 시작)",
    "selfcheck": "자가진단 시리즈 ('이런 사람 특징 4가지' → 사주로 보면 OO 기운. 다음 글에서 '내 일간으로 확인하는 법'을 예고)",
    "shinsal": "신살로 보는 나 (도화살·역마살·양인·화개 등 하나를 골라 겁주지 않고 장점 중심으로, 해당 띠·일간을 짚어줌)",
    "season": "이번 달·절기 기운 (지금 절기와 이번 달 기운이 직장인의 컨디션·관계에 주는 영향과 할 일)",
    "today": "오늘의 일진 한마디 (오늘 날짜의 기운으로 직장인이 오늘 해볼 한 가지)",
    "daymaster": "일간별 성향 ('갑목 일간인 사람이 회사에서 유독 지치는 이유' 처럼 한 일간을 콕 집기)",
    "worry": "직장·연애 고민을 사주로 해석 (흔한 고민 한 장면 → 사주로 보면 이런 이유 → 작은 해결 행동)",
    "empathy": "공감형 ('이런 사주는 OO할 때 힘들어요' 체크리스트, 읽는 사람이 '이거 나잖아' 하게)",
    "story": "운영자 이야기 (사주 공부하며 깨달은 것, 상담하며 느낀 것. 지어낸 손님 사례 금지, 일반적인 관찰로)",
    "offer": "상품 소개 (리포트·올해 운세·궁합·고민 상담 중 하나를, 받는 사람 입장의 이득 중심으로. 가격 명시)",
}

PERSONA = """당신은 '운결' 계정의 홍보 글 작가입니다. 운결은 '사주로 보는 커리어·관계 코칭'을 하는 1인 사주 상담 브랜드입니다.
주요 독자: 2030 직장인 여성. 말투: 따뜻하고 똑똑한 언니·선배처럼, 존댓말, 짧은 문장.

꼭 지킬 것:
- 없는 경력·자격·후기·숫자를 지어내지 않습니다. ('20년 경력', '1만 명 상담', 가짜 후기 금지)
- 겁주기·단정 금지 ('올해 큰일 납니다' X). 사주는 '타고난 기운의 지도'라는 관점.
- 건강·투자·법률은 확언하지 않습니다.
- 명리 용어는 쉬운 말 먼저, 괄호에 용어 한 번. 한자는 쓰지 않습니다.
- 매번 다른 첫 문장 패턴을 씁니다. 이모지는 글마다 0~2개."""


def now():
    return datetime.now().isoformat(timespec="seconds")


def today_pillar(d=None):
    s, b = day_ganzhi(d or date.today())
    return {"ko": STEMS_KO[s] + BRANCHES_KO[b], "stem_el": ELEMENTS[STEM_ELEMENT[s]], "branch_el": ELEMENTS[BRANCH_ELEMENT[b]]}


def link_for(public_url, channel):
    return f"{public_url}/?src={channel}"


def _parse_posts(text):
    """AI 답변에서 JSON 배열을 꺼낸다. 코드블록(```json)으로 감싸 와도 처리."""
    m = re.search(r"\[.*\]", text or "", re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except ValueError:
        return []
    return [i for i in items if isinstance(i, dict) and str(i.get("text", "")).strip()]


def _rule_drafts(channel, n, products):
    """AI가 꺼져 있을 때 쓰는 기본 글 (시험·비상용)."""
    tp = today_pillar()
    out = []
    stems = random.sample(list(K.DAY_MASTER.keys()), k=min(n, len(K.DAY_MASTER)))
    for i, dm in enumerate(stems):
        info = K.DAY_MASTER[dm]
        image = info["image"].split("(")[0]
        if i == 0:
            text = (f"오늘 일진은 {tp['ko']}일.\n{tp['stem_el']}과 {tp['branch_el']}의 기운이 함께 들어오는 날이에요.\n\n"
                    "오늘 할 일 목록에서 하나만 골라 끝까지 해보세요.\n작게 끝낸 하나가 오늘의 운을 만듭니다.")
            theme = "today"
        else:
            text = (f"{dm} 일간, 그러니까 '{image}' 기운을 타고난 분들.\n\n잘하는 것: {info['strength']}\n지칠 때: {info['shadow']}\n\n"
                    f"{info['advice']}")
            theme = "daymaster"
        if channel == "instagram":
            text += f"\n\n내 사주 풀이는 프로필 링크에서 신청할 수 있어요.\n\n#사주 #사주풀이 #일간 #직장인고민 #운결\n[카드] {image} 일간의 비밀"
        elif channel == "daangn":
            low = min(p["price"] for p in products.values())
            text += f"\n\n생년월일과 고민을 보내주시면 사주 풀이를 PDF로 보내드려요. ({low:,}원부터)"
        out.append({"theme": theme, "text": text[:CHANNELS[channel]["limit"]]})
    return out


def generate_drafts(channel, n, products, theme=None):
    """후보 n개를 만들어 저장하고 돌려준다."""
    ch = CHANNELS[channel]
    tp = today_pillar()
    product_lines = "\n".join(f"- {p['label']}: {p['price']:,}원 (PDF 약 {p.get('pages', '?')}쪽) — {p['desc']}"
                              for p in products.values() if not p.get("hidden"))
    focus = products.get(theme.split(":", 1)[1]) if theme and theme.startswith("product:") else None
    if focus:
        theme_text = (f"- {theme}: 「{focus['label']}」로 이어지는 시리즈. 이 상품이 다루는 주제({focus['desc']})로 "
                      f"공감·정보 글을 써서 '내 것도 궁금하다'를 만든다. {n}개 중 마지막 1개만 상품을 소개하고 나머지는 팔지 않는다.")
    else:
        theme_text = "\n".join(f"- {k}: {THEMES[k]}" for k in ([theme] if theme in THEMES else list(THEMES)))
    recent = [r["text"][:60] for r in db.all_("SELECT text FROM promo_posts WHERE channel=? ORDER BY id DESC LIMIT 15", channel)]
    ref_text = kv_get("promo_refs", "").strip()
    refs = (f"[반응 좋았던 참고 글 — 구조·리듬·첫 줄 방식만 참고하고, 문장은 절대 베끼지 마세요]\n{ref_text[:4000]}\n\n"
            if ref_text else "")
    prompt = f"""오늘은 {date.today():%Y년 %m월 %d일}, 오늘 일진은 {tp['ko']}일({tp['stem_el']}·{tp['branch_el']} 기운)입니다.

[판매 상품]
{product_lines}
손님은 신청서에 생년월일과 고민을 적고 계좌이체하면, 풀이를 PDF로 이메일로 받습니다.

[채널 규칙]
{ch['guide']}

[글 주제 — 이 중에서 골고루]
{theme_text}

{refs}[최근에 쓴 글의 첫 부분 — 겹치지 않게]
{chr(10).join('- ' + r for r in recent) or '- (없음)'}

{ch['label']}에 올릴 글 후보 {n}개를 만들어 주세요. 상품 소개는 {n}개 중 많아야 1개만.
JSON 배열로만 답하세요: [{{"theme": "주제 키", "text": "글 전체"}}, ...]"""
    text, engine = llm.generate(PERSONA, [{"role": "user", "content": prompt}], 3000)
    items = _parse_posts(text) if text else []
    if not items:
        if text:
            print(f"[홍보] AI 답변을 글 목록으로 읽지 못함 → 기본 글로 대체: {text[:200]}")
        items, engine = _rule_drafts(channel, n, {k: p for k, p in products.items() if not p.get("hidden")}), "rules"
    saved = []
    for it in items[:n]:
        body = str(it["text"]).strip()[: ch["limit"]]
        pid = db.run("INSERT INTO promo_posts(channel,theme,text,status,engine,created_at) VALUES (?,?,?,?,?,?)",
                     channel, (theme if focus else str(it.get("theme") or ""))[:40], body, "draft", engine, now())
        saved.append(get(pid))
    return saved


def get(pid):
    return db.one("SELECT * FROM promo_posts WHERE id=?", pid)


def listing(status):
    return db.all_("SELECT * FROM promo_posts WHERE status=? ORDER BY id DESC LIMIT 100", status)


def update(pid, **fields):
    keys = list(fields)
    db.run(f"UPDATE promo_posts SET {', '.join(k + '=?' for k in keys)} WHERE id=?", *[fields[k] for k in keys], pid)


def channel_stats():
    """채널별 신청 수·입금 확인 금액 — 어디에 힘을 줄지 판단용."""
    rows = db.all_("""SELECT COALESCE(NULLIF(channel,''),'direct') ch, COUNT(*) n,
                      SUM(CASE WHEN status IN ('paid','writing','sent') THEN amount ELSE 0 END) paid
                      FROM orders WHERE status != 'canceled' GROUP BY ch ORDER BY n DESC""")
    return rows


def kv_get(k, default=None):
    r = db.one("SELECT v FROM kv WHERE k=?", k)
    return r["v"] if r else default


def kv_set(k, v):
    db.run("INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v)


# ---------------------------------------------------------------- 스레드 자동화: 매일 아침 글 후보 + 승인한 글 예약 게시
# 게시 시간대(반응 좋은 점심·밤). saju/.env 의 THREADS_POST_TIMES 로 바꿀 수 있음. 시간대 하나에 글 하나.
POST_TIMES = [t.strip() for t in os.environ.get("THREADS_POST_TIMES", "12:30,21:00,22:30").split(",") if t.strip()]
# 평소에는 맥북의 클로드가 아침 7:30에 글을 넣는다(tools/threads_daily.py). 이 시각까지 안 들어왔으면 서버의 AI가 대신 쓴다.
DRAFT_HOUR = int(os.environ.get("THREADS_DRAFT_HOUR", "10"))
DAILY_DRAFTS = 5


STATS_EVERY_H = 6  # 성적 갱신 간격


def refresh_stats(fetch):
    """최근 14일 스레드 글의 성적을 갱신. fetch(post_id) → {views, likes, replies, reposts}."""
    since = (datetime.now() - timedelta(days=14)).isoformat(timespec="seconds")
    stale = (datetime.now() - timedelta(hours=STATS_EVERY_H)).isoformat(timespec="seconds")
    rows = db.all_("""SELECT id, post_id FROM promo_posts WHERE channel='threads' AND status='posted' AND post_id IS NOT NULL
                      AND posted_at >= ? AND (stats_at IS NULL OR stats_at < ?)""", since, stale)
    for r in rows:
        try:
            s = fetch(r["post_id"])
        except Exception as e:  # noqa — 권한이 없거나 일시 오류면 다음에 다시
            print(f"[스레드] 성적 가져오기 실패 #{r['id']}: {e}")
            return
        update(r["id"], views=s.get("views"), likes=s.get("likes"), replies=s.get("replies"), reposts=s.get("reposts"),
               stats_at=now())


def brief_data(products):
    """맥북의 글쓰기 담당(제미나이 분석 → 클로드 작성)에게 넘길 자료."""
    tp = today_pillar()
    posted = db.all_("""SELECT text, theme, views, likes, replies, reposts, posted_at FROM promo_posts
                        WHERE channel='threads' AND status='posted' ORDER BY id DESC LIMIT 40""")
    return {"today": date.today().isoformat(), "day_pillar": tp, "refs": kv_get("promo_refs", ""), "posted": posted,
            "recent_drafts": [r["text"][:80] for r in db.all_(
                "SELECT text FROM promo_posts WHERE channel='threads' ORDER BY id DESC LIMIT 20")],
            "products": {k: {"label": p["label"], "price": p["price"], "pages": p.get("pages"), "desc": p["desc"]}
                         for k, p in products.items() if not p.get("hidden")},
            "themes": THEMES, "channel_rule": CHANNELS["threads"]["guide"], "persona": PERSONA}


def import_drafts(items, engine, channel="threads"):
    """밖(맥북의 클로드)에서 쓴 글 후보를 넣는다. 오늘 자동 후보는 이걸로 대신한 것으로 기록."""
    ch = CHANNELS[channel]
    saved = []
    for it in items[:10]:
        body = str(it.get("text") or "").strip()[: ch["limit"]]
        if body:
            pid = db.run("INSERT INTO promo_posts(channel,theme,text,status,engine,created_at) VALUES (?,?,?,?,?,?)",
                         channel, str(it.get("theme") or "")[:40], body, "draft", engine[:60], now())
            saved.append(get(pid))
    if saved and channel == "threads":
        kv_set("auto_drafts_day", date.today().isoformat())
    return saved


def auto_drafts_on():
    return kv_get("auto_drafts", "0") == "1"


def next_slot(after=None):
    """비어 있는 다음 게시 시간대."""
    after = after or datetime.now()
    taken = {r["scheduled_at"] for r in db.all_("SELECT scheduled_at FROM promo_posts WHERE status='scheduled'")}
    for day in range(0, 30):
        d = (after + timedelta(days=day)).date()
        for t in sorted(POST_TIMES):
            h, m = map(int, t.split(":"))
            slot = datetime(d.year, d.month, d.day, h, m)
            iso = slot.isoformat(timespec="seconds")
            if slot > after + timedelta(minutes=2) and iso not in taken:
                return iso
    return (after + timedelta(hours=1)).isoformat(timespec="seconds")


def schedule(pid, text, when=None):
    update(pid, text=text, status="scheduled", scheduled_at=when or next_slot(), error=None)
    return get(pid)


def start_scheduler(publish, products, stats=None, interval=60):
    """publish(post) → 실제 게시 함수(서버가 넘겨줌). 1분마다 예약 글을 올리고, 아침에 글 후보를 만들고, 성적을 갱신한다."""
    def loop():
        while True:
            try:
                now_ = datetime.now()
                for p in db.all_("SELECT * FROM promo_posts WHERE status='scheduled' AND scheduled_at <= ?",
                                 now_.isoformat(timespec="seconds")):
                    try:
                        publish(p)
                        print(f"[스레드] 예약 글 게시 완료 #{p['id']}")
                    except Exception as e:  # noqa — 실패하면 후보로 되돌리고 이유를 남김 (중복 게시 방지)
                        update(p["id"], status="draft", error=f"예약 게시 실패: {e}")
                        print(f"[스레드] 예약 글 게시 실패 #{p['id']}: {e}")
                if stats:
                    refresh_stats(stats)
                today = now_.date().isoformat()
                if auto_drafts_on() and now_.hour >= DRAFT_HOUR and kv_get("auto_drafts_day") != today:
                    kv_set("auto_drafts_day", today)
                    made = generate_drafts("threads", DAILY_DRAFTS, products)
                    print(f"[스레드] 오늘의 글 후보 {len(made)}개 자동 생성")
            except Exception as e:  # noqa
                print("[스레드] 자동화 오류:", e)
            time.sleep(interval)
    threading.Thread(target=loop, daemon=True).start()
