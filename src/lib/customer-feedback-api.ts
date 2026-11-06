import { getFirebaseAuth } from "./firebase/client";

export interface CustomerFeedbackLocation {
  id: string;
  kind: "MARKET" | "GENERAL" | "CASHIER";
  marketId: string | null;
  name: string;
  active: boolean;
  publicToken: string;
  responseCount: number;
  averageRating: number | null;
  cashierRatingCount: number;
  cashierAverage: number | null;
}

export interface CustomerFeedbackResponse {
  id: string;
  sourceLocationId: string;
  sourceLocationName: string;
  marketId: string | null;
  marketName: string | null;
  cashierId: string | null;
  cashierName: string | null;
  overallRating: number;
  cashierRating: number | null;
  comment: string;
  submittedAt: string | null;
}

export interface CustomerFeedbackDashboard {
  companyName: string;
  locations: CustomerFeedbackLocation[];
  summary: { responseCount: number; averageRating: number | null };
  recentResponses: CustomerFeedbackResponse[];
  maxRecentResponses: number;
  privacyThreshold: number;
}

export interface PublicCustomerFeedbackForm {
  companyName: string;
  location: { id: string; kind: "MARKET" | "GENERAL" | "CASHIER"; name: string; marketId: string | null; marketName: string | null };
  cashiers: Array<{ id: string; name: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCustomerFeedbackLocationKind(value: unknown): value is CustomerFeedbackLocation["kind"] {
  return value === "MARKET" || value === "GENERAL" || value === "CASHIER";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (!isRecord(payload)) throw new Error("O servidor retornou uma resposta inválida.");
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível processar a solicitação.");
  }
  return payload;
}

async function adminRequest(companyId: string, action: string, details: Record<string, unknown> = {}) {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Faça login para continuar.");
  const idToken = await user.getIdToken();
  const response = await fetch("/api/customer-feedback/admin", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, action, ...details }),
  });
  return readJson(response);
}

function parseLocation(value: unknown): CustomerFeedbackLocation {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !isCustomerFeedbackLocationKind(value.kind)
    || typeof value.name !== "string"
    || typeof value.active !== "boolean"
    || typeof value.publicToken !== "string") {
    throw new Error("O servidor retornou um local de avaliação inválido.");
  }
  const numberField = (field: unknown) => typeof field === "number" && Number.isFinite(field) ? field : 0;
  return {
    id: value.id,
    kind: value.kind,
    marketId: typeof value.marketId === "string" ? value.marketId : null,
    name: value.name,
    active: value.active,
    publicToken: value.publicToken,
    responseCount: numberField(value.responseCount),
    averageRating: typeof value.averageRating === "number" && Number.isFinite(value.averageRating)
      ? value.averageRating
      : null,
    cashierRatingCount: numberField(value.cashierRatingCount),
    cashierAverage: typeof value.cashierAverage === "number" && Number.isFinite(value.cashierAverage)
      ? value.cashierAverage
      : null,
  };
}

function parseResponse(value: unknown): CustomerFeedbackResponse {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.sourceLocationId !== "string"
    || typeof value.sourceLocationName !== "string"
    || typeof value.overallRating !== "number"
    || typeof value.comment !== "string") {
    throw new Error("O servidor retornou uma avaliação inválida.");
  }
  return {
    id: value.id,
    sourceLocationId: value.sourceLocationId,
    sourceLocationName: value.sourceLocationName,
    marketId: typeof value.marketId === "string" ? value.marketId : null,
    marketName: typeof value.marketName === "string" ? value.marketName : null,
    cashierId: typeof value.cashierId === "string" ? value.cashierId : null,
    cashierName: typeof value.cashierName === "string" ? value.cashierName : null,
    overallRating: value.overallRating,
    cashierRating: typeof value.cashierRating === "number" ? value.cashierRating : null,
    comment: value.comment,
    submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : null,
  };
}

export async function loadCustomerFeedbackDashboard(companyId: string): Promise<CustomerFeedbackDashboard> {
  const payload = await adminRequest(companyId, "list");
  if (typeof payload.companyName !== "string"
    || !Array.isArray(payload.locations)
    || !Array.isArray(payload.recentResponses)
    || !isRecord(payload.summary)) {
    throw new Error("O servidor retornou dados inválidos para as avaliações de clientes.");
  }
  return {
    companyName: payload.companyName,
    locations: payload.locations.map(parseLocation),
    summary: {
      responseCount: typeof payload.summary.responseCount === "number" ? payload.summary.responseCount : 0,
      averageRating: typeof payload.summary.averageRating === "number" ? payload.summary.averageRating : null,
    },
    recentResponses: payload.recentResponses.map(parseResponse),
    maxRecentResponses: typeof payload.maxRecentResponses === "number" ? payload.maxRecentResponses : 100,
    privacyThreshold: typeof payload.privacyThreshold === "number" ? payload.privacyThreshold : 5,
  };
}

export async function createCustomerFeedbackCashier(companyId: string, marketId: string, name: string) {
  const payload = await adminRequest(companyId, "createCashier", { marketId, name });
  if (typeof payload.locationId !== "string" || typeof payload.token !== "string") {
    throw new Error("O servidor não retornou o QR Code do caixa.");
  }
  return { locationId: payload.locationId, token: payload.token };
}

export async function setCustomerFeedbackCashierActive(companyId: string, locationId: string, active: boolean) {
  await adminRequest(companyId, "setCashierActive", { locationId, active });
}

export async function renameCustomerFeedbackCashier(companyId: string, locationId: string, name: string) {
  await adminRequest(companyId, "renameCashier", { locationId, name });
}

export async function rotateCustomerFeedbackQr(companyId: string, locationId: string) {
  const payload = await adminRequest(companyId, "rotateQr", { locationId });
  if (typeof payload.token !== "string") throw new Error("O servidor não retornou o QR Code atualizado.");
  return payload.token;
}

export async function loadPublicCustomerFeedbackForm(token: string): Promise<PublicCustomerFeedbackForm> {
  const response = await fetch(`/api/customer-feedback?token=${encodeURIComponent(token)}`, { cache: "no-store" });
  const payload = await readJson(response);
  if (typeof payload.companyName !== "string"
    || !isRecord(payload.location)
    || typeof payload.location.id !== "string"
    || typeof payload.location.name !== "string"
    || !isCustomerFeedbackLocationKind(payload.location.kind)
    || !Array.isArray(payload.cashiers)) {
    throw new Error("Este QR Code não contém uma página de avaliação válida.");
  }
  const cashiers = payload.cashiers.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      throw new Error("O servidor retornou uma lista de caixas inválida.");
    }
    return { id: item.id, name: item.name };
  });
  return {
    companyName: payload.companyName,
    location: {
      id: payload.location.id,
      name: payload.location.name,
      kind: payload.location.kind,
      marketId: typeof payload.location.marketId === "string" ? payload.location.marketId : null,
      marketName: typeof payload.location.marketName === "string" ? payload.location.marketName : null,
    },
    cashiers,
  };
}

export async function sendPublicCustomerFeedback(input: {
  token: string;
  overallRating: number;
  cashierId?: string;
  cashierRating?: number;
  comment: string;
  website: string;
}) {
  const response = await fetch("/api/customer-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await readJson(response);
}
