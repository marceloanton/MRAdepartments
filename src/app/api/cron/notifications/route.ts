import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { appUsers, notifications } from "@/db/schema";
import { isSmtpConfigured, sendEmailFallback } from "@/lib/notifications";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    const db = getDb();
    const queue = await db
      .select()
      .from(notifications)
      .where(eq(notifications.status, "pending"))
      .orderBy(asc(notifications.createdAt))
      .limit(50);

    for (const item of queue) {
      processed += 1;
      let recipients: string[] = [];
      try {
        recipients = await resolveRecipients({
          tenantId: item.tenantId,
          userId: item.userId ?? undefined,
          role: item.role ?? undefined,
        });
      } catch (error) {
        await db
          .update(notifications)
          .set({
            status: "failed",
            read: false,
            lastError: error instanceof Error ? error.message : "Recipient resolution failed",
            updatedAt: new Date(),
          })
          .where(eq(notifications.id, item.id));
        failed += 1;
        continue;
      }

      if (!isSmtpConfigured()) {
        await db
          .update(notifications)
          .set({ status: "failed", read: false, lastError: "SMTP is not configured", updatedAt: new Date() })
          .where(eq(notifications.id, item.id));
        failed += 1;
        continue;
      }

      if (recipients.length === 0) {
        await db
          .update(notifications)
          .set({ status: "failed", read: false, lastError: "No recipients found", updatedAt: new Date() })
          .where(eq(notifications.id, item.id));
        failed += 1;
        continue;
      }

      try {
        for (const to of recipients) {
          await sendEmailFallback(to, {
            tenantId: item.tenantId,
            eventType: "ticket_assigned",
            eventKey: item.eventKey,
            title: item.title,
            body: item.body ?? undefined,
            targetRole: item.role ?? undefined,
            targetUserId: item.userId ?? undefined,
            channel: "email",
          });
        }

        await db
          .update(notifications)
          .set({ status: "sent", read: false, sentAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(notifications.id, item.id));
        sent += 1;
      } catch (error) {
        await db
          .update(notifications)
          .set({
            status: "failed",
            read: false,
            lastError: error instanceof Error ? error.message : "Unknown SMTP error",
            updatedAt: new Date(),
          })
          .where(eq(notifications.id, item.id));
        failed += 1;
      }
    }

    return NextResponse.json({ processed, sent, failed });
  } catch (error) {
    return NextResponse.json({
      processed,
      sent,
      failed,
      degraded: true,
      error: error instanceof Error ? error.message : "Queue processing failed",
    });
  }
}

async function resolveRecipients(input: { tenantId: string; userId?: string; role?: string }) {
  const db = getDb();
  if (input.userId && input.role) {
    throw new Error("Notification target is ambiguous: userId and role are both set.");
  }

  if (input.userId) {
    const byUser = await db
      .select({ email: appUsers.email })
      .from(appUsers)
      .where(and(eq(appUsers.tenantId, input.tenantId), eq(appUsers.id, input.userId), eq(appUsers.active, true)));
    return byUser.map((row) => row.email);
  }

  if (input.role) {
    const byRole = await db
      .select({ email: appUsers.email })
      .from(appUsers)
      .where(and(eq(appUsers.tenantId, input.tenantId), eq(appUsers.role, input.role as never), eq(appUsers.active, true)));
    return byRole.map((row) => row.email);
  }

  const supervisors = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(and(eq(appUsers.tenantId, input.tenantId), eq(appUsers.role, "supervisor"), eq(appUsers.active, true)));
  return supervisors.map((row) => row.email);
}
