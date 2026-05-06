"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt, lt, ne, or, isNull, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";

import { getDb } from "@/db/client";
import { getDefaultTenantId, listLatestAgentActionLogsByTenant } from "@/db/queries";
import {
  agentActionLog,
  appUsers,
  events,
  evidence,
  notifications,
  offlineOpsLog,
  operationalClosures,
  reservations,
  tasks,
  tickets,
  units,
} from "@/db/schema";
import type { ParsedReservationImport } from "@/lib/csv";
import type { EventType, Priority, Role, Task, TicketStatus, UnitStatus } from "@/lib/domain";
import { createServiceRoleClient } from "@/lib/server";

type Actor = {
  id: string;
  tenantId: string;
  role: Role;
};

const OFFLINE_TENANT_ID = "offline-tenant";
type OfflineOp =
  | {
      opId: string;
      type: "create_unit";
      payload: {
        code: string;
        address: string;
        zone: string;
        owner?: string;
        floor?: string;
        bedrooms?: number;
        imageUrl?: string;
      };
    }
  | {
      opId: string;
      type: "update_unit_status";
      payload: {
        code: string;
        status: UnitStatus;
      };
    }
  | {
      opId: string;
      type: "create_ticket";
      payload: {
        unitCode: string;
        title: string;
        category: string;
        priority: Priority;
        assigneeId?: string;
      };
    }
  | {
      opId: string;
      type: "create_task";
      payload: {
        unitCode: string;
        title: string;
        role: Task["role"];
        assigneeId?: string;
      };
    }
  | {
      opId: string;
      type: "import_reservation";
      payload: {
        unitCode: string;
        platform: string;
        guest: string;
        checkIn: string;
        checkOut: string;
        notes?: string;
      };
    }
  | {
      opId: string;
      type: "create_evidence";
      payload: {
        unitCode: string;
        ticketTitle?: string;
        kind: string;
        url: string;
        sizeKb?: number;
      };
    };

async function getActorOrThrow(actorUserId: string): Promise<Actor> {
  if (!actorUserId) throw new Error("actor_user_id is required");
  const db = getDb();
  const tenantId = await getDefaultTenantId();
  const [actor] = await db
    .select({ id: appUsers.id, tenantId: appUsers.tenantId, role: appUsers.role })
    .from(appUsers)
    .where(and(eq(appUsers.id, actorUserId), eq(appUsers.tenantId, tenantId), eq(appUsers.active, true)))
    .limit(1);

  if (!actor) throw new Error("Actor not found or inactive.");
  return actor as Actor;
}

async function getSessionActorOrThrow(): Promise<Actor> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; role?: string; tenantId?: string } | undefined;
  const actorUserId = sessionUser?.id;
  if (!actorUserId) throw new Error("Not authenticated.");
  if (sessionUser?.tenantId === OFFLINE_TENANT_ID && sessionUser.role) {
    return {
      id: actorUserId,
      tenantId: OFFLINE_TENANT_ID,
      role: sessionUser.role as Role,
    };
  }
  return getActorOrThrow(actorUserId);
}

function assertRole(actor: Actor, allowed: Role[]) {
  if (!allowed.includes(actor.role)) {
    throw new Error(`Role '${actor.role}' is not allowed for this action.`);
  }
}

const agentSuggestionSchema = z.object({
  agentName: z.enum(["TriageAgent", "DispatchAgent", "SLAAgent", "CommsAgent", "ReviewAgent"]),
  suggestion: z.string().min(5),
  status: z.enum(["suggested", "accepted", "rejected"]).default("suggested"),
  reviewerId: z.string().uuid().optional(),
});

const updateUnitSchema = z.object({
  unitId: z.string().uuid(),
  code: z.string().min(2).max(32),
  address: z.string().min(5).max(220),
  zone: z.string().min(2).max(80),
  owner: z.string().min(2).max(120),
  floor: z.string().min(1).max(20),
  bedrooms: z.number().int().min(0).max(20),
  status: z.enum(["pendiente_limpieza", "en_limpieza", "mantenimiento", "inspeccion", "lista", "bloqueada"]),
  imageUrl: z.string().optional(),
});

