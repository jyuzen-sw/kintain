import { assertCsrf, requireSession } from "@/lib/server/auth";
import { getDatabase, getRuntimeEnv } from "@/lib/server/db";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { resetDemoAttendanceData } from "@/lib/server/demo-reset";
import {
  assertTrustedMutation,
  errorResponse,
  HttpError,
  jsonResponse,
} from "@/lib/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const runtimeEnv = getRuntimeEnv();
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["admin"]);
    await assertCsrf(session, request);
    if (!isPublicDemoMode(runtimeEnv)) {
      throw new HttpError(404, "DEMO_RESET_DISABLED", "デモリセットは無効です。");
    }
    await resetDemoAttendanceData({ database, actorUserId: session.user.id });
    return jsonResponse({ data: { reset: true } });
  } catch (error) {
    return errorResponse(error);
  }
}
