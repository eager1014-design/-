#!/bin/bash
# 운결 지인 테스트 시작 — 이 맥북을 클라우드플레어 임시 주소로 잠깐 인터넷에 연다(무료).
# 멈추기: 이 창에서 Ctrl+C (터널·서버가 함께 꺼짐)
# 주의: 테스트 동안 맥북 전원을 연결하고 덮개를 열어두세요. 실행할 때마다 주소가 바뀝니다.
set -uo pipefail
cd "$(dirname "$0")"

CF="$HOME/.local/bin/cloudflared"
PORT=8770
LOG="../.tmp/tunnel.log"
INVITE="$(grep '^FRIEND_INVITE_CODE=' .env 2>/dev/null | cut -d= -f2)"

[ -x "$CF" ] || { echo "cloudflared 가 없습니다 ($CF)."; exit 1; }
[ -n "$INVITE" ] || { echo "saju/.env 에 FRIEND_INVITE_CODE 가 없습니다."; exit 1; }
if lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "이미 실행 중입니다(포트 $PORT)."; exit 1; fi

mkdir -p ../.tmp data
"$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null; echo; echo "지인 테스트를 종료했습니다."' EXIT

echo "임시 주소를 만드는 중…"
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "임시 주소를 만들지 못했습니다. $LOG 를 확인하세요."; exit 1; }

cat <<MSG

==========================================================
  운결 지인 테스트가 열렸습니다
  주소      : $URL
  초대 코드 : $INVITE
  (멈추려면 Ctrl+C)
==========================================================

MSG

# -is: 테스트하는 동안 맥북이 잠들지 않게 함
PUBLIC_URL="$URL" PORT=$PORT INVITE_CODE="$INVITE" ALLOW_MOCK_BILLING=1 TRUST_PROXY=1 \
AI_DAILY_LIMIT=150 SAJU_DB=data/friends.db PYTHONUNBUFFERED=1 \
  caffeinate -is python3 server.py
