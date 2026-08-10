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

const createSchema = z.object({
  workDate: z.iso.date("対象日を正しく入力してください。"),
  requestedCategory: z.enum(["paid_leave", "absence", "sick_leave", "other"]),
  reason: z.string().trim().min(1, "理由・備考を入力してください。").max(500),
  clientRequestId: z.uuid("再送用の識別子が不正です。"),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    const requests = await new AttendanceService(database).listRequests(session.user.id);
    return jsonResponse({ data: { requests } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    await assertCsrf(session, request);
    const input = parseInput(createSchema, await readJsonBody(request));
    const created = await new AttendanceService(database).createRequest({
      userId: session.user.id,
      ...input,
    });
    return jsonResponse({ data: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
