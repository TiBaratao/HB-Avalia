import type { Firestore } from "firebase-admin/firestore";

export class CustomerFeedbackError extends Error {
  constructor(code: string, message: string);
  code: string;
}

export interface CustomerFeedbackForm {
  companyName: string;
  location: { id: string; kind: "GENERAL" | "CASHIER"; name: string };
  cashiers: Array<{ id: string; name: string }>;
}

export function getPublicCustomerFeedbackForm(db: Firestore, token: unknown): Promise<CustomerFeedbackForm>;

export function submitCustomerFeedback(
  db: Firestore,
  input: unknown,
  clientAddress: string,
): Promise<{ accepted: true }>;

export function manageCustomerFeedback(
  db: Firestore,
  uid: string,
  data: Record<string, unknown>,
): Promise<object>;
