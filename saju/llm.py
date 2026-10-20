"""여러 AI(코덱스=챗GPT 구독·Claude·제미나이·챗GPT API)를 순서대로 시도하는 연결 모듈.

AI_PROVIDERS 에 적힌 순서대로 시도하고, 키가 없거나 오류가 나면 다음 AI로 넘어간다.
모두 실패하면 (None, None) 을 돌려주고, 호출한 쪽에서 규칙 기반 풀이로 대체한다.
외부 패키지 없이 urllib 로 직접 호출한다.
"""
import json
import os
import subprocess
import threading
import urllib.error
import urllib.request
from datetime import date

# 한 AI를 기다리는 최대 시간(초). 넘으면 다음 AI로 넘어간다.
TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "150"))


def _post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers=dict(headers, **{"content-type": "application/json"}))
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None


def _claude(system, messages, max_tokens):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    data = _post("https://api.anthropic.com/v1/messages",
                 {"x-api-key": key, "anthropic-version": "2023-06-01"},
                 {"model": PROVIDERS["claude"]["model"](), "max_tokens": max_tokens,
                  "system": system, "messages": messages})
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


def _gemini(system, messages, max_tokens):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                for m in messages]
    model = PROVIDERS["gemini"]["model"]()
    data = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                 {"x-goog-api-key": key},
                 {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                  "generationConfig": _gemini_config(model, max_tokens)})
    cands = data.get("candidates") or []
    if not cands:
        raise RuntimeError(f"빈 응답: {json.dumps(data.get('promptFeedback', data), ensure_ascii=False)[:300]}")
    return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []) if not p.get("thought"))


def _gemini_config(model, max_tokens):
    """제미나이 3 이후 모델은 답하기 전 '생각'이 길어 느리다 → 생각을 짧게(low) 해서 속도를 확보."""
    cfg = {"maxOutputTokens": max_tokens}
    if model.startswith("gemini-") and not model.startswith(("gemini-1", "gemini-2")):
        cfg["thinkingConfig"] = {"thinkingLevel": os.environ.get("GEMINI_THINKING", "low")}
    return cfg


def _openai(system, messages, max_tokens):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    data = _post("https://api.openai.com/v1/responses", {"Authorization": f"Bearer {key}"},
                 {"model": PROVIDERS["openai"]["model"](), "instructions": system,
                  "input": [{"role": m["role"], "content": m["content"]} for m in messages],
                  "max_output_tokens": max_tokens})
    parts = []
    for item in data.get("output", []):
        if item.get("type") == "message":
            parts += [c.get("text", "") for c in item.get("content", []) if c.get("type") == "output_text"]
    return "".join(parts)


CODEX = os.environ.get("CODEX_BIN", os.path.expanduser("~/.local/bin/codex"))


def _codex(system, messages, max_tokens):
    """사장님 챗GPT 구독(코덱스 CLI)으로 쓰기 — 추가 비용 없음. 코덱스가 설치·로그인된 맥북에서만 동작."""

    import tempfile
    convo = "\n\n".join(("[이전 답변]\n" if m["role"] == "assistant" else "") + m["content"] for m in messages)
    prompt = (f"{system}\n\n---\n{convo}\n\n---\n위 요청에 대한 최종 답변 본문만 출력하세요. "
              "파일을 만들거나 명령을 실행하지 말고, 설명·인사말 없이 답변만.")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "answer.txt")
        args = [CODEX, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o", out]
        if os.environ.get("CODEX_MODEL"):
            args += ["-m", os.environ["CODEX_MODEL"]]
        r = subprocess.run(args + ["-"], input=prompt, capture_output=True, text=True, timeout=TIMEOUT, cwd=tmp)
        if r.returncode != 0 or not os.path.exists(out):
            raise RuntimeError(f"코덱스 실패: {(r.stderr or r.stdout)[-300:]}")
        return open(out, encoding="utf-8").read()


PROVIDERS = {
    "codex": {"call": _codex, "ready": lambda: os.path.exists(CODEX),
              "model": lambda: os.environ.get("CODEX_MODEL", "챗GPT구독")},
    "claude": {"call": _claude, "key": "ANTHROPIC_API_KEY",
               "model": lambda: os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")},
    "gemini": {"call": _gemini, "key": "GEMINI_API_KEY",
               "model": lambda: os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")},
    "openai": {"call": _openai, "key": "OPENAI_API_KEY",
               "model": lambda: os.environ.get("OPENAI_MODEL", "gpt-6.1-sol")},
}


def order():
    names = [n.strip().lower() for n in os.environ.get("AI_PROVIDERS", "claude,gemini,openai").split(",")]
    return [n for n in names if n in PROVIDERS]


def available():
    """키가 설정된 AI 이름을 시도 순서대로. 예: ['gemini', 'openai']"""
    return [n for n in order() if (PROVIDERS[n]["ready"]() if "ready" in PROVIDERS[n] else os.environ.get(PROVIDERS[n]["key"]))]


def label(name):
    return f"{name}:{PROVIDERS[name]['model']()}" if name in PROVIDERS else name


# 하루 AI 호출 상한(비용 안전장치). 넘으면 AI 대신 규칙 기반 풀이로 대체된다. 0이면 제한 없음.
DAILY_LIMIT = int(os.environ.get("AI_DAILY_LIMIT", "150"))
_usage_lock = threading.Lock()


def _take_quota():
    """오늘 사용량을 1 늘리고, 상한 안이면 True."""
    if DAILY_LIMIT <= 0:
        return True
    import db  # llm.py 를 다른 곳에서 단독으로 쓸 때 DB 의존을 피하려고 여기서 import
    today = date.today().isoformat()
    with _usage_lock:
        c = db.conn()
        c.execute("CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL)")
        row = c.execute("SELECT calls FROM ai_usage WHERE day=?", (today,)).fetchone()
        used = row[0] if row else 0
        if used >= DAILY_LIMIT:
            return False
        c.execute("INSERT INTO ai_usage(day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls=calls+1", (today,))
        c.commit()
        if used + 1 in (int(DAILY_LIMIT * 0.8), DAILY_LIMIT):
            print(f"[llm] ⚠️ 오늘 AI 사용 {used + 1}/{DAILY_LIMIT}회")
        return True


def generate(system, messages, max_tokens=3000):
    """(text, engine) — engine 은 실제로 답한 AI 예: 'gemini:gemini-3.8-flash'. 모두 실패하면 (None, None)."""
    if available() and not _take_quota():
        print(f"[llm] 오늘 AI 사용 상한({DAILY_LIMIT}회) 도달 → 기본 풀이로 대체")
        return None, None
    for name in available():
        try:
            # 생각하는 모델은 생각에도 토큰을 쓰므로 여유를 둔다.
            text = PROVIDERS[name]["call"](system, messages, max_tokens * 2)
            if text and text.strip():
                return text.strip(), label(name)
            print(f"[llm] {name}: 빈 답변 → 다음 AI 시도")
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            print(f"[llm] {name} 실패 → 다음 AI 시도: {e}")
    return None, None
