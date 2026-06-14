FROM python:3.12-slim

WORKDIR /app
COPY backend/ ./backend/
COPY data/ ./data/
COPY frontend/dist/ ./backend/static/

RUN pip install --no-cache-dir -r backend/requirements.txt

ENV PYTHONPATH=/app
EXPOSE 8080
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8080"]
