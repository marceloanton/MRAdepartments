import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type QueueItem = {
  id: string;
  tenantId: string;
  userId: string | null;
  role: string | null;
  eventKey: string;
  title: string;
  body: string | null;
  createdAt: Date;
};

type DbMockConfig = {
  queue: QueueItem[];
  recipientBatches?: Array<Array<{ email: string }>>;
};

type UpdateSetPayload = Record<string, unknown>;

function createDbMock(config: DbMockConfig) {
  const recipientQueue = [...(config.recipientBatches ?? [])];
  const updateSetCalls: UpdateSetPayload[] = [];

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn((payload: UpdateSetPayload) => {
    updateSetCalls.push(payload);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set: updateSet }));

  const select = vi.fn((shape?: unknown) => {
    if (shape) {
      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => recipientQueue.shift() ?? []),
        })),
      };
    }

    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => config.queue),
          })),
        })),
      })),
    };
  });

  return {
    db: { select, update },
    updateSetCalls,
    updateSet,
  };
}

const { getDbMock, isSmtpConfiguredMock, sendEmailFallbackMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  isSmtpConfiguredMock: vi.fn(),
  sendEmailFallbackMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: getDbMock,
}));

vi.mock("@/lib/notifications", () => ({
  isSmtpConfigured: isSmtpConfiguredMock,
  sendEmailFallback: sendEmailFallbackMock,
}));

import { GET } from "@/app/api/cron/notifications/route";

describe("GET /api/cron/notifications", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  function buildRequest() {
    return new Request("http://localhost/api/cron/notifications", {
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : undefined,
    });
  }

  it("returns unauthorized when CRON_SECRET is set and authorization header is missing/wrong", async () => {
    process.env.CRON_SECRET = "top-secret";

    const missingHeaderRequest = new Request("http://localhost/api/cron/notifications");
    const missingHeaderResponse = await GET(missingHeaderRequest);
    expect(missingHeaderResponse.status).toBe(401);
    await expect(missingHeaderResponse.json()).resolves.toEqual({ error: "Unauthorized" });

    const wrongHeaderRequest = new Request("http://localhost/api/cron/notifications", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const wrongHeaderResponse = await GET(wrongHeaderRequest);
    expect(wrongHeaderResponse.status).toBe(401);
    await expect(wrongHeaderResponse.json()).resolves.toEqual({ error: "Unauthorized" });

    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("resolves recipient by userId and marks notification sent when SMTP is configured", async () => {
    const dbMock = createDbMock({
      queue: [
        {
          id: "n-1",
          tenantId: "tenant-1",
          userId: "u-1",
          role: null,
          eventKey: "ticket_assigned:t-1",
          title: "Nuevo ticket",
          body: "Revisar unidad",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      recipientBatches: [[{ email: "user1@example.com" }]],
    });

    getDbMock.mockReturnValue(dbMock.db);
    isSmtpConfiguredMock.mockReturnValue(true);
    sendEmailFallbackMock.mockResolvedValue({ status: "sent" });

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendEmailFallbackMock).toHaveBeenCalledTimes(1);
    expect(sendEmailFallbackMock).toHaveBeenCalledWith(
      "user1@example.com",
      expect.objectContaining({
        tenantId: "tenant-1",
        eventKey: "ticket_assigned:t-1",
        targetUserId: "u-1",
      }),
    );
    expect(dbMock.updateSetCalls).toContainEqual(expect.objectContaining({ status: "sent", lastError: null }));
  });

  it("resolves recipients by role and marks notification sent", async () => {
    const dbMock = createDbMock({
      queue: [
        {
          id: "n-2",
          tenantId: "tenant-1",
          userId: null,
          role: "supervisor",
          eventKey: "task_created:task-1",
          title: "Nueva tarea",
          body: "Limpiar unidad",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      recipientBatches: [[{ email: "sup1@example.com" }, { email: "sup2@example.com" }]],
    });

    getDbMock.mockReturnValue(dbMock.db);
    isSmtpConfiguredMock.mockReturnValue(true);
    sendEmailFallbackMock.mockResolvedValue({ status: "sent" });

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendEmailFallbackMock).toHaveBeenCalledTimes(2);
    expect(sendEmailFallbackMock).toHaveBeenNthCalledWith(1, "sup1@example.com", expect.any(Object));
    expect(sendEmailFallbackMock).toHaveBeenNthCalledWith(2, "sup2@example.com", expect.any(Object));
    expect(dbMock.updateSetCalls).toContainEqual(expect.objectContaining({ status: "sent", lastError: null }));
  });

  it("marks notification failed when target is ambiguous (userId + role)", async () => {
    const dbMock = createDbMock({
      queue: [
        {
          id: "n-3",
          tenantId: "tenant-1",
          userId: "u-2",
          role: "supervisor",
          eventKey: "task_created:task-2",
          title: "Ambiguo",
          body: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    getDbMock.mockReturnValue(dbMock.db);
    isSmtpConfiguredMock.mockReturnValue(true);

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(dbMock.updateSetCalls).toContainEqual(
      expect.objectContaining({
        status: "failed",
        lastError: "Notification target is ambiguous: userId and role are both set.",
      }),
    );
  });

  it("marks notification failed when SMTP is not configured", async () => {
    const dbMock = createDbMock({
      queue: [
        {
          id: "n-4",
          tenantId: "tenant-1",
          userId: "u-4",
          role: null,
          eventKey: "task_created:task-4",
          title: "Sin SMTP",
          body: "No envia",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      recipientBatches: [[{ email: "user4@example.com" }]],
    });

    getDbMock.mockReturnValue(dbMock.db);
    isSmtpConfiguredMock.mockReturnValue(false);

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(sendEmailFallbackMock).not.toHaveBeenCalled();
    expect(dbMock.updateSetCalls).toContainEqual(
      expect.objectContaining({ status: "failed", lastError: "SMTP is not configured" }),
    );
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });
});
