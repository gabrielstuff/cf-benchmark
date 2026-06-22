#!/usr/bin/env bash
# Orchestrator: builds images, then runs each framework + wrk one at a time.
# All containers limited to 2 CPUs / 512MB.
#
# Usage: ./run_docker_bench.sh [duration]
#   duration: wrk duration (default: 10s)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DURATION="${1:-10s}"
RESULT_FILE="$SCRIPT_DIR/results/docker_benchmark_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p "$SCRIPT_DIR/results"

FRAMEWORKS=("gin" "elysia" "fastify" "fastify-bun" "hono" "h3" "blacksheep" "blacksheep-granian-orjson" "fastapi")

echo "======================================================" | tee "$RESULT_FILE"
echo " Docker Benchmark - $(date)" | tee -a "$RESULT_FILE"
echo " Server: 2 CPUs, 512MB, 2 workers | wrk: 2 CPUs, 256MB" | tee -a "$RESULT_FILE"
echo " Duration: $DURATION per endpoint" | tee -a "$RESULT_FILE"
echo " Frameworks: ${FRAMEWORKS[*]}" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"

# Build all images first
echo "Building images..." | tee -a "$RESULT_FILE"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build 2>&1 | tail -5

for fw in "${FRAMEWORKS[@]}"; do
    echo "" | tee -a "$RESULT_FILE"
    echo ">>> Starting $fw ..." | tee -a "$RESULT_FILE"

    # Start server
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" --profile "$fw" up -d "$fw" 2>/dev/null

    # Run wrk against it
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" --profile wrk run --rm \
        -e "SERVER_HOST=$fw" \
        -e "SERVER_NAME=$fw" \
        -e "DURATION=$DURATION" \
        wrk 2>&1 | tee -a "$RESULT_FILE"

    # Stop server
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" --profile "$fw" down 2>/dev/null

    echo ">>> $fw complete." | tee -a "$RESULT_FILE"
done

echo "" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"
echo " ALL DONE - Results: $RESULT_FILE" | tee -a "$RESULT_FILE"
echo "======================================================" | tee -a "$RESULT_FILE"
