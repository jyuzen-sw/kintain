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
import { parseInput, utcDateTimeSchema } from "@/lib/server/validation";

const updateSchema = z.object({
  clockInAt: utcDateTimeSchema.nullable(),
  clockOutAt: utcDateTimeSchema.nullable(),
  actualBreakMinutes: z.number().int().min(0).max(1_440).nullable(),
  note: z.string().trim().max(500).nullable(),
  reason: z.string().trim().max(500).nullable(),
  version: z.number().int().nonnegative(),
  clientRequestId: z.uuid(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    await assertCsrf(session, request);
    const input = parseInput(updateSchema, await readJsonBody(request));
    const { recordId } = await context.params;
    const record = await new AttendanceService(database).updateRecord({
      actor: session.user,
      recordId,
      expectedVersion: input.version,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt,
      actualBreakMinutes: input.actualBreakMinutes,
      note: input.note,
      reason: input.reason,
      mutationId: input.clientRequestId,
    });
    return jsonResponse({ data: record });
  } catch (error) {
    return errorResponse(error);
  }
}
