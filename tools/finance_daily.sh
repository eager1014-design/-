#!/bin/sh
# 매일 지출 자동 정리 (tools/finance_daily.plist 가 부름). 실패하면 맥 알림으로 알려준다.
cd /Users/mac/ai || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M')"
fail=""
out=$(node tools/finance.mjs scan --since 2026-09-01 --yes 2>&1) || fail="메일 읽기"
echo "$out"
# 구글 "테스트" 상태 앱은 7일마다 로그인이 풀린다 → 다시 로그인하라고 알림
if echo "$out" | grep -q "열쇠가 만료\|로그인 안 됨"; then
  osascript -e 'display notification "구글 로그인이 풀렸어요. ai/tools 폴더의 finance_login.command 를 더블클릭 → 허용" with title "사업 지출" sound name "Glass"'
  exit 0
fi
node tools/finance.mjs shots --yes || fail="$fail 스샷 읽기"
if [ -n "$fail" ]; then
  osascript -e "display notification \"$fail 실패 — .tmp/finance/daily.log 확인 (제미나이 하루 한도면 내일 자동으로 이어서 함)\" with title \"사업 지출\""
fi
