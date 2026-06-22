#!/usr/bin/env bash
# Benchmark Cloudflare Workers with wrk (via Docker wrk image).
#
# Usage: ./run_cloudflare_bench.sh [duration]
#   duration: wrk duration (default: 10s)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DURATION="${1:-10s}"
RESULT_FILE="$SCRIPT_DIR/results/cloudflare_benchmark_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p "$SCRIPT_DIR/results"

NAMES=("elysia" "hono" "h3")
URLS=(
  "https://bench-elysia.edumapper-com.workers.dev"
  "https://bench-hono.edumapper-com.workers.dev"
  "https://bench-h3.edumapper-com.workers.dev"
)

THREADS=2
CONNECTIONS=128

echo "======================================================" | tee "$RESULT_FILE"
echo " Cloudflare Workers Benchmark - $(date)" | tee -a "$RESULT_FILE"
echo " wrk: ${THREADS}t / ${CONNECTIONS}c / ${DURATION} per endpoint" | tee -a "$RESULT_FILE"
echo " Workers: ${NAMES[*]}" | tee -a "$RESULT_FILE"
echo " (Fastify excluded: find-my-way JIT + crypto.randomBytes" | tee -a "$RESULT_FILE"
echo "  incompatible with Workers V8 isolate restrictions)" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"

for i in "${!NAMES[@]}"; do
    name="${NAMES[$i]}"
    url="${URLS[$i]}"
    echo "" | tee -a "$RESULT_FILE"
    echo ">>> Benchmarking $name ($url) ..." | tee -a "$RESULT_FILE"

    # Warmup
    echo "Warming up..." | tee -a "$RESULT_FILE"
    for j in $(seq 1 50); do
        curl -sf "${url}/plaintext" > /dev/null 2>&1 || true
    done
    sleep 1

    for endpoint in "plaintext" "json" "user/42"; do
        echo "" | tee -a "$RESULT_FILE"
        echo "--- $name / $endpoint ---" | tee -a "$RESULT_FILE"
        docker run --rm \
            framework-benchmark-wrk:latest \
            wrk -t$THREADS -c$CONNECTIONS -d$DURATION "${url}/${endpoint}" 2>&1 | tee -a "$RESULT_FILE"
    done

    echo "" | tee -a "$RESULT_FILE"
    echo "--- $name / validate (POST) ---" | tee -a "$RESULT_FILE"
    docker run --rm \
        framework-benchmark-wrk:latest \
        wrk -t$THREADS -c$CONNECTIONS -d$DURATION -s /bench/post_validate.lua "${url}/validate" 2>&1 | tee -a "$RESULT_FILE"

    echo "" | tee -a "$RESULT_FILE"
    echo ">>> $name complete." | tee -a "$RESULT_FILE"
done

echo "" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"
echo " ALL DONE - Results: $RESULT_FILE" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"
