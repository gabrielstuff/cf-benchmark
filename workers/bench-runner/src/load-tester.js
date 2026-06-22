/**
 * Load tester — Node.js HTTP server that wraps wrk.
 *
 * Runs inside a Cloudflare Container. Listens on port 8080.
 *
 * Endpoints:
 *   GET  /health  -> 200 OK (container health check)
 *   POST /run     -> Run wrk benchmark, return parsed JSON
 *
 * POST /run body:
 *   { target: "https://bench-hono.workers.dev", endpoint: "plaintext", duration: "60s", threads: 2, connections: 128 }
 *
 * POST /run response:
 *   { rps: 259159, avgLatencyMs: 0.53, p50ms: 0.42, p95ms: 0.86, p99ms: 1.27, totalRequests: 2592116, successful: 2592116, failed: 0 }
 */

const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const fs = require("fs");

const LUA_SCRIPT = `wrk.method = "POST"
wrk.body = '{"name":"Alice","age":30}'
wrk.headers["Content-Type"] = "application/json"
`;

fs.writeFileSync("/tmp/post_validate.lua", LUA_SCRIPT);

function warmup(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", () => resolve());
    req.setTimeout(5000, () => {
      req.destroy();
      resolve();
    });
  });
}

function parseLatencyMs(value, unit) {
  const num = parseFloat(value);
  if (unit === "us") return num / 1000;
  if (unit === "ms") return num;
  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60000;
  return num;
}

function parseWrkOutput(stdout) {
  const lines = stdout.split("\n");
  const result = {
    rps: 0,
    avgLatencyMs: 0,
    p50ms: 0,
    p95ms: 0,
    p99ms: 0,
    totalRequests: 0,
    successful: 0,
    failed: 0,
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Requests/sec: 259159.51
    const rpsMatch = trimmed.match(/^Requests\/sec:\s+([\d.]+)/);
    if (rpsMatch) {
      result.rps = Math.round(parseFloat(rpsMatch[1]));
    }

    // Latency   529.13us  504.80us  31.24ms   88.86%
    const latMatch = trimmed.match(/^Latency\s+([\d.]+)(us|ms|s|m)\s+/);
    if (latMatch) {
      result.avgLatencyMs = parseLatencyMs(latMatch[1], latMatch[2]);
    }

    // wrk --latency provides 50%, 75%, 90%, 99% (not 95%)
    const p50Match = trimmed.match(/^50%\s+([\d.]+)(us|ms|s|m)/);
    if (p50Match) {
      result.p50ms = parseLatencyMs(p50Match[1], p50Match[2]);
    }

    const p90Match = trimmed.match(/^90%\s+([\d.]+)(us|ms|s|m)/);
    if (p90Match) {
      result.p95ms = parseLatencyMs(p90Match[1], p90Match[2]);
    }

    const p99Match = trimmed.match(/^99%\s+([\d.]+)(us|ms|s|m)/);
    if (p99Match) {
      result.p99ms = parseLatencyMs(p99Match[1], p99Match[2]);
    }

    // 2592116 requests in 10.00s, 321.36MB read
    const totalMatch = trimmed.match(/^(\d+)\s+requests in/);
    if (totalMatch) {
      result.totalRequests = parseInt(totalMatch[1]);
      result.successful = result.totalRequests;
    }

    // Socket errors: connect 0, read 0, write 0, timeout 126
    const errMatch = trimmed.match(/^Socket errors:\s+connect\s+(\d+),\s+read\s+(\d+),\s+write\s+(\d+),\s+timeout\s+(\d+)/);
    if (errMatch) {
      result.failed = parseInt(errMatch[1]) + parseInt(errMatch[2]) + parseInt(errMatch[3]) + parseInt(errMatch[4]);
      result.successful = result.totalRequests - result.failed;
    }
  }

  return result;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let params;
    try {
      params = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const { target, endpoint, duration, threads, connections } = params;
    if (!target || !endpoint) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "target and endpoint required" }));
      return;
    }

    const url = `${target}/${endpoint}`;
    const isPost = endpoint === "validate";
    const wrkArgs = [
      `-t${threads || 2}`,
      `-c${connections || 128}`,
      `-d${duration || "10s"}`,
      "--latency",
    ];

    if (isPost) {
      wrkArgs.push("-s", "/tmp/post_validate.lua");
    }
    wrkArgs.push(url);

    console.log(`Warming up: ${url}`);
    await warmup(url);

    console.log(`Running: wrk ${wrkArgs.join(" ")}`);

    execFile("wrk", wrkArgs, { timeout: 180000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.killed) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "wrk timed out", stderr: stderr }));
        return;
      }

      const parsed = parseWrkOutput(stdout);
      console.log(`Done: ${parsed.rps} req/s, ${parsed.avgLatencyMs}ms avg`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(parsed));
    });
  });
});

server.listen(8080, () => {
  console.log("Load tester listening on port 8080");
});
