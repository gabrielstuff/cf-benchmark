#!/usr/bin/env bash
# Benchmark runner - runs inside wrk container.
# Expects SERVER_HOST and SERVER_NAME env vars.
set -euo pipefail

HOST="${SERVER_HOST:-server}"
PORT=3000
NAME="${SERVER_NAME:-unknown}"
DURATION="${DURATION:-10s}"
THREADS=2
CONNECTIONS=128
WARMUP=500

echo ""
echo "============================================"
echo " Benchmarking: $NAME"
echo " Target: $HOST:$PORT"
echo " Config: ${THREADS}t / ${CONNECTIONS}c / ${DURATION}"
echo "============================================"

# Wait for server
echo "Waiting for server..."
for i in $(seq 1 30); do
    if curl -sf "http://${HOST}:${PORT}/plaintext" > /dev/null 2>&1; then
        echo "Server ready."
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo "ERROR: Server did not start in 30s"
        exit 1
    fi
done

# Warmup
echo "Warming up ($WARMUP requests)..."
for i in $(seq 1 $WARMUP); do
    curl -sf "http://${HOST}:${PORT}/plaintext" > /dev/null 2>&1 || true
done
sleep 2

echo ""
echo "--- $NAME / plaintext ---"
wrk -t$THREADS -c$CONNECTIONS -d$DURATION "http://${HOST}:${PORT}/plaintext"

echo ""
echo "--- $NAME / json ---"
wrk -t$THREADS -c$CONNECTIONS -d$DURATION "http://${HOST}:${PORT}/json"

echo ""
echo "--- $NAME / params ---"
wrk -t$THREADS -c$CONNECTIONS -d$DURATION "http://${HOST}:${PORT}/user/42"

echo ""
echo "--- $NAME / validate (POST) ---"
wrk -t$THREADS -c$CONNECTIONS -d$DURATION -s /bench/post_validate.lua "http://${HOST}:${PORT}/validate"

echo ""
echo "=== $NAME DONE ==="
