FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only the files needed for /gemini
COPY draw_server.py .
COPY draw_subagent.py .
COPY p5js/ ./p5js/

EXPOSE 5001

CMD ["uvicorn", "draw_server:app", "--host", "0.0.0.0", "--port", "5001"]