const bulkDispatchCriticalTicketsSchema = z.object({
  unitIds: z.array(z.string().uuid()).min(1),
  assigneeId: z.string().uuid().optional(),
  dueInHours: z.number().int().min(1).max(168).optional(),
});

function assertReservationWindow(checkIn: Date, checkOut: Date) {
  if (!(checkIn.getTime() > checkOut.getTime())) {
    throw new Error("La reserva debe tener check-out antes de check-in.");
  }
}

function windowsOverlap(a: { checkIn: Date; checkOut: Date }, b: { checkIn: Date; checkOut: Date }) {
  return a.checkOut < b.checkIn && a.checkIn > b.checkOut;
}

async function ensureNoReservationOverlap(params: {
  tenantId: string;
  unitId: string;
  checkIn: Date;
  checkOut: Date;
  excludeId?: string;
}) {
  const db = getDb();
  const filters = [
    eq(reservations.tenantId, params.tenantId),
    eq(reservations.unitId, params.unitId),
    lt(reservations.checkOutAt, params.checkIn),
    gt(reservations.checkInAt, params.checkOut),
  ];
  if (params.excludeId) filters.push(ne(reservations.id, params.excludeId));
  const [overlap] = await db.select({ id: reservations.id }).from(reservations).where(and(...filters)).limit(1);
  if (overlap) throw new Error("Existe conflicto de ventana con otra reserva en esta unidad.");
}

export async function createUnitAction(formData: FormData) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const address = String(formData.get("address") ?? "").trim();
  const zone = String(formData.get("zone") ?? "").trim();

  if (!code || !address || !zone) {
    throw new Error("code, address and zone are required");
  }

  await db.insert(units).values({
    tenantId,
    code,
    address: address.endsWith("CABA") ? address : `${address}, CABA`,
    zone,
    ownerName: String(formData.get("owner") ?? "Owner demo"),
    status: "pendiente_limpieza",
    metadata: {
      imageUrl: String(formData.get("imageUrl") ?? ""),
      bedrooms: Number(formData.get("bedrooms") ?? 1),
      floor: String(formData.get("floor") ?? "1A"),
    },
  });

  revalidatePath("/");
}

export async function updateUnitStatusAction(unitId: string, status: UnitStatus) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  await db
    .update(units)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(units.id, unitId), eq(units.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function updateUnitAction(input: unknown) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;

  const parsed = updateUnitSchema.parse(input);

  await db
    .update(units)
    .set({
      code: parsed.code.trim().toUpperCase(),
      address: parsed.address.trim().endsWith("CABA") ? parsed.address.trim() : `${parsed.address.trim()}, CABA`,
      zone: parsed.zone.trim(),
      ownerName: parsed.owner.trim(),
      status: parsed.status,
      metadata: {
        imageUrl: parsed.imageUrl ?? "",
        bedrooms: parsed.bedrooms,
        floor: parsed.floor.trim(),
      },
      updatedAt: new Date(),
    })
    .where(and(eq(units.id, parsed.unitId), eq(units.tenantId, actor.tenantId)));

  revalidatePath("/");
}

