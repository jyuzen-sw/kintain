import { AttendanceService } from "@/lib/server/attendance-service";
import { requireSession } from "@/lib/server/auth";
import { getDatabase, getRuntimeEnv } from "@/lib/server/db";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const publicDemoMode = isPublicDemoMode(getRuntimeEnv());
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    const today = await new AttendanceService(database).getToday(session.user.id);
    return jsonResponse({
      data: {
        ...today,
        user: session.user,
        publicDemoMode,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
