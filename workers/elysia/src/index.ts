/**
 * Elysia benchmark server on Cloudflare Workers.
 *
 * Uses Elysia's experimental CloudflareAdapter.
 * Native TypeBox validation via t.Object() — same schema as Docker benchmark.
 * .compile() enables AoT compilation (supported on Workers since compat date 2025-06-01).
 */

import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

const HELLO = "Hello, World!";

export default new Elysia({ adapter: CloudflareAdapter })
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
  .compile();