export async function deleteUnitAction(unitId: string) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;

  const [hasTickets, hasTasks, hasReservations, hasClosures] = await Promise.all([
    db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.tenantId, actor.tenantId), eq(tickets.unitId, unitId))).limit(1),
    db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, actor.tenantId), eq(tasks.unitId, unitId))).limit(1),
    db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.tenantId, actor.tenantId), eq(reservations.unitId, unitId)))
      .limit(1),
    db
      .select({ id: operationalClosures.id })
      .from(operationalClosures)
      .where(and(eq(operationalClosures.tenantId, actor.tenantId), eq(operationalClosures.unitId, unitId)))
      .limit(1),
  ]);

  if (hasTickets.length || hasTasks.length || hasReservations.length || hasClosures.length) {
    throw new Error("No se puede eliminar: la unidad tiene datos operativos asociados.");
  }

  await db.delete(units).where(and(eq(units.id, unitId), eq(units.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function createTicketAction(formData: FormData) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;
  const priority = String(formData.get("priority") ?? "normal") as Priority;

  await db.insert(tickets).values({
    tenantId,
    unitId: String(formData.get("unitId")),
    title: String(formData.get("title") ?? "Nueva incidencia"),
    category: String(formData.get("category") ?? "mantenimiento"),
    priority,
    status: "nuevo",
    source: "supervisor",
    assignedToId: String(formData.get("assigneeId")),
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * (priority === "critico" ? 1 : 8)),
  });

  revalidatePath("/");
}

export async function updateTicketStatusAction(ticketId: string, status: TicketStatus) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const [ticket] = await db
    .select({ assignedToId: tickets.assignedToId, tenantId: tickets.tenantId })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, actor.tenantId)))
    .limit(1);
  if (!ticket) throw new Error("Ticket not found.");
  if (!["admin", "supervisor"].includes(actor.role) && ticket.assignedToId !== actor.id) {
    throw new Error("Not allowed to update this ticket.");
  }

  await db
    .update(tickets)
    .set({ status, closedAt: status === "resuelto" || status === "cerrado" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function bulkDispatchCriticalTicketsAction(input: unknown) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return { updated: 0 };

  const parsed = bulkDispatchCriticalTicketsSchema.parse(input);
  const unitIds = Array.from(new Set(parsed.unitIds));
  if (unitIds.length === 0) return { updated: 0 };

  const updateData: {
    updatedAt: Date;
    assignedToId?: string | null;
    dueAt?: Date | null;
  } = {
    updatedAt: new Date(),
  };

  if (parsed.assigneeId) {
    updateData.assignedToId = parsed.assigneeId;
  }
  if (typeof parsed.dueInHours === "number") {
    updateData.dueAt = new Date(Date.now() + parsed.dueInHours * 60 * 60 * 1000);
  }

  const updatedRows = await db
    .update(tickets)
    .set(updateData)
    .where(
      and(
        eq(tickets.tenantId, actor.tenantId),
        inArray(tickets.unitId, unitIds),
        eq(tickets.priority, "critico"),
        notInArray(tickets.status, ["resuelto", "cerrado"]),
      ),
    )
    .returning({ id: tickets.id });

  await db.insert(events).values({
    tenantId: actor.tenantId,
    type: "bulk_dispatch_critical",
    actorUserId: actor.id,
    entityType: "ticket",
    entityId: updatedRows[0]?.id ?? actor.id,
    payload: {
      unitIdsCount: unitIds.length,
      updated: updatedRows.length,
      assigneeId: parsed.assigneeId ?? null,
      dueInHours: typeof parsed.dueInHours === "number" ? parsed.dueInHours : null,
    },
  });

  revalidatePath("/");
  return { updated: updatedRows.length };
}

export async function listRecentBulkRiskActionsAction() {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return [];

  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      createdAt: events.createdAt,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.tenantId, actor.tenantId),
        inArray(events.type, ["bulk_dispatch_critical", "bulk_mark_units_ready", "bulk_resolve_critical"]),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(20);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    payload: row.payload ?? {},
  }));
}

export async function createTaskAction(formData: FormData) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;
  const role = String(formData.get("role") ?? "mantenimiento") as Task["role"];

  await db.insert(tasks).values({
    tenantId,
    unitId: String(formData.get("unitId")),
    title: String(formData.get("title") ?? "Nueva tarea"),
    role,
    assignedToId: String(formData.get("assigneeId")),
    status: "nuevo",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
  });

  revalidatePath("/");
}

