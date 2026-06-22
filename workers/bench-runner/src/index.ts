/**
 * Distributed Benchmark Dashboard for Cloudflare Workers.
 *
 * Triggers wrk benchmarks across 8 regions via Durable Objects
 * pinned with locationHint. Each DO runs a Container with real wrk.
 *
 * Endpoints:
 *   GET  /          -> Dashboard (summary table + bar charts + raw data)
 *   POST /run       -> Run one framework/endpoint across all 8 regions
 *   GET  /results   -> Raw results from all DOs
 *   GET  /summary   -> Aggregated matrix: frameworks × endpoints, avg across regions
 *   DELETE /results -> Clear all results
 */

import { Hono } from "hono";
import { BenchmarkDO } from "./benchmark-do";

const REGIONS = ["wnam", "enam", "weur", "eeur", "apac", "oc", "afr", "me"];

const REGION_LABELS: Record<string, string> = {
  wnam: "US West",
  enam: "US East",
  weur: "EU West",
  eeur: "EU East",
  apac: "Asia Pacific",
  oc: "Oceania",
  afr: "Africa",
  me: "Middle East",
};

const TARGETS: Record<string, string> = {
  elysia: "https://bench-elysia.edumapper-com.workers.dev",
  hono: "https://bench-hono.edumapper-com.workers.dev",
  h3: "https://bench-h3.edumapper-com.workers.dev",
};

const ENDPOINTS = ["plaintext", "json", "user/42", "validate"];

const app = new Hono();

app.get("/", (c) => c.html(dashboardHTML()));

app.post("/run", async (c) => {
  const body = await c.req.json();
  const { targetName, endpoint, duration, threads, connections } = body;

  if (!targetName || !endpoint || !TARGETS[targetName]) {
    return c.json({ error: "targetName and endpoint required" }, 400);
  }

  const target = TARGETS[targetName];
  const params = { target, targetName, endpoint, duration: duration || "60s", threads: threads || 2, connections: connections || 128 };

  const results = await Promise.all(
    REGIONS.map(async (region) => {
      try {
        const id = c.env.BENCH_DO.idFromName(region);
        const stub = c.env.BENCH_DO.get(id, { locationHint: region as any });
        const result = await stub.runBenchmark(params);
        return { region, ...result };
      } catch (err: any) {
        return { region, error: err.message };
      }
    })
  );

  const key = `${targetName}:${endpoint}:${Date.now()}`;
  await c.env.RESULTS.put(key, JSON.stringify({ targetName, endpoint, results, timestamp: Date.now() }), {
    expirationTtl: 7200,
  });

  return c.json({ targetName, endpoint, results });
});

app.get("/results", async (c) => {
  const allResults = [];

  for (const region of REGIONS) {
    try {
      const id = c.env.BENCH_DO.idFromName(region);
      const stub = c.env.BENCH_DO.get(id, { locationHint: region as any });
      const results = await stub.getResults();
      for (const r of results) {
        allResults.push({ region, ...r });
      }
    } catch {
      // DO might not be created yet for this region
    }
  }

  allResults.sort((a, b) => b.timestamp - a.timestamp);
  return c.json(allResults);
});

