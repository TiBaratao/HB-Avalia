import type { Firestore } from "firebase-admin/firestore";

export type SecureActionResult = { evaluationId: string; averageScore: number } | { responseId: string };

export class SecureActionError extends Error {
  constructor(code: string, message: string);
  code: string;
}

export function submitEvaluation(
  db: Firestore,
  uid: string,
  data: Record<string, unknown>,
): Promise<{ evaluationId: string; averageScore: number }>;

export function submitSurveyResponse(
  db: Firestore,
  uid: string,
  data: Record<string, unknown>,
): Promise<{ responseId: string }>;
