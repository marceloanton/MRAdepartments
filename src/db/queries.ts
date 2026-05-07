import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

import { getDb } from "./client";
import {
  appUsers,
  evidence as evidenceTable,
  notifications as notificationsTable,
  agentActionLog as agentActionLogTable,
  operationalClosures as operationalClosuresTable,
  reservations as reservationsTable,
  tasks as tasksTable,
  tenants,
  tickets as ticketsTable,
  units as unitsTable,
} from "./schema";
import type { AppData } from "@/lib/app-data";
import { createServiceRoleClient } from "@/lib/server";
import {
  agentActionLogs as mockAgentActionLogs,
  evidenceItems as mockEvidence,
  notifications as mockNotifications,
  operationalClosures as mockClosures,
  reservations as mockReservations,
  tasks as mockTasks,
  tickets as mockTickets,
  units as mockUnits,
  users as mockUsers,
  type Reservation,
  type Task,
  type Ticket,
  type Unit,
  type User,
  createFakeApartmentImage,
} from "@/lib/domain";

export const defaultTenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "mranalytics_departments";

type UnitMetadata = {
  imageUrl?: string;
  bedrooms?: number;
  floor?: string;
};

export async function getAppData(input?: { actorRole?: string | null; actorUserId?: string | null }): Promise<AppData> {
  try {
    const db = getDb();
    const tenant = await getDefaultTenantId();

    const actorRole = input?.actorRole ?? null;
    const actorUserId = input?.actorUserId ?? null;
    const notificationsScope =
      actorUserId && actorRole
        ? and(
            eq(notificationsTable.tenantId, tenant),
            or(
              eq(notificationsTable.userId, actorUserId),
              and(isNull(notificationsTable.userId), eq(notificationsTable.role, actorRole as never)),
            ),
          )
        : actorUserId
          ? and(eq(notificationsTable.tenantId, tenant), eq(notificationsTable.userId, actorUserId))
          : actorRole
            ? and(
                eq(notificationsTable.tenantId, tenant),
                and(isNull(notificationsTable.userId), eq(notificationsTable.role, actorRole as never)),
              )
            : eq(notificationsTable.tenantId, tenant);
    const [dbUnits, dbUsers, dbTickets, dbTasks, dbReservations, dbNotifications, dbEvidence, dbClosures, dbAgentLogs] = await Promise.all([
      db.select().from(unitsTable).where(eq(unitsTable.tenantId, tenant)).orderBy(asc(unitsTable.code)),
      db.select().from(appUsers).where(eq(appUsers.tenantId, tenant)).orderBy(asc(appUsers.name)),
      db.select().from(ticketsTable).where(eq(ticketsTable.tenantId, tenant)).orderBy(asc(ticketsTable.createdAt)),
      db.select().from(tasksTable).where(eq(tasksTable.tenantId, tenant)).orderBy(asc(tasksTable.createdAt)),
      db.select().from(reservationsTable).where(eq(reservationsTable.tenantId, tenant)).orderBy(asc(reservationsTable.checkInAt)),
      db
        .select()
        .from(notificationsTable)
        .where(notificationsScope)
        .orderBy(asc(notificationsTable.createdAt)),
      db.select().from(evidenceTable).where(eq(evidenceTable.tenantId, tenant)).orderBy(asc(evidenceTable.createdAt)),
      db.select().from(operationalClosuresTable).where(eq(operationalClosuresTable.tenantId, tenant)).orderBy(asc(operationalClosuresTable.closedAt)),
      listLatestAgentActionLogsByTenant(tenant),
    ]);

    if (dbUnits.length === 0) {
      return mockAppData();
    }

    const supabase = createServiceRoleClient();
    const signedEvidenceUrls = new Map<string, string>();
    if (supabase) {
      const photoPaths = dbEvidence
        .filter((item) => item.kind === "photo" && !item.url.startsWith("http") && !item.url.startsWith("data:"))
        .map((item) => item.url);

      await Promise.all(
        photoPaths.map(async (path) => {
          const { data } = await supabase.storage.from("evidence").createSignedUrl(path, 60 * 60 * 24 * 7);
          if (data?.signedUrl) signedEvidenceUrls.set(path, data.signedUrl);
        }),
      );
    }

    return {
      source: "database",
      units: dbUnits.map((unit): Unit => {
        const metadata = unit.metadata as UnitMetadata;

        return {
          id: unit.id,
          code: unit.code,
          address: unit.address,
          zone: unit.zone,
          status: unit.status,
          nextCheckIn: dbReservations.find((reservation) => reservation.unitId === unit.id)?.checkInAt.toISOString() ?? new Date().toISOString(),
          owner: unit.ownerName ?? "Owner sin nombre",
          imageUrl: metadata.imageUrl ?? createFakeApartmentImage(unit.code, "#d5dec8"),
          bedrooms: metadata.bedrooms ?? 1,
          floor: metadata.floor ?? "1A",
        };
      }),
      users: dbUsers.map((user): User => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        zone: user.zone ?? "Todas",
        active: user.active,
      })),
      tickets: dbTickets.map((ticket): Ticket => ({
        id: ticket.id,
        unitId: ticket.unitId,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        assigneeId: ticket.assignedToId ?? "",
        dueAt: ticket.dueAt?.toISOString() ?? new Date().toISOString(),
        source: ticket.source as Ticket["source"],
        evidenceCount: 0,
      })),
      tasks: dbTasks.map((task): Task => ({
        id: task.id,
        unitId: task.unitId,
        ticketId: task.ticketId ?? undefined,
        title: task.title,
        role: task.role as Task["role"],
        assigneeId: task.assignedToId ?? "",
        status: task.status,
        dueAt: task.dueAt?.toISOString() ?? new Date().toISOString(),
      })),
      reservations: dbReservations.map((reservation): Reservation => ({
        id: reservation.id,
        unitId: reservation.unitId,
        platform: reservation.source as Reservation["platform"],
        guest: reservation.guestName,
        checkOut: reservation.checkOutAt.toISOString(),
        checkIn: reservation.checkInAt.toISOString(),
        notes: reservation.notes ?? undefined,
        guestData: (reservation.metadata as Reservation["guestData"]) ?? undefined,
      })),
      notifications: dbNotifications.map((notification) => ({
        id: notification.id,
        type: "ticket_created",
        title: notification.title,
        targetRole: notification.role ?? "supervisor",
        createdAt: notification.createdAt.toISOString(),
        read: notification.read,
      })),
      evidence: dbEvidence.map((item) => ({
        id: item.id,
        unitId: dbTickets.find((ticket) => ticket.id === item.ticketId)?.unitId ?? dbTasks.find((task) => task.id === item.taskId)?.unitId ?? "",
        ticketId: item.ticketId ?? undefined,
        taskId: item.taskId ?? undefined,
        kind: item.kind === "external_link" ? "external_link" : "photo",
        url:
          item.kind === "photo" && !item.url.startsWith("http") && !item.url.startsWith("data:")
            ? (signedEvidenceUrls.get(item.url) ?? item.url)
            : item.url,
        sizeKb: item.sizeKb ?? undefined,
        createdAt: item.createdAt.toISOString(),
      })),
      closures: dbClosures.map((closure) => ({
        id: closure.id,
        unitId: closure.unitId,
        ticketId: closure.ticketId ?? undefined,
        actorUserId: closure.actorUserId,
        checklist: (closure.checklist ?? {}) as Record<string, boolean>,
        evidenceRequired: closure.evidenceRequired,
        evidenceCount: closure.evidenceCount,
        notes: closure.notes ?? undefined,
        closedAt: closure.closedAt.toISOString(),
      })),
      agentLogs: dbAgentLogs.map((log) => ({
        id: log.id,
        agentName: log.agentName,
        decision: log.decision,
        entityType: log.entityType,
        entityId: log.entityId,
        suggestion: String(log.output?.suggestion ?? log.input?.suggestion ?? ""),
        createdAt: log.createdAt.toISOString(),
        reviewedAt: log.reviewedAt?.toISOString(),
      })),
    };
  } catch {
    return mockAppData();
  }
}

export async function getDefaultTenantId() {
  const tenantId = await tryGetDefaultTenantId();
  if (!tenantId) {
    throw new Error(`Tenant '${defaultTenantSlug}' does not exist or database is unavailable.`);
  }
  return tenantId;
}

export async function tryGetDefaultTenantId() {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, defaultTenantSlug)).limit(1);

  if (!tenant) {
    return null;
  }

  return tenant.id;
}

export async function listLatestAgentActionLogsByTenant(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(agentActionLogTable)
    .where(eq(agentActionLogTable.tenantId, tenantId))
    .orderBy(desc(agentActionLogTable.createdAt))
    .limit(20);
}

export function mockAppData(): AppData {
  return {
    source: "mock",
    units: mockUnits,
    tickets: mockTickets,
    tasks: mockTasks,
    reservations: mockReservations,
    notifications: mockNotifications,
    evidence: mockEvidence,
    closures: mockClosures,
    agentLogs: mockAgentActionLogs,
    users: mockUsers,
  };
}
