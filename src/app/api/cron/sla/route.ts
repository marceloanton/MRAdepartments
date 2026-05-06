import { NextResponse } from "next/server";

import { createOperationalNotificationAction } from "@/app/actions";
import { getAppData } from "@/db/queries";
import { evaluateSla } from "@/lib/sla";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await getAppData();
  const alerts = evaluateSla({
    units: data.units,
    tickets: data.tickets,
    tasks: data.tasks,
  });

  const persisted: string[] = [];
  for (const alert of alerts) {
    try {
      await createOperationalNotificationAction({
        type: alert.type,
        entityType: alert.entityType,
        entityId: alert.entityId,
        title: alert.title,
        body: alert.body,
        role: "supervisor",
      });
      persisted.push(alert.id);
    } catch {
      // The route must remain observable even when Postgres is not reachable locally.
    }
  }

  return NextResponse.json({
    alerts: alerts.length,
    persisted: persisted.length,
  });
}
