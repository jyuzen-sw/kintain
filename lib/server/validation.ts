import { z } from "zod";

import { HttpError } from "@/lib/server/http";

export const utcDateTimeSchema = z
  .iso.datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new HttpError(422, "VALIDATION_ERROR", "入力内容を確認してください。", {
    fieldErrors,
  });
}
