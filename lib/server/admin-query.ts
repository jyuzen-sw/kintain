import { DateTimeValidationError, parseWorkDate, toJstWorkDate } from "@/lib/domain/datetime";
import { HttpError } from "@/lib/server/http";

export interface AdminAuditQuery {
  limit: number;
  entityType?: "attendance_record" | "attendance_request";
  entityId?: string;
}

export function readWorkDate(request: Request): string {
  const workDate =
    new URL(request.url).searchParams.get("date") ?? toJstWorkDate(new Date());
  try {
    parseWorkDate(workDate);
    return workDate;
  } catch (error) {
    if (error instanceof DateTimeValidationError) {
      throw new HttpError(400, error.code, error.message);
    }
    throw error;
  }
}

export function readOptionalSiteId(request: Request): string | undefined {
  const siteId = new URL(request.url).searchParams.get("siteId")?.trim();
  return siteId || undefined;
}

export function readAdminAuditQuery(request: Request): AdminAuditQuery {
  const params = new URL(request.url).searchParams;
  const requestedLimit = Number(params.get("limit") ?? "100");
  const rawEntityType = params.get("entityType")?.trim();
  let entityType: AdminAuditQuery["entityType"];
  if (rawEntityType === "attendance_record" || rawEntityType === "attendance_request") {
    entityType = rawEntityType;
  } else if (rawEntityType) {
    throw new HttpError(400, "INVALID_AUDIT_ENTITY_TYPE", "監査対象の種類を確認してください。");
  }
  const entityId = params.get("entityId")?.trim();
  if (entityId && entityId.length > 200) {
    throw new HttpError(400, "INVALID_AUDIT_ENTITY_ID", "監査対象の識別子を確認してください。");
  }
  return {
    limit: Number.isInteger(requestedLimit) ? requestedLimit : 100,
    entityType,
    entityId: entityId || undefined,
  };
}
