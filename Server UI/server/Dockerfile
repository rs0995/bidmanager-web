FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BIDMANAGER_ENV=production \
    BIDMANAGER_HEADLESS=true \
    BIDMANAGER_BROWSER=chromium \
    BIDMANAGER_RUNTIME_DIR=/tmp/bidmanager \
    WDM_LOCAL=1 \
    PORT=8080

WORKDIR /app

# firefox-esr is intentionally left unpinned: Debian's apt mirror only ever
# carries the current point release for a package, so pinning an exact version
# string here would break the next rebuild once Debian rotates it out. The ESR
# channel itself is the stability guarantee. geckodriver, below, is pinned
# instead (GitHub releases keep every version downloadable indefinitely) and
# must be kept in sync with GECKODRIVER_VERSION in app_core.py.
RUN apt-get update \
    && apt-get install -y --no-install-recommends firefox-esr chromium chromium-driver ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from webdriver_manager.firefox import GeckoDriverManager; GeckoDriverManager(version='v0.37.1').install()"

COPY . ./

RUN mkdir -p /tmp/bidmanager && chmod 1777 /tmp/bidmanager

CMD ["sh", "-c", "uvicorn api_server:app --host 0.0.0.0 --port ${PORT} --workers 1"]
