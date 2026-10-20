"""메타 공식 스레드(Threads) API로 글 올리기.

필요한 설정 (saju/.env):
  THREADS_ACCESS_TOKEN  메타 개발자 앱에서 발급한 '장기 토큰'(60일). 처음 한 번만 넣으면,
                        이후에는 서버가 만료 전에 스스로 연장해서 DB(kv 표)에 보관한다.
흐름: 글 상자 만들기(container) → 게시(publish) → 같은 방식으로 첫 댓글(신청서 링크) 달기.
문서: https://developers.facebook.com/docs/threads/posts
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import promo

API = os.environ.get("THREADS_API", "https://graph.threads.net/v1.0")  # 시험 때만 가짜 서버로 바꿈
REFRESH_BEFORE_DAYS = 10  # 만료 10일 전부터 연장


class ThreadsError(Exception):
    pass


def _call(method, path, params):
    url = f"{API}/{path}" if not path.startswith("http") else path
    data = urllib.parse.urlencode(params).encode()
    if method == "GET":
        req = urllib.request.Request(url + "?" + data.decode())
    else:
        req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", "")
        except ValueError:
            msg = ""
        raise ThreadsError(f"스레드 응답 오류 {e.code}: {msg or '알 수 없는 오류'}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ThreadsError(f"스레드에 연결하지 못했습니다: {e}") from None


def token():
    return promo.kv_get("threads_token") or os.environ.get("THREADS_ACCESS_TOKEN", "").strip()


def configured():
    return bool(token())


def refresh_if_needed():
    """장기 토큰은 60일짜리. 만료가 가까우면 새 토큰으로 바꿔 DB에 저장."""
    tok = token()
    if not tok:
        return
    exp = promo.kv_get("threads_token_expires")
    if exp and datetime.fromisoformat(exp) - datetime.now() > timedelta(days=REFRESH_BEFORE_DAYS):
        return
    try:
        r = _call("GET", API.rsplit("/", 1)[0] + "/refresh_access_token",
                  {"grant_type": "th_refresh_token", "access_token": tok})
    except ThreadsError as e:
        print(f"[스레드] 토큰 연장 실패: {e}")
        return
    promo.kv_set("threads_token", r["access_token"])
    promo.kv_set("threads_token_expires",
                 (datetime.now() + timedelta(seconds=int(r.get("expires_in", 5_184_000)))).isoformat(timespec="seconds"))
    print("[스레드] 토큰 연장 완료")


def me():
    """연결된 스레드 계정 이름. 설정이 없거나 잘못되면 ThreadsError."""
    if not configured():
        raise ThreadsError("스레드 토큰(THREADS_ACCESS_TOKEN)이 아직 설정되지 않았습니다.")
    return _call("GET", "me", {"fields": "id,username", "access_token": token()})


def insights(post_id):
    """게시물 성적 {views, likes, replies, reposts}. threads_manage_insights 권한이 필요."""
    r = _call("GET", f"{post_id}/insights", {"metric": "views,likes,replies,reposts", "access_token": token()})
    out = {}
    for m in r.get("data", []):
        vals = m.get("values") or [{}]
        out[m["name"]] = (m.get("total_value") or {}).get("value", vals[0].get("value", 0))
    return out


def _publish(text, reply_to=None):
    params = {"media_type": "TEXT", "text": text, "access_token": token()}
    if reply_to:
        params["reply_to_id"] = reply_to
    cid = _call("POST", "me/threads", params)["id"]
    # 글 상자가 준비될 때까지 잠깐 기다렸다가 게시 (준비 전이면 몇 번 다시 시도)
    for attempt in range(4):
        time.sleep(2 + attempt * 3)
        try:
            return _call("POST", "me/threads_publish", {"creation_id": cid, "access_token": token()})["id"]
        except ThreadsError as e:
            if attempt == 3:
                raise
            print(f"[스레드] 게시 대기 중… ({e})")


def post(text, link_comment=None):
    """본문을 올리고, link_comment 가 있으면 첫 댓글로 단다. (게시물 번호, 주소) 반환."""
    if not configured():
        raise ThreadsError("스레드 연결(THREADS_ACCESS_TOKEN)이 아직 없습니다. 연결 전에는 '복사'해서 직접 올려 주세요.")
    if len(text) > 500:
        raise ThreadsError(f"스레드 글은 500자까지입니다. 지금 {len(text)}자예요.")
    refresh_if_needed()
    pid = _publish(text)
    if link_comment:
        try:
            _publish(link_comment, reply_to=pid)
        except ThreadsError as e:  # 본문은 이미 올라갔으므로 실패를 알리기만 함
            print(f"[스레드] 링크 댓글 실패(본문은 게시됨): {e}")
    try:
        permalink = _call("GET", pid, {"fields": "permalink", "access_token": token()}).get("permalink")
    except ThreadsError:
        permalink = None
    return pid, permalink
