#!/bin/sh
# 더블클릭하면 지출 관리용 구글 로그인을 다시 한다 (7일마다 풀림). 브라우저에서 '허용'만 누르면 끝.
cd /Users/mac/ai && node tools/finance.mjs login
echo "\n이 창은 닫으셔도 됩니다."
