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

const reviewSchema = z.object({
  version: z.number().int().positive(),
  reviewComment: z.string().trim().max(500).nullable().default(null),
  clientRequestId: z.uuid(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["admin"]);
    await assertCsrf(session, request);
    const input = parseInput(reviewSchema, await readJsonBody(request));
    const { requestId } = await context.params;
    const updated = await new AttendanceService(database).reviewRequest({
      actor: session.user,
      requestId,
      expectedVersion: input.version,
      decision: "approve",
      reviewComment: input.reviewComment,
      clientRequestId: input.clientRequestId,
    });
    return jsonResponse({ data: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