export async function importReservationsAction(rows: ParsedReservationImport[]) {
  if (rows.length === 0) return { imported: 0 };

  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return { imported: 0 };
  const tenantId = actor.tenantId;

  await db.transaction(async (tx) => {
    const keys = new Set<string>();
    const pendingByUnit = new Map<string, Array<{ checkIn: Date; checkOut: Date; rowKey: string }>>();
    for (const row of rows) {
      const key = `${row.unitId}:${new Date(row.checkIn).toISOString()}`;
      if (keys.has(key)) throw new Error(`Duplicate reservation in import: ${key}`);
      keys.add(key);

      const checkInAt = new Date(row.checkIn);
      const checkOutAt = new Date(row.checkOut);
      assertReservationWindow(checkInAt, checkOutAt);
      const pending = pendingByUnit.get(row.unitId) ?? [];
      for (const previous of pending) {
        if (windowsOverlap(previous, { checkIn: checkInAt, checkOut: checkOutAt })) {
          throw new Error(`Reservation overlap conflict inside CSV: ${row.unitId}`);
        }
      }
      pending.push({ checkIn: checkInAt, checkOut: checkOutAt, rowKey: key });
      pendingByUnit.set(row.unitId, pending);
    }

    for (const row of rows) {
      const checkInAt = new Date(row.checkIn);
      const checkOutAt = new Date(row.checkOut);
      assertReservationWindow(checkInAt, checkOutAt);
      const [existing] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.tenantId, tenantId),
            eq(reservations.unitId, row.unitId),
            eq(reservations.checkInAt, new Date(row.checkIn)),
          ),
        )
        .limit(1);
      if (existing) throw new Error(`Existing reservation conflict: ${row.unitId}:${row.checkIn}`);
      const [overlap] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.tenantId, tenantId),
            eq(reservations.unitId, row.unitId),
            lt(reservations.checkOutAt, checkInAt),
            gt(reservations.checkInAt, checkOutAt),
          ),
        )
        .limit(1);
      if (overlap) throw new Error(`Reservation overlap conflict: ${row.unitId}`);
    }

    await tx.insert(reservations).values(
      rows.map((row) => ({
        tenantId,
        unitId: row.unitId,
        source: row.platform,
        guestName: row.guest,
        checkInAt: new Date(row.checkIn),
        checkOutAt: new Date(row.checkOut),
        notes: row.notes,
        metadata: {},
      })),
    );
  });

  revalidatePath("/");
  return { imported: rows.length };
}

export async function createReservationAction(input: {
  unitId: string;
  platform: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  notes?: string;
  guestData?: {
    primary: {
      fullName: string;
      documentType: "dni" | "pasaporte";
      documentNumber: string;
      nationality?: string;
      phone?: string;
      email?: string;
      photoDataUrl?: string;
      photoPath?: string;
    };
    occupants: Array<{
      fullName: string;
      documentType: "dni" | "pasaporte";
      documentNumber: string;
      nationality?: string;
    }>;
  };
}) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const checkIn = new Date(input.checkIn);
  const checkOut = new Date(input.checkOut);
  assertReservationWindow(checkIn, checkOut);
  await ensureNoReservationOverlap({
    tenantId: actor.tenantId,
    unitId: input.unitId,
    checkIn,
    checkOut,
  });
  await db.insert(reservations).values({
    tenantId: actor.tenantId,
    unitId: input.unitId,
    source: input.platform,
    guestName: input.guest,
    checkInAt: checkIn,
    checkOutAt: checkOut,
    notes: input.notes || null,
    metadata: input.guestData ?? {},
  });
  revalidatePath("/");
}

