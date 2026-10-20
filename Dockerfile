# 운결 사주 서비스 — 클라우드 서버(Railway 등) 배포용
# 외부 패키지는 PDF용 reportlab 하나뿐 (saju/requirements.txt).
FROM python:3.12-slim

# TZ=KST-9: 한국 시간(UTC+9). '오늘의 운'·체험 종료 시각이 한국 날짜 기준으로 계산되게 함
# SAJU_DB: 서버 저장 공간(Volume)을 /data 에 연결해야 재배포해도 회원 정보가 유지됨
ENV PYTHONUNBUFFERED=1 \
    TZ=KST-9 \
    SAJU_DB=/data/saju.db \
    TRUST_PROXY=1

WORKDIR /app
COPY saju/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt
COPY saju/ /app/
RUN mkdir -p /data

CMD ["python3", "server.py"]
