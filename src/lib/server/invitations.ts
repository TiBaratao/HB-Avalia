import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { profileMatchesCompany } from "./company-access-core.js";
import { hasActiveDirectorGrant } from "./director-access-core.js";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin-app.js";
import { InvitationApiError } from "./invitation-errors.js";
export { InvitationApiError } from "./invitation-errors.js";

type JsonObject = Record<string, unknown>;
type InvitationRole = "ADMIN" | "LEADER" | "EMPLOYEE";
type InvitationStatus = "PENDING" | "ACCEPTED" | "CANCELED" | "EXPIRED";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INITIAL_POSITION = "Atendente de Açougue Junior";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string, maxLength = 150): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("/")) {
    throw new InvitationApiError(`${label} inválido.`, 400);
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || value.trim().length > 254) {
    throw new InvitationApiError("E-mail inválido.", 400);
  }
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvitationApiError("E-mail inválido.", 400);
  }
  return email;
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function invitationReservationId(companyId: string, email: string): string {
  return createHash("sha256").update(`${companyId}:${email}`).digest("hex");
}

function tokenMatches(token: string, storedHash: unknown): boolean {
  if (typeof storedHash !== "string") return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = tokenDigest(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

function requireToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new InvitationApiError("Convite inválido ou expirado.", 404);
  }
  return value;
}

function requireInvitationId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new InvitationApiError("Convite inválido ou expirado.", 404);
  }
  return value;
}

function getInvitationStatus(data: JsonObject, now = Date.now()): InvitationStatus {
  if (data.status === "ACCEPTED") return "ACCEPTED";
  if (data.status === "CANCELED") return "CANCELED";
  if (data.status !== "PENDING") return "EXPIRED";
  return data.expiresAt instanceof Timestamp && data.expiresAt.toMillis() > now ? "PENDING" : "EXPIRED";
}

function invitationSummary(id: string, data: JsonObject) {
  return {
    id,
    email: String(data.invitedEmail ?? ""),
    role: data.role as InvitationRole,
    teamIds: Array.isArray(data.teamIds) ? data.teamIds.filter((value): value is string => typeof value === "string") : [],
    status: getInvitationStatus(data),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toDate().toISOString() : null,
  };
}

function authenticationError(error: unknown): InvitationApiError | null {
  if (!isObject(error) || typeof error.code !== "string") return null;
  switch (error.code) {
    case "auth/id-token-expired":
    case "auth/id-token-revoked":
    case "auth/invalid-id-token":
      return new InvitationApiError("Sua sessão expirou. Entre novamente para continuar.", 401);
    case "auth/user-disabled":
      return new InvitationApiError("Esta conta está desativada. Procure um administrador.", 403);
    case "auth/user-not-found":
      return new InvitationApiError("A conta autenticada não está mais disponível.", 401);
    default:
      return null;
  }
}

export async function authenticateInvitationRequest(request: Request, requireVerifiedEmail = true) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new InvitationApiError("Faça login para continuar.", 401);

  let decodedToken;
  try {
    decodedToken = await getAdminAuth().verifyIdToken(match[1], true);
  } catch (error) {
    const apiError = authenticationError(error);
    if (apiError) throw apiError;
    throw error;
  }

  if (requireVerifiedEmail && decodedToken.email_verified !== true) {
    throw new InvitationApiError("Verifique seu e-mail antes de continuar.", 403);
  }
  return decodedToken;
}

export async function readInvitationPayload(request: Request): Promise<JsonObject> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new InvitationApiError("Não foi possível ler a solicitação.", 400);
  }
  if (text.length > 16_384) throw new InvitationApiError("Solicitação muito grande.", 413);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new InvitationApiError("O corpo da solicitação deve ser um JSON válido.", 400);
  }
  if (!isObject(payload)) throw new InvitationApiError("O corpo da solicitação deve ser um objeto JSON.", 400);
  return payload;
}

