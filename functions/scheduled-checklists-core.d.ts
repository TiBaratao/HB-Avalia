import type { Firestore } from "firebase-admin/firestore";

interface ScheduledChecklistLogger {
  info?(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export function publishScheduledChecklists(
  db: Firestore,
  options?: {
    logger?: ScheduledChecklistLogger;
    now?: Date;
    fieldValue?: { serverTimestamp(): unknown };
  },
): Promise<void>;
