import { describe, expect, it } from "vitest";

import {
  AttendanceRequestValidationError,
  assertNoActiveRequest,
  assertRequestCanBeApproved,
  assertRequestCategory,
  assertRequestTransition,
  isActiveRequestStatus,
  isSameRequestCreation,
  isSameRequestReview,
  isSameRequestTransition,
  transitionRequestStatus,
} from "../../lib/domain/requests";

describe("申請状態遷移", () => {
  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
    ["withdraw", "withdrawn"],
  ] as const)("申請中を %s すると %s になる", (decision, expected) => {
    expect(transitionRequestStatus("pending", decision)).toBe(expected);
  });

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "終端状態 %s の再処理を拒否する",
    (status) => {
      expect(() => transitionRequestStatus(status, "approve")).toThrow(
        `${status === "approved" ? "承認済み" : status === "rejected" ? "却下" : "取消済み"}の申請は承認済みへ変更できません。`,
      );
    },
  );

  it("申請中のまま更新する遷移も拒否する", () => {
    expect(() => assertRequestTransition("pending", "pending")).toThrowError(
      AttendanceRequestValidationError,
    );
  });
});

describe("申請制約", () => {
  it("有休・欠勤・病欠・その他だけを申請区分として認める", () => {
    expect(() => assertRequestCategory("paid_leave")).not.toThrow();
    expect(() => assertRequestCategory("absence")).not.toThrow();
    expect(() => assertRequestCategory("sick_leave")).not.toThrow();
    expect(() => assertRequestCategory("other")).not.toThrow();
    expect(() => assertRequestCategory("work")).toThrow(
      "通常勤務への変更は申請できません。",
    );
  });

  it("申請中または承認済みを有効な申請として扱う", () => {
    expect(isActiveRequestStatus("pending")).toBe(true);
    expect(isActiveRequestStatus("approved")).toBe(true);
    expect(isActiveRequestStatus("rejected")).toBe(false);
    expect(isActiveRequestStatus("withdrawn")).toBe(false);
  });

  it("同日の有効な申請があるときは重複申請を拒否する", () => {
    expect(() =>
      assertNoActiveRequest([{ status: "rejected" }, { status: "withdrawn" }]),
    ).not.toThrow();
    expect(() => assertNoActiveRequest([{ status: "pending" }])).toThrow(
      "同じ勤務日には申請中または承認済みの申請を複数登録できません。",
    );
  });
});

describe("申請承認時の打刻競合", () => {
  it("対象日に打刻がなければ申請中の申請を承認できる", () => {
    expect(() =>
      assertRequestCanBeApproved({
        status: "pending",
        clockInAt: null,
        clockOutAt: null,
      }),
    ).not.toThrow();
  });

  it.each([
    { clockInAt: "2026-08-09T23:00:00.000Z", clockOutAt: null },
    { clockInAt: null, clockOutAt: "2026-08-10T08:00:00.000Z" },
  ])("出勤・退勤のどちらか一方でも打刻があれば承認を拒否する", (punch) => {
    expect(() =>
      assertRequestCanBeApproved({ status: "pending", ...punch }),
    ).toThrow(
      "対象日に打刻実績があるため承認できません。先に個人実績で競合を解消してください。",
    );
  });

  it("承認済み申請の二重承認を打刻確認より先に拒否する", () => {
    expect(() =>
      assertRequestCanBeApproved({ status: "approved", clockInAt: null }),
    ).toThrow("承認済みの申請は承認済みへ変更できません。");
  });
});

describe("申請操作の再送識別", () => {
  const creation = {
    userId: "user-employee",
    workDate: "2026-08-10",
    requestedCategory: "paid_leave" as const,
    reason: "私用のため",
  };

  it("同じ利用者が同じ申請内容を再送したときだけ同じ作成操作とみなす", () => {
    expect(isSameRequestCreation(creation, { ...creation })).toBe(true);
    expect(
      isSameRequestCreation(creation, {
        ...creation,
        reason: "別の理由",
      }),
    ).toBe(false);
    expect(
      isSameRequestCreation(creation, {
        ...creation,
        userId: "other-user",
      }),
    ).toBe(false);
  });

  it("同じ申請を同じ終端状態へ進めたときだけ同じ状態遷移とみなす", () => {
    expect(
      isSameRequestTransition(
        { id: "request-1", status: "withdrawn" },
        { requestId: "request-1", status: "withdrawn" },
      ),
    ).toBe(true);
    expect(
      isSameRequestTransition(
        { id: "request-1", status: "approved" },
        { requestId: "request-1", status: "rejected" },
      ),
    ).toBe(false);
    expect(
      isSameRequestTransition(
        { id: "request-2", status: "withdrawn" },
        { requestId: "request-1", status: "withdrawn" },
      ),
    ).toBe(false);
  });

  it("審査再送は申請・判断・審査者・コメント・元versionが完全一致したときだけ同じ操作とみなす", () => {
    const reviewed = {
      id: "request-1",
      status: "approved" as const,
      reviewerUserId: "admin-1",
      reviewComment: "承認します",
      version: 2,
    };
    const attempted = {
      requestId: "request-1",
      status: "approved" as const,
      reviewerUserId: "admin-1",
      reviewComment: "承認します",
      expectedVersion: 1,
    };
    expect(isSameRequestReview(reviewed, attempted)).toBe(true);
    expect(
      isSameRequestReview(reviewed, {
        ...attempted,
        reviewComment: "別コメント",
      }),
    ).toBe(false);
    expect(
      isSameRequestReview(reviewed, {
        ...attempted,
        reviewerUserId: "admin-2",
      }),
    ).toBe(false);
    expect(
      isSameRequestReview(reviewed, { ...attempted, expectedVersion: 2 }),
    ).toBe(false);
  });
});
