import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { hasActiveDirectorGrant } from "./director-access-core.js";
import { getAdminFirestore } from "./firebase-admin-app.js";
import { InvitationApiError } from "./invitation-errors.js";
import { buildStoreAnalytics } from "./organization-analytics-core.js";

const ORGANIZATION_ID = "hipermercado-baratao";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function timestampToIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value
    && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function requireStoreId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new InvitationApiError("Identificador de loja inválido.", 400);
  }
  return value;
}

function requireTransferTeams(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item || item.length > 128)) {
    throw new InvitationApiError("A seleção de equipes é inválida.", 400);
  }
  const teamIds = [...new Set(value as string[])];
  if (teamIds.length !== value.length || teamIds.length > 20) {
    throw new InvitationApiError("Selecione até 20 equipes sem duplicar.", 400);
  }
  return teamIds;
}

async function assertDirectorTransaction(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  uid: string,
  email: string,
  storeIds: string[],
) {
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const organizationSnapshot = await transaction.get(organizationRef);
  const directorSnapshot = await transaction.get(organizationRef.collection("directors").doc(uid));
  if (!hasActiveDirectorGrant(
    organizationSnapshot.data(),
    directorSnapshot.data(),
    uid,
    email,
  )) {
    throw new InvitationApiError("Somente o Diretor ativo pode gerenciar usuários e transferências.", 403);
  }
  const stores = await Promise.all(storeIds.map(async (storeId) => {
    const snapshot = await transaction.get(organizationRef.collection("stores").doc(storeId));
    const data = snapshot.data();
    if (!snapshot.exists || data?.organizationId !== ORGANIZATION_ID || data.storeId !== storeId
      || data.status !== "ACTIVE" || data.companyMappingStatus !== "CONFIRMED"
      || typeof data.companyId !== "string") {
      throw new InvitationApiError(`A loja ${storeId} não possui vínculo operacional confirmado.`, 409);
    }
    const companySnapshot = await transaction.get(db.collection("companies").doc(data.companyId));
    if (!companySnapshot.exists || companySnapshot.get("organizationId") !== ORGANIZATION_ID
      || companySnapshot.get("storeId") !== storeId) {
      throw new InvitationApiError(`A empresa da loja ${storeId} não confirma o vínculo organizacional.`, 409);
    }
    return { storeId, companyId: data.companyId as string };
  }));
  return stores;
}

