const JST = "Asia/Tokyo";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const shortDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST,
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseWorkDate(workDate: string): Date {
  return new Date(`${workDate}T00:00:00+09:00`);
}

export function formatJstDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return dateFormatter.format(date);
}

export function formatWorkDate(workDate: string): string {
  return dateFormatter.format(parseWorkDate(workDate));
}

export function formatWorkDateShort(workDate: string): string {
  return shortDateFormatter.format(parseWorkDate(workDate));
}

export function formatJstTime(value: string | Date | null): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

export function formatJstDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function currentJstMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function currentJstWorkDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}年${monthNumber}月`;
}

export function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toTimeInput(value: string | null): string {
  return value ? formatJstTime(value) : "";
}

export function jstTimeToUtc(workDate: string, time: string): string | null {
  if (!time) return null;
  const value = new Date(`${workDate}T${time}:00+09:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}
