FROM node:22-slim AS frontend

WORKDIR /src
COPY frontend/package*.json ./frontend/
WORKDIR /src/frontend
RUN npm ci
COPY frontend ./
COPY backend/app/static ../backend/app/static
RUN npm run build

FROM python:3.13-slim

WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY --from=frontend /src/backend/app/static ./app/static
RUN pip install --no-cache-dir .

EXPOSE 8080
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
