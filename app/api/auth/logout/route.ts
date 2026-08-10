import { assertCsrf, getAuthenticatedSession } from "@/lib/server/auth";
import { expiredSessionCookies, readSessionToken } from "@/lib/server/cookies";
import { sha256Base64Url } from "@/lib/server/crypto";
import { getDatabase } from "@/lib/server/db";
import { D1AuthRepository } from "@/lib/repositories/d1-auth-repository";
import {
  assertTrustedMutation,
  errorResponse,
  jsonResponse,
} from "@/lib/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await getAuthenticatedSession(database, request);
    if (session) await assertCsrf(session, request);
    const token = readSessionToken(request);
    if (token) {
      await new D1AuthRepository(database).deleteSession(await sha256Base64Url(token));
    }
    const headers = new Headers();
    for (const cookie of expiredSessionCookies()) headers.append("set-cookie", cookie);
    return jsonResponse({ data: null }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