export async function readOrganizationManagement(uid: string, emailValue: unknown) {
  const email = normalizeEmail(emailValue);
  const db = getAdminFirestore();
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const [organizationSnapshot, directorSnapshot, storeSnapshot] = await Promise.all([
    organizationRef.get(),
    organizationRef.collection("directors").doc(uid).get(),
    organizationRef.collection("stores").get(),
  ]);
  if (!hasActiveDirectorGrant(
    organizationSnapshot.data(),
    directorSnapshot.data(),
    uid,
    email,
  )) {
    throw new InvitationApiError("Somente o Diretor ativo pode acessar a gestão organizacional.", 403);
  }
  const stores = await Promise.all(storeSnapshot.docs.map(async (snapshot) => {
    const store = snapshot.data();
    const base = {
      storeId: snapshot.id,
      name: String(store.name ?? ""),
      companyId: String(store.companyId ?? ""),
      status: store.status === "ACTIVE" ? "ACTIVE" as const : "INACTIVE" as const,
      companyMappingStatus: store.companyMappingStatus === "CONFIRMED" ? "CONFIRMED" as const : "PENDING_CONFIRMATION" as const,
    };
    if (store.organizationId !== ORGANIZATION_ID || store.storeId !== snapshot.id
      || !base.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(base.storeId)
      || !base.companyId || !/^[a-zA-Z0-9_-]+$/.test(base.companyId)) {
      throw new Error(`O cadastro organizacional da loja ${snapshot.id} é inválido.`);
    }
    const companySnapshot = await db.collection("companies").doc(base.companyId).get();
    if (companySnapshot.exists && (companySnapshot.get("organizationId") !== ORGANIZATION_ID
      || companySnapshot.get("storeId") !== base.storeId)) {
      throw new Error(`A empresa da loja ${base.storeId} não confirma o vínculo organizacional.`);
    }
    const operationalAccessReady = base.status === "ACTIVE"
      && base.companyMappingStatus === "CONFIRMED" && companySnapshot.exists;
    if (!operationalAccessReady) {
      return {
        ...base,
        operationalAccessReady,
        teams: [],
        departments: [],
        members: [],
        indicators: {
          activeMembers: 0,
          activeTeams: 0,
          openCycles: 0,
          evaluations: 0,
          developmentPlans: 0,
          promotionRequests: 0,
          customerFeedbackResponses: 0,
        },
        analytics: buildStoreAnalytics({
          members: [],
          teams: [],
          departments: [],
          cycles: [],
          evaluations: [],
          plans: [],
          feedback: [],
        }),
      };
    }
    const companyRef = db.collection("companies").doc(base.companyId);
    const [
      teamSnapshot,
      memberSnapshot,
      departmentSnapshot,
      cycleSnapshot,
      criterionSnapshot,
      evaluationSnapshot,
      planSnapshot,
      promotionSnapshot,
      feedbackSnapshot,
    ] = await Promise.all([
      companyRef.collection("teams").get(),
      companyRef.collection("members").get(),
      companyRef.collection("departments").get(),
      companyRef.collection("cycles").get(),
      companyRef.collection("criteria").get(),
      companyRef.collection("evaluations").get(),
      companyRef.collection("developmentPlans").get(),
      companyRef.collection("promotionRequests").get(),
      companyRef.collection("customerFeedbackResponses").get(),
    ]);
    const activeTeams = teamSnapshot.docs.filter((team) => team.get("active") === true);
    const activeMembers = memberSnapshot.docs.filter((member) => member.get("status") === "ACTIVE"
      && ["ADMIN", "LEADER", "EMPLOYEE"].includes(String(member.get("role"))));
    const openCycles = cycleSnapshot.docs.filter((cycle) => cycle.get("status") === "OPEN");
    const departments = departmentSnapshot.docs.map((department) => ({
      id: department.id,
      name: String(department.get("name") ?? ""),
      active: department.get("active") === true,
    }));
    const memberData = memberSnapshot.docs.map((member) => ({
      uid: member.id,
      name: String(member.get("name") ?? ""),
      email: String(member.get("email") ?? ""),
      role: String(member.get("role") ?? ""),
      status: String(member.get("status") ?? ""),
      teamIds: stringArray(member.get("teamIds")),
    }));
    const teamData = teamSnapshot.docs.map((team) => ({
      id: team.id,
      name: String(team.get("name") ?? ""),
      departmentId: String(team.get("departmentId") ?? ""),
      active: team.get("active") === true,
    }));
    const evaluationData = evaluationSnapshot.docs.map((evaluation) => ({
      id: evaluation.id,
      cycleId: String(evaluation.get("cycleId") ?? ""),
      evaluatorId: String(evaluation.get("evaluatorId") ?? ""),
      evaluatedUserId: String(evaluation.get("evaluatedUserId") ?? ""),
      type: String(evaluation.get("type") ?? ""),
      status: String(evaluation.get("status") ?? ""),
      averageScore: typeof evaluation.get("averageScore") === "number" ? evaluation.get("averageScore") : null,
      submittedAt: timestampToIso(evaluation.get("submittedAt")),
    }));
    const submittedEvaluations = evaluationSnapshot.docs.filter((evaluation) => evaluation.get("status") === "SUBMITTED");
    const answerData: Array<{ evaluationId: string; criterionId: string; score: number }> = [];
    for (let offset = 0; offset < submittedEvaluations.length; offset += 25) {
      const answerSnapshots = await Promise.all(submittedEvaluations.slice(offset, offset + 25)
        .map((evaluation) => evaluation.ref.collection("answers").get()));
      answerSnapshots.forEach((answers, index) => {
        const evaluation = submittedEvaluations[offset + index];
        answers.docs.forEach((answer) => {
          const score = answer.get("score");
          if (Number.isInteger(score) && score >= 1 && score <= 5) {
            answerData.push({ evaluationId: evaluation.id, criterionId: answer.id, score });
          }
        });
      });
    }
    const criteria = criterionSnapshot.docs.map((criterion) => ({
      id: criterion.id,
      name: String(criterion.get("name") ?? ""),
      evaluationType: String(criterion.get("evaluationType") ?? ""),
      active: criterion.get("active") === true,
    }));
    const planData = planSnapshot.docs.map((plan) => ({
      employeeId: String(plan.get("employeeId") ?? plan.id),
      status: String(plan.get("status") ?? ""),
      goals: Array.isArray(plan.get("goals")) ? plan.get("goals") : [],
    }));
    const feedbackData = feedbackSnapshot.docs.map((response) => ({
      overallRating: Number(response.get("overallRating")),
      submittedAt: timestampToIso(response.get("submittedAt")),
    }));
    const analytics = buildStoreAnalytics({
      members: memberData,
      teams: teamData,
      departments,
      cycles: cycleSnapshot.docs.map((cycle) => ({ id: cycle.id, status: String(cycle.get("status") ?? "") })),
      evaluations: evaluationData,
      criteria,
      answers: answerData,
      plans: planData,
      feedback: feedbackData,
    });
    return {
      ...base,
      operationalAccessReady,
      teams: activeTeams.map((team) => ({
          teamId: team.id,
          name: String(team.get("name") ?? ""),
          departmentId: String(team.get("departmentId") ?? ""),
        })),
      departments: departments.map((department) => ({
          departmentId: department.id,
          name: department.name,
        })),
      members: activeMembers.map((member) => ({
          uid: member.id,
          name: String(member.get("name") ?? ""),
          email: String(member.get("email") ?? ""),
          role: member.get("role") as "ADMIN" | "LEADER" | "EMPLOYEE",
          teamIds: stringArray(member.get("teamIds")),
        })),
      indicators: {
        activeMembers: activeMembers.length,
        activeTeams: activeTeams.length,
        openCycles: openCycles.length,
        evaluations: evaluationSnapshot.size,
        developmentPlans: planSnapshot.size,
        promotionRequests: promotionSnapshot.size,
        customerFeedbackResponses: feedbackSnapshot.size,
      },
      analytics,
    };
  }));
  stores.sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  const operationalStores = stores.filter((store) => store.operationalAccessReady);
  const consolidated = operationalStores.reduce((totals, store) => ({
    activeMembers: totals.activeMembers + store.indicators.activeMembers,
    activeTeams: totals.activeTeams + store.indicators.activeTeams,
    openCycles: totals.openCycles + store.indicators.openCycles,
    evaluations: totals.evaluations + store.indicators.evaluations,
    developmentPlans: totals.developmentPlans + store.indicators.developmentPlans,
    promotionRequests: totals.promotionRequests + store.indicators.promotionRequests,
    customerFeedbackResponses: totals.customerFeedbackResponses + store.indicators.customerFeedbackResponses,
    operationalStores: totals.operationalStores + 1,
  }), {
    activeMembers: 0,
    activeTeams: 0,
    openCycles: 0,
    evaluations: 0,
    developmentPlans: 0,
    promotionRequests: 0,
    customerFeedbackResponses: 0,
    operationalStores: 0,
  });
  const transferSnapshot = await organizationRef.collection("transfers")
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  const storeById = new Map(stores.map((store) => [store.storeId, store]));
  const transfers = transferSnapshot.docs.flatMap((snapshot) => {
    const transfer = snapshot.data();
    const source = storeById.get(String(transfer.sourceStoreId ?? ""));
    const target = storeById.get(String(transfer.targetStoreId ?? ""));
    if (!source || !target || source.companyId !== transfer.sourceCompanyId
      || target.companyId !== transfer.targetCompanyId
      || typeof transfer.uid !== "string" || typeof transfer.email !== "string") return [];
    return [{
      id: snapshot.id,
      uid: transfer.uid,
      email: transfer.email,
      role: transfer.role as "ADMIN" | "LEADER" | "EMPLOYEE",
      sourceStoreId: source.storeId,
      targetStoreId: target.storeId,
      previousTeamIds: stringArray(transfer.previousTeamIds),
      targetTeamIds: stringArray(transfer.targetTeamIds),
      createdAt: timestampToIso(transfer.createdAt),
    }];
  });
  return { organizationId: ORGANIZATION_ID, stores, consolidated, transfers };
}

