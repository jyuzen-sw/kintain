import { AttendanceService } from "@/lib/server/attendance-service";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    const month = new URL(request.url).searchParams.get("month") ?? "";
    const days = await new AttendanceService(database).getMonth(session.user.id, month);
    return jsonResponse({ data: { days } });
  } catch (error) {
    return errorResponse(error);
  }
}