export async function updateReservationAction(input: {
  reservationId: string;
  unitId: string;
  platform: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  notes?: string;
  guestData?: {
    primary: {
      fullName: string;
      documentType: "dni" | "pasaporte";
      documentNumber: string;
      nationality?: string;
      phone?: string;
      email?: string;
      photoDataUrl?: string;
      photoPath?: string;
    };
    occupants: Array<{
      fullName: string;
      documentType: "dni" | "pasaporte";
      documentNumber: string;
      nationality?: string;
    }>;
  };
}) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const checkIn = new Date(input.checkIn);
  const checkOut = new Date(input.checkOut);
  assertReservationWindow(checkIn, checkOut);
  await ensureNoReservationOverlap({
    tenantId: actor.tenantId,
    unitId: input.unitId,
    checkIn,
    checkOut,
    excludeId: input.reservationId,
  });
  await db
    .update(reservations)
    .set({
      unitId: input.unitId,
      source: input.platform,
      guestName: input.guest,
      checkInAt: checkIn,
      checkOutAt: checkOut,
      notes: input.notes || null,
      metadata: input.guestData ?? {},
      updatedAt: new Date(),
    })
    .where(and(eq(reservations.id, input.reservationId), eq(reservations.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function deleteReservationAction(reservationId: string) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  await db.delete(reservations).where(and(eq(reservations.id, reservationId), eq(reservations.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function createOperationalClosureAction(input: {
  unitId: string;
  ticketId?: string;
  checklist: Record<string, boolean>;
  evidenceRequired: boolean;
  evidenceCount: number;
  notes?: string;
}) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  if (input.evidenceRequired && input.evidenceCount <= 0) {
    throw new Error("Se requiere al menos una evidencia para cerrar.");
  }

  if (!["admin", "supervisor"].includes(actor.role)) {
    if (input.ticketId) {
      const [ticket] = await db
        .select({ id: tickets.id, assignedToId: tickets.assignedToId })
        .from(tickets)
        .where(and(eq(tickets.id, input.ticketId), eq(tickets.tenantId, actor.tenantId), eq(tickets.unitId, input.unitId)))
        .limit(1);
      if (!ticket || ticket.assignedToId !== actor.id) {
        throw new Error("Not allowed to close this unit.");
      }
    } else {
      const [assignedTask] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.tenantId, actor.tenantId), eq(tasks.unitId, input.unitId), eq(tasks.assignedToId, actor.id)))
        .limit(1);
      if (!assignedTask) throw new Error("Not allowed to close this unit.");
    }
  }

  await db.insert(operationalClosures).values({
    tenantId: actor.tenantId,
    unitId: input.unitId,
    ticketId: input.ticketId || null,
    actorUserId: actor.id,
    checklist: input.checklist,
    evidenceRequired: input.evidenceRequired,
    evidenceCount: input.evidenceCount,
    notes: input.notes || null,
    closedAt: new Date(),
  });

  revalidatePath("/");
}

export async function updateTaskStatusAction(taskId: string, status: TicketStatus) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const [task] = await db
    .select({ assignedToId: tasks.assignedToId, tenantId: tasks.tenantId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, actor.tenantId)))
    .limit(1);
  if (!task) throw new Error("Task not found.");
  if (!["admin", "supervisor"].includes(actor.role) && task.assignedToId !== actor.id) {
    throw new Error("Not allowed to update this task.");
  }
  await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, actor.tenantId)));
  revalidatePath("/");
}

export async function createEvidenceAction(formData: FormData) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;
  const ticketId = String(formData.get("ticketId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");

  const storagePath = String(formData.get("storagePath") ?? "").trim();
  await db.insert(evidence).values({
    tenantId,
    ticketId: ticketId || null,
    taskId: taskId || null,
    kind: String(formData.get("kind") ?? "photo"),
    url: storagePath || String(formData.get("url") ?? ""),
    uploadedById: actor.id,
    sizeKb: Number(formData.get("sizeKb") ?? 0) || null,
  });

  revalidatePath("/");
}