export async function transferOrganizationMember(uid: string, emailValue: unknown, payload: Record<string, unknown>) {
  const email = normalizeEmail(emailValue);
  const memberUid = typeof payload.memberUid === "string" ? payload.memberUid.trim() : "";
  const sourceStoreId = requireStoreId(payload.sourceStoreId);
  const targetStoreId = requireStoreId(payload.targetStoreId);
  const targetTeamIds = requireTransferTeams(payload.targetTeamIds);
  if (!memberUid || memberUid.length > 128 || memberUid.includes("/") || sourceStoreId === targetStoreId) {
    throw new InvitationApiError("Usuário ou lojas de origem e destino inválidos.", 400);
  }

  const db = getAdminFirestore();
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const auditRef = organizationRef.collection("transfers").doc();
  await db.runTransaction(async (transaction) => {
    const stores = await assertDirectorTransaction(
      transaction,
      db,
      uid,
      email,
      [sourceStoreId, targetStoreId],
    );
    const source = stores.find((store) => store.storeId === sourceStoreId)!;
    const target = stores.find((store) => store.storeId === targetStoreId)!;
    const sourceCompanyRef = db.collection("companies").doc(source.companyId);
    const targetCompanyRef = db.collection("companies").doc(target.companyId);
    const sourceMemberRef = sourceCompanyRef.collection("members").doc(memberUid);
    const targetMemberRef = targetCompanyRef.collection("members").doc(memberUid);
    const profileRef = db.collection("userProfiles").doc(memberUid);
    const [sourceMemberSnapshot, targetMemberSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(sourceMemberRef),
      transaction.get(targetMemberRef),
      transaction.get(profileRef),
    ]);
    const sourceMember = sourceMemberSnapshot.data();
    if (!sourceMemberSnapshot.exists || sourceMember?.uid !== memberUid || sourceMember.status !== "ACTIVE"
      || typeof sourceMember.email !== "string" || !normalizeEmail(sourceMember.email)
      || !profileSnapshot.exists || profileSnapshot.get("companyId") !== source.companyId) {
      throw new InvitationApiError("O usuário não possui um vínculo ativo confirmado na loja de origem.", 409);
    }
    if (targetMemberSnapshot.exists) {
      throw new InvitationApiError("O usuário já possui um registro na loja de destino.", 409);
    }
    if (!["ADMIN", "LEADER", "EMPLOYEE"].includes(String(sourceMember.role))) {
      throw new InvitationApiError("O perfil do usuário não pode ser transferido.", 409);
    }
    if (sourceMember.role === "ADMIN" && targetTeamIds.length > 0) {
      throw new InvitationApiError("Administradores não podem ser associados a equipes.", 400);
    }

    const targetTeamRefs = targetTeamIds.map((teamId) => targetCompanyRef.collection("teams").doc(teamId));
    if (sourceMember.teamIds !== undefined
      && (!Array.isArray(sourceMember.teamIds) || sourceMember.teamIds.some((teamId: unknown) => typeof teamId !== "string"))) {
      throw new InvitationApiError("O registro de equipes do usuário precisa ser corrigido antes da transferência.", 409);
    }
    const rawSourceTeamIds = stringArray(sourceMember.teamIds);
    if (rawSourceTeamIds.some((teamId) => !teamId || teamId.includes("/") || teamId.length > 128)
      || rawSourceTeamIds.length > 450) {
      throw new InvitationApiError("O registro de equipes do usuário precisa ser corrigido antes da transferência.", 409);
    }
    const sourceTeamIds = [...new Set(rawSourceTeamIds)];
    const sourceRosterRefs = sourceTeamIds.map((teamId) =>
      sourceCompanyRef.collection("teams").doc(teamId).collection("members").doc(memberUid));
    const targetRosterRefs = sourceMember.role === "ADMIN"
      ? []
      : targetTeamIds.map((teamId) =>
        targetCompanyRef.collection("teams").doc(teamId).collection("members").doc(memberUid));
    const teamSnapshots = await Promise.all(targetTeamRefs.map((ref) => transaction.get(ref)));
    if (teamSnapshots.some((team) => !team.exists || team.get("active") !== true)) {
      throw new InvitationApiError("Uma das equipes selecionadas não está ativa na loja de destino.", 409);
    }

    const nextMember = {
      uid: memberUid,
      name: String(sourceMember.name ?? ""),
      email: String(sourceMember.email ?? ""),
      role: sourceMember.role,
      status: "ACTIVE",
      teamIds: targetTeamIds,
      ...(typeof sourceMember.positionTitle === "string" ? { positionTitle: sourceMember.positionTitle } : {}),
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.update(sourceMemberRef, {
      status: "INACTIVE",
      teamIds: [],
    });
    transaction.create(targetMemberRef, nextMember);
    transaction.update(profileRef, { companyId: target.companyId });
    for (const rosterRef of sourceRosterRefs) transaction.delete(rosterRef);
    if (sourceMember.role !== "ADMIN") {
      for (let index = 0; index < targetRosterRefs.length; index += 1) {
        transaction.set(targetRosterRefs[index], {
          uid: memberUid,
          name: nextMember.name,
          email: nextMember.email,
          role: nextMember.role,
          status: "ACTIVE",
          teamIds: targetTeamIds,
          ...(typeof sourceMember.positionTitle === "string" ? { positionTitle: sourceMember.positionTitle } : {}),
        });
      }
    }
    transaction.update(sourceCompanyRef, {
      teamRosterVersion: 2,
      teamRosterSyncedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(targetCompanyRef, {
      teamRosterVersion: 2,
      teamRosterSyncedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      uid: memberUid,
      email: nextMember.email,
      role: nextMember.role,
      sourceStoreId,
      sourceCompanyId: source.companyId,
      targetStoreId,
      targetCompanyId: target.companyId,
      previousTeamIds: sourceTeamIds,
      targetTeamIds,
      initiatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { transferId: auditRef.id, memberUid, sourceStoreId, targetStoreId };
}
