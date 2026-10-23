#!/bin/bash
# 삼감 모닝 실행기: 이 파일을 더블클릭하면 앱이 브라우저에서 열립니다.
# 창을 닫거나 Ctrl+C를 누르면 앱이 종료됩니다.
cd "$(dirname "$0")"
PORT=8790
echo "삼감 모닝을 시작합니다 → http://127.0.0.1:$PORT"
(sleep 1 && open "http://127.0.0.1:$PORT") &
python3 -m http.server "$PORT" --bind 127.0.0.1
