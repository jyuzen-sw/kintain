import { z } from "zod";

import { AttendanceService } from "@/lib/server/attendance-service";
import { assertCsrf, requireSession } from "@/lib/server/auth";
import { getDatabase, getRuntimeEnv } from "@/lib/server/db";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import {
  assertTrustedMutation,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/server/http";
import { parseInput, utcDateTimeSchema } from "@/lib/server/validation";

const locationSchema = z
  .object({
    state: z.enum(["granted", "denied", "unavailable", "timeout"]),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    accuracyMeters: z.number().nonnegative().max(100_000).nullable(),
    capturedAt: utcDateTimeSchema.nullable(),
  })
  .superRefine((location, context) => {
    if (
      location.state === "granted" &&
      (location.latitude === null || location.longitude === null || location.accuracyMeters === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "取得済みの位置情報には座標と精度が必要です。",
      });
    } else if (
      location.state !== "granted" &&
      (location.latitude !== null ||
        location.longitude !== null ||
        location.accuracyMeters !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "位置情報を取得していない場合は座標を送信できません。",
      });
    }
  });

const punchSchema = z.object({
  type: z.enum(["clock_in", "clock_out"]),
  clientRequestId: z.string().uuid("打刻識別子が正しくありません。"),
  location: locationSchema,
});

export async function POST(request: Request): Promise<Response> {
  try {
    const publicDemoMode = isPublicDemoMode(getRuntimeEnv());
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["employee"]);
    await assertCsrf(session, request);
    const input = parseInput(punchSchema, await readJsonBody(request));
    const today = await new AttendanceService(database).punch({
      user: session.user,
      type: input.type,
      clientRequestId: input.clientRequestId,
      location: publicDemoMode
        ? {
            state: "unavailable",
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            capturedAt: null,
          }
        : input.location,
    });
    return jsonResponse({
      data: { ...today, user: session.user, publicDemoMode },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
