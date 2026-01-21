FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed (audio libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tutor.py .

# Run the worker
CMD ["python", "tutor.py", "dev"]
