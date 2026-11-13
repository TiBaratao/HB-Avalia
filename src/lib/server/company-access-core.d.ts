import type { DocumentSnapshot } from "firebase-admin/firestore";

export function profileMatchesCompany(
  profileSnapshot: DocumentSnapshot | undefined,
  companyId: string,
): boolean;
