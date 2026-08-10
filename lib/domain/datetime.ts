export const JST_TIME_ZONE = "Asia/Tokyo" as const;

export type UtcDateTime = string;
export type WorkDate = string;
export type JapaneseWeekday =
  | "日"
  | "月"
  | "火"
  | "水"
  | "木"
  | "金"
  | "土";

export type DateTimeErrorCode =
  | "INVALID_UTC_DATETIME"
  | "INVALID_WORK_DATE";

export class DateTimeValidationError extends Error {
  readonly name = "DateTimeValidationError";

  constructor(
    readonly code: DateTimeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const WORK_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const JAPANESE_WEEKDAYS: readonly JapaneseWeekday[] = [
  "日",
  "月",
  "火",
  "水",
  "木",
  "金",
  "土",
];
const JST_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const JST_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: JST_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface WorkDateParts {
  year: number;
  month: number;
  day: number;
}

export function parseUtcDateTime(value: UtcDateTime): Date {
  if (typeof value !== "string" || !UTC_ISO_PATTERN.test(value)) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時はUTCのISO-8601形式で指定してください。",
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時に実在する日時を指定してください。",
    );
  }

  const canonicalInput = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_match, milliseconds: string) =>
        `.${milliseconds.padEnd(3, "0")}Z`,
      )
    : value.replace(/Z$/, ".000Z");
  if (parsed.toISOString() !== canonicalInput) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時に実在する日時を指定してください。",
    );
  }

  return parsed;
}

export function toUtcDateTime(value: Date | string): UtcDateTime {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時に実在する日時を指定してください。",
    );
  }

  return parsed.toISOString();
}

export function parseWorkDate(workDate: WorkDate): WorkDateParts {
  const matched = WORK_DATE_PATTERN.exec(workDate);
  if (!matched) {
    throw new DateTimeValidationError(
      "INVALID_WORK_DATE",
      "勤務日はYYYY-MM-DD形式で指定してください。",
    );
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new DateTimeValidationError(
      "INVALID_WORK_DATE",
      "勤務日に実在する日付を指定してください。",
    );
  }

  return { year, month, day };
}

export function toJstWorkDate(value: UtcDateTime | Date): WorkDate {
  const date = value instanceof Date ? value : parseUtcDateTime(value);
  if (Number.isNaN(date.getTime())) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時に実在する日時を指定してください。",
    );
  }

  const parts = JST_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時を日本時間の勤務日に変換できませんでした。",
    );
  }

  return `${year}-${month}-${day}`;
}

export function getJapaneseWeekday(workDate: WorkDate): JapaneseWeekday {
  const { year, month, day } = parseWorkDate(workDate);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  const weekday = JAPANESE_WEEKDAYS[date.getUTCDay()];

  if (!weekday) {
    throw new DateTimeValidationError(
      "INVALID_WORK_DATE",
      "勤務日の曜日を判定できませんでした。",
    );
  }

  return weekday;
}

export function getJstWeekday(
  value: WorkDate | UtcDateTime | Date,
): JapaneseWeekday {
  if (value instanceof Date) {
    return getJapaneseWeekday(toJstWorkDate(value));
  }

  return getJapaneseWeekday(
    WORK_DATE_PATTERN.test(value) ? value : toJstWorkDate(value),
  );
}

export function formatJstTime(value: UtcDateTime | Date): string {
  const date = value instanceof Date ? value : parseUtcDateTime(value);
  if (Number.isNaN(date.getTime())) {
    throw new DateTimeValidationError(
      "INVALID_UTC_DATETIME",
      "日時に実在する日時を指定してください。",
    );
  }

  return JST_TIME_FORMATTER.format(date);
}

export function formatJstDateWithWeekday(
  value: WorkDate | UtcDateTime | Date,
): string {
  const workDate =
    value instanceof Date
      ? toJstWorkDate(value)
      : WORK_DATE_PATTERN.test(value)
        ? value
        : toJstWorkDate(value);
  const { year, month, day } = parseWorkDate(workDate);

  return `${year}年${month}月${day}日（${getJapaneseWeekday(workDate)}）`;
}

export function isSameJstWorkDate(
  left: UtcDateTime | Date,
  right: UtcDateTime | Date,
): boolean {
  return toJstWorkDate(left) === toJstWorkDate(right);
}
