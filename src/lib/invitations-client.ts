import { getFirebaseAuth } from "./firebase/client";

export type InvitationRole = "ADMIN" | "LEADER" | "EMPLOYEE";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "CANCELED" | "EXPIRED";

export interface InvitationSummary {
  id: string;
  email: string;
  role: InvitationRole;
  teamIds: string[];
  status: InvitationStatus;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface PublicInvitation {
  invitationId: string;
  email: string;
  companyName: string;
  role: InvitationRole;
  teamNames: string[];
  expiresAt: string | null;
}

export interface CompanyAccess {
  accessType: "COMPANY";
  companyId: string;
}

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

export interface OrganizationManagementMember {
  uid: string;
  name: string;
  email: string;
  role: "ADMIN" | "LEADER" | "EMPLOYEE";
  teamIds: string[];
}

export interface OrganizationManagementTeam {
  teamId: string;
  name: string;
  departmentId: string;
}

export interface OrganizationStoreIndicators {
  activeMembers: number;
  activeTeams: number;
  openCycles: number;
  evaluations: number;
  developmentPlans: number;
  promotionRequests: number;
  customerFeedbackResponses: number;
}

export interface OrganizationManagementStore extends DirectorStoreAccess {
  teams: OrganizationManagementTeam[];
  departments: Array<{ departmentId: string; name: string }>;
  members: OrganizationManagementMember[];
  indicators: OrganizationStoreIndicators;
  analytics: import("./server/organization-analytics-core").OrganizationStoreAnalytics;
}

export interface OrganizationTransferSummary {
  id: string;
  uid: string;
  email: string;
  role: InvitationRole;
  sourceStoreId: string;
  targetStoreId: string;
  previousTeamIds: string[];
  targetTeamIds: string[];
  createdAt: string | null;
}

export interface OrganizationConsolidatedIndicators extends OrganizationStoreIndicators {
  operationalStores: number;
}

export interface OrganizationManagement {
  organizationId: string;
  stores: OrganizationManagementStore[];
  consolidated: OrganizationConsolidatedIndicators;
  transfers: OrganizationTransferSummary[];
}

export type CurrentAccess = CompanyAccess | DirectorAccess;

interface InvitationResult {
  invitation: InvitationSummary;
  inviteUrl: string;
  emailSent: boolean;
  emailWarning: string;
}

class InvitationClientError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const status = `HTTP ${response.status}`;
    if (!response.ok) {
      throw new InvitationClientError(
        `O servidor retornou uma resposta inesperada (${status}). Atualize a página e tente novamente.`,
        response.status,
      );
    }
    throw new Error(`O servidor retornou uma resposta inválida (${status}).`);
  }
}

async function authenticatedRequest<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Entre na sua conta para continuar.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const result = await readJsonResponse<T & { error?: string }>(response);
  if (!response.ok) throw new InvitationClientError(result.error || "Não foi possível concluir a solicitação.", response.status);
  return result;
}

export async function fetchCurrentAccess(): Promise<CurrentAccess> {
  const access = await authenticatedRequest<CurrentAccess>("/api/access");
  if (!access || typeof access !== "object") {
    throw new Error("O servidor retornou um perfil de acesso inválido.");
  }
  if (access.accessType === "DIRECTOR"
    && (!Array.isArray(access.stores)
      || access.stores.some((store) => !store.storeId || !store.companyId))) {
    throw new Error("O servidor retornou uma lista de lojas inválida para o Diretor.");
  }
  if (access.accessType === "COMPANY" && typeof access.companyId !== "string") {
    throw new Error("O servidor retornou um vínculo de empresa inválido.");
  }
  if (access.accessType !== "DIRECTOR" && access.accessType !== "COMPANY") {
    throw new Error("O servidor retornou um perfil de acesso inválido.");
  }
  return access;
}

export async function fetchInvitations(companyId: string, storeId?: string) {
  const query = new URLSearchParams({ companyId });
  if (storeId) query.set("storeId", storeId);
  const result = await authenticatedRequest(`/api/invitations?${query.toString()}`) as {
    invitations: InvitationSummary[];
  };
  return result.invitations;
}

export async function createStoreAdminInvitation(storeId: string, email: string) {
  return authenticatedRequest("/api/invitations", {
    method: "POST",
    body: JSON.stringify({ action: "createStoreAdmin", storeId, email }),
  }) as Promise<InvitationResult>;
}

export async function fetchOrganizationManagement() {
  return authenticatedRequest<OrganizationManagement>("/api/organization/management");
}

export async function transferOrganizationMember(input: {
  memberUid: string;
  sourceStoreId: string;
  targetStoreId: string;
  targetTeamIds: string[];
}) {
  return authenticatedRequest<{ transferId: string }>("/api/organization/management", {
    method: "POST",
    body: JSON.stringify({ action: "transfer", ...input }),
  });
}

export async function createInvitation(input: {
  companyId: string;
  email: string;
  role: InvitationRole;
  teamIds: string[];
}) {
  return authenticatedRequest("/api/invitations", {
    method: "POST",
    body: JSON.stringify({ action: "create", ...input }),
  }) as Promise<InvitationResult>;
}

export async function resendInvitation(invitationId: string) {
  return authenticatedRequest("/api/invitations", {
    method: "POST",
    body: JSON.stringify({ action: "resend", invitationId }),
  }) as Promise<InvitationResult>;
}

export async function cancelInvitation(invitationId: string) {
  await authenticatedRequest("/api/invitations", {
    method: "POST",
    body: JSON.stringify({ action: "cancel", invitationId }),
  });
}

export async function lookupInvitation(invitationId: string, token: string) {
  const response = await fetch("/api/invitations/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationId, token }),
    cache: "no-store",
  });
  const result = await readJsonResponse<PublicInvitation & { error?: string }>(response);
  if (!response.ok) throw new Error(result.error || "Não foi possível validar o convite.");
  return result;
}

export async function acceptInvitation(input: { invitationId: string; token: string; name: string }) {
  return authenticatedRequest("/api/invitations/accept", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
