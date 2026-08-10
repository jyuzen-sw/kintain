import { requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(getDatabase(), request);
    return jsonResponse({ data: { user: session.user } });
  } catch (error) {
    return errorResponse(error);
  }
}
