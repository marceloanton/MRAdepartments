import { addHours, isBefore, parseISO } from "date-fns";

import type { NotificationItem, Task, Ticket, Unit } from "./domain";
import { isCheckInAtRisk } from "./domain";

export type SlaAlert = {
  id: string;
  type: NotificationItem["type"];
  title: string;
  entityType: "ticket" | "task" | "unit";
  entityId: string;
  body?: string;
};

export function evaluateSla(input: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  now?: Date;
  horizonHours?: number;
}) {
  const now = input.now ?? new Date();
  const horizon = addHours(now, input.horizonHours ?? 8);
  const alerts: SlaAlert[] = [];

  for (const ticket of input.tickets) {
    if (ticket.status === "resuelto" || ticket.status === "cerrado") continue;
    const dueAt = parseISO(ticket.dueAt);
    const unit = input.units.find((currentUnit) => currentUnit.id === ticket.unitId);

    if (isBefore(dueAt, now)) {
      alerts.push({
        id: `ticket_overdue:${ticket.id}`,
        type: "ticket_overdue",
        title: `${unit?.code ?? "Unidad"} tiene ticket vencido`,
        entityType: "ticket",
        entityId: ticket.id,
        body: ticket.title,
      });
    }
  }

  for (const task of input.tasks) {
    if (task.status === "resuelto" || task.status === "cerrado") continue;
    const dueAt = parseISO(task.dueAt);
    const unit = input.units.find((currentUnit) => currentUnit.id === task.unitId);

    if (isBefore(dueAt, now)) {
      alerts.push({
        id: `ticket_overdue:${task.id}`,
        type: "ticket_overdue",
        title: `${unit?.code ?? "Unidad"} tiene tarea vencida`,
        entityType: "task",
        entityId: task.id,
        body: task.title,
      });
    }
  }

  for (const unit of input.units) {
    const unitTickets = input.tickets.filter((ticket) => ticket.unitId === unit.id);
    const checkInAt = parseISO(unit.nextCheckIn);

    if (isBefore(checkInAt, horizon) && isCheckInAtRisk(unit, unitTickets)) {
      alerts.push({
        id: `checkin_risk:${unit.id}`,
        type: "checkin_risk",
        title: `${unit.code} en riesgo antes del check-in`,
        entityType: "unit",
        entityId: unit.id,
        body: `Estado actual: ${unit.status}`,
      });
    }
  }

  return dedupeAlerts(alerts);
}

function dedupeAlerts(alerts: SlaAlert[]) {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    if (seen.has(alert.id)) return false;
    seen.add(alert.id);
    return true;
  });
}
