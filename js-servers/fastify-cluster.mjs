/**
 * Fastify benchmark server with Node.js cluster (multi-worker).
 *
 * Endpoints:
 *   GET  /plaintext   -> "Hello, World!"
 *   GET  /json        -> {"message": "Hello, World!"}
 *   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
 *   POST /validate    -> echo validated body {"name": str, "age": int}
 */

import cluster from "node:cluster";
import Fastify from "fastify";
import { compiledValidator } from "./validate-schema.mjs";

const HELLO = "Hello, World!";
const PORT = 3000;
const WORKERS = parseInt(process.env.WORKERS || "2", 10);

if (cluster.isPrimary) {
  console.log(`Fastify cluster: spawning ${WORKERS} workers on port ${PORT}`);
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }
} else {
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
}
