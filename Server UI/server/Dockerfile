FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BIDMANAGER_ENV=production \
    BIDMANAGER_HEADLESS=true \
    BIDMANAGER_BROWSER=firefox \
    BIDMANAGER_RUNTIME_DIR=/tmp/bidmanager \
    WDM_LOCAL=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends firefox-esr chromium chromium-driver ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from webdriver_manager.firefox import GeckoDriverManager; GeckoDriverManager().install()"

COPY . ./

RUN mkdir -p /tmp/bidmanager && chmod 1777 /tmp/bidmanager

CMD ["sh", "-c", "uvicorn api_server:app --host 0.0.0.0 --port ${PORT} --workers 1"]
