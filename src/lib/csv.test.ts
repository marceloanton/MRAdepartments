import { describe, expect, it } from "vitest";

import { normalizePlatform, reservationCsvSchema } from "./csv";

describe("reservationCsvSchema", () => {
  it("accepts the minimum reservation CSV shape", () => {
    const result = reservationCsvSchema.safeParse({
      unidad: "PAL-101",
      direccion: "Nicaragua 4512",
      plataforma: "Airbnb",
      huesped: "Ana Perez",
      check_in: "2026-05-06 15:00",
      check_out: "2026-05-06 10:00",
      observaciones: "",
    });

    expect(result.success).toBe(true);
  });

  it("rejects rows without a unit code", () => {
    const result = reservationCsvSchema.safeParse({
      unidad: "",
      direccion: "Nicaragua 4512",
      plataforma: "Airbnb",
      huesped: "Ana Perez",
      check_in: "2026-05-06 15:00",
      check_out: "2026-05-06 10:00",
    });

    expect(result.success).toBe(false);
  });
});

describe("normalizePlatform", () => {
  it("normalizes known booking channels", () => {
    expect(normalizePlatform("booking.com")).toBe("Booking");
    expect(normalizePlatform("MercadoLibre")).toBe("MercadoLibre");
    expect(normalizePlatform("directo")).toBe("Directo");
    expect(normalizePlatform("airbnb")).toBe("Airbnb");
  });
});
