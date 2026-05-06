import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkDispatchCriticalTicketsAction,
  createOperationalClosureAction,
  createReservationAction,
  createOperationalNotificationAction,
  createUnitAction,
  listRecentBulkRiskActionsAction,
  logAgentSuggestionAction,
  markAllNotificationsReadAction,
  syncOfflineOpsAction,
  updateReservationAction,
  updateTaskStatusAction,
  updateTicketStatusAction,
} from "@/app/actions";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getDefaultTenantId } from "@/db/queries";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getDefaultTenantId: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(),
}));

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function buildDb(limitQueue: unknown[]): DbMock {
  const queue = [...limitQueue];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const limit = vi.fn(async () => {
          const next = queue.shift();
          return Array.isArray(next) ? next : [];
        });
        return {
          limit,
          orderBy: vi.fn(() => ({ limit })),
        };
      }),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => [{ id: "agent-log-1" }]),
      onConflictDoUpdate: vi.fn(async () => undefined),
      onConflictDoNothing: vi.fn(async () => undefined),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => []),
      })),
    })),
  }));

  return { select, insert, update };
}

describe("actions authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDefaultTenantId).mockResolvedValue("tenant-1");
  });

  it("rejects createUnitAction when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(getDb).mockReturnValue(buildDb([]) as never);

    const form = new FormData();
    form.set("code", "pal-101");
    form.set("address", "Nicaragua 4512");
    form.set("zone", "Palermo");

    await expect(createUnitAction(form)).rejects.toThrow("Not authenticated.");
  });

  it("rejects createUnitAction for role without permission", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([[{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }]]) as never,
    );

    const form = new FormData();
    form.set("code", "pal-101");
    form.set("address", "Nicaragua 4512");
    form.set("zone", "Palermo");

    await expect(createUnitAction(form)).rejects.toThrow("not allowed");
  });

  it("allows createUnitAction for admin and writes tenant-scoped record", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([[{ id: "u-admin", tenantId: "tenant-1", role: "admin" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const form = new FormData();
    form.set("code", "pal-101");
    form.set("address", "Nicaragua 4512");
    form.set("zone", "Palermo");

    await createUnitAction(form);

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertCall = db.insert.mock.results[0]?.value;
    const valuesMock = insertCall.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        code: "PAL-101",
        address: "Nicaragua 4512, CABA",
      }),
    );
  });

  it("rejects updateTicketStatusAction when actor is not assignee and not supervisor/admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-tech" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([
        [{ id: "u-tech", tenantId: "tenant-1", role: "mantenimiento" }],
        [{ assignedToId: "u-other", tenantId: "tenant-1" }],
      ]) as never,
    );

    await expect(updateTicketStatusAction("ticket-1", "resuelto")).rejects.toThrow("Not allowed");
  });

  it("allows updateTicketStatusAction when actor is the assignee", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-tech" } } as never);
    const db = buildDb([
      [{ id: "u-tech", tenantId: "tenant-1", role: "mantenimiento" }],
      [{ assignedToId: "u-tech", tenantId: "tenant-1" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await updateTicketStatusAction("ticket-1", "resuelto");

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("rejects updateTaskStatusAction when actor is not assignee and not supervisor/admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([
        [{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }],
        [{ assignedToId: "u-other", tenantId: "tenant-1" }],
      ]) as never,
    );

    await expect(updateTaskStatusAction("task-1", "resuelto")).rejects.toThrow("Not allowed");
  });

  it("allows updateTaskStatusAction for supervisor even if not assignee", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([
      [{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }],
      [{ assignedToId: "u-other", tenantId: "tenant-1" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await updateTaskStatusAction("task-1", "resuelto");

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("rejects createOperationalClosureAction when evidence is required and none is provided", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([[{ id: "u-admin", tenantId: "tenant-1", role: "admin" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      createOperationalClosureAction({
        unitId: "unit-1",
        checklist: { bano: true },
        evidenceRequired: true,
        evidenceCount: 0,
      }),
    ).rejects.toThrow("Se requiere al menos una evidencia para cerrar.");

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects createOperationalClosureAction for worker when ticket is not assigned", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([
        [{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }],
        [{ id: "ticket-1", assignedToId: "u-other" }],
      ]) as never,
    );

    await expect(
      createOperationalClosureAction({
        unitId: "unit-1",
        ticketId: "ticket-1",
        checklist: { cocina: true },
        evidenceRequired: false,
        evidenceCount: 0,
      }),
    ).rejects.toThrow("Not allowed to close this unit.");
  });

  it("allows createOperationalClosureAction for worker when assigned ticket matches actor", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    const db = buildDb([
      [{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }],
      [{ id: "ticket-1", assignedToId: "u-clean" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await createOperationalClosureAction({
      unitId: "unit-1",
      ticketId: "ticket-1",
      checklist: { living: true },
      evidenceRequired: false,
      evidenceCount: 0,
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("allows createOperationalClosureAction for admin and supervisor without ticket assignment", async () => {
    for (const role of ["admin", "supervisor"] as const) {
      vi.mocked(auth).mockResolvedValue({ user: { id: `u-${role}` } } as never);
      const db = buildDb([[{ id: `u-${role}`, tenantId: "tenant-1", role }]]);
      vi.mocked(getDb).mockReturnValue(db as never);

      await createOperationalClosureAction({
        unitId: "unit-1",
        checklist: { dormitorio: true },
        evidenceRequired: false,
        evidenceCount: 0,
      });

      expect(db.insert).toHaveBeenCalledTimes(1);
    }
  });

  it("marks all notifications as read scoped by tenant for authenticated actor", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([[{ id: "u-admin", tenantId: "tenant-1", role: "admin" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await markAllNotificationsReadAction();

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("rejects createReservationAction when reservation window is invalid for this app", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([[{ id: "u-admin", tenantId: "tenant-1", role: "admin" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      createReservationAction({
        unitId: "unit-1",
        platform: "manual",
        guest: "Jane Doe",
        checkIn: "2026-05-10T15:00:00.000Z",
        checkOut: "2026-05-11T11:00:00.000Z",
      }),
    ).rejects.toThrow("check-out antes de check-in");

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects createReservationAction when reservation overlaps existing reservation", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [{ id: "res-2" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      createReservationAction({
        unitId: "unit-1",
        platform: "manual",
        guest: "Jane Doe",
        checkIn: "2026-05-12T15:00:00.000Z",
        checkOut: "2026-05-10T11:00:00.000Z",
      }),
    ).rejects.toThrow("Existe conflicto de ventana con otra reserva en esta unidad.");

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects updateReservationAction when reservation window is invalid for this app", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([[{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      updateReservationAction({
        reservationId: "res-1",
        unitId: "unit-1",
        platform: "booking",
        guest: "John Doe",
        checkIn: "2026-06-01T15:00:00.000Z",
        checkOut: "2026-06-02T11:00:00.000Z",
      }),
    ).rejects.toThrow("check-out antes de check-in");

    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects updateReservationAction when reservation overlaps existing reservation", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([
      [{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }],
      [{ id: "res-2" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      updateReservationAction({
        reservationId: "res-1",
        unitId: "unit-1",
        platform: "booking",
        guest: "John Doe",
        checkIn: "2026-06-03T15:00:00.000Z",
        checkOut: "2026-06-01T11:00:00.000Z",
      }),
    ).rejects.toThrow("Existe conflicto de ventana con otra reserva en esta unidad.");

    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects createOperationalNotificationAction when both targetUserId and role are provided", async () => {
    vi.mocked(getDb).mockReturnValue(buildDb([]) as never);

    await expect(
      createOperationalNotificationAction({
        actorUserId: "u-admin",
        targetUserId: "u-target",
        role: "supervisor",
        type: "task_created",
        entityType: "task",
        entityId: "task-1",
        title: "Nueva tarea",
      }),
    ).rejects.toThrow("Notification target is ambiguous");
  });

  it("allows createOperationalNotificationAction when only role is provided", async () => {
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await createOperationalNotificationAction({
      actorUserId: "u-admin",
      role: "supervisor",
      type: "task_created",
      entityType: "task",
      entityId: "task-1",
      title: "Nueva tarea",
    });

    expect(db.insert).toHaveBeenCalledTimes(2);
    const notificationInsertCall = db.insert.mock.results[1]?.value;
    const valuesMock = notificationInsertCall.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        role: "supervisor",
      }),
    );
  });

  it("allows createOperationalNotificationAction when only targetUserId is provided", async () => {
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await createOperationalNotificationAction({
      actorUserId: "u-admin",
      targetUserId: "u-target",
      type: "task_created",
      entityType: "task",
      entityId: "task-1",
      title: "Nueva tarea",
    });

    expect(db.insert).toHaveBeenCalledTimes(2);
    const notificationInsertCall = db.insert.mock.results[1]?.value;
    const valuesMock = notificationInsertCall.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-target",
        role: null,
      }),
    );
  });

  it("returns skipped when syncOfflineOpsAction receives an already applied opId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [{ status: "applied" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "op-1",
        type: "create_unit",
        payload: { code: "pal-101", address: "Nicaragua 4512", zone: "Palermo" },
      },
    ]);

    expect(result).toEqual({ applied: 0, failed: 0, skipped: 1 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("records failed when syncOfflineOpsAction receives missing/invalid opId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([[{ id: "u-admin", tenantId: "tenant-1", role: "admin" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "   ",
        type: "create_unit",
        payload: { code: "pal-101", address: "Nicaragua 4512", zone: "Palermo" },
      },
    ]);

    expect(result).toEqual({ applied: 0, failed: 1, skipped: 0 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns applied when syncOfflineOpsAction executes a valid op", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "op-2",
        type: "create_unit",
        payload: { code: "pal-101", address: "Nicaragua 4512", zone: "Palermo" },
      },
    ]);

    expect(result).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("returns failed count and skipped 0 for offline tenant in syncOfflineOpsAction", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-admin", role: "admin", tenantId: "offline-tenant" },
    } as never);
    vi.mocked(getDb).mockReturnValue(buildDb([]) as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "op-3",
        type: "create_unit",
        payload: { code: "pal-101", address: "Nicaragua 4512", zone: "Palermo" },
      },
      {
        opId: "op-4",
        type: "create_unit",
        payload: { code: "pal-102", address: "Nicaragua 4513", zone: "Palermo" },
      },
    ]);

    expect(result).toEqual({ applied: 0, failed: 2, skipped: 0 });
  });

  it("fails import_reservation with invalid checkIn date and does not apply", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [],
      [{ id: "unit-1" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "op-invalid-date",
        type: "import_reservation",
        payload: {
          unitCode: "PAL-101",
          platform: "manual",
          guest: "Jane Doe",
          checkIn: "not-a-date",
          checkOut: "2026-05-10T11:00:00.000Z",
        },
      },
    ]);

    expect(result).toEqual({ applied: 0, failed: 1, skipped: 0 });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("applies first import_reservation and fails second overlapping one in same batch", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-admin" } } as never);
    const db = buildDb([
      [{ id: "u-admin", tenantId: "tenant-1", role: "admin" }],
      [],
      [{ id: "unit-1" }],
      [],
      [],
      [{ id: "unit-1" }],
      [{ id: "res-overlap" }],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await syncOfflineOpsAction([
      {
        opId: "op-import-1",
        type: "import_reservation",
        payload: {
          unitCode: "PAL-101",
          platform: "manual",
          guest: "Guest A",
          checkIn: "2026-05-12T15:00:00.000Z",
          checkOut: "2026-05-10T11:00:00.000Z",
        },
      },
      {
        opId: "op-import-2",
        type: "import_reservation",
        payload: {
          unitCode: "PAL-101",
          platform: "manual",
          guest: "Guest B",
          checkIn: "2026-05-11T16:00:00.000Z",
          checkOut: "2026-05-09T11:00:00.000Z",
        },
      },
    ]);

    expect(result).toEqual({ applied: 1, failed: 1, skipped: 0 });
  });

  it("rejects logAgentSuggestionAction for limpieza role", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([[{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }]]) as never,
    );

    await expect(
      logAgentSuggestionAction({
        agentName: "TriageAgent",
        suggestion: "Subir prioridad por check-in cercano",
      }),
    ).rejects.toThrow("not allowed");
  });

  it("creates tenant-scoped agent suggestion log for supervisor", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([[{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }]]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await logAgentSuggestionAction({
      agentName: "DispatchAgent",
      suggestion: "Asignar tarea a mantenimiento zona Palermo.",
      status: "accepted",
      reviewerId: "11111111-1111-4111-8111-111111111111",
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertCall = db.insert.mock.results[0]?.value;
    const valuesMock = insertCall.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        agentName: "DispatchAgent",
        decision: "accepted",
        reviewedById: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("rejects bulkDispatchCriticalTicketsAction for limpieza role", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([[{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }]]) as never,
    );

    await expect(
      bulkDispatchCriticalTicketsAction({
        unitIds: ["11111111-1111-4111-8111-111111111111"],
        dueInHours: 4,
      }),
    ).rejects.toThrow("not allowed");
  });

  it("returns updated 0 for offline tenant in bulkDispatchCriticalTicketsAction", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-admin", role: "admin", tenantId: "offline-tenant" },
    } as never);
    const db = buildDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await bulkDispatchCriticalTicketsAction({
      unitIds: ["11111111-1111-4111-8111-111111111111"],
      assigneeId: "22222222-2222-4222-8222-222222222222",
      dueInHours: 8,
    });

    expect(result).toEqual({ updated: 0 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates critical open tickets scoped by tenant and returns affected count", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([[{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }]]);
    const returningMock = vi.fn(async () => [{ id: "t-1" }, { id: "t-2" }]);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    db.update = vi.fn(() => ({ set: setMock }));
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await bulkDispatchCriticalTicketsAction({
      unitIds: [
        "11111111-1111-4111-8111-111111111111",
        "33333333-3333-4333-8333-333333333333",
      ],
      assigneeId: "22222222-2222-4222-8222-222222222222",
      dueInHours: 12,
    });

    expect(result).toEqual({ updated: 2 });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToId: "22222222-2222-4222-8222-222222222222",
        dueAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(returningMock).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    const eventInsertCall = db.insert.mock.results[0]?.value;
    const eventValuesMock = eventInsertCall.values as ReturnType<typeof vi.fn>;
    expect(eventValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        type: "bulk_dispatch_critical",
        actorUserId: "u-super",
        entityType: "ticket",
        entityId: "t-1",
        payload: expect.objectContaining({
          unitIdsCount: 2,
          updated: 2,
          assigneeId: "22222222-2222-4222-8222-222222222222",
          dueInHours: 12,
        }),
      }),
    );
  });

  it("rejects listRecentBulkRiskActionsAction for limpieza role", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-clean" } } as never);
    vi.mocked(getDb).mockReturnValue(
      buildDb([[{ id: "u-clean", tenantId: "tenant-1", role: "limpieza" }]]) as never,
    );

    await expect(listRecentBulkRiskActionsAction()).rejects.toThrow("not allowed");
  });

  it("returns empty list for offline tenant in listRecentBulkRiskActionsAction", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-admin", role: "admin", tenantId: "offline-tenant" },
    } as never);
    const db = buildDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await listRecentBulkRiskActionsAction();

    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists recent bulk risk events for supervisor", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-super" } } as never);
    const db = buildDb([
      [{ id: "u-super", tenantId: "tenant-1", role: "supervisor" }],
      [
        {
          id: "evt-1",
          type: "bulk_dispatch_critical",
          createdAt: new Date("2026-05-06T10:00:00.000Z"),
          payload: { updated: 2 },
        },
      ],
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await listRecentBulkRiskActionsAction();

    expect(result).toEqual([
      {
        id: "evt-1",
        type: "bulk_dispatch_critical",
        createdAt: new Date("2026-05-06T10:00:00.000Z"),
        payload: { updated: 2 },
      },
    ]);
  });
});
