/**
 * Shared TypeBox validator for the /validate endpoint.
 *
 * Used by all JS frameworks (Hono, H3, Fastify, Fastify-Bun) so that
 * the benchmark measures framework overhead, not validator luck.
 *
 * Elysia uses TypeBox natively via its `t` namespace (which IS @sinclair/typebox),
 * so it already runs the exact same compiled validator under the hood.
 */

import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

const UserInput = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Integer({ minimum: 0, maximum: 150 }),
});

export const compiledValidator = TypeCompiler.Compile(UserInput);
