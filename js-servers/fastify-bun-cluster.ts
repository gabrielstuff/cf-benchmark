/**
 * Fastify benchmark server with Bun cluster (multi-worker).
 *
 * Same Fastify app as the Node.js version, but running on the Bun runtime
 * with Bun.spawn for clustering instead of node:cluster.
 *
 * Endpoints:
 *   GET  /plaintext   -> "Hello, World!"
 *   GET  /json        -> {"message": "Hello, World!"}
 *   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
 *   POST /validate    -> echo validated body {"name": str, "age": int}
 */

import Fastify from "fastify";
import { compiledValidator } from "./validate-schema.mjs";

const HELLO = "Hello, World!";
const PORT = 3000;
const WORKERS = parseInt(process.env.WORKERS || "2", 10);
const IS_WORKER = process.env.BUN_CLUSTER_WORKER === "1";

if (IS_WORKER) {
  const app = Fastify({ logger: false });

  app.get("/plaintext", async () => {
    return HELLO;
  });

  app.get("/json", async () => {
    return { message: HELLO };
  });

  app.get("/user/:id", async (request) => {
    return { id: request.params.id, name: `User ${request.params.id}` };
  });

  app.post("/validate", async (request, reply) => {
    const body = request.body;
    if (!compiledValidator.Check(body)) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    return { name: body.name, age: body.age, valid: true };
  });

  app.listen({ port: PORT, host: "0.0.0.0" });
} else {
  console.log(`Fastify (Bun) cluster: spawning ${WORKERS} workers on port ${PORT}`);
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
