import { AttendanceService } from "@/lib/server/attendance-service";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const database = getDatabase();
    await requireSession(database, request, ["admin"]);
    const employees = await new AttendanceService(database).repositoryForAdmin.listEmployees();
    return jsonResponse({ data: { employees } });
  } catch (error) {
    return errorResponse(error);
  }
}
