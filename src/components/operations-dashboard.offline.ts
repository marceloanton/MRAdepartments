export type OfflineOp = Record<string, unknown> & { opId: string };

function createOfflineOpId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `op-${crypto.randomUUID()}`;
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ensureOfflineOp(op: Record<string, unknown>): OfflineOp {
  const opId = typeof op.opId === "string" && op.opId.length > 0 ? op.opId : createOfflineOpId();
  return { ...op, opId };
}

export function getOfflineSyncSkippedInfo(skipped: number) {
  return `${skipped} operaciones ya estaban aplicadas y se omitieron.`;
}
