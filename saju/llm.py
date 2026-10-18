"""여러 AI(Claude·제미나이·챗GPT)를 순서대로 시도하는 연결 모듈.

AI_PROVIDERS 에 적힌 순서대로 시도하고, 키가 없거나 오류가 나면 다음 AI로 넘어간다.
모두 실패하면 (None, None) 을 돌려주고, 호출한 쪽에서 규칙 기반 풀이로 대체한다.
외부 패키지 없이 urllib 로 직접 호출한다.
"""
import json
import os
import urllib.error
import urllib.request

TIMEOUT = 120


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
                  "generationConfig": {"maxOutputTokens": max_tokens}})
    cands = data.get("candidates") or []
    if not cands:
        raise RuntimeError(f"빈 응답: {json.dumps(data.get('promptFeedback', data), ensure_ascii=False)[:300]}")
    return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []) if not p.get("thought"))


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


PROVIDERS = {
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
    return [n for n in order() if os.environ.get(PROVIDERS[n]["key"])]


def label(name):
    return f"{name}:{PROVIDERS[name]['model']()}" if name in PROVIDERS else name


def generate(system, messages, max_tokens=3000):
    """(text, engine) — engine 은 실제로 답한 AI 예: 'gemini:gemini-3.8-flash'. 모두 실패하면 (None, None)."""
    for name in available():
        try:
            # 생각하는 모델은 생각에도 토큰을 쓰므로 여유를 둔다.
            text = PROVIDERS[name]["call"](system, messages, max_tokens * 2)
            if text and text.strip():
                return text.strip(), label(name)
            print(f"[llm] {name}: 빈 답변 → 다음 AI 시도")
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError, OSError) as e:
            print(f"[llm] {name} 실패 → 다음 AI 시도: {e}")
    return None, None
