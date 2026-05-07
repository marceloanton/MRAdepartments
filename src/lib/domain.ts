import { addHours, format, isBefore, parseISO } from "date-fns";

export const roles = ["admin", "supervisor", "limpieza", "mantenimiento"] as const;
export const unitStatuses = [
  "pendiente_limpieza",
  "en_limpieza",
  "mantenimiento",
  "inspeccion",
  "lista",
  "bloqueada",
] as const;
export const priorities = ["critico", "alto", "normal", "bajo"] as const;
export const ticketStatuses = ["nuevo", "asignado", "en_curso", "resuelto", "cerrado"] as const;
export const eventTypes = [
  "ticket_created",
  "ticket_assigned",
  "ticket_overdue",
  "ticket_resolved",
  "unit_ready",
  "checkin_risk",
] as const;

export type Role = (typeof roles)[number];
export type UnitStatus = (typeof unitStatuses)[number];
export type Priority = (typeof priorities)[number];
export type TicketStatus = (typeof ticketStatuses)[number];
export type EventType = (typeof eventTypes)[number];

export type User = {
  id: string;
  name: string;
  email?: string;
  role: Role;
  zone: string;
  active?: boolean;
};

export type Unit = {
  id: string;
  code: string;
  address: string;
  zone: string;
  status: UnitStatus;
  nextCheckIn: string;
  owner: string;
  imageUrl: string;
  bedrooms: number;
  floor: string;
};

export type Reservation = {
  id: string;
  unitId: string;
  platform: "Airbnb" | "Booking" | "MercadoLibre" | "Directo";
  guest: string;
  checkOut: string;
  checkIn: string;
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
    legal?: {
      dataConsentAccepted: boolean;
      termsAccepted: boolean;
      acceptedAt?: string;
    };
  };
};

export type Ticket = {
  id: string;
  unitId: string;
  title: string;
  category: string;
  priority: Priority;
  status: TicketStatus;
  assigneeId: string;
  dueAt: string;
  source: "whatsapp" | "planilla" | "supervisor" | "airbnb";
  evidenceCount: number;
};

export type Task = {
  id: string;
  unitId: string;
  ticketId?: string;
  title: string;
  role: Extract<Role, "limpieza" | "mantenimiento" | "supervisor">;
  assigneeId: string;
  status: TicketStatus;
  dueAt: string;
};

export type EvidenceItem = {
  id: string;
  unitId: string;
  ticketId?: string;
  taskId?: string;
  kind: "photo" | "external_link";
  url: string;
  note?: string;
  sizeKb?: number;
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  type: EventType;
  title: string;
  targetRole: Role;
  createdAt: string;
  read: boolean;
};

export type OperationalClosure = {
  id: string;
  unitId: string;
  ticketId?: string;
  actorUserId: string;
  checklist: Record<string, boolean>;
  evidenceRequired: boolean;
  evidenceCount: number;
  notes?: string;
  closedAt: string;
};

export type AgentActionLogItem = {
  id: string;
  agentName: string;
  decision: "suggested" | "accepted" | "rejected" | "expired";
  entityType: string;
  entityId: string;
  suggestion: string;
  createdAt: string;
  reviewedAt?: string;
};

export const slaHours: Record<Priority, number> = {
  critico: 1,
  alto: 4,
  normal: 24,
  bajo: 72,
};

const now = new Date("2026-05-06T10:00:00-03:00");

export function createFakeApartmentImage(seed: string, accent: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${accent}" offset="0"/><stop stop-color="#f6f1e7" offset=".58"/><stop stop-color="#d8ded6" offset="1"/></linearGradient></defs><rect width="900" height="520" fill="url(#g)"/><rect x="72" y="72" width="756" height="376" rx="24" fill="#ffffff" fill-opacity=".62"/><rect x="118" y="122" width="310" height="230" rx="10" fill="#26352f" fill-opacity=".16"/><rect x="472" y="122" width="280" height="70" rx="10" fill="#26352f" fill-opacity=".14"/><rect x="472" y="222" width="280" height="130" rx="10" fill="#26352f" fill-opacity=".1"/><circle cx="704" cy="392" r="32" fill="#26352f" fill-opacity=".18"/><text x="118" y="410" fill="#26352f" font-family="Arial, sans-serif" font-size="42" font-weight="700">${seed}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const users: User[] = [
  { id: "u-admin", name: "Mora Admin", email: "admin@demo.local", role: "admin", zone: "Todas", active: true },
  { id: "u-super", name: "Leo Supervisor", email: "supervisor@demo.local", role: "supervisor", zone: "Centro", active: true },
  { id: "u-clean", name: "Equipo Limpieza A", email: "limpieza@demo.local", role: "limpieza", zone: "Palermo", active: true },
  { id: "u-tech", name: "Rafa Mantenimiento", email: "mantenimiento@demo.local", role: "mantenimiento", zone: "Recoleta", active: true },
];

