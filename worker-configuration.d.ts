interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ALLOW_PUBLIC_DEMO?: string;
  DEMO_MODE?: string;
  SHOW_DEMO_CREDENTIALS?: string;
}

declare namespace Cloudflare {
  type Env = globalThis.Env;
}
