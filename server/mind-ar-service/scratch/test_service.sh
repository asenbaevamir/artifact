#!/bin/bash
set -e

API_URL="${API_URL:-http://localhost:3000}"
IMAGE_PATH="${1:-berdakh.jpg}"
OUTPUT_PATH="${2:-output.mind}"
POLL_INTERVAL="${POLL_INTERVAL:-3}"
MAX_WAIT="${MAX_WAIT:-300}"

if [ ! -f "$IMAGE_PATH" ]; then
  echo "Usage: $0 <image.jpg> [output.mind]"
  exit 1
fi

echo "--- Health ---"
curl -sf "$API_URL/health" | grep -q "ok"
echo "OK"

echo -e "\n--- Submit job ---"
RESPONSE=$(curl -s -X POST "$API_URL/api/v1/ar-target" -F "image=@$IMAGE_PATH")
echo "$RESPONSE"

JOB_ID=$(echo "$RESPONSE" | grep -oP '(?<="jobId":")[^"]+')
if [ -z "$JOB_ID" ]; then
  echo "Failed to get jobId"
  exit 1
fi
echo "Job ID: $JOB_ID"

echo -e "\n--- Poll until .mind is ready ---"
ELAPSED=0
while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  HTTP_CODE=$(curl -s -w "%{http_code}" -o "$OUTPUT_PATH" "$API_URL/api/v1/ar-target/$JOB_ID")

  if [ "$HTTP_CODE" = "200" ]; then
    echo "Done! Saved to $OUTPUT_PATH ($(wc -c < "$OUTPUT_PATH") bytes)"
    exit 0
  fi

  if [ "$HTTP_CODE" = "422" ]; then
    echo "Job failed:"
    cat "$OUTPUT_PATH"
    exit 1
  fi

  echo "Status $HTTP_CODE — waiting ${POLL_INTERVAL}s…"
  cat "$OUTPUT_PATH" 2>/dev/null || true
  echo ""
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

echo "Timeout after ${MAX_WAIT}s"
exit 1
