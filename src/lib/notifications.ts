import nodemailer from "nodemailer";

import type { EventType, Role } from "./domain";

export type NotificationChannel = "in_app" | "email";
export type NotificationStatus = "pending" | "sent" | "failed";

export type NotificationPayload = {
  tenantId: string;
  eventType: EventType;
  eventKey: string;
  title: string;
  body?: string;
  targetRole?: Role;
  targetUserId?: string;
  channel: NotificationChannel;
};

let transporter: nodemailer.Transporter | null = null;

export function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

export function createEventKey(eventType: EventType, entityId: string) {
  return `${eventType}:${entityId}`;
}

export async function sendEmailFallback(to: string, payload: NotificationPayload) {
  const mailer = getTransporter();
  if (!mailer) {
    return { status: "failed" as const, error: "SMTP is not configured" };
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: payload.title,
    text: payload.body ?? payload.title,
  });

  return { status: "sent" as const };
}