export async function uploadEvidencePhotoAction(input: { path: string; dataUrl: string; contentType?: string }) {
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return input.path.trim();
  const normalizedPath = input.path.trim();
  if (!normalizedPath) throw new Error("Evidence path is required.");
  if (!input.dataUrl.startsWith("data:")) throw new Error("Invalid evidence payload.");

  const supabase = createServiceRoleClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");

  const [, base64Payload] = input.dataUrl.split(",", 2);
  if (!base64Payload) throw new Error("Invalid base64 evidence payload.");

  const bytes = Buffer.from(base64Payload, "base64");
  const contentType = input.contentType ?? "image/jpeg";

  const { error } = await supabase.storage.from("evidence").upload(normalizedPath, bytes, {
    contentType,
    upsert: true,
  });

  if (error) throw error;
  return normalizedPath;
}

export async function uploadGuestPhotoAction(input: { path: string; dataUrl: string; contentType?: string }) {
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) {
    return { path: input.path.trim(), signedUrl: input.dataUrl };
  }
  const normalizedPath = input.path.trim();
  if (!normalizedPath) throw new Error("Guest photo path is required.");
  if (!input.dataUrl.startsWith("data:")) throw new Error("Invalid guest photo payload.");

  const supabase = createServiceRoleClient();
  if (!supabase) throw new Error("Supabase service role key is not configured.");

  const [, base64Payload] = input.dataUrl.split(",", 2);
  if (!base64Payload) throw new Error("Invalid base64 guest photo payload.");

  const bytes = Buffer.from(base64Payload, "base64");
  const contentType = input.contentType ?? "image/jpeg";

  const { error } = await supabase.storage.from("evidence").upload(normalizedPath, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;

  const { data, error: signedError } = await supabase.storage.from("evidence").createSignedUrl(normalizedPath, 60 * 60 * 24 * 30);
  if (signedError || !data?.signedUrl) {
    return { path: normalizedPath, signedUrl: null as string | null };
  }
  return { path: normalizedPath, signedUrl: data.signedUrl };
}

export async function getEvidenceSignedUrlAction(path: string) {
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return null;
  const normalizedPath = path.trim();
  if (!normalizedPath) return null;

  const supabase = createServiceRoleClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage.from("evidence").createSignedUrl(normalizedPath, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function createOperationalNotificationAction(input: {
  actorUserId?: string;
  targetUserId?: string;
  type: EventType;
  entityType: string;
  entityId: string;
  title: string;
  body?: string;
  role?: Role;
}) {
  const db = getDb();
  if (input.targetUserId && input.role) {
    throw new Error("Notification target is ambiguous: provide targetUserId or role, not both.");
  }
  const target = input.targetUserId
    ? { userId: input.targetUserId, role: null as Role | null }
    : { userId: null as string | null, role: (input.role ?? "supervisor") as Role };

  const actor = input.actorUserId
    ? await getActorOrThrow(input.actorUserId)
    : await auth().then((session) => {
        const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
        return sessionUserId ? getActorOrThrow(sessionUserId) : null;
      });

  const tenantId = actor?.tenantId ?? (await getDefaultTenantId());
  if (tenantId === OFFLINE_TENANT_ID) return;
  const eventKey = `${input.type}:${input.entityId}`;
  const [existing] = await db
    .select({ id: notifications.id, status: notifications.status })
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.eventKey, eventKey)))
    .limit(1);

  if (existing) {
    await db
      .update(notifications)
      .set({
        title: input.title,
        body: input.body,
        userId: target.userId,
        role: target.role,
        status: existing.status === "failed" ? "pending" : existing.status,
        read: false,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, existing.id));

    revalidatePath("/");
    return;
  }

  await db.insert(events).values({
    tenantId,
    type: input.type,
    actorUserId: actor ? actor.id : null,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: {
      title: input.title,
      body: input.body,
      role: input.role,
    },
  });

  await db.insert(notifications).values({
    tenantId,
    userId: target.userId,
    role: target.role,
    channel: "in_app",
    status: "pending",
    read: false,
    eventKey,
    title: input.title,
    body: input.body,
  });

  revalidatePath("/");
}

export async function markNotificationReadAction(notificationId: string) {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.tenantId, actor.tenantId),
        or(eq(notifications.userId, actor.id), and(isNull(notifications.userId), eq(notifications.role, actor.role))),
      ),
    );
  revalidatePath("/");
}

