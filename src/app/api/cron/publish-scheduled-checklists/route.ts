import { FieldValue } from "firebase-admin/firestore";
import { publishScheduledChecklists } from "../../../../../functions/scheduled-checklists-core";
import { getAdminFirestore } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET is not configured.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  await publishScheduledChecklists(getAdminFirestore(), { fieldValue: FieldValue });
  return new Response("Scheduled checklists processed.", { status: 200 });
}