function requireAdminSnapshot(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  profileSnapshot: FirebaseFirestore.DocumentSnapshot,
  uid: string,
  companyId: string,
) {
  const member = snapshot.data();
  if (!profileMatchesCompany(profileSnapshot, companyId)
    || !snapshot.exists || member?.uid !== uid || member.status !== "ACTIVE" || member.role !== "ADMIN") {
    throw new InvitationApiError("Somente uma administradora ativa pode gerenciar convites.", 403);
  }
}

function requireDirectorSnapshots(
  organizationSnapshot: FirebaseFirestore.DocumentSnapshot,
  directorSnapshot: FirebaseFirestore.DocumentSnapshot,
  storeSnapshot: FirebaseFirestore.DocumentSnapshot,
  companySnapshot: FirebaseFirestore.DocumentSnapshot,
  uid: string,
  emailValue: unknown,
  organizationId: string,
  storeId: string,
  companyId: string,
) {
  if (!hasActiveDirectorGrant(organizationSnapshot.data(), directorSnapshot.data(), uid, emailValue)
    || !storeSnapshot.exists || storeSnapshot.get("organizationId") !== organizationId
    || storeSnapshot.get("storeId") !== storeId || storeSnapshot.get("companyId") !== companyId
    || storeSnapshot.get("status") !== "ACTIVE" || storeSnapshot.get("companyMappingStatus") !== "CONFIRMED"
    || !companySnapshot.exists || companySnapshot.get("organizationId") !== organizationId
    || companySnapshot.get("storeId") !== storeId) {
    throw new InvitationApiError("Somente o Diretor pode administrar convites de administrador de uma loja confirmada.", 403);
  }
}

function requireRole(value: unknown): InvitationRole {
  if (value !== "ADMIN" && value !== "LEADER" && value !== "EMPLOYEE") {
    throw new InvitationApiError("Perfil do convite inválido.", 400);
  }
  return value;
}

function requireTeamIds(value: unknown, role: InvitationRole): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== "string" || !id.trim() || id.includes("/"))) {
    throw new InvitationApiError("As equipes selecionadas são inválidas.", 400);
  }
  const teamIds = [...new Set(value as string[])];
  if (teamIds.length !== value.length) throw new InvitationApiError("Há equipes duplicadas no convite.", 400);
  if (role === "ADMIN" && teamIds.length) {
    throw new InvitationApiError("O perfil de administração não pode ser vinculado a equipes.", 400);
  }
  return teamIds;
}

async function assertAdmin(db: FirebaseFirestore.Firestore, uid: string, companyId: string) {
  const [snapshot, profileSnapshot] = await Promise.all([
    db.collection("companies").doc(companyId).collection("members").doc(uid).get(),
    db.collection("userProfiles").doc(uid).get(),
  ]);
  requireAdminSnapshot(snapshot, profileSnapshot, uid, companyId);
}

