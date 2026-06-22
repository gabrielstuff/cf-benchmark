/**
 * Benchmark Durable Object — manages a wrk container in a specific region.
 *
 * One DO instance per region, pinned via locationHint.
 * The DO starts a Container (Alpine + wrk + Node.js) and forwards
 * benchmark requests to it. Results are stored in SQLite.
 */

import { Container } from "@cloudflare/containers";

export class BenchmarkDO extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "30m";
  enableInternet = true;
  pingEndpoint = "/health";

  private initialized = false;

  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        rps REAL NOT NULL,
        avg_ms REAL,
        p50_ms REAL,
        p95_ms REAL,
        p99_ms REAL,
        total INTEGER,
        success INTEGER,
        failed INTEGER,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  async ensureRunning() {
    if (!this.initialized) {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (!this.initialized) {
          await this.startAndWaitForPorts();
          this.initialized = true;
        }
      });
    }
  }

  async runBenchmark(params: {
    target: string;
    targetName: string;
    endpoint: string;
    duration: string;
    threads: number;
    connections: number;
  }): Promise<any> {
    await this.ensureRunning();

    const response = await super.fetch(
      new Request("http://container/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Container error ${response.status}: ${text}`);
    }

    const result = await response.json();

    this.ctx.storage.sql.exec(
      "INSERT INTO results (target, endpoint, rps, avg_ms, p50_ms, p95_ms, p99_ms, total, success, failed, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params.targetName,
      params.endpoint,
      result.rps,
      result.avgLatencyMs,
      result.p50ms,
      result.p95ms,
      result.p99ms,
      result.totalRequests,
      result.successful,
      result.failed,
      Date.now()
    );

    return {
      rps: result.rps,
      avgLatencyMs: result.avgLatencyMs,
      p50ms: result.p50ms,
      p95ms: result.p95ms,
      p99ms: result.p99ms,
      totalRequests: result.totalRequests,
      successful: result.successful,
      failed: result.failed,
    };
  }

  async getResults(): Promise<any[]> {
    return this.ctx.storage.sql
      .exec("SELECT target, endpoint, rps, avg_ms, p50_ms, p95_ms, p99_ms, total, success, failed, timestamp FROM results ORDER BY timestamp DESC")
      .toArray();
  }

  async clearResults(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM results");
  }
}
