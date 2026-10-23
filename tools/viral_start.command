#!/bin/sh
# 더블클릭하면 떡상 소싱 앱이 브라우저에서 열린다. 앱은 맥북이 켜질 때 자동으로 켜져 있음(tools/viral_app.plist).
# 혹시 꺼져 있으면 여기서 켠다.
cd /Users/mac/ai
if ! curl -s -o /dev/null http://localhost:4600/api/status; then
  (sleep 1.5 && open http://localhost:4600) &
  node tools/viral/server.mjs
else
  open http://localhost:4600
fi
