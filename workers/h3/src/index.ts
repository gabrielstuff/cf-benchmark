/**
 * H3 benchmark server on Cloudflare Workers.
 *
 * Same 4 endpoints as the Docker benchmark, same TypeBox validator.
 * Uses h3/cloudflare serve() which returns a Workers-compatible export.
 */

import {
  H3,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  serve,
} from "h3/cloudflare";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const HELLO = "Hello, World!";

const UserInput = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Integer({ minimum: 0, maximum: 150 }),
});

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
    if (!Value.Check(UserInput, body)) {
      setResponseStatus(event, 400);
      return { error: "Invalid input" };
    }
    return { name: body.name, age: body.age, valid: true };
  })
);

export default serve(app);
