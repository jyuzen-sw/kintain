import { AttendanceService } from "@/lib/server/attendance-service";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
): Promise<Response> {
  try {
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    const { recordId } = await context.params;
    const logs = await new AttendanceService(database).getRecordAuditHistory({
      actor: session.user,
      recordId,
    });
    return jsonResponse({ data: { logs } });
  } catch (error) {
    return errorResponse(error);
  }
}
