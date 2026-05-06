import { describe, expect, it, vi } from "vitest";

import { ensureOfflineOp, getOfflineSyncSkippedInfo } from "./operations-dashboard.offline";

describe("ensureOfflineOp", () => {
  it("normalizes legacy offline ops without opId by generating one", () => {
    const randomUUIDSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-uuid");

    const normalized = ensureOfflineOp({
      type: "create_unit",
      payload: { code: "PAL-101" },
    });

    expect(normalized).toEqual({
      opId: "op-fixed-uuid",
      type: "create_unit",
      payload: { code: "PAL-101" },
    });

    randomUUIDSpy.mockRestore();
  });
});

describe("getOfflineSyncSkippedInfo", () => {
  it("shows skipped count in sync info message", () => {
    expect(getOfflineSyncSkippedInfo(3)).toBe("3 operaciones ya estaban aplicadas y se omitieron.");
  });
});
