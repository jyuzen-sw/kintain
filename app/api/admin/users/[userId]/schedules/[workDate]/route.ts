import { z } from "zod";

import { AttendanceService } from "@/lib/server/attendance-service";
import { assertCsrf, requireSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";
import {
  assertTrustedMutation,
  errorResponse,
  jsonResponse,
  noStoreHeaders,
  readJsonBody,
} from "@/lib/server/http";
import { parseInput, utcDateTimeSchema } from "@/lib/server/validation";

const paramsSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  workDate: z.iso.date("対象日を正しく入力してください。"),
});

const scheduleIdSchema = z
  .string()
  .trim()
  .min(1, "勤務予定の識別子が不正です。")
  .max(200, "勤務予定の識別子が不正です。");

const saveSchema = z
  .object({
    scheduleId: scheduleIdSchema.nullable(),
    version: z.number().int().positive().nullable(),
    siteId: z.string().trim().min(1, "現場を選択してください。").max(200),
    scheduledStartAt: utcDateTimeSchema,
    scheduledEndAt: utcDateTimeSchema,
    scheduledBreakMinutes: z.number().int().min(0).max(1_440).nullable(),
    note: z.string().trim().max(500).nullable(),
    clientRequestId: z.uuid("再送用の識別子が不正です。"),
  })
  .superRefine((value, context) => {
    if ((value.scheduleId === null) !== (value.version === null)) {
      context.addIssue({
        code: "custom",
        message: "勤務予定の識別子とversionを確認してください。",
        path: ["version"],
      });
    }
  });

const deleteSchema = z.object({
  scheduleId: scheduleIdSchema,
  version: z.number().int().positive(),
  clientRequestId: z.uuid("再送用の識別子が不正です。"),
});

type RouteContext = {
  params: Promise<{ userId: string; workDate: string }>;
};

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["admin"]);
    await assertCsrf(session, request);
    const params = parseInput(paramsSchema, await context.params);
    const input = parseInput(saveSchema, await readJsonBody(request));
    const schedule = await new AttendanceService(database).saveWorkSchedule({
      actor: session.user,
      userId: params.userId,
      workDate: params.workDate,
      scheduleId: input.scheduleId,
      expectedVersion: input.version,
      siteId: input.siteId,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduledBreakMinutes: input.scheduledBreakMinutes,
      note: input.note,
      mutationId: input.clientRequestId,
    });
    return jsonResponse({ data: schedule }, { status: input.scheduleId === null ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertTrustedMutation(request);
    const database = getDatabase();
    const session = await requireSession(database, request, ["admin"]);
    await assertCsrf(session, request);
    const params = parseInput(paramsSchema, await context.params);
    const input = parseInput(deleteSchema, await readJsonBody(request));
    await new AttendanceService(database).deleteWorkSchedule({
      actor: session.user,
      userId: params.userId,
      workDate: params.workDate,
      scheduleId: input.scheduleId,
      expectedVersion: input.version,
      mutationId: input.clientRequestId,
    });
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
