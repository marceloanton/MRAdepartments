import { describe, expect, it } from "vitest";

import { isCheckInAtRisk, tickets, units } from "./domain";

describe("isCheckInAtRisk", () => {
  it("flags a unit with check-in soon and unfinished operations", () => {
    const unit = units.find((currentUnit) => currentUnit.id === "unit-101");
    const unitTickets = tickets.filter((ticket) => ticket.unitId === "unit-101");

    expect(unit).toBeDefined();
    expect(isCheckInAtRisk(unit!, unitTickets)).toBe(true);
  });

  it("does not flag a ready unit without blocking tickets", () => {
    const unit = units.find((currentUnit) => currentUnit.id === "unit-411");

    expect(unit).toBeDefined();
    expect(isCheckInAtRisk(unit!, [])).toBe(false);
  });
});