async function createInvitationLink(
  db: FirebaseFirestore.Firestore,
  uid: string,
  payload: JsonObject,
  director?: { email: string; organizationId: string; storeId: string },
): Promise<{ id: string; token: string; invitation: ReturnType<typeof invitationSummary>; companyName: string }> {
  const companyId = director
    ? requireString((await db.collection("organizations").doc(director.organizationId)
      .collection("stores").doc(director.storeId).get()).get("companyId"), "Empresa da loja")
    : requireString(payload.companyId, "Empresa");
  const email = normalizeEmail(payload.email);
  const role = requireRole(payload.role);
  const teamIds = requireTeamIds(payload.teamIds ?? [], role);
  if (director ? role !== "ADMIN" || teamIds.length > 0 : role === "ADMIN") {
    throw new InvitationApiError(
      director ? "O convite do Diretor deve ser de administrador sem equipes." : "Somente o Diretor pode convidar administradores de loja.",
      403,
    );
  }
  const dbCompany = db.collection("companies").doc(companyId);
  const reservationRef = dbCompany.collection("invitationReservations").doc(invitationReservationId(companyId, email));
  const invitationRef = db.collection("invitations").doc(randomUUID());
  const token = makeToken();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + INVITATION_LIFETIME_MS);

  const invitation = await db.runTransaction(async (transaction) => {
    const adminRef = dbCompany.collection("members").doc(uid);
    const profileRef = db.collection("userProfiles").doc(uid);
    const organizationRef = director
      ? db.collection("organizations").doc(director.organizationId)
      : null;
    const teamsQuery = dbCompany.collection("teams");
    const teamRefs = teamIds.map((teamId) => teamsQuery.doc(teamId));
    const [companySnapshot, adminSnapshot, profileSnapshot, reservationSnapshot, ...teamSnapshots] = await Promise.all([
      transaction.get(dbCompany),
      transaction.get(adminRef),
      transaction.get(profileRef),
      transaction.get(reservationRef),
      ...teamRefs.map((teamRef) => transaction.get(teamRef)),
    ]);

    if (!companySnapshot.exists) throw new InvitationApiError("Empresa não encontrada.", 404);
    if (director && organizationRef) {
      const [organizationSnapshot, directorSnapshot, storeSnapshot] = await Promise.all([
        transaction.get(organizationRef),
        transaction.get(organizationRef.collection("directors").doc(uid)),
        transaction.get(organizationRef.collection("stores").doc(director.storeId)),
      ]);
      requireDirectorSnapshots(
        organizationSnapshot,
        directorSnapshot,
        storeSnapshot,
        companySnapshot,
        uid,
        director.email,
        director.organizationId,
        director.storeId,
        companyId,
      );
    } else {
      requireAdminSnapshot(adminSnapshot, profileSnapshot, uid, companyId);
    }
    if (teamSnapshots.some((snapshot) => !snapshot.exists || snapshot.get("active") !== true)) {
      throw new InvitationApiError("Uma das equipes selecionadas não existe ou está inativa.", 409);
    }
    const reservationExpiry = reservationSnapshot.get("expiresAt");
    if (reservationSnapshot.exists && reservationExpiry instanceof Timestamp && reservationExpiry.toMillis() > now) {
      throw new InvitationApiError("Já existe um convite pendente para este e-mail. Reenvie o convite existente.", 409);
    }

    const companyName = typeof companySnapshot.get("name") === "string" ? companySnapshot.get("name") : "a empresa";
    const invitationData = {
      companyId,
      companyName,
      invitedEmail: email,
      role,
      teamIds,
      status: "PENDING",
      tokenHash: tokenDigest(token).toString("hex"),
      createdBy: uid,
      ...(director ? {
        invitationScope: "STORE_ADMIN",
        organizationId: director.organizationId,
        storeId: director.storeId,
      } : {}),
      createdAt: Timestamp.fromMillis(now),
      expiresAt,
    };
    transaction.create(invitationRef, invitationData);
    transaction.set(reservationRef, { invitationId: invitationRef.id, expiresAt });
    return { ...invitationData, companyName };
  });

  return {
    id: invitationRef.id,
    token,
    invitation: invitationSummary(invitationRef.id, invitation),
    companyName: invitation.companyName,
  };
}

async function rotateInvitationLink(
  db: FirebaseFirestore.Firestore,
  uid: string,
  payload: JsonObject,
  email: string,
): Promise<{ id: string; token: string; invitation: ReturnType<typeof invitationSummary>; companyName: string }> {
  const invitationId = requireInvitationId(payload.invitationId);
  const invitationRef = db.collection("invitations").doc(invitationId);
  const token = makeToken();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + INVITATION_LIFETIME_MS);

  const invitation = await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(invitationRef);
    if (!currentSnapshot.exists) throw new InvitationApiError("Convite não encontrado.", 404);
    const current = currentSnapshot.data()!;
    if (typeof current.companyId !== "string") throw new InvitationApiError("Convite inválido.", 409);
    await requireInvitationManager(transaction, db, uid, email, current, current.companyId);
    if (current.status !== "PENDING") {
      throw new InvitationApiError("Somente convites pendentes podem ser reenviados.", 409);
    }
    const reservationRef = db.collection("companies").doc(current.companyId)
      .collection("invitationReservations").doc(invitationReservationId(current.companyId, String(current.invitedEmail)));
    const reservationSnapshot = await transaction.get(reservationRef);
    if (reservationSnapshot.exists && reservationSnapshot.get("invitationId") !== invitationId
      && reservationSnapshot.get("expiresAt") instanceof Timestamp
      && reservationSnapshot.get("expiresAt").toMillis() > now) {
      throw new InvitationApiError("Já existe outro convite pendente para este e-mail.", 409);
    }

    const next: JsonObject = {
      ...current,
      tokenHash: tokenDigest(token).toString("hex"),
      expiresAt,
      updatedAt: Timestamp.fromMillis(now),
    };
    transaction.update(invitationRef, next);
    transaction.set(reservationRef, { invitationId, expiresAt });
    return next;
  });

  return {
    id: invitationRef.id,
    token,
    invitation: invitationSummary(invitationRef.id, invitation),
    companyName: String(invitation.companyName ?? "a empresa"),
  };
}

