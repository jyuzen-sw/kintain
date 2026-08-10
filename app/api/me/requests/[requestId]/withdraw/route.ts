import { z } from "zod";

import { AttendanceService } from "@/lib/server/attendance-service";
import { assertCsrf, requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import {
  assertTrustedMutation,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/http";
import { parseInput } from "@/lib/server/validation";

const withdrawSchema = z.object({
  version: z.number().int().positive(),
  clientRequestId: z.uuid("再送用の識別子が不正です。"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    await assertCsrf(session, request);
    const input = parseInput(withdrawSchema, await readJsonBody(request));
    const { requestId } = await context.params;
    const updated = await new AttendanceService(database).withdrawRequest({
      actor: session.user,
      requestId,
      expectedVersion: input.version,
      clientRequestId: input.clientRequestId,
    });
    return jsonResponse({ data: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
