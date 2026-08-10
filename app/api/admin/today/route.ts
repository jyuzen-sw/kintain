import { AttendanceService } from "@/lib/server/attendance-service";
import { readWorkDate } from "@/lib/server/admin-query";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    await requireSession(database, request, ["admin"]);
    const workDate = readWorkDate(request);
    const serverNow = new Date().toISOString();
    const repository = new AttendanceService(database).repositoryForAdmin;
    const [rows, employees, sites] = await Promise.all([
      repository.listDailyAttendance(workDate, undefined, serverNow),
      repository.listEmployees(),
      repository.listSites(),
    ]);
    return jsonResponse({ data: { serverNow, workDate, rows, employees, sites } });
  } catch (error) {
    return errorResponse(error);
  }
}
