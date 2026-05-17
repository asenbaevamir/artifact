# MindAR Microservice

A production-ready Node.js microservice that compiles images into MindAR `.mind` AR target files. Built with Express + TypeScript, BullMQ async queue, MinIO/S3 storage, and full Docker support.

---

## Architecture

```
POST /api/v1/ar-target
        │
        ▼
  Express API  ──► BullMQ Queue (Redis)
                          │
                          ▼
                     Worker Process
                    ┌──────────────┐
                    │  Validate    │ ← sharp metadata check
                    │  Preprocess  │ ← sharp resize+PNG
                    │  Compile     │ ← @mind-ar/image-compiler
                    │  Upload      │ ← S3 / MinIO
                    │  Webhook     │ ─► callbackUrl
                    └──────────────┘
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd mind-ar-microservice
cp .env.example .env
npm install
```

### 2. Run with Docker Compose (recommended)

```bash
docker compose up --build -d
```

Services started:
| Service | URL |
|---------|-----|
| **API** | http://localhost:3000 |
| **MinIO Console** | http://localhost:9001 (minioadmin / minioadmin) |
| **Redis** | localhost:6379 |

### 3. Run locally (dev)

```bash
# Terminal 1 — API server (hot reload)
npm run dev

# Terminal 2 — Worker (hot reload)
npm run dev:worker
```

Requires Redis running on `localhost:6379` and MinIO on `localhost:9000`.

---

## API Reference

### `POST /api/v1/ar-target`

Accepts a `multipart/form-data` request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | ✅ | Image to compile (JPEG, PNG, WEBP, GIF, BMP, TIFF). Max 10 MB, max 2000×2000 px |
| `callbackUrl` | string | ❌ | Webhook URL to receive the result (http/https) |

**Response `202 Accepted`:**
```json
{
  "jobId": "a1b2c3d4-...",
  "status": "queued",
  "message": "Your image is queued for AR target compilation.",
  "callbackUrl": "https://your-backend.example.com/webhook/ar",
  "queuedAt": "2024-01-15T10:30:00.000Z"
}
```

### `GET /health`

Returns `200 { "status": "ok", "timestamp": "..." }`.

---

## Webhook Payloads

### Success

```json
{
  "jobId": "a1b2c3d4-...",
  "status": "success",
  "mindUrl": "http://minio:9000/ar-targets/mind-files/a1b2c3d4.../...",
  "presignedUrl": "http://minio:9000/ar-targets/mind-files/...?X-Amz-Signature=...",
  "expiresAt": "2024-01-16T10:30:00.000Z",
  "metadata": {
    "originalName": "marker.jpg",
    "compiledAt": "2024-01-15T10:30:05.000Z",
    "durationMs": 4200,
    "sizeBytes": 38456,
    "storageKey": "mind-files/a1b2c3d4.../...",
    "storageBucket": "ar-targets"
  }
}
```

### Failure

```json
{
  "jobId": "a1b2c3d4-...",
  "status": "failed",
  "error": "MindAR compilation error: insufficient image features"
}
```

---

## curl Examples

### Submit a job (no callback)

```bash
curl -X POST http://localhost:3000/api/v1/ar-target \
  -F "image=@/path/to/marker.jpg"
```

### Submit a job with webhook

```bash
curl -X POST http://localhost:3000/api/v1/ar-target \
  -F "image=@/path/to/marker.png" \
  -F "callbackUrl=https://your-backend.example.com/webhook/ar"
```

### Health check

```bash
curl http://localhost:3000/health
```

---

## Python Integration

### Submitting a job

```python
import httpx
import asyncio

MIND_AR_SERVICE = "http://localhost:3000"

async def compile_ar_target(image_path: str, callback_url: str) -> dict:
    async with httpx.AsyncClient() as client:
        with open(image_path, "rb") as f:
            response = await client.post(
                f"{MIND_AR_SERVICE}/api/v1/ar-target",
                files={"image": (image_path.split("/")[-1], f, "image/jpeg")},
                data={"callbackUrl": callback_url},
                timeout=30.0,
            )
        response.raise_for_status()
        return response.json()  # {"jobId": "...", "status": "queued"}

# Usage
result = asyncio.run(compile_ar_target("marker.jpg", "https://myapp.com/webhook"))
job_id = result["jobId"]
```

### Receiving the webhook (FastAPI example)

```python
from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import Literal, Optional

app = FastAPI()

class ARTargetSuccess(BaseModel):
    jobId: str
    status: Literal["success"]
    mindUrl: str
    presignedUrl: str
    expiresAt: str
    metadata: dict

class ARTargetFailed(BaseModel):
    jobId: str
    status: Literal["failed"]
    error: str

@app.post("/webhook/ar")
async def ar_webhook(request: Request):
    payload = await request.json()
    if payload["status"] == "success":
        data = ARTargetSuccess(**payload)
        # Download .mind file, store in your DB, notify user, etc.
        print(f"Job {data.jobId} complete! URL: {data.presignedUrl}")
    else:
        data = ARTargetFailed(**payload)
        print(f"Job {data.jobId} failed: {data.error}")
    return {"received": True}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `production` | Environment mode |
| `LOG_LEVEL` | `info` | Winston log level |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `S3_ENDPOINT` | `http://localhost:9000` | S3/MinIO endpoint |
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key |
| `S3_BUCKET` | `ar-targets` | Target S3 bucket |
| `S3_REGION` | `us-east-1` | S3 region |
| `PRESIGNED_URL_EXPIRES` | `86400` | Presigned URL TTL (seconds) |
| `WORKER_CONCURRENCY` | `2` | Parallel jobs per worker |
| `RATE_LIMIT_MAX` | `30` | Max requests per IP per minute |
| `UPLOAD_DIR` | `uploads` | Temp upload directory |

---

## Scaling

To run multiple workers:

```bash
docker compose up --scale worker=4 -d
```

Each worker consumes jobs from the same BullMQ queue. BullMQ guarantees each job is processed by exactly one worker.

---

## Limitations & Tips

- **Image quality**: MindAR targets work best with high-contrast images with distinctive features. Low-contrast or blurry images will fail compilation. The worker will send a `failed` webhook with the reason.
- **File expiry**: Presigned URLs expire after 24 hours by default (`PRESIGNED_URL_EXPIRES`). Download and store the `.mind` file in your own storage promptly.
- **Retries**: Jobs are automatically retried up to 3 times with exponential backoff on transient errors (network, S3 timeout). A permanent compilation failure is not retried after 3 attempts.
