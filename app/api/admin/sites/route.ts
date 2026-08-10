import { AttendanceService } from "@/lib/server/attendance-service";
import { readOptionalSiteId, readWorkDate } from "@/lib/server/admin-query";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    await requireSession(database, request, ["admin"]);
    const workDate = readWorkDate(request);
    const siteId = readOptionalSiteId(request);
    const serverNow = new Date().toISOString();
    const repository = new AttendanceService(database).repositoryForAdmin;
    const [rows, sites] = await Promise.all([
      repository.listDailyAttendance(workDate, siteId, serverNow),
      repository.listSites(),
    ]);
    return jsonResponse({
      data: { serverNow, workDate, siteId: siteId ?? null, sites, rows },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
