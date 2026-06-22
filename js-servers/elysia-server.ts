/**
 * Elysia benchmark server (Bun).
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
  .listen(PORT, () => {
    console.log(`Elysia listening on http://localhost:${PORT}`);
  });
