"""매일 아침 스레드 글 후보 만들기 (맥북에서 실행) — 제미나이가 분석하고, 클로드가 쓴다.

순서:
  1) 운결 서버에서 자료 받기: 참고 인기 글, 우리 글 성적(조회·좋아요·댓글), 최근 후보, 상품 목록
  2) 제미나이: 어떤 글이 왜 반응이 좋았는지 분석 → '오늘의 글쓰기 메모'
  3) 클로드(이 맥북의 Claude Code 구독, `claude -p`): 메모를 보고 글 5개 작성 — 추가 API 비용 없음
  4) 서버의 홍보 센터에 후보로 넣기 → 사장님이 골라서 예약

실행:  python3 tools/threads_daily.py            (매일 7:30 자동 실행은 tools/threads_daily.plist)
       python3 tools/threads_daily.py --dry-run  (서버에 넣지 않고 화면에만 출력)
설정 (/Users/mac/ai/.env):
  SAJU_URL        운결 서버 주소 (배포 전: http://localhost:8000)
  SAJU_ADMIN_KEY  서버 saju/.env 의 ADMIN_API_KEY 와 같은 값
  GEMINI_API_KEY  (없으면 saju/.env 에서 읽음)
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, ".tmp", "threads_daily.log")
CLAUDE = os.path.expanduser("~/.local/bin/claude")


def load_env():
    for path in (os.path.join(ROOT, "saju", ".env"), os.path.join(ROOT, ".env")):  # 루트 .env 가 우선
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if v.strip():
                        os.environ[k.strip()] = v.strip()


def log(msg):
    line = f"[{datetime.now():%m-%d %H:%M}] {msg}"
    print(line)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def server(method, path, body=None):
    url = os.environ.get("SAJU_URL", "http://localhost:8000").rstrip("/") + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Admin-Key": os.environ.get("SAJU_ADMIN_KEY", "")})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def gemini(prompt):
    """제미나이 한 번 호출 (분석 담당). saju/llm.py 와 같은 방식."""
    sys.path.insert(0, os.path.join(ROOT, "saju"))
    os.environ["AI_PROVIDERS"] = "gemini"
    os.environ["AI_DAILY_LIMIT"] = "0"  # 서버 DB의 하루 상한 계산을 건드리지 않음
    import llm
    text, _ = llm.generate("당신은 SNS 콘텐츠 분석가입니다. 근거 있는 관찰만 짧고 구체적으로 씁니다.",
                           [{"role": "user", "content": prompt}], 2500)
    return text


def analysis_prompt(d):
    posted = [p for p in d["posted"] if p.get("views") is not None]
    posted.sort(key=lambda p: (p.get("likes") or 0) + 3 * (p.get("replies") or 0), reverse=True)
    ours = "\n\n".join(f"(조회 {p['views']} · 좋아요 {p['likes']} · 댓글 {p['replies']})\n{p['text']}" for p in posted[:12])
    return f"""사주 상담 브랜드 '운결'의 스레드 글을 분석해 주세요.

[다른 계정의 반응 좋은 사주 글 — 사장님이 모은 것]
{d['refs'][:6000] or '(아직 없음)'}

[우리 계정 글과 성적 — 좋아요+댓글 순]
{ours or '(아직 성적 자료 없음)'}

아래 형식으로 '오늘의 글쓰기 메모'를 써 주세요. 근거가 없는 항목은 '자료 부족'이라고 쓰세요.
1. 반응 좋은 첫 줄 패턴 3가지 (예시 포함)
2. 반응 좋은 주제 3가지, 반응 나쁜 주제
3. 적당한 길이·줄바꿈·말투
4. 댓글을 부른 마지막 줄 방식
5. 오늘 써볼 글 아이디어 5개 (한 줄씩)"""


def writing_prompt(d, memo):
    products = "\n".join(f"- {k}: {p['label']} {p['price']:,}원 (PDF 약 {p['pages']}쪽) — {p['desc']}" for k, p in d["products"].items())
    themes = "\n".join(f"- {k}: {v}" for k, v in d["themes"].items())
    recent = "\n".join("- " + t for t in d["recent_drafts"]) or "- (없음)"
    return f"""{d['persona']}

오늘은 {d['today']}, 일진은 {d['day_pillar']['ko']}일({d['day_pillar']['stem_el']}·{d['day_pillar']['branch_el']} 기운)입니다.

[스레드 규칙]
{d['channel_rule']}

[판매 상품 — 본문에서 팔지 말 것. 5개 중 많아야 1개만 상품 이야기]
{products}

[주제 목록]
{themes}

[분석가(제미나이)의 오늘의 글쓰기 메모]
{memo or '(분석 없음 — 위 규칙대로)'}

[최근 후보 첫 부분 — 겹치지 않게]
{recent}

스레드 글 5개를 써 주세요. 각 글은 500자 이내.
다른 말 없이 JSON 배열만 출력하세요: [{{"theme": "주제 키", "text": "글 전체"}}, ...]"""


def claude(prompt):
    """이 맥북의 Claude Code 구독으로 글쓰기 (도구 사용 없이 답만)."""
    r = subprocess.run([CLAUDE, "-p", prompt, "--output-format", "json", "--tools", ""],
                       capture_output=True, text=True, timeout=600, cwd=os.path.join(ROOT, ".tmp"))
    if r.returncode != 0:
        raise RuntimeError(f"claude 실행 실패: {(r.stderr or r.stdout)[:300]}")
    out = json.loads(r.stdout)
    if out.get("is_error"):
        raise RuntimeError(f"claude 오류: {str(out.get('result'))[:300]}")
    return out.get("result", "")


def parse_posts(text):
    m = re.search(r"\[.*\]", text or "", re.S)
    items = json.loads(m.group(0)) if m else []
    return [i for i in items if isinstance(i, dict) and str(i.get("text", "")).strip()]


def main():
    load_env()
    dry = "--dry-run" in sys.argv
    try:
        d = server("GET", "/api/admin/promo/brief")
    except (urllib.error.URLError, OSError) as e:
        log(f"서버 연결 실패 ({os.environ.get('SAJU_URL')}): {e} — 오늘은 서버의 AI가 10시에 대신 씀")
        return 1
    memo = None
    try:
        memo = gemini(analysis_prompt(d))
        log(f"제미나이 분석 완료 ({len(memo or '')}자)")
    except Exception as e:  # noqa — 분석이 없어도 글은 쓴다
        log(f"제미나이 분석 실패, 분석 없이 진행: {e}")
    try:
        posts = parse_posts(claude(writing_prompt(d, memo)))
    except Exception as e:  # noqa
        log(f"클로드 글쓰기 실패: {e} — 오늘은 서버의 AI가 10시에 대신 씀")
        return 1
    posts = [p for p in posts if len(p["text"]) <= 500]
    if dry:
        print("\n\n---- 제미나이 메모 ----\n" + (memo or "(없음)"))
        for i, p in enumerate(posts, 1):
            print(f"\n---- 글 {i} [{p.get('theme')}] {len(p['text'])}자 ----\n{p['text']}")
        return 0
    r = server("POST", "/api/admin/promo/import", {"posts": posts, "engine": "claude(맥북)+gemini 분석"})
    log(f"글 후보 {r.get('count')}개 넣음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
