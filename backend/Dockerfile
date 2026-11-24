FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BIDMANAGER_HEADLESS=true \
    PORT=8080

WORKDIR /app

# This legacy backend is intentionally not deployable. The maintained backend,
# including /admin and /client boundaries, lives in Server UI/server/.
RUN echo "ERROR: backend/ is disabled; build Server UI/server/ instead." >&2 && exit 1

RUN apt-get update \
    && apt-get install -y --no-install-recommends firefox-esr ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

CMD ["sh", "-c", "uvicorn api_server:app --host 0.0.0.0 --port ${PORT}"]
