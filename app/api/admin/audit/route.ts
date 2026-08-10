import { AttendanceService } from "@/lib/server/attendance-service";
import { readAdminAuditQuery } from "@/lib/server/admin-query";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    await requireSession(database, request, ["admin"]);
    const filters = readAdminAuditQuery(request);
    const logs = await new AttendanceService(database).repositoryForAdmin.listAuditLogs(filters);
    return jsonResponse({ data: { logs } });
  } catch (error) {
    return errorResponse(error);
  }
}
