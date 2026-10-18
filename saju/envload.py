"""saju/.env 를 읽어 환경변수로 등록한다(표준 라이브러리만 사용).

다른 모듈이 import 시점에 환경변수를 읽으므로, server.py 에서 가장 먼저 import 해야 한다.
이미 셸에서 지정한 환경변수가 있으면 그 값을 우선한다.
"""
import os

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def load(path=ENV_PATH):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


load()
