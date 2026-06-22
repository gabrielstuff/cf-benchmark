/**
 * Hono benchmark server with Bun cluster (multi-worker).
 *
 * Endpoints:
 *   GET  /plaintext   -> "Hello, World!"
 *   GET  /json        -> {"message": "Hello, World!"}
 *   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
 *   POST /validate    -> echo validated body {"name": str, "age": int}
 */

import { Hono } from "hono";
import { compiledValidator } from "./validate-schema.mjs";

const HELLO = "Hello, World!";
const PORT = 3000;
const WORKERS = parseInt(process.env.WORKERS || "2", 10);
const IS_WORKER = process.env.BUN_CLUSTER_WORKER === "1";

if (IS_WORKER) {
  const app = new Hono();

  app.get("/plaintext", (c) => c.text(HELLO));

  app.get("/json", (c) => c.json({ message: HELLO }));

  app.get("/user/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ id, name: `User ${id}` });
  });

  app.post("/validate", async (c) => {
    const body = await c.req.json();
    if (!compiledValidator.Check(body)) {
      return c.json({ error: "Invalid input" }, 400);
    }
    return c.json({ name: body.name, age: body.age, valid: true });
  });

  Bun.serve({ port: PORT, fetch: app.fetch });
} else {
  console.log(`Hono cluster: spawning ${WORKERS} workers on port ${PORT}`);
  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(
      Bun.spawn({
        cmd: ["bun", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, BUN_CLUSTER_WORKER: "1" },
      })
    );
  }
  await Promise.all(procs.map((p) => p.exited));
}
