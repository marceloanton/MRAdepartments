import { z } from "zod";

export const reservationCsvSchema = z.object({
  unidad: z.string().min(1),
  direccion: z.string().min(1),
  plataforma: z.string().min(1),
  huesped: z.string().min(1),
  check_in: z.string().min(1),
  check_out: z.string().min(1),
  observaciones: z.string().optional().default(""),
});

export type ReservationCsvRow = z.infer<typeof reservationCsvSchema>;

export const csvHeaders = ["unidad", "direccion", "plataforma", "huesped", "check_in", "check_out", "observaciones"];

export type ParsedReservationImport = {
  id: string;
  unitId: string;
  platform: "Airbnb" | "Booking" | "MercadoLibre" | "Directo";
  guest: string;
  checkOut: string;
  checkIn: string;
  notes?: string;
};

export function normalizePlatform(value: string): ParsedReservationImport["platform"] {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("booking")) return "Booking";
  if (normalized.includes("mercado")) return "MercadoLibre";
  if (normalized.includes("direct")) return "Directo";

  return "Airbnb";
}
