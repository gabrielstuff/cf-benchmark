/**
 * Elysia benchmark server with Bun cluster (multi-worker).
 *
 * Endpoints:
 *   GET  /plaintext   -> "Hello, World!"
 *   GET  /json        -> {"message": "Hello, World!"}
 *   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
 *   POST /validate    -> echo validated body {"name": str, "age": int}
 */

import { Elysia, t } from "elysia";

const HELLO = "Hello, World!";
const PORT = 3000;
const WORKERS = parseInt(process.env.WORKERS || "4", 10);
const IS_WORKER = process.env.BUN_CLUSTER_WORKER === "1";

if (IS_WORKER) {
  new Elysia()
    .get("/plaintext", () => HELLO)
    .get("/json", () => ({ message: HELLO }))
    .get("/user/:id", ({ params }) => ({
      id: params.id,
      name: `User ${params.id}`,
    }))
    .post(
      "/validate",
      ({ body }) => ({
        name: body.name,
        age: body.age,
        valid: true,
      }),
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          age: t.Integer({ minimum: 0, maximum: 150 }),
        }),
      }
    )
    .listen(PORT);
} else {
  console.log(`Elysia cluster: spawning ${WORKERS} workers on port ${PORT}`);
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
