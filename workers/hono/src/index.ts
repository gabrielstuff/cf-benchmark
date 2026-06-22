/**
 * Hono benchmark server on Cloudflare Workers.
 *
 * Same 4 endpoints as the Docker benchmark, same TypeBox validator.
 * No cluster mode — Workers scale automatically via V8 isolates.
 */

import { Hono } from "hono";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const HELLO = "Hello, World!";

const UserInput = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Integer({ minimum: 0, maximum: 150 }),
});

const app = new Hono();

app.get("/plaintext", (c) => c.text(HELLO));

app.get("/json", (c) => c.json({ message: HELLO }));

app.get("/user/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id, name: `User ${id}` });
});

app.post("/validate", async (c) => {
  const body = await c.req.json();
  if (!Value.Check(UserInput, body)) {
    return c.json({ error: "Invalid input" }, 400);
  }
  return c.json({ name: body.name, age: body.age, valid: true });
});

export default app;
