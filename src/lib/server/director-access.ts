import "server-only";

import { getAdminFirestore } from "./firebase-admin-app.js";
import { hasActiveDirectorGrant } from "./director-access-core.js";

const ORGANIZATION_ID = "hipermercado-baratao";
const STORE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPANY_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface DirectorStoreAccess {
  storeId: string;
  name: string;
  companyId: string;
  status: "ACTIVE" | "INACTIVE";
  companyMappingStatus: "PENDING_CONFIRMATION" | "CONFIRMED";
  operationalAccessReady: boolean;
}

export interface DirectorAccess {
  accessType: "DIRECTOR";
  organizationId: string;
  organizationName: string;
  stores: DirectorStoreAccess[];
}

export class DirectorAccessError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "DirectorAccessError";
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export async function readDirectorAccess(uid: string, emailValue: unknown): Promise<DirectorAccess | null> {
  if (!uid) throw new DirectorAccessError("A conta autenticada não é válida.");

  const db = getAdminFirestore();
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const directorRef = organizationRef.collection("directors").doc(uid);
  const [organizationSnapshot, directorSnapshot] = await Promise.all([
    organizationRef.get(),
    directorRef.get(),
  ]);
  if (!directorSnapshot.exists) return null;

  const email = normalizeEmail(emailValue);
  if (!hasActiveDirectorGrant(organizationSnapshot.data(), directorSnapshot.data(), uid, email)) {
    throw new DirectorAccessError("Seu acesso de Diretor não está ativo para esta conta.");
  }

  const storesSnapshot = await organizationRef.collection("stores").get();
  const organizationName = organizationSnapshot.get("name");
  if (typeof organizationName !== "string" || !organizationName.trim()) {
    throw new Error("O cadastro da organização não contém um nome válido.");
  }

  const stores = await Promise.all(storesSnapshot.docs.map(async (storeSnapshot) => {
    const store = storeSnapshot.data();
    const storeId = storeSnapshot.id;
    if (store.organizationId !== ORGANIZATION_ID
      || store.storeId !== storeId
      || !STORE_ID_PATTERN.test(storeId)
      || typeof store.name !== "string"
      || !store.name.trim()
      || typeof store.companyId !== "string"
      || !COMPANY_ID_PATTERN.test(store.companyId)
      || (store.status !== "ACTIVE" && store.status !== "INACTIVE")
      || (store.companyMappingStatus !== "PENDING_CONFIRMATION"
        && store.companyMappingStatus !== "CONFIRMED")) {
      throw new Error(`O cadastro organizacional da loja ${storeId} é inválido.`);
    }

    const companySnapshot = await db.collection("companies").doc(store.companyId).get();
    if (companySnapshot.exists
      && (companySnapshot.get("organizationId") !== ORGANIZATION_ID
        || companySnapshot.get("storeId") !== storeId)) {
      throw new Error(`A empresa vinculada à loja ${storeId} não confirma o vínculo organizacional.`);
    }

    return {
      storeId,
      name: store.name,
      companyId: store.companyId,
      status: store.status,
      companyMappingStatus: store.companyMappingStatus,
      operationalAccessReady: store.status === "ACTIVE"
        && store.companyMappingStatus === "CONFIRMED"
        && companySnapshot.exists,
    } satisfies DirectorStoreAccess;
  }));

  stores.sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  return {
    accessType: "DIRECTOR",
    organizationId: ORGANIZATION_ID,
    organizationName,
    stores,
  };
}
