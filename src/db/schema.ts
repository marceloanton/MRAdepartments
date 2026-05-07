import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "supervisor", "limpieza", "mantenimiento"]);
export const unitStatusEnum = pgEnum("unit_status", [
  "pendiente_limpieza",
  "en_limpieza",
  "mantenimiento",
  "inspeccion",
  "lista",
  "bloqueada",
]);
export const priorityEnum = pgEnum("priority", ["critico", "alto", "normal", "bajo"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["nuevo", "asignado", "en_curso", "resuelto", "cerrado"]);
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sent", "failed"]);
export const agentDecisionEnum = pgEnum("agent_decision", ["suggested", "accepted", "rejected", "expired"]);
export const offlineOpStatusEnum = pgEnum("offline_op_status", ["applied", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull(),
    zone: text("zone"),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [index("app_users_tenant_idx").on(table.tenantId)],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    code: text("code").notNull(),
    address: text("address").notNull(),
    zone: text("zone").notNull(),
    ownerName: text("owner_name"),
    status: unitStatusEnum("status").default("pendiente_limpieza").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [index("units_tenant_idx").on(table.tenantId), index("units_status_idx").on(table.status)],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    unitId: uuid("unit_id").references(() => units.id).notNull(),
    source: text("source").notNull(),
    externalId: text("external_id"),
    guestName: text("guest_name").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    index("reservations_window_idx").on(table.tenantId, table.checkInAt, table.checkOutAt),
    uniqueIndex("reservations_tenant_unit_checkin_uq").on(table.tenantId, table.unitId, table.checkInAt),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    unitId: uuid("unit_id").references(() => units.id).notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    priority: priorityEnum("priority").notNull(),
    status: ticketStatusEnum("status").default("nuevo").notNull(),
    source: text("source").notNull(),
    assignedToId: uuid("assigned_to_id").references(() => appUsers.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("tickets_tenant_status_idx").on(table.tenantId, table.status)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    unitId: uuid("unit_id").references(() => units.id).notNull(),
    title: text("title").notNull(),
    role: roleEnum("role").notNull(),
    assignedToId: uuid("assigned_to_id").references(() => appUsers.id),
    status: ticketStatusEnum("status").default("nuevo").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("tasks_assignee_idx").on(table.tenantId, table.assignedToId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    taskId: uuid("task_id").references(() => tasks.id),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => appUsers.id),
    sizeKb: integer("size_kb"),
    ...timestamps,
  },
  (table) => [index("evidence_ticket_idx").on(table.tenantId, table.ticketId)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    type: text("type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [index("events_tenant_type_idx").on(table.tenantId, table.type)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    userId: uuid("user_id").references(() => appUsers.id),
    role: roleEnum("role"),
    channel: text("channel").notNull(),
    status: notificationStatusEnum("status").default("pending").notNull(),
    read: boolean("read").default(false).notNull(),
    eventKey: text("event_key").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("notifications_queue_idx").on(table.tenantId, table.status, table.createdAt),
    uniqueIndex("notifications_tenant_event_key_uq").on(table.tenantId, table.eventKey),
  ],
);

export const operationalClosures = pgTable(
  "operational_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    unitId: uuid("unit_id").references(() => units.id).notNull(),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id).notNull(),
    checklist: jsonb("checklist").$type<Record<string, boolean>>().default({}).notNull(),
    evidenceRequired: boolean("evidence_required").default(false).notNull(),
    evidenceCount: integer("evidence_count").default(0).notNull(),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    index("operational_closures_tenant_unit_idx").on(table.tenantId, table.unitId, table.closedAt),
    index("operational_closures_actor_idx").on(table.tenantId, table.actorUserId),
  ],
);

export const agentActionLog = pgTable(
  "agent_action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    agentName: text("agent_name").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
    output: jsonb("output").$type<Record<string, unknown>>().default({}).notNull(),
    decision: agentDecisionEnum("decision").default("suggested").notNull(),
    reviewedById: uuid("reviewed_by_id").references(() => appUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("agent_action_tenant_idx").on(table.tenantId, table.agentName)],
);

export const offlineOpsLog = pgTable(
  "offline_ops_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    opId: text("op_id").notNull(),
    opType: text("op_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    status: offlineOpStatusEnum("status").notNull(),
    error: text("error"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_ops_log_tenant_op_id_uq").on(table.tenantId, table.opId),
    index("offline_ops_log_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);