export async function markAllNotificationsReadAction() {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;
  await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.read, false),
        or(eq(notifications.userId, actor.id), and(isNull(notifications.userId), eq(notifications.role, actor.role))),
      ),
    );
  revalidatePath("/");
}

export async function ensureDemoUsersAction() {
  const db = getDb();
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return;
  const tenantId = actor.tenantId;

  await db
    .insert(appUsers)
    .values([
      { tenantId, email: "admin@demo.local", name: "Mora Admin", role: "admin", zone: "Todas" },
      { tenantId, email: "supervisor@demo.local", name: "Leo Supervisor", role: "supervisor", zone: "Centro" },
      { tenantId, email: "limpieza@demo.local", name: "Equipo Limpieza A", role: "limpieza", zone: "Palermo" },
      { tenantId, email: "mantenimiento@demo.local", name: "Rafa Mantenimiento", role: "mantenimiento", zone: "Recoleta" },
    ])
    .onConflictDoNothing();

  revalidatePath("/");
}

export async function syncOfflineOpsAction(ops: OfflineOp[]) {
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) {
    return { applied: 0, failed: ops.length, skipped: 0 };
  }

  const db = getDb();
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const op of ops) {
    const opId = op.opId?.trim();
    if (!opId) {
      failed += 1;
      continue;
    }

    const [existingLog] = await db
      .select({ status: offlineOpsLog.status })
      .from(offlineOpsLog)
      .where(and(eq(offlineOpsLog.tenantId, actor.tenantId), eq(offlineOpsLog.opId, opId)))
      .limit(1);

    if (existingLog?.status === "applied") {
      skipped += 1;
      continue;
    }

    try {
      if (op.type === "create_unit") {
        const code = op.payload.code.trim().toUpperCase();
        if (!code) throw new Error("invalid code");
        await db.insert(units).values({
          tenantId: actor.tenantId,
          code,
          address: op.payload.address.endsWith("CABA") ? op.payload.address : `${op.payload.address}, CABA`,
          zone: op.payload.zone,
          ownerName: op.payload.owner ?? "Owner demo",
          status: "pendiente_limpieza",
          metadata: {
            imageUrl: op.payload.imageUrl ?? "",
            bedrooms: op.payload.bedrooms ?? 1,
            floor: op.payload.floor ?? "1A",
          },
        });
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      if (op.type === "update_unit_status") {
        await db
          .update(units)
          .set({ status: op.payload.status, updatedAt: new Date() })
          .where(and(eq(units.tenantId, actor.tenantId), eq(units.code, op.payload.code)));
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      if (op.type === "create_ticket") {
        const [unit] = await db
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.tenantId, actor.tenantId), eq(units.code, op.payload.unitCode)))
          .limit(1);
        if (!unit) throw new Error("unit not found");
        await db.insert(tickets).values({
          tenantId: actor.tenantId,
          unitId: unit.id,
          title: op.payload.title,
          category: op.payload.category,
          priority: op.payload.priority,
          status: "nuevo",
          source: "offline_sync",
          assignedToId: op.payload.assigneeId || null,
          dueAt: new Date(Date.now() + 1000 * 60 * 60 * (op.payload.priority === "critico" ? 1 : 8)),
        });
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      if (op.type === "create_task") {
        const [unit] = await db
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.tenantId, actor.tenantId), eq(units.code, op.payload.unitCode)))
          .limit(1);
        if (!unit) throw new Error("unit not found");
        await db.insert(tasks).values({
          tenantId: actor.tenantId,
          unitId: unit.id,
          title: op.payload.title,
          role: op.payload.role,
          assignedToId: op.payload.assigneeId || null,
          status: "nuevo",
          dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
        });
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      if (op.type === "import_reservation") {
        const [unit] = await db
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.tenantId, actor.tenantId), eq(units.code, op.payload.unitCode)))
          .limit(1);
        if (!unit) throw new Error("unit not found");
        const checkInAt = new Date(op.payload.checkIn);
        const checkOutAt = new Date(op.payload.checkOut);
        assertReservationWindow(checkInAt, checkOutAt);
        await ensureNoReservationOverlap({
          tenantId: actor.tenantId,
          unitId: unit.id,
          checkIn: checkInAt,
          checkOut: checkOutAt,
        });
        await db.insert(reservations).values({
          tenantId: actor.tenantId,
          unitId: unit.id,
          source: op.payload.platform,
          guestName: op.payload.guest,
          checkInAt,
          checkOutAt,
          notes: op.payload.notes || null,
        });
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      if (op.type === "create_evidence") {
        const [unit] = await db
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.tenantId, actor.tenantId), eq(units.code, op.payload.unitCode)))
          .limit(1);
        if (!unit) throw new Error("unit not found");

        let ticketId: string | null = null;
        if (op.payload.ticketTitle) {
          const [ticket] = await db
            .select({ id: tickets.id })
            .from(tickets)
            .where(and(eq(tickets.tenantId, actor.tenantId), eq(tickets.unitId, unit.id), eq(tickets.title, op.payload.ticketTitle)))
            .limit(1);
          ticketId = ticket?.id ?? null;
        }

        await db.insert(evidence).values({
          tenantId: actor.tenantId,
          ticketId,
          taskId: null,
          kind: op.payload.kind,
          url: op.payload.url,
          uploadedById: actor.id,
          sizeKb: op.payload.sizeKb ?? null,
        });
        applied += 1;
        await db
          .insert(offlineOpsLog)
          .values({
            tenantId: actor.tenantId,
            opId,
            opType: op.type,
            payload: op.payload,
            status: "applied",
            error: null,
            appliedAt: new Date(),
            actorUserId: actor.id,
          })
          .onConflictDoUpdate({
            target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
            set: {
              opType: op.type,
              payload: op.payload,
              status: "applied",
              error: null,
              appliedAt: new Date(),
              actorUserId: actor.id,
              updatedAt: new Date(),
            },
          });
        continue;
      }
      throw new Error(`Unsupported offline op type: ${String((op as { type?: string }).type ?? "unknown")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      await db
        .insert(offlineOpsLog)
        .values({
          tenantId: actor.tenantId,
          opId,
          opType: op.type,
          payload: op.payload,
          status: "failed",
          error: message,
          appliedAt: null,
          actorUserId: actor.id,
        })
        .onConflictDoUpdate({
          target: [offlineOpsLog.tenantId, offlineOpsLog.opId],
          set: {
            opType: op.type,
            payload: op.payload,
            status: "failed",
            error: message,
            appliedAt: null,
            actorUserId: actor.id,
            updatedAt: new Date(),
          },
        });
      failed += 1;
    }
  }

  revalidatePath("/");
  return { applied, failed, skipped };
}

export async function logAgentSuggestionAction(input: unknown) {
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) {
    return null;
  }

  const parsed = agentSuggestionSchema.parse(input);
  const db = getDb();
  const reviewedAt = parsed.status === "suggested" ? null : new Date();

  const [created] = await db
    .insert(agentActionLog)
    .values({
      tenantId: actor.tenantId,
      agentName: parsed.agentName,
      entityType: "agent_suggestion",
      entityId: actor.id,
      input: { suggestion: parsed.suggestion },
      output: {},
      decision: parsed.status,
      reviewedById: parsed.reviewerId ?? null,
      reviewedAt,
    })
    .returning();

  revalidatePath("/");
  return created;
}

export async function listAgentSuggestionLogsAction() {
  const actor = await getSessionActorOrThrow();
  assertRole(actor, ["admin", "supervisor"]);
  if (actor.tenantId === OFFLINE_TENANT_ID) return [];
  return listLatestAgentActionLogsByTenant(actor.tenantId);
}
