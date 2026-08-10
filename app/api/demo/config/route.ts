import { getRuntimeEnv } from "@/lib/server/db";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { jsonResponse } from "@/lib/server/http";

const demoAccounts = [
  { displayName: "〇〇さん", email: "maru.employee@example.test", password: "DemoPass!2026", role: "employee" },
  { displayName: "✖✖さん", email: "batsu.employee@example.test", password: "DemoPass!2026", role: "employee" },
  { displayName: "△△さん", email: "sankaku.employee@example.test", password: "DemoPass!2026", role: "employee" },
  { displayName: "□□さん", email: "shikaku.employee@example.test", password: "DemoPass!2026", role: "employee" },
  { displayName: "◇◇さん", email: "hishi.employee@example.test", password: "DemoPass!2026", role: "employee" },
  { displayName: "デモ管理者", email: "admin@example.test", password: "AdminDemo!2026", role: "admin" },
] as const;

export function GET(): Response {
  const runtimeEnv = getRuntimeEnv();
  const enabled = isPublicDemoMode(runtimeEnv);
  return jsonResponse({
    data: {
      enabled,
      accounts: enabled ? demoAccounts : [],
    },
  });
}
