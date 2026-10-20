"""이메일 발송 (표준 smtplib).

세 가지 방식 (MODE):
  smtp  : SMTP_HOST / SMTP_USER / SMTP_PASS 가 있으면 직접 보낸다 (맥북에서 Gmail 앱 비밀번호로)
  relay : 인터넷 서버(Railway Hobby)는 메일 포트가 막혀 있어서, 보낼 메일을 DB 보관함(outbox)에 넣고
          맥북 일꾼(tools/saju_worker.py)이 가져가 사장님 Gmail로 대신 보낸다. 공개 주소 + SMTP 없음이면 자동.
  mock  : 내 컴퓨터 시험용. 서버 로그에만 출력
예) Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=주소, SMTP_PASS=앱 비밀번호
"""
import base64
import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

HOST = os.environ.get("SMTP_HOST", "")
PORT = int(os.environ.get("SMTP_PORT", "587"))
USER = os.environ.get("SMTP_USER", "")
PASS = os.environ.get("SMTP_PASS", "")
FROM = os.environ.get("SMTP_FROM", USER)
_PUBLIC = os.environ.get("PUBLIC_URL", "http://localhost").split("//")[-1].split(":")[0].split("/")[0] not in ("localhost", "127.0.0.1")
MODE = "smtp" if HOST and USER and PASS else ("relay" if _PUBLIC or os.environ.get("MAIL_RELAY") == "1" else "mock")
# 안전장치: 시험용 DB(.tmp 안)로 켠 서버는 진짜 메일을 절대 보내지 않는다 (2026-10-20 시험 메일이 실제로 나간 일 이후).
# 진짜로 보내야 하는 곳(맥북 일꾼)은 MAIL_MODE=smtp 로 명시한다.
_TESTING = "/.tmp/" in os.path.abspath(os.environ.get("SAJU_DB", "")) + "/"
if os.environ.get("MAIL_MODE") in ("smtp", "relay", "mock"):
    MODE = os.environ["MAIL_MODE"]
elif _TESTING and MODE == "smtp":
    MODE = "relay" if os.environ.get("MAIL_RELAY") == "1" else "mock"


def queue(to, subject, text, attachments=None):
    """맥북이 대신 보내도록 보관함에 넣는다."""
    import db  # 맥북 일꾼처럼 DB 없이 mailer 만 쓰는 곳에서도 불러올 수 있게
    files = [{"name": n, "type": t, "data": base64.b64encode(d).decode()} for n, d, t in attachments or []]
    db.run("INSERT INTO outbox(to_addr,subject,body,files,created_at) VALUES (?,?,?,?,datetime('now','localtime'))",
           to, subject, text, json.dumps(files, ensure_ascii=False))
    print(f"[메일] 맥북 발송 대기: {to} / {subject}")
    return True


def send(to, subject, text, attachments=None):
    """성공 여부(bool). 실패해도 예외를 밖으로 던지지 않는다.
    attachments: [(파일이름, 바이트, "application/pdf"), ...]"""
    if MODE == "relay":
        return queue(to, subject, text, attachments)
    if MODE == "mock":
        public = _PUBLIC
        # 공개 서버 로그에 비밀번호 재설정 링크가 남으면 위험하므로 본문은 내 컴퓨터에서만 출력
        files = "".join(f"\n첨부: {name} ({len(data):,}바이트)" for name, data, _ in attachments or [])
        print(f"\n[메일 모의 발송] 받는 사람: {to}\n제목: {subject}\n" + ("(공개 서버라 본문 생략)" if public else text) + files + "\n")
        return True
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("운결", FROM))
    msg["To"] = to
    msg.set_content(text)
    for name, data, ctype in attachments or []:
        maintype, subtype = ctype.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    try:
        if PORT == 465:
            with smtplib.SMTP_SSL(HOST, PORT, context=ssl.create_default_context(), timeout=20) as s:
                s.login(USER, PASS)
                s.send_message(msg)
        else:
            with smtplib.SMTP(HOST, PORT, timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(USER, PASS)
                s.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as e:
        print(f"[메일] 발송 실패 ({to}): {e}")
        return False
