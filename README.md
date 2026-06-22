# CF Benchmark

Benchmark web frameworks on Cloudflare Workers from 8 regions simultaneously.

Uses Cloudflare Containers + Durable Objects with `locationHint` to run real `wrk` load tests from 8 global regions against Workers deployed on the edge. Results are aggregated in a live dashboard with summary tables and bar charts.

## What it benchmarks

Three JS frameworks that run natively on Cloudflare Workers:

| Framework | Runtime | Validation |
|-----------|---------|------------|
| [Elysia](https://elysiajs.com) | Bun (via CloudflareAdapter) | TypeBox (native) |
| [Hono](https://hono.dev) | Workers (V8 isolate) | TypeBox (Value.Check) |
| [H3](https://h3.dev) | Workers (V8 isolate) | TypeBox (Value.Check) |

Four endpoints, progressively more work:

| Endpoint | Method | What it tests |
|----------|--------|---------------|
| `/plaintext` | GET | Raw I/O — returns `"Hello, World!"` |
| `/json` | GET | JSON serialization — returns `{"message":"Hello, World!"}` |
| `/user/42` | GET | URL param parsing + JSON response |
| `/validate` | POST | JSON body parse + TypeBox validation + response |

All frameworks share the same TypeBox schema for `/validate`, so the benchmark measures framework overhead, not validator luck.

## Architecture

```
                         Dashboard Worker
                         (Hono on Workers)
                         • Web UI with summary table + bar charts
                         • Triggers 8 Durable Objects via RPC
                         • Aggregates results from DOs
                              │
           ┌──────────┬───────┼────────┬──────────┐
           ▼          ▼       ▼        ▼          ▼
      DO: WNAM     DO:ENAM  DO:WEUR  DO:APAC    DO:OC  ... (8 total)
      hint:wnam    hint:enam hint:weur hint:apac hint:oc
           │          │       │        │          │
           ▼          ▼       ▼        ▼          ▼
      Container  Container Container Container Container
      (Alpine +   (Alpine +  (Alpine + (Alpine +  (Alpine +
       wrk +       wrk +      wrk +    wrk +       wrk +
       Node.js)    Node.js)   Node.js) Node.js)    Node.js)
           │          │       │        │          │
           └──────────┴───────┴────────┴──────────┘
                              │
                    Real HTTP requests to:
                    bench-elysia.workers.dev
                    bench-hono.workers.dev
                    bench-h3.workers.dev
```

**How it works:**

1. Dashboard receives a "Run" command
2. 8 Durable Objects are triggered simultaneously, each pinned to a region via `locationHint`
3. Each DO starts a Container (Alpine + wrk + Node.js) in its region
4. The Container runs `wrk` against the target Worker's public URL — real HTTP requests over the real network path
5. Results (req/s, latency percentiles) are stored in DO SQLite and aggregated in the dashboard

**Why Containers + DOs:**

- **Containers** have real Linux network stacks — they make real TCP connections to `*.workers.dev` URLs (Workers' `fetch()` to same-account Workers returns 404)
- **Durable Objects with `locationHint`** pin to specific regions — `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`
- **No subrequest cap** — Containers run real `wrk` processes with no 990-subrequest limit

## Repository structure

```
cf-benchmark/
├── workers/
│   ├── bench-elysia/        Target Worker — Elysia with CloudflareAdapter
│   ├── bench-hono/          Target Worker — Hono
│   ├── bench-h3/            Target Worker — H3
│   └── bench-runner/        Dashboard Worker + Durable Object + Container
│       ├── Dockerfile       Container image: Alpine + wrk + Node.js
│       ├── src/
│       │   ├── index.ts     Dashboard Worker (Hono) — web UI, RPC to DOs
│       │   ├── benchmark-do.ts  Durable Object — manages Container, stores results
│       │   └── load-tester.js   Node.js HTTP server wrapping wrk
│       ├── wrangler.toml    Worker + Container + DO + KV config
│       └── package.json
├── docker/                  Docker benchmark infrastructure (local comparison)
├── go-server/               Gin server (for local Docker benchmark)
├── js-servers/              Elysia, Hono, H3, Fastify servers (Docker)
├── python-servers/          BlackSheep, FastAPI servers (Docker)
├── results/                 Benchmark results (raw text files)
├── docker-compose.yml       Local Docker benchmark setup
├── run_docker_bench.sh      Local benchmark runner
└── run_cloudflare_bench.sh  Cloudflare Workers benchmark runner (single-region)
```

## Deploy

### Prerequisites

- Cloudflare account with Workers (paid plan for Durable Objects + Containers)
- `wrangler` CLI installed and authenticated (`npx wrangler login`)
- Docker (for building Container images)

### 1. Deploy target Workers

These are the Workers being benchmarked. Deploy one per framework:

```bash
cd workers/bench-elysia && npm install && npx wrangler deploy
cd workers/bench-hono && npm install && npx wrangler deploy
cd workers/bench-h3 && npm install && npx wrangler deploy
```

Each deploys to `https://bench-<framework>.<your-subdomain>.workers.dev`.

### 2. Create KV namespace

```bash
cd workers/bench-runner
npx wrangler kv namespace create RESULTS
```

Update `wrangler.toml` with the returned namespace ID:

```toml
[[kv_namespaces]]
binding = "RESULTS"
id = "<your-namespace-id>"
```

### 3. Update target URLs

In `workers/bench-runner/src/index.ts`, update the `TARGETS` map with your deployed Worker URLs:

```typescript
const TARGETS: Record<string, string> = {
  elysia: "https://bench-elysia.your-subdomain.workers.dev",
  hono:   "https://bench-hono.your-subdomain.workers.dev",
  h3:     "https://bench-h3.your-subdomain.workers.dev",
};
```

### 4. Deploy the benchmark runner

```bash
cd workers/bench-runner
npm install
npx wrangler deploy
```

This deploys the dashboard Worker, creates the Durable Object namespace, builds and pushes the Container image.

### 5. Run benchmarks

Open the dashboard URL (shown after deploy). Click **"Run all (12 combos)"** to benchmark all 3 frameworks × 4 endpoints across all 8 regions.

Each run takes ~12 minutes (12 combinations × 60 seconds each). Results appear in real-time in the summary table and bar charts.

## Dashboard

The dashboard has three sections:

1. **Summary table** — frameworks as rows, endpoints as columns, values are average req/s across all 8 regions. Best framework per endpoint is bolded.

2. **Bar charts** — horizontal bars showing framework comparison per endpoint, and per-region breakdown showing which regions perform best.

3. **Raw results** — detailed table with per-region req/s, latency percentiles (p50, p90, p99), total requests, and failures.

## Results

Latest benchmark run: 8 regions × 60s × 2 threads × 128 connections.

### Average req/s across 8 regions

| Framework | /plaintext | /json | /user/42 | /validate | Overall |
|-----------|-----------|-------|----------|-----------|---------|
| Elysia    | **852**   | 766   | **669**  | 714       | **750** |
| Hono      | 716       | 708   | 717      | **750**   | 723     |
| H3        | 668       | **732** | 701    | 612       | 678     |

### Key findings

- **Elysia wins plaintext by 19%** (852 vs 716 Hono) — consistent with local Docker benchmarks where Elysia dominated raw I/O
- **Hono wins validate by 5%** (750 vs 714 Elysia) — H3's validate dropped in some regions
- **All three are within 10% on JSON and params** — framework choice barely matters for these endpoints on the edge
- **Network RTT dominates** — p90 latencies of 200-400ms mean framework overhead (~1ms) is <0.5% of total latency
- **No framework is a clear winner on the edge** — the 10% overall difference is within regional noise

### Why Fastify is excluded

Fastify cannot run on Cloudflare Workers. Two fundamental incompatibilities:
1. **Constructor** uses `crypto.randomBytes()` — Workers block random value generation in global scope
2. **Router** (`find-my-way`) uses `new Function()` for JIT route compilation — Workers block code generation from strings

Cloudflare's September 2025 blog confirms: *"Express and Koa within Workers, and we're hoping to be able to add Fastify support later."*

## Local Docker benchmark

For comparison, the repo also includes a local Docker benchmark that tests frameworks under identical constraints (2 CPUs, 512MB RAM, 2 workers).

```bash
./run_docker_bench.sh
```

This benchmarks Gin (Go), Elysia (Bun), Fastify (Node + Bun), Hono (Bun), H3 (Bun), BlackSheep (Python), and FastAPI (Python) locally via Docker with `wrk`.

Results are saved to `results/docker_benchmark_*.txt`.

## Cost

Each full benchmark run (12 combos × 60s × 8 regions) costs approximately **$0.20** in Container runtime on Cloudflare's `standard-1` instance type.

## Tech stack

- **Cloudflare Workers** — target frameworks + dashboard
- **Cloudflare Containers** — wrk load generation in 8 regions
- **Cloudflare Durable Objects** — per-region state + `locationHint` for geographic pinning
- **Cloudflare KV** — result caching
- **wrk** — HTTP benchmarking tool
- **Hono** — dashboard framework
- **TypeBox** — shared JSON schema validation

## License

MIT