export const units: Unit[] = [
  {
    id: "unit-101",
    code: "PAL-101",
    address: "Nicaragua 4512, Palermo Hollywood, CABA",
    zone: "Palermo",
    status: "pendiente_limpieza",
    nextCheckIn: "2026-05-06T15:00:00-03:00",
    owner: "Fideicomiso Norte",
    imageUrl: createFakeApartmentImage("PAL-101", "#b9d8c2"),
    bedrooms: 2,
    floor: "7B",
  },
  {
    id: "unit-204",
    code: "REC-204",
    address: "Junin 1280, Recoleta, CABA",
    zone: "Recoleta",
    status: "mantenimiento",
    nextCheckIn: "2026-05-06T18:30:00-03:00",
    owner: "Lopez Propiedades",
    imageUrl: createFakeApartmentImage("REC-204", "#d8c7b0"),
    bedrooms: 1,
    floor: "4A",
  },
  {
    id: "unit-318",
    code: "CEN-318",
    address: "Av. Corrientes 920, San Nicolas, CABA",
    zone: "Centro",
    status: "inspeccion",
    nextCheckIn: "2026-05-07T12:00:00-03:00",
    owner: "BA Rentals",
    imageUrl: createFakeApartmentImage("CEN-318", "#bcc7df"),
    bedrooms: 3,
    floor: "12C",
  },
  {
    id: "unit-411",
    code: "BEL-411",
    address: "Mendoza 1720, Belgrano, CABA",
    zone: "Belgrano",
    status: "lista",
    nextCheckIn: "2026-05-07T16:00:00-03:00",
    owner: "Rios Group",
    imageUrl: createFakeApartmentImage("BEL-411", "#c7d7d5"),
    bedrooms: 2,
    floor: "9D",
  },
  {
    id: "unit-512",
    code: "PCH-512",
    address: "Defensa 980, San Telmo, CABA",
    zone: "San Telmo",
    status: "en_limpieza",
    nextCheckIn: "2026-05-06T17:00:00-03:00",
    owner: "Puerto Chico",
    imageUrl: createFakeApartmentImage("PCH-512", "#d9ccb5"),
    bedrooms: 1,
    floor: "2F",
  },
  {
    id: "unit-620",
    code: "CAB-620",
    address: "Pedro Goyena 1468, Caballito, CABA",
    zone: "Caballito",
    status: "bloqueada",
    nextCheckIn: "2026-05-08T14:00:00-03:00",
    owner: "Alquileres Sur",
    imageUrl: createFakeApartmentImage("CAB-620", "#c9d3aa"),
    bedrooms: 2,
    floor: "6E",
  },
];

export const reservations: Reservation[] = [
  {
    id: "res-1",
    unitId: "unit-101",
    platform: "Airbnb",
    guest: "Ana Perez",
    checkOut: "2026-05-06T10:00:00-03:00",
    checkIn: "2026-05-06T15:00:00-03:00",
    notes: "Pide cama extra",
  },
  {
    id: "res-2",
    unitId: "unit-204",
    platform: "Booking",
    guest: "Mark Fisher",
    checkOut: "2026-05-06T11:00:00-03:00",
    checkIn: "2026-05-06T18:30:00-03:00",
    notes: "Llegada tarde",
  },
  {
    id: "res-3",
    unitId: "unit-318",
    platform: "Directo",
    guest: "Camila Suarez",
    checkOut: "2026-05-07T09:30:00-03:00",
    checkIn: "2026-05-07T12:00:00-03:00",
  },
];

