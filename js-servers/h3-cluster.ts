/**
 * H3 benchmark server with Bun cluster (multi-worker).
 *
 * Endpoints:
 *   GET  /plaintext   -> "Hello, World!"
 *   GET  /json        -> {"message": "Hello, World!"}
 *   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
 *   POST /validate    -> echo validated body {"name": str, "age": int}
 */

import {
  H3,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  serve,
} from "h3";
import { compiledValidator } from "./validate-schema.mjs";

const HELLO = "Hello, World!";
const PORT = 3000;
const WORKERS = parseInt(process.env.WORKERS || "2", 10);
const IS_WORKER = process.env.BUN_CLUSTER_WORKER === "1";

if (IS_WORKER) {
  const app = new H3();

  app.get("/plaintext", defineEventHandler(() => HELLO));

  app.get("/json", defineEventHandler(() => ({ message: HELLO })));

  app.get(
    "/user/:id",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      return { id, name: `User ${id}` };
    })
  );

  app.post(
    "/validate",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      if (!compiledValidator.Check(body)) {
        setResponseStatus(event, 400);
        return { error: "Invalid input" };
      }
      return { name: body.name, age: body.age, valid: true };
    })
  );

  serve(app, { port: PORT });
} else {
  console.log(`H3 cluster: spawning ${WORKERS} workers on port ${PORT}`);
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