app.get("/summary", async (c) => {
  const allResults: any[] = [];

  for (const region of REGIONS) {
    try {
      const id = c.env.BENCH_DO.idFromName(region);
      const stub = c.env.BENCH_DO.get(id, { locationHint: region as any });
      const results = await stub.getResults();
      for (const r of results) {
        allResults.push({ region, ...r });
      }
    } catch {}
  }

  // Dedupe: keep latest per region+target+endpoint
  const seen = new Set<string>();
  const latest = [];
  for (const r of allResults.sort((a, b) => b.timestamp - a.timestamp)) {
    const key = `${r.region}:${r.target}:${r.endpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(r);
  }

  // Build matrix: framework × endpoint → avg rps across regions
  const frameworks = ["elysia", "hono", "h3"];
  const endpoints = ["plaintext", "json", "user/42", "validate"];
  const matrix: Record<string, Record<string, { avg: number; min: number; max: number; regions: number }>> = {};

  for (const fw of frameworks) {
    matrix[fw] = {};
    for (const ep of endpoints) {
      const vals = latest
        .filter((r) => r.target === fw && r.endpoint === ep && typeof r.rps === "number")
        .map((r) => r.rps);
      if (vals.length > 0) {
        matrix[fw][ep] = {
          avg: Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length),
          min: Math.min(...vals),
          max: Math.max(...vals),
          regions: vals.length,
        };
      } else {
        matrix[fw][ep] = { avg: 0, min: 0, max: 0, regions: 0 };
      }
    }
  }

  // Per-region averages per framework
  const byRegion: Record<string, Record<string, number>> = {};
  for (const region of REGIONS) {
    byRegion[region] = {};
    for (const fw of frameworks) {
      const vals = latest
        .filter((r) => r.region === region && r.target === fw && typeof r.rps === "number")
        .map((r) => r.rps);
      byRegion[region][fw] = vals.length > 0
        ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length)
        : 0;
    }
  }

  return c.json({ matrix, byRegion, frameworks, endpoints, regions: REGIONS });
});

app.delete("/results", async (c) => {
  for (const region of REGIONS) {
    try {
      const id = c.env.BENCH_DO.idFromName(region);
      const stub = c.env.BENCH_DO.get(id, { locationHint: region as any });
      await stub.clearResults();
    } catch {}
  }

  const kvList = await c.env.RESULTS.list();
  for (const key of kvList.keys) {
    await c.env.RESULTS.delete(key.name);
  }

  return c.json({ cleared: true });
});

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CF Benchmark — Distributed Worker Performance</title>
<style>
  :root { color-scheme: light dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 1200px; margin: 0 auto; color: #171717; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e5e5e5; background: #0a0a0a; } }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; }
  h2 { font-size: 0.9375rem; font-weight: 600; margin-bottom: 0.75rem; color: #404040; }
  @media (prefers-color-scheme: dark) { h2 { color: #a3a3a3; } }
  .sub { color: #737373; font-size: 0.8125rem; margin-bottom: 1.5rem; }
  .card { border: 1px solid #e5e5e5; border-radius: 6px; padding: 1.25rem; margin-bottom: 1.25rem; }
  @media (prefers-color-scheme: dark) { .card { border-color: #262626; } }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; margin-bottom: 0.75rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  label { font-size: 0.75rem; font-weight: 500; color: #525252; }
  @media (prefers-color-scheme: dark) { label { color: #a3a3a3; } }
  select, input { padding: 0.4rem 0.6rem; border: 1px solid #d4d4d4; border-radius: 4px; background: inherit; color: inherit; font-size: 0.8125rem; font-family: inherit; }
  @media (prefers-color-scheme: dark) { select, input { border-color: #404040; } }
  button { padding: 0.4rem 0.9rem; border: 1px solid #d4d4d4; border-radius: 4px; background: #f5f5f5; color: #171717; font-weight: 500; font-size: 0.8125rem; cursor: pointer; font-family: inherit; }
  button:hover:not(:disabled) { background: #ebebeb; }
  @media (prefers-color-scheme: dark) { button { background: #1a1a1a; color: #e5e5e5; border-color: #404040; } button:hover:not(:disabled) { background: #262626; } }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary { background: #171717; color: #fff; border-color: #171717; }
  .btn-primary:hover:not(:disabled) { background: #404040; }
  @media (prefers-color-scheme: dark) { .btn-primary { background: #e5e5e5; color: #0a0a0a; border-color: #e5e5e5; } .btn-primary:hover:not(:disabled) { background: #fff; } }
  #status { font-size: 0.8125rem; color: #737373; margin-top: 0.5rem; min-height: 1.2em; }

  /* Summary table */
  table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  th, td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #262626; } }
  th { font-weight: 500; color: #737373; text-align: left; }
  @media (prefers-color-scheme: dark) { th { color: #a3a3a3; } }
  td.num { font-family: ui-monospace, 'SF Mono', Menlo, monospace; text-align: right; }
  td.fw { font-weight: 600; }
  td.fw.elysia { color: #404040; }
  td.fw.hono { color: #525252; }
  td.fw.h3 { color: #737373; }
  @media (prefers-color-scheme: dark) { td.fw.elysia { color: #e5e5e5; } td.fw.hono { color: #d4d4d4; } td.fw.h3 { color: #a3a3a3; } }
  td.best { font-weight: 700; }
  .empty { color: #d4d4d4; }
  @media (prefers-color-scheme: dark) { .empty { color: #404040; } }

  /* Bar chart */
  .chart { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
  .bar-row { display: flex; align-items: center; gap: 0.5rem; }
  .bar-label { width: 80px; font-size: 0.75rem; font-weight: 500; color: #525252; text-align: right; flex-shrink: 0; }
  @media (prefers-color-scheme: dark) { .bar-label { color: #a3a3a3; } }
  .bar-track { flex: 1; height: 22px; background: #f5f5f5; border-radius: 3px; overflow: hidden; position: relative; }
  @media (prefers-color-scheme: dark) { .bar-track { background: #1a1a1a; } }
  .bar-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; font-size: 0.6875rem; font-weight: 600; font-family: ui-monospace, monospace; color: #fff; }
  @media (prefers-color-scheme: dark) { .bar-fill { color: #0a0a0a; } }
  .bar-fill.elysia { background: #171717; }
  .bar-fill.hono { background: #525252; }
  .bar-fill.h3 { background: #a3a3a3; }
  @media (prefers-color-scheme: dark) { .bar-fill.elysia { background: #e5e5e5; } .bar-fill.hono { background: #a3a3a3; } .bar-fill.h3 { background: #737373; } }

  /* Grouped bar chart for regional */
  .region-chart { display: grid; grid-template-columns: 100px 1fr; gap: 0.25rem 0.75rem; align-items: center; margin-top: 0.5rem; }
  .region-label { font-size: 0.75rem; font-weight: 500; color: #525252; text-align: right; }
  @media (prefers-color-scheme: dark) { .region-label { color: #a3a3a3; } }
  .region-bars { display: flex; gap: 2px; height: 20px; }
  .rb { height: 100%; border-radius: 2px; transition: width 0.6s ease; min-width: 0; }
  .rb.elysia { background: #171717; }
  .rb.hono { background: #525252; }
  .rb.h3 { background: #a3a3a3; }
  @media (prefers-color-scheme: dark) { .rb.elysia { background: #e5e5e5; } .rb.hono { background: #a3a3a3; } .rb.h3 { background: #737373; } }

  /* Legend */
  .legend { display: flex; gap: 1rem; margin-top: 0.75rem; font-size: 0.75rem; color: #737373; }
  .legend-item { display: flex; align-items: center; gap: 0.3rem; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
  .legend-dot.elysia { background: #171717; }
  .legend-dot.hono { background: #525252; }
  .legend-dot.h3 { background: #a3a3a3; }
  @media (prefers-color-scheme: dark) { .legend-dot.elysia { background: #e5e5e5; } .legend-dot.hono { background: #a3a3a3; } .legend-dot.h3 { background: #737373; } }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
  .muted { color: #737373; font-size: 0.75rem; }
</style>
</head>
<body>
<h1>CF Benchmark</h1>
<p class="sub">Distributed performance benchmark — 8 Cloudflare regions × wrk in Containers. Real HTTP requests to Workers.</p>

<div class="card">
  <h2>Run benchmarks</h2>
  <div class="row">
    <div class="field">
      <label>Framework</label>
      <select id="target">
        <option value="elysia">Elysia</option>
        <option value="hono">Hono</option>
        <option value="h3">H3</option>
      </select>
    </div>
    <div class="field">
      <label>Endpoint</label>
      <select id="endpoint">
        <option value="plaintext">/plaintext</option>
        <option value="json">/json</option>
        <option value="user/42">/user/42</option>
        <option value="validate">POST /validate</option>
      </select>
    </div>
    <div class="field">
      <label>Duration</label>
      <select id="duration">
        <option value="10s">10s</option>
        <option value="30s">30s</option>
        <option value="60s" selected>60s</option>
      </select>
    </div>
    <div class="field">
      <label>Threads</label>
      <input type="number" id="threads" value="2" min="1" max="4" style="width:60px">
    </div>
    <div class="field">
      <label>Connections</label>
      <input type="number" id="connections" value="128" min="1" max="512" style="width:70px">
    </div>
  </div>
  <div class="row">
    <button class="btn-primary" id="runBtn" onclick="runOne()">Run 1 endpoint</button>
    <button id="allBtn" onclick="runAll()">Run all (12 combos)</button>
    <button onclick="loadAll()">Refresh</button>
    <button onclick="clearResults()">Clear</button>
  </div>
  <div id="status"></div>
</div>

<div id="summarySection"></div>

<div class="card">
  <h2>Raw results — per region</h2>
  <table>
    <thead>
      <tr>
        <th>Region</th>
        <th>Framework</th>
        <th>Endpoint</th>
        <th>Req/s</th>
        <th>Avg ms</th>
        <th>p50</th>
        <th>p90</th>
        <th>p99</th>
        <th>Total</th>
        <th>Failed</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
</div>

<script>
const REGIONS = {
  wnam: 'US West', enam: 'US East', weur: 'EU West', eeur: 'EU East',
  apac: 'Asia Pacific', oc: 'Oceania', afr: 'Africa', me: 'Middle East'
};
const FRAMEWORKS = ['elysia', 'hono', 'h3'];
const ENDPOINTS = ['plaintext', 'json', 'user/42', 'validate'];
const EP_LABELS = { 'plaintext': '/plaintext', 'json': '/json', 'user/42': '/user/42', 'validate': '/validate' };

async function runOne() {
  const btn = document.getElementById('runBtn');
  const status = document.getElementById('status');
  btn.disabled = true;
  const t = document.getElementById('target').value;
  const e = document.getElementById('endpoint').value;
  const d = document.getElementById('duration').value;
  const th = document.getElementById('threads').value;
  const c = document.getElementById('connections').value;
  status.textContent = 'Running ' + t + ' /' + e + ' across 8 regions...';
  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({targetName: t, endpoint: e, duration: d, threads: +th, connections: +c})
    });
    const data = await res.json();
    if (data.error) { status.textContent = 'Error: ' + data.error; }
    else { status.textContent = 'Done: ' + t + ' /' + e + ' — ' + data.results.filter(r=>!r.error).length + '/8 regions succeeded'; }
  } catch(err) { status.textContent = 'Error: ' + err.message; }
  btn.disabled = false;
  loadAll();
}

async function runAll() {
  const btn = document.getElementById('allBtn');
  const status = document.getElementById('status');
  btn.disabled = true;
  const d = document.getElementById('duration').value;
  const th = document.getElementById('threads').value;
  const c = document.getElementById('connections').value;
  let i = 0;
  for (const t of FRAMEWORKS) {
    for (const e of ENDPOINTS) {
      i++;
      status.textContent = 'Running ' + i + '/12: ' + t + ' /' + e + ' ...';
      try {
        await fetch('/run', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({targetName: t, endpoint: e, duration: d, threads: +th, connections: +c})
        });
      } catch(err) { status.textContent = 'Error at ' + i + ': ' + err.message; break; }
      loadAll();
    }
  }
  status.textContent = 'All 12 combinations complete.';
  btn.disabled = false;
}

async function loadAll() {
  loadSummary();
  loadRawResults();
}

async function loadSummary() {
  try {
    const res = await fetch('/summary');
    const data = await res.json();
    const section = document.getElementById('summarySection');
    section.innerHTML = renderSummary(data);
  } catch(err) { console.error('summary error:', err); }
}

function renderSummary(data) {
  const { matrix, byRegion, frameworks, endpoints, regions } = data;
  let html = '';

  // --- Summary table: frameworks × endpoints ---
  html += '<div class="card">';
  html += '<h2>Average req/s — frameworks × endpoints (avg across all regions)</h2>';
  html += '<table><thead><tr><th>Framework</th>';
  for (const ep of endpoints) { html += '<th class="num">' + EP_LABELS[ep] + '</th>'; }
  html += '<th class="num">Overall</th></tr></thead><tbody>';

  // Find max per endpoint for bar widths
  const maxPerEp = {};
  for (const ep of endpoints) {
    maxPerEp[ep] = Math.max(...frameworks.map(fw => matrix[fw]?.[ep]?.avg || 0));
  }

  for (const fw of frameworks) {
    html += '<tr><td class="fw ' + fw + '">' + fw + '</td>';
    let overallSum = 0, overallCount = 0;
    for (const ep of endpoints) {
      const v = matrix[fw]?.[ep];
      if (v && v.avg > 0) {
        overallSum += v.avg;
        overallCount++;
        // Find best for highlighting
        const isBest = v.avg === maxPerEp[ep];
        html += '<td class="num' + (isBest ? ' best' : '') + '">' + v.avg.toLocaleString() + '</td>';
      } else {
        html += '<td class="num empty">—</td>';
      }
    }
    const overall = overallCount > 0 ? Math.round(overallSum / overallCount) : 0;
    html += '<td class="num"><strong>' + overall.toLocaleString() + '</strong></td></tr>';
  }
  html += '</tbody></table>';
  html += '<p class="muted" style="margin-top:0.5rem">Bold = best framework for that endpoint. Overall = average of all 4 endpoints.</p>';
  html += '</div>';

  // --- Bar chart: framework comparison per endpoint ---
  html += '<div class="grid-2">';
  html += '<div class="card">';
  html += '<h2>Framework comparison by endpoint</h2>';
  for (const ep of endpoints) {
    const max = maxPerEp[ep] || 1;
    html += '<div style="margin-bottom:0.75rem"><div class="muted" style="margin-bottom:0.25rem">' + EP_LABELS[ep] + '</div>';
    html += '<div class="chart">';
    for (const fw of frameworks) {
      const v = matrix[fw]?.[ep]?.avg || 0;
      const pct = max > 0 ? (v / max * 100) : 0;
      html += '<div class="bar-row">';
      html += '<div class="bar-label">' + fw + '</div>';
      html += '<div class="bar-track"><div class="bar-fill ' + fw + '" style="width:' + pct + '%">' + (v > 0 ? v.toLocaleString() : '') + '</div></div>';
      html += '</div>';
    }
    html += '</div></div>';
  }
  html += '<div class="legend">';
  html += '<div class="legend-item"><div class="legend-dot elysia"></div>Elysia</div>';
  html += '<div class="legend-item"><div class="legend-dot hono"></div>Hono</div>';
  html += '<div class="legend-item"><div class="legend-dot h3"></div>H3</div>';
  html += '</div>';
  html += '</div>';

  // --- Regional breakdown ---
  html += '<div class="card">';
  html += '<h2>Average req/s by region</h2>';

  // Find global max for scaling
  const globalMax = Math.max(...regions.map(r => Math.max(...frameworks.map(fw => byRegion[r]?.[fw] || 0))));

  for (const r of regions) {
    const vals = frameworks.map(fw => byRegion[r]?.[fw] || 0);
    const total = vals.reduce((a,b) => a+b, 0);
    html += '<div style="margin-bottom:0.4rem">';
    html += '<div class="muted" style="margin-bottom:0.15rem">' + (REGIONS[r]||r) + ' — avg ' + (total > 0 ? Math.round(total/frameworks.length).toLocaleString() : '0') + ' req/s</div>';
    html += '<div class="region-bars">';
    for (const fw of frameworks) {
      const v = byRegion[r]?.[fw] || 0;
      const pct = globalMax > 0 ? (v / globalMax * 100) : 0;
      html += '<div class="rb ' + fw + '" style="width:' + pct + '%" title="' + fw + ': ' + v + ' req/s"></div>';
    }
    html += '</div></div>';
  }
  html += '<div class="legend">';
  html += '<div class="legend-item"><div class="legend-dot elysia"></div>Elysia</div>';
  html += '<div class="legend-item"><div class="legend-dot hono"></div>Hono</div>';
  html += '<div class="legend-item"><div class="legend-dot h3"></div>H3</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>'; // grid-2

  return html;
}

async function loadRawResults() {
  try {
    const res = await fetch('/results');
    const data = await res.json();
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    const seen = new Set();
    for (const r of data) {
      const key = r.region + ':' + r.target + ':' + r.endpoint;
      if (seen.has(key)) continue;
      seen.add(key);
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (REGIONS[r.region]||r.region) + '</td>' +
        '<td class="fw ' + r.target + '">' + r.target + '</td>' +
        '<td>/' + r.endpoint + '</td>' +
        '<td class="num">' + (r.rps||0).toLocaleString() + '</td>' +
        '<td class="num">' + (r.avg_ms||0).toFixed(2) + '</td>' +
        '<td class="num">' + (r.p50_ms||0).toFixed(2) + '</td>' +
        '<td class="num">' + (r.p95_ms||0).toFixed(2) + '</td>' +
        '<td class="num">' + (r.p99_ms||0).toFixed(2) + '</td>' +
        '<td class="num">' + (r.total||0).toLocaleString() + '</td>' +
        '<td class="num">' + (r.failed||0) + '</td>';
      tbody.appendChild(tr);
    }
  } catch(err) { console.error(err); }
}

async function clearResults() {
  document.getElementById('status').textContent = 'Clearing...';
  await fetch('/results', {method:'DELETE'});
  document.getElementById('status').textContent = 'Cleared.';
  loadAll();
}

loadAll();
</script>
</body>
</html>`;
}

export { BenchmarkDO };
export default app;
