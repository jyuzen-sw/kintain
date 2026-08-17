import { z } from "zod";

import { loginWithPassword } from "@/lib/server/auth";
import { serializeCsrfCookie, serializeSessionCookie } from "@/lib/server/cookies";
import { getDatabase, getRuntimeEnv } from "@/lib/server/db";
import { ensurePublicDemoBootstrap } from "@/lib/server/demo-bootstrap";
import {
  assertTrustedMutation,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/http";
import { parseInput } from "@/lib/server/validation";

const loginSchema = z.object({
  email: z.string().min(1, "メールアドレスを入力してください。").max(254),
  password: z.string().min(1, "パスワードを入力してください。").max(256),
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const input = parseInput(loginSchema, await readJsonBody(request));
    const database = getDatabase();
    const runtimeEnv = getRuntimeEnv();
    await ensurePublicDemoBootstrap({
      database,
      environment: runtimeEnv,
    });
    const result = await loginWithPassword({
      database,
      environment: runtimeEnv,
      request,
      email: input.email,
      password: input.password,
    });
    const maxAge = Math.max(
      0,
      Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1_000),
    );
    const headers = new Headers();
    headers.append("set-cookie", serializeSessionCookie(request.url, result.sessionToken, maxAge));
    headers.append("set-cookie", serializeCsrfCookie(request.url, result.csrfToken, maxAge));
    return jsonResponse({ data: { user: result.user } }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
