"""이메일 발송 (표준 smtplib).

SMTP_HOST / SMTP_USER / SMTP_PASS 가 설정되어 있으면 실제로 보내고,
없으면 '모의 모드'로 서버 로그에 내용을 출력한다(결제 mock 과 같은 방식).
예) Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=주소, SMTP_PASS=앱 비밀번호
"""
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
MODE = "smtp" if HOST and USER and PASS else "mock"


def send(to, subject, text):
    """성공 여부(bool). 실패해도 예외를 밖으로 던지지 않는다."""
    if MODE == "mock":
        public = os.environ.get("PUBLIC_URL", "http://localhost").split("//")[-1].split(":")[0].split("/")[0] not in ("localhost", "127.0.0.1")
        # 공개 서버 로그에 비밀번호 재설정 링크가 남으면 위험하므로 본문은 내 컴퓨터에서만 출력
        print(f"\n[메일 모의 발송] 받는 사람: {to}\n제목: {subject}\n" + ("(공개 서버라 본문 생략)" if public else text) + "\n")
        return True
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr(("운결", FROM))
    msg["To"] = to
    msg.set_content(text)
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