async function requireInvitationManager(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  uid: string,
  email: string,
  invitation: JsonObject,
  companyId: string,
) {
  if (invitation.role === "ADMIN" && invitation.invitationScope !== "STORE_ADMIN") {
    throw new InvitationApiError("Convites de administrador devem ser gerenciados pelo Diretor.", 403);
  }
  if (invitation.invitationScope === "STORE_ADMIN") {
    const organizationId = requireString(invitation.organizationId, "Organização");
    const storeId = requireString(invitation.storeId, "Loja");
    const organizationRef = db.collection("organizations").doc(organizationId);
    const [organizationSnapshot, directorSnapshot, storeSnapshot, companySnapshot] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(organizationRef.collection("directors").doc(uid)),
      transaction.get(organizationRef.collection("stores").doc(storeId)),
      transaction.get(db.collection("companies").doc(companyId)),
    ]);
    requireDirectorSnapshots(
      organizationSnapshot,
      directorSnapshot,
      storeSnapshot,
      companySnapshot,
      uid,
      email,
      organizationId,
      storeId,
      companyId,
    );
    return;
  }
  const [adminSnapshot, profileSnapshot] = await Promise.all([
    transaction.get(db.collection("companies").doc(companyId).collection("members").doc(uid)),
    transaction.get(db.collection("userProfiles").doc(uid)),
  ]);
  requireAdminSnapshot(adminSnapshot, profileSnapshot, uid, companyId);
}

