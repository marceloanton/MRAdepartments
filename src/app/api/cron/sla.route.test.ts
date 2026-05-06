import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getAppDataMock, createOperationalNotificationActionMock } = vi.hoisted(() => ({
  getAppDataMock: vi.fn(),
  createOperationalNotificationActionMock: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getAppData: getAppDataMock,
}));

vi.mock("@/app/actions", () => ({
  createOperationalNotificationAction: createOperationalNotificationActionMock,
}));

import { GET } from "@/app/api/cron/sla/route";

describe("GET /api/cron/sla", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  function buildRequest() {
    return new Request("http://localhost/api/cron/sla", {
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : undefined,
    });
  }

  it("returns unauthorized when CRON_SECRET is set and auth header is invalid", async () => {
    process.env.CRON_SECRET = "sla-secret";

    const missingHeaderRequest = new Request("http://localhost/api/cron/sla");
    const missingHeaderResponse = await GET(missingHeaderRequest);
    expect(missingHeaderResponse.status).toBe(401);
    await expect(missingHeaderResponse.json()).resolves.toEqual({ error: "Unauthorized" });

    const wrongHeaderRequest = new Request("http://localhost/api/cron/sla", {
      headers: { authorization: "Bearer bad" },
    });
    const wrongHeaderResponse = await GET(wrongHeaderRequest);
    expect(wrongHeaderResponse.status).toBe(401);
    await expect(wrongHeaderResponse.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns zero alerts and does not persist notifications when no SLA alerts exist", async () => {
    getAppDataMock.mockResolvedValue({
      units: [],
      tickets: [],
      tasks: [],
      reservations: [],
      notifications: [],
      evidence: [],
      closures: [],
      users: [],
      source: "database",
    });

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ alerts: 0, persisted: 0 });
    expect(createOperationalNotificationActionMock).not.toHaveBeenCalled();
  });

  it("persists one notification per alert and returns counts", async () => {
    getAppDataMock.mockResolvedValue({
      units: [
        {
          id: "unit-1",
          code: "PAL-101",
          address: "Nicaragua 4512, CABA",
          zone: "Palermo",
          status: "pendiente_limpieza",
          nextCheckIn: "2026-05-06T15:00:00-03:00",
          owner: "Owner",
          imageUrl: "",
          bedrooms: 2,
          floor: "7B",
        },
      ],
      tickets: [
        {
          id: "tk-1",
          unitId: "unit-1",
          title: "Ticket vencido",
          category: "mantenimiento",
          priority: "alto",
          status: "en_curso",
          assigneeId: "u-1",
          dueAt: "2026-05-01T10:00:00-03:00",
          source: "supervisor",
          evidenceCount: 0,
        },
      ],
      tasks: [],
      reservations: [],
      notifications: [],
      evidence: [],
      closures: [],
      users: [],
      source: "database",
    });
    createOperationalNotificationActionMock.mockResolvedValue(undefined);

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ alerts: 2, persisted: 2 });
    expect(createOperationalNotificationActionMock).toHaveBeenCalledTimes(2);
  });

  it("throws when getAppData fails", async () => {
    getAppDataMock.mockRejectedValue(new Error("db down"));
    await expect(GET(buildRequest())).rejects.toThrow("db down");
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });
});
