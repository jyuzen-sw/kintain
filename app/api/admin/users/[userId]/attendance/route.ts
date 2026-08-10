import { AttendanceService } from "@/lib/server/attendance-service";
import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, HttpError, jsonResponse } from "@/lib/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const database = getDatabase();
    await requireSession(database, request, ["admin"]);
    const { userId } = await context.params;
    const service = new AttendanceService(database);
    const employees = await service.repositoryForAdmin.listEmployees();
    const employee = employees.find((item) => item.id === userId);
    if (!employee) {
      throw new HttpError(404, "USER_NOT_FOUND", "従業員が見つかりません。");
    }
    const month = new URL(request.url).searchParams.get("month") ?? "";
    const days = await service.getMonth(userId, month);
    return jsonResponse({ data: { employee, month, days } });
  } catch (error) {
    return errorResponse(error);
  }
}
