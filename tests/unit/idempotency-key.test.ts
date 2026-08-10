import { describe, expect, it } from "vitest";

import { createIdempotencyKeyTracker } from "../../lib/client/id";

describe("変更操作の再送識別子", () => {
  it("同じ内容の再試行では同じ識別子を使い、内容を変えた新操作では更新する", () => {
    const tracker = createIdempotencyKeyTracker();
    const first = tracker.keyForPayload({ note: "最初の内容", version: 1 });

    expect(
      tracker.keyForPayload({ note: "最初の内容", version: 1 }),
    ).toBe(first);

    const changed = tracker.keyForPayload({ note: "変更後の内容", version: 1 });
    expect(changed).not.toBe(first);
    expect(
      tracker.keyForPayload({ note: "変更後の内容", version: 1 }),
    ).toBe(changed);
  });
});
