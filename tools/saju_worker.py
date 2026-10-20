"""맥북 일꾼: (1) '맥북 챗GPT로 만들기' 주문을 코덱스(챗GPT 구독)로 써서 올리고,
(2) 사이트가 보관함에 넣어둔 메일(PDF·구독·안내)을 사장님 Gmail로 대신 보낸다 (서버는 메일 포트가 막혀 있음).

맥북이 켜져 있는 동안 15초마다 운결 서버에 '맡길 일 있어?'를 묻는다 (launchd 로 항상 실행: tools/saju_worker.plist).
풀이는 서버와 같은 코드(saju/longform.py)로 쓰고, AI만 맥북의 코덱스를 쓴다 → 추가 비용 0원.
코덱스가 실패한 장은 제미나이가 대신 쓴다 (llm.py 순서).

실행:  python3 tools/saju_worker.py          (계속 돌기)
       python3 tools/saju_worker.py --once   (한 번만 확인)
설정: 루트 .env 의 SAJU_URL, SAJU_ADMIN_KEY (tools/threads_daily.py 와 같음)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, ".tmp", "saju_worker.log")
POLL_SEC = 15


def load_env():
    given = set(os.environ)  # 실행할 때 직접 준 값(시험용 주소 등)은 .env 보다 우선
    for path in (os.path.join(ROOT, "saju", ".env"), os.path.join(ROOT, ".env")):  # 루트 .env 가 우선
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if v.strip() and k.strip() not in given:
                        os.environ[k.strip()] = v.strip()
    os.environ["AI_PROVIDERS"] = "codex,gemini"  # 맥북에서는 챗GPT 구독 먼저
    os.environ["AI_DAILY_LIMIT"] = "0"           # 맥북 쪽 하루 상한 계산 안 함
    os.environ.setdefault("SAJU_DB", os.path.join(ROOT, ".tmp", "worker.db"))  # 서버 DB와 섞이지 않게


def log(msg):
    line = f"[{datetime.now():%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def server(method, path, body=None, retries=0):
    """retries: 사이트가 잠깐 없을 때(다시 배포 중 502·503, 연결 끊김) 기다렸다 다시 시도할 횟수."""
    url = os.environ.get("SAJU_URL", "http://localhost:8000").rstrip("/") + path
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", "X-Admin-Key": os.environ.get("SAJU_ADMIN_KEY", "")})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code not in (502, 503, 504) or attempt == retries:
                raise
        except (urllib.error.URLError, OSError):
            if attempt == retries:
                raise
        log(f"사이트가 잠깐 응답 없음 → {15 * (attempt + 1)}초 뒤 다시 ({attempt + 1}/{retries})")
        time.sleep(15 * (attempt + 1))


def work(order):
    import longform
    from server import chart_of_birth  # 서버와 같은 생일 → 사주 계산
    oid = order["id"]
    try:
        server("POST", "/api/admin/jobs/update", {"id": oid, "state": "claim"})
    except urllib.error.HTTPError:
        return  # 이미 다른 곳에서 가져감
    log(f"{order['code']} {order['name']} / {order['product_label']} 쓰기 시작")
    t = time.time()
    try:
        chart = chart_of_birth(order["birth"])
        partner = chart_of_birth(order["partner"]["birth"]) if order.get("partner") else None
        def progress(d, n):
            try:  # 진행 표시는 실패해도 글쓰기는 계속
                server("POST", "/api/admin/jobs/update", {"id": oid, "state": "running", "progress": f"맥북에서 {d}/{n}장"})
            except Exception:  # noqa
                pass
        res = longform.generate(order, chart, partner, progress=progress)
        # 다 쓴 풀이는 꼭 올린다: 사이트가 다시 배포 중이면 최대 약 5분 기다리며 재시도
        server("POST", "/api/admin/jobs/update", {"id": oid, "state": "done", "markdown": res["markdown"], "engine": res["engine"]}, retries=6)
        log(f"{order['code']} 완료 ({len(res['markdown']):,}자, {time.time() - t:.0f}초, {res['engine']})")
    except Exception as e:  # noqa — 실패하면 관리 화면에 이유를 남겨 다시 누를 수 있게
        log(f"{order['code']} 실패: {e}")
        try:
            server("POST", "/api/admin/jobs/update", {"id": oid, "state": "error", "error": str(e)[:150]})
        except Exception:  # noqa
            pass


_mail_warned = False


def send_outbox():
    """보관함 메일을 Gmail(SMTP)로 보낸다. 맥북에 Gmail 앱 비밀번호(saju/.env 의 SMTP_*)가 있어야 함."""
    global _mail_warned
    import base64
    import mailer
    if mailer.MODE != "smtp":
        if not _mail_warned:
            log("메일 보관함: Gmail 앱 비밀번호(SMTP_*)가 맥북에 없어서 아직 못 보냄")
            _mail_warned = True
        return
    for m in server("GET", "/api/admin/outbox")["mails"]:
        files = [(f["name"], base64.b64decode(f["data"]), f["type"]) for f in m.get("files") or []]
        ok = mailer.send(m["to_addr"], m["subject"], m["body"], attachments=files)
        # 보낸 기록을 꼭 남긴다 (못 남기면 같은 메일을 두 번 보낼 수 있음)
        server("POST", "/api/admin/outbox/done", {"id": m["id"], "ok": ok, "error": "" if ok else "Gmail 발송 실패 (맥북 로그 확인)"}, retries=6)
        log(f"메일 {'보냄' if ok else '실패'}: {m['to_addr']} / {m['subject']}")


def main():
    load_env()
    sys.path.insert(0, os.path.join(ROOT, "saju"))
    once = "--once" in sys.argv
    log(f"맥북 일꾼 시작 → {os.environ.get('SAJU_URL')}")
    failing = False
    while True:
        try:
            for job in server("GET", "/api/admin/jobs")["jobs"]:
                work(job)
            send_outbox()
            if failing:
                log("서버 연결 다시 됨")
            failing = False
        except (urllib.error.URLError, OSError, ValueError) as e:
            if not failing:  # 인터넷이 끊긴 동안 같은 기록이 쌓이지 않게 처음 한 번만
                log(f"서버 확인 실패 (계속 다시 시도): {e}")
            failing = True
        if once:
            return 0
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    sys.exit(main())
