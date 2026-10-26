import adminApp from "../../src/lib/server/firebase-admin-app.js";
import scheduledChecklists from "../../functions/scheduled-checklists-core.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = { schedule: "5 3 * * *" };

export default async function publishScheduledChecklists() {
  await scheduledChecklists.publishScheduledChecklists(adminApp.getAdminFirestore(), { fieldValue: FieldValue });
  return new Response("Scheduled checklists processed.", { status: 200 });
}
