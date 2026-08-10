import { env } from "cloudflare:workers";

export type DatabaseBindings = Pick<Env, "DB">;

export function getDatabase(bindings: DatabaseBindings = env): D1Database {
  return bindings.DB;
}

export function getRuntimeEnv(bindings: Env = env): Env {
  return bindings;
}
