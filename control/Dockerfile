FROM python:3.13-slim

WORKDIR /app
COPY control/pyproject.toml /app/pyproject.toml
COPY control/app /app/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir .

EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
