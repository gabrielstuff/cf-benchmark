/**
 * Fastify benchmark server on Cloudflare Workers.
 *
 * Fastify's constructor uses crypto.randomBytes() which Workers blocks
 * in the global scope. We lazily initialize inside the fetch handler.
 *
 * Uses node:http + httpServerHandler from cloudflare:node to bridge
 * Fastify's HTTP server with the Workers fetch event.
 */

import Fastify from "fastify";
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const HELLO = "Hello, World!";

const UserInput = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Integer({ minimum: 0, maximum: 150 }),
});

let handler = null;

async function getHandler() {
  if (handler) return handler;

  const app = Fastify({ logger: false });

  app.get("/plaintext", async () => HELLO);
  app.get("/json", async () => ({ message: HELLO }));
  app.get("/user/:id", async (request) => ({
    id: request.params.id,
    name: `User ${request.params.id}`,
  }));
  app.post("/validate", async (request, reply) => {
    const body = request.body;
    if (!Value.Check(UserInput, body)) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    return { name: body.name, age: body.age, valid: true };
  });

  await app.ready();
  const server = createServer(app.server);
  handler = httpServerHandler(server);
  return handler;
}

export default {
  async fetch(request, env, ctx) {
    const h = await getHandler();
    return h(request, env, ctx);
  },
};