export async function cancelInvitation(uid: string, emailValue: unknown, payload: JsonObject) {
  const db = getAdminFirestore();
  const email = normalizeEmail(emailValue);
  const invitationId = requireInvitationId(payload.invitationId);
  const invitationRef = db.collection("invitations").doc(invitationId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(invitationRef);
    if (!snapshot.exists) throw new InvitationApiError("Convite não encontrado.", 404);
    const data = snapshot.data()!;
    if (typeof data.companyId !== "string") throw new InvitationApiError("Convite inválido.", 409);
    await requireInvitationManager(transaction, db, uid, email, data, data.companyId);
    if (data.status !== "PENDING") {
      throw new InvitationApiError("Somente convites pendentes podem ser cancelados.", 409);
    }
    const reservationRef = db.collection("companies").doc(data.companyId)
      .collection("invitationReservations").doc(invitationReservationId(data.companyId, String(data.invitedEmail)));
    const reservationSnapshot = await transaction.get(reservationRef);
    transaction.update(invitationRef, {
      status: "CANCELED",
      tokenHash: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (reservationSnapshot.exists && reservationSnapshot.get("invitationId") === invitationId) {
      transaction.delete(reservationRef);
    }
  });
  return { invitationId, status: "CANCELED" as const };
}

export async function listInvitations(uid: string, emailValue: unknown, companyIdValue: unknown, storeIdValue?: unknown) {
  const companyId = requireString(companyIdValue, "Empresa");
  const db = getAdminFirestore();
  if (typeof storeIdValue === "string" && storeIdValue) {
    const organizationId = "hipermercado-baratao";
    const storeId = requireString(storeIdValue, "Loja");
    const organizationRef = db.collection("organizations").doc(organizationId);
    const [organizationSnapshot, directorSnapshot, storeSnapshot, companySnapshot] = await Promise.all([
      organizationRef.get(),
      organizationRef.collection("directors").doc(uid).get(),
      organizationRef.collection("stores").doc(storeId).get(),
      db.collection("companies").doc(companyId).get(),
    ]);
    requireDirectorSnapshots(
      organizationSnapshot,
      directorSnapshot,
      storeSnapshot,
      companySnapshot,
      uid,
      emailValue,
      organizationId,
      storeId,
      companyId,
    );
  } else {
    await assertAdmin(db, uid, companyId);
  }
  const snapshot = await db.collection("invitations").where("companyId", "==", companyId).get();
  return snapshot.docs
    .filter((item) => storeIdValue
      ? item.get("invitationScope") === "STORE_ADMIN"
      : item.get("invitationScope") !== "STORE_ADMIN" && item.get("role") !== "ADMIN")
    .map((item) => invitationSummary(item.id, item.data()))
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

function requireValidPendingInvitation(data: JsonObject) {
  if (getInvitationStatus(data) !== "PENDING") {
    throw new InvitationApiError("Este convite foi cancelado, utilizado ou expirou.", 410);
  }
}

export async function lookupInvitation(payload: JsonObject) {
  const invitationId = requireInvitationId(payload.invitationId);
  const token = requireToken(payload.token);
  const db = getAdminFirestore();
  const snapshot = await db.collection("invitations").doc(invitationId).get();
  if (!snapshot.exists) throw new InvitationApiError("Convite inválido ou expirado.", 404);
  const data = snapshot.data()!;
  requireValidPendingInvitation(data);
  if (!tokenMatches(token, data.tokenHash)) throw new InvitationApiError("Convite inválido ou expirado.", 404);

  const teamIds = Array.isArray(data.teamIds) ? data.teamIds.filter((id): id is string => typeof id === "string") : [];
  const teams = await Promise.all(teamIds.map((id) =>
    db.collection("companies").doc(String(data.companyId)).collection("teams").doc(id).get(),
  ));
  return {
    invitationId,
    email: String(data.invitedEmail),
    companyName: String(data.companyName ?? "a empresa"),
    role: data.role as InvitationRole,
    teamNames: teams.flatMap((team) => team.exists && typeof team.get("name") === "string" ? [team.get("name") as string] : []),
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toDate().toISOString() : null,
  };
}

export async function acceptInvitation(
  uid: string,
  emailValue: unknown,
  emailVerified: boolean,
  payload: JsonObject,
) {
  if (!emailVerified) throw new InvitationApiError("Verifique seu e-mail antes de aceitar o convite.", 403);
  const email = normalizeEmail(emailValue);
  const invitationId = requireInvitationId(payload.invitationId);
  const token = requireToken(payload.token);
  const db = getAdminFirestore();
  const invitationRef = db.collection("invitations").doc(invitationId);
  const userProfileRef = db.collection("userProfiles").doc(uid);

  return db.runTransaction(async (transaction) => {
    const invitationSnapshot = await transaction.get(invitationRef);
    if (!invitationSnapshot.exists) throw new InvitationApiError("Convite inválido ou expirado.", 404);
    const invitation = invitationSnapshot.data()!;
    const wasAcceptedByUser = invitation.status === "ACCEPTED"
      && invitation.acceptedUid === uid
      && invitation.invitedEmail === email
      && tokenMatches(token, invitation.tokenHash);
    if (wasAcceptedByUser) {
      const companyId = requireString(invitation.companyId, "Empresa do convite");
      const [profileSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(userProfileRef),
        transaction.get(db.collection("companies").doc(companyId).collection("members").doc(uid)),
      ]);
      const member = memberSnapshot.data();
      if (!profileMatchesCompany(profileSnapshot, companyId)
        || !memberSnapshot.exists || member?.uid !== uid
        || member.status !== "ACTIVE" || member.role !== invitation.role) {
        throw new InvitationApiError("Esta conta não possui mais um vínculo ativo com a empresa do convite.", 403);
      }
      return { companyId, alreadyAccepted: true };
    }
    requireValidPendingInvitation(invitation);
    if (!tokenMatches(token, invitation.tokenHash)) {
      throw new InvitationApiError("Convite inválido ou expirado.", 404);
    }
    if (invitation.invitedEmail !== email) {
      throw new InvitationApiError("Este convite foi enviado para outro e-mail.", 403);
    }

    const companyId = requireString(invitation.companyId, "Empresa do convite");
    const role = requireRole(invitation.role);
    if (role === "ADMIN" && invitation.invitationScope !== "STORE_ADMIN") {
      throw new InvitationApiError("Convites de administrador devem ser emitidos pelo Diretor.", 403);
    }
    const teamIds = requireTeamIds(invitation.teamIds ?? [], role);
    const companyRef = db.collection("companies").doc(companyId);
    const memberRef = companyRef.collection("members").doc(uid);
    const reservationRef = companyRef.collection("invitationReservations")
      .doc(invitationReservationId(companyId, email));
    const teamRefs = teamIds.map((teamId) => companyRef.collection("teams").doc(teamId));
    const [companySnapshot, memberSnapshot, profileSnapshot, reservationSnapshot, ...teamSnapshots] = await Promise.all([
      transaction.get(companyRef),
      transaction.get(memberRef),
      transaction.get(userProfileRef),
      transaction.get(reservationRef),
      ...teamRefs.map((teamRef) => transaction.get(teamRef)),
    ]);
    if (!companySnapshot.exists) throw new InvitationApiError("A empresa deste convite não está mais disponível.", 409);
    if (memberSnapshot.exists) throw new InvitationApiError("Esta conta já possui um vínculo com a empresa.", 409);
    if (profileSnapshot.exists && profileSnapshot.get("companyId") !== companyId) {
      throw new InvitationApiError("Esta conta já está vinculada a outra empresa.", 409);
    }
    if (teamSnapshots.some((snapshot) => !snapshot.exists || snapshot.get("active") !== true)) {
      throw new InvitationApiError("Uma equipe deste convite não está mais disponível. Peça um novo convite à administração.", 409);
    }
    if (invitation.invitationScope === "STORE_ADMIN") {
      const organizationId = requireString(invitation.organizationId, "Organização do convite");
      const storeId = requireString(invitation.storeId, "Loja do convite");
      const [organizationSnapshot, storeSnapshot] = await Promise.all([
        transaction.get(db.collection("organizations").doc(organizationId)),
        transaction.get(db.collection("organizations").doc(organizationId).collection("stores").doc(storeId)),
      ]);
      if (!organizationSnapshot.exists || organizationSnapshot.get("status") !== "ACTIVE"
        || !storeSnapshot.exists || storeSnapshot.get("organizationId") !== organizationId
        || storeSnapshot.get("storeId") !== storeId || storeSnapshot.get("companyId") !== companyId
        || storeSnapshot.get("status") !== "ACTIVE" || storeSnapshot.get("companyMappingStatus") !== "CONFIRMED"
        || companySnapshot.get("organizationId") !== organizationId || companySnapshot.get("storeId") !== storeId) {
        throw new InvitationApiError("A loja deste convite não está mais disponível para cadastro.", 409);
      }
    }

    const displayName = typeof payload.name === "string" ? payload.name.trim().slice(0, 100) : "";
    transaction.create(memberRef, {
      uid,
      name: displayName || email.split("@")[0],
      email,
      role,
      status: "ACTIVE",
      teamIds,
      positionTitle: INITIAL_POSITION,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(userProfileRef, {
      companyId,
      ...(profileSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.update(invitationRef, {
      status: "ACCEPTED",
      acceptedUid: uid,
      acceptedAt: FieldValue.serverTimestamp(),
    });
    if (reservationSnapshot.exists && reservationSnapshot.get("invitationId") === invitationId) {
      transaction.delete(reservationRef);
    }
    return { companyId, alreadyAccepted: false };
  });
}

export async function readCurrentAccess(uid: string, emailValue: unknown) {
  const email = normalizeEmail(emailValue);
  const db = getAdminFirestore();
  const profile = await db.collection("userProfiles").doc(uid).get();
  const companyId = profile.get("companyId");
  if (typeof companyId !== "string" || !companyId) {
    throw new InvitationApiError("Sua conta ainda não tem acesso ao painel. Solicite um convite à administração.", 403);
  }

  const companyRef = db.collection("companies").doc(companyId);
  const [companySnapshot, memberSnapshot] = await Promise.all([
    companyRef.get(),
    companyRef.collection("members").doc(uid).get(),
  ]);
  const member = memberSnapshot.data();
  if (!companySnapshot.exists || !memberSnapshot.exists || member?.status !== "ACTIVE"
    || member.uid !== uid
    || typeof member.email !== "string" || member.email.trim().toLowerCase() !== email) {
    throw new InvitationApiError("Sua conta não possui um vínculo ativo. Solicite ajuda à administração.", 403);
  }
  return { companyId };
}

export async function createInvitation(uid: string, payload: JsonObject, baseUrl: string) {
  const db = getAdminFirestore();
  const generated = await createInvitationLink(db, uid, payload);
  const inviteUrl = `${baseUrl}/convite/${generated.id}#${generated.token}`;
  const delivery = await deliverInvitationEmail(generated.invitation.email, generated.companyName, inviteUrl);
  return { invitation: generated.invitation, inviteUrl, ...delivery };
}

export async function createStoreAdminInvitation(
  uid: string,
  emailValue: unknown,
  payload: JsonObject,
  baseUrl: string,
) {
  const storeId = requireString(payload.storeId, "Loja", 64);
  const email = normalizeEmail(emailValue);
  const generated = await createInvitationLink(
    getAdminFirestore(),
    uid,
    { ...payload, role: "ADMIN", teamIds: [] },
    { email, organizationId: "hipermercado-baratao", storeId },
  );
  const inviteUrl = `${baseUrl}/convite/${generated.id}#${generated.token}`;
  const delivery = await deliverInvitationEmail(generated.invitation.email, generated.companyName, inviteUrl);
  return { invitation: generated.invitation, inviteUrl, ...delivery };
}

export async function resendInvitation(uid: string, emailValue: unknown, payload: JsonObject, baseUrl: string) {
  const email = normalizeEmail(emailValue);
  const db = getAdminFirestore();
  const generated = await rotateInvitationLink(db, uid, payload, email);
  const inviteUrl = `${baseUrl}/convite/${generated.id}#${generated.token}`;
  const delivery = await deliverInvitationEmail(generated.invitation.email, generated.companyName, inviteUrl);
  return { invitation: generated.invitation, inviteUrl, ...delivery };
}

async function deliverInvitationEmail(email: string, companyName: string, inviteUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITATION_FROM_EMAIL;
  if (!apiKey || !from) {
    return { emailSent: false, emailWarning: "Envio de e-mail não configurado. Copie o link e envie ao convidado por um canal seguro." };
  }

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Convite para acessar ${companyName} no HB Avalia`,
        text: `Você recebeu um convite para acessar ${companyName} no HB Avalia. Abra este link para criar ou acessar sua conta: ${inviteUrl}\n\nO convite expira em 7 dias e só pode ser usado pelo e-mail convidado.`,
        html: `<p>Você recebeu um convite para acessar <strong>${escapeHtml(companyName)}</strong> no HB Avalia.</p><p><a href="${escapeHtml(inviteUrl)}">Aceitar convite</a></p><p>O convite expira em 7 dias e só pode ser usado pelo e-mail convidado.</p>`,
      }),
    });
    if (!response.ok) {
      console.error("Invitation email provider returned a non-success status.", response.status);
      return { emailSent: false, emailWarning: "O convite foi criado, mas o envio do e-mail falhou. Copie o link e envie ao convidado por um canal seguro." };
    }
    return { emailSent: true, emailWarning: "" };
  } catch (error) {
    console.error("Invitation email delivery failed.", error);
    return { emailSent: false, emailWarning: "O convite foi criado, mas não foi possível enviar o e-mail. Copie o link e envie ao convidado por um canal seguro." };
  }
}

export function getInvitationBaseUrl() {
  const configured = process.env.INVITATION_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const raw = configured || vercelUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  if (!raw) throw new InvitationApiError("Configure INVITATION_BASE_URL para gerar links de convite.", 503);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvitationApiError("A URL pública de convites está configurada incorretamente.", 503);
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new InvitationApiError("A URL pública de convites deve usar HTTPS.", 503);
  }
  return url.origin;
}
