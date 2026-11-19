FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN pip install --no-cache-dir uv==0.11.29
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
COPY --from=frontend /build/dist /app/frontend/dist
RUN groupadd --system --gid 10001 adrobot \
    && useradd --system --uid 10001 --gid 10001 --create-home adrobot \
    && mkdir /data && chown adrobot:adrobot /data
USER 10001:10001
ENV DATABASE_URL=sqlite:////data/adrobot.db
EXPOSE 8765
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 \
    CMD [".venv/bin/python", "-c", "import json, urllib.request; h = json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=2)); assert h['status'] == 'ok' and h['configured']"]
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && exec .venv/bin/uvicorn adrobot.app:create_app --factory --host 0.0.0.0 --port 8765 --workers 1"]