export const tickets: Ticket[] = [
  {
    id: "tk-9001",
    unitId: "unit-204",
    title: "No enfria el aire acondicionado",
    category: "aire",
    priority: "critico",
    status: "en_curso",
    assigneeId: "u-tech",
    dueAt: addHours(now, 1).toISOString(),
    source: "whatsapp",
    evidenceCount: 1,
  },
  {
    id: "tk-9002",
    unitId: "unit-101",
    title: "Limpieza post check-out",
    category: "limpieza",
    priority: "alto",
    status: "asignado",
    assigneeId: "u-clean",
    dueAt: addHours(now, 3).toISOString(),
    source: "planilla",
    evidenceCount: 0,
  },
  {
    id: "tk-9003",
    unitId: "unit-318",
    title: "Revisar cerradura electronica",
    category: "cerradura",
    priority: "normal",
    status: "nuevo",
    assigneeId: "u-super",
    dueAt: addHours(now, 20).toISOString(),
    source: "supervisor",
    evidenceCount: 2,
  },
];

export const tasks: Task[] = [
  {
    id: "task-1",
    unitId: "unit-101",
    ticketId: "tk-9002",
    title: "Limpieza profunda y reposicion de blancos",
    role: "limpieza",
    assigneeId: "u-clean",
    status: "asignado",
    dueAt: addHours(now, 2).toISOString(),
  },
  {
    id: "task-2",
    unitId: "unit-204",
    ticketId: "tk-9001",
    title: "Diagnosticar aire acondicionado split",
    role: "mantenimiento",
    assigneeId: "u-tech",
    status: "en_curso",
    dueAt: addHours(now, 1).toISOString(),
  },
  {
    id: "task-3",
    unitId: "unit-318",
    ticketId: "tk-9003",
    title: "Inspeccion pre check-in",
    role: "supervisor",
    assigneeId: "u-super",
    status: "nuevo",
    dueAt: addHours(now, 18).toISOString(),
  },
];

export const evidenceItems: EvidenceItem[] = [
  {
    id: "ev-1",
    unitId: "unit-204",
    ticketId: "tk-9001",
    kind: "photo",
    url: createFakeApartmentImage("EV-REC-204", "#d8c7b0"),
    note: "Foto fake del aire acondicionado reportado",
    sizeKb: 96,
    createdAt: "2026-05-06T09:40:00-03:00",
  },
  {
    id: "ev-2",
    unitId: "unit-318",
    ticketId: "tk-9003",
    kind: "external_link",
    url: "https://drive.google.com/demo/cerradura-cen-318",
    note: "Link externo demo a video de cerradura",
    createdAt: "2026-05-06T08:20:00-03:00",
  },
];

export const operationalClosures: OperationalClosure[] = [];

export const notifications: NotificationItem[] = [
  {
    id: "nt-1",
    type: "checkin_risk",
    title: "REC-204 tiene check-in hoy y sigue en mantenimiento",
    targetRole: "supervisor",
    createdAt: "2026-05-06T09:50:00-03:00",
    read: false,
  },
  {
    id: "nt-2",
    type: "ticket_assigned",
    title: "PAL-101 asignado a Limpieza A",
    targetRole: "limpieza",
    createdAt: "2026-05-06T09:35:00-03:00",
    read: false,
  },
  {
    id: "nt-3",
    type: "unit_ready",
    title: "BEL-411 marcada como lista",
    targetRole: "supervisor",
    createdAt: "2026-05-06T08:10:00-03:00",
    read: true,
  },
];

export const agentActionLogs: AgentActionLogItem[] = [
  {
    id: "ag-1",
    agentName: "TriageAgent",
    decision: "suggested",
    entityType: "ticket",
    entityId: "tk-9001",
    suggestion: "Prioridad sugerida: critico por riesgo de check-in en menos de 8h.",
    createdAt: "2026-05-06T09:05:00-03:00",
  },
  {
    id: "ag-2",
    agentName: "DispatchAgent",
    decision: "accepted",
    entityType: "task",
    entityId: "task-2",
    suggestion: "Asignar a mantenimiento Recoleta por cercania y carga baja.",
    createdAt: "2026-05-06T09:10:00-03:00",
    reviewedAt: "2026-05-06T09:11:00-03:00",
  },
];

export function unitStatusLabel(status: UnitStatus) {
  return status.replaceAll("_", " ");
}

export function priorityLabel(priority: Priority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function formatShortDate(value: string) {
  return format(parseISO(value), "dd/MM HH:mm");
}

export function isCheckInAtRisk(unit: Unit, unitTickets: Ticket[]) {
  const checkInSoon = isBefore(parseISO(unit.nextCheckIn), addHours(now, 8));
  const hasBlockingTicket = unitTickets.some(
    (ticket) => ticket.priority === "critico" && ticket.status !== "resuelto" && ticket.status !== "cerrado",
  );

  return checkInSoon && (unit.status !== "lista" || hasBlockingTicket);
}
