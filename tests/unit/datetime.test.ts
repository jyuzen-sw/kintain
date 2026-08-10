import { describe, expect, it } from "vitest";

import {
  DateTimeValidationError,
  formatJstDateWithWeekday,
  formatJstTime,
  getJapaneseWeekday,
  getJstWeekday,
  isSameJstWorkDate,
  parseUtcDateTime,
  parseWorkDate,
  toJstWorkDate,
  toUtcDateTime,
} from "../../lib/domain/datetime";

describe("JST日時", () => {
  it("UTCの同じ日でもJSTの勤務日へ変換する", () => {
    expect(toJstWorkDate("2026-08-09T14:59:59.000Z")).toBe("2026-08-09");
    expect(toJstWorkDate("2026-08-09T15:00:00.000Z")).toBe("2026-08-10");
  });

  it("JSTで時刻を分単位表示する", () => {
    expect(formatJstTime("2026-08-06T05:40:00.000Z")).toBe("14:40");
  });

  it("Dateやオフセット付きISO文字列をUTC ISO文字列へ正規化する", () => {
    expect(toUtcDateTime("2026-08-06T14:40:00+09:00")).toBe(
      "2026-08-06T05:40:00.000Z",
    );
    expect(toUtcDateTime(new Date("2026-08-06T05:40:00.000Z"))).toBe(
      "2026-08-06T05:40:00.000Z",
    );
  });

  it("保存値としてUTC以外のISO文字列を受け付けない", () => {
    expect(() => parseUtcDateTime("2026-08-06T14:40:00+09:00")).toThrowError(
      new DateTimeValidationError(
        "INVALID_UTC_DATETIME",
        "日時はUTCのISO-8601形式で指定してください。",
      ),
    );
  });

  it("ISO形式でも存在しないUTC日時を受け付けない", () => {
    expect(() => parseUtcDateTime("2026-02-30T00:00:00.000Z")).toThrow(
      "日時に実在する日時を指定してください。",
    );
  });
});

describe("勤務日と曜日", () => {
  it("Excel原案の曜日ずれを引き継がず正しい日本語曜日を返す", () => {
    expect(getJapaneseWeekday("2026-08-01")).toBe("土");
    expect(getJapaneseWeekday("2026-08-10")).toBe("月");
    expect(getJstWeekday("2026-08-09T15:00:00.000Z")).toBe("月");
  });

  it("日本語の日付と曜日を固定形式で表示する", () => {
    expect(formatJstDateWithWeekday("2026-08-10")).toBe(
      "2026年8月10日（月）",
    );
  });

  it("UTC日付が異なってもJST勤務日が同じなら同日と判定する", () => {
    expect(
      isSameJstWorkDate(
        "2026-08-09T23:30:00.000Z",
        "2026-08-10T01:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("存在しない勤務日を日本語エラーで拒否する", () => {
    expect(() => parseWorkDate("2026-02-30")).toThrow(
      "勤務日に実在する日付を指定してください。",
    );
  });
});
