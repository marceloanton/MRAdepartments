import { describe, expect, it } from "vitest";

import { tasks, tickets, units } from "./domain";
import { evaluateSla } from "./sla";

describe("evaluateSla", () => {
  it("detects check-in risk for units not ready inside the horizon", () => {
    const alerts = evaluateSla({
      units,
      tickets,
      tasks,
      now: new Date("2026-05-06T10:00:00-03:00"),
      horizonHours: 8,
    });

    expect(alerts.some((alert) => alert.type === "checkin_risk" && alert.entityId === "unit-101")).toBe(true);
  });

  it("detects overdue tickets", () => {
    const overdueTickets = [
      {
        ...tickets[0],
        dueAt: "2026-05-06T09:00:00-03:00",
      },
    ];

    const alerts = evaluateSla({
      units,
      tickets: overdueTickets,
      tasks: [],
      now: new Date("2026-05-06T10:00:00-03:00"),
    });

    expect(alerts.some((alert) => alert.type === "ticket_overdue" && alert.entityId === tickets[0].id)).toBe(true);
  });
});
