import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import {
  calculatePromotionEvaluationResult,
  type PromotionCompetencyInput,
  type PromotionIndicatorInput,
} from "../../../functions/promotion-scoring";
import {
  getActiveSharedTeamIds,
  getMemberTeamIds,
  isActivePromotionAdmin,
  createPromotionEvaluationEvidence,
  createPromotionEvaluationPrivacyFields,
} from "../../../functions/promotion-security";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin";

type JsonObject = Record<string, unknown>;
const MAX_PROMOTION_EVALUATIONS = 30;

export class PromotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PromotionApiError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string, maxLength = 150): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("/")) {
    throw new PromotionApiError(`${label} inválido.`, 400);
  }
  return value.trim();
}

function callableErrorMessage(error: unknown): string | undefined {
  if (!isObject(error) || typeof error.code !== "string") return undefined;
  return error.code.startsWith("auth/") ? error.code : undefined;
}

export async function authenticatePromotionRequest(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new PromotionApiError("Faça login para continuar.", 401);

  try {
    const token = await getAdminAuth().verifyIdToken(match[1], true);
    return token.uid;
  } catch (error) {
    if (callableErrorMessage(error)) {
      throw new PromotionApiError("Sua sessão expirou. Entre novamente para continuar.", 401);
    }
    throw error;
  }
}

export async function readPromotionPayload(request: Request): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new PromotionApiError("O corpo da solicitação deve ser um JSON válido.", 400);
  }
  if (!isObject(payload)) throw new PromotionApiError("O corpo da solicitação deve ser um objeto JSON.", 400);
  return payload;
}

function readEvaluationInputs(payload: JsonObject): {
  indicators: PromotionIndicatorInput[];
  competencies: PromotionCompetencyInput[];
} {
  if (!Array.isArray(payload.indicators) || !Array.isArray(payload.competencies)) {
    throw new PromotionApiError("Informe os indicadores e as competências da avaliação.", 400);
  }

  const indicators = payload.indicators.map((item): PromotionIndicatorInput => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.percentage !== "number") {
      throw new PromotionApiError("Os dados de um indicador são inválidos.", 400);
    }
    return { id: item.id, percentage: item.percentage };
  });
  const competencies = payload.competencies.map((item): PromotionCompetencyInput => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.score !== "number") {
      throw new PromotionApiError("Os dados de uma competência são inválidos.", 400);
    }
    return { id: item.id, score: item.score };
  });

  return { indicators, competencies };
}

export async function submitPromotionRequest(uid: string, payload: JsonObject): Promise<{
  requestId: string;
}> {
  const companyId = requireString(payload.companyId, "Empresa");
  const employeeId = requireString(payload.employeeId, "Colaborador");
  const targetPosition = requireString(payload.targetPosition, "Cargo desejado", 100);
  if (targetPosition.length < 2) {
    throw new PromotionApiError("Informe o cargo desejado (2 a 100 caracteres).", 400);
  }
  const justification = typeof payload.justification === "string" ? payload.justification.trim() : "";
  if (justification.length < 20 || justification.length > 1500) {
    throw new PromotionApiError("Explique em 20 a 1.500 caracteres por que a pessoa está apta à promoção.", 400);
  }

  const inputs = readEvaluationInputs(payload);
  let promotionDetails;
  try {
    promotionDetails = calculatePromotionEvaluationResult(inputs.indicators, inputs.competencies);
  } catch (error) {
    throw new PromotionApiError(
      error instanceof Error ? error.message : "Os dados da avaliação de promoção são inválidos.",
      400,
    );
  }

  const db = getAdminFirestore();
  const companyRef = db.collection("companies").doc(companyId);
  const planRef = companyRef.collection("developmentPlans").doc(employeeId);
  const statusRef = companyRef.collection("promotionStatuses").doc(employeeId);
  const requestRef = companyRef.collection("promotionRequests").doc();

  try {
    return await db.runTransaction(async (transaction) => {
      const leaderRef = companyRef.collection("members").doc(uid);
      const employeeRef = companyRef.collection("members").doc(employeeId);
      const evaluationsQuery = companyRef.collection("evaluations")
        .where("evaluatedUserId", "==", employeeId)
        .where("type", "==", "EMPLOYEE")
        .where("status", "==", "SUBMITTED")
        .orderBy("submittedAt", "desc")
        .limit(MAX_PROMOTION_EVALUATIONS);
      const [leaderSnapshot, employeeSnapshot, planSnapshot, statusSnapshot, evaluationsSnapshot] = await Promise.all([
        transaction.get(leaderRef),
        transaction.get(employeeRef),
        transaction.get(planRef),
        transaction.get(statusRef),
        transaction.get(evaluationsQuery),
      ]);
      const leader = leaderSnapshot.data();
      const employee = employeeSnapshot.data();
      if (!leaderSnapshot.exists || leader?.status !== "ACTIVE" || leader.role !== "LEADER") {
        throw new PromotionApiError("Somente a liderança pode enviar uma indicação.", 403);
      }
      if (!employeeSnapshot.exists || employee?.status !== "ACTIVE" || employee.role !== "EMPLOYEE") {
        throw new PromotionApiError("Você não pode indicar este colaborador.", 403);
      }
      const sharedTeamIds = getActiveSharedTeamIds(leader, employee);
      if (!sharedTeamIds.length) {
        throw new PromotionApiError("O colaborador não está em uma equipe compartilhada ativa.", 409);
      }
      if (statusSnapshot.exists && statusSnapshot.data()?.status === "PENDING") {
        throw new PromotionApiError("Já existe uma indicação em análise para este colaborador.", 409);
      }

      const sourceSnapshots = evaluationsSnapshot.docs;
      const answerSnapshots = await Promise.all(
        sourceSnapshots.map((snapshot) => transaction.get(snapshot.ref.collection("answers"))),
      );
      const evaluations = sourceSnapshots.flatMap((snapshot, index) => {
        const answers = answerSnapshots[index].docs.map((answer) => ({
          id: answer.id,
          criterionId: answer.get("criterionId"),
          score: answer.get("score"),
        }));
        if (!answers.length || answers.some((answer) => answer.criterionId !== answer.id
          || !Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5)) return [];
        const averageScore = Number((answers.reduce((sum, answer) => sum + Number(answer.score), 0) / answers.length).toFixed(2));
        return [{
          id: snapshot.id,
          averageScore,
          cycleId: snapshot.get("cycleId"),
          comment: snapshot.get("comment"),
          submittedAt: snapshot.get("submittedAt"),
        }];
      });
      const cycleIds = [...new Set(evaluations
        .map((evaluation) => evaluation.cycleId)
        .filter((id): id is string => typeof id === "string"))];
      const cycleSnapshots = await Promise.all(
        cycleIds.map((cycleId) => transaction.get(companyRef.collection("cycles").doc(cycleId))),
      );
      const cyclesById = new Map(cycleSnapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
      const evidence = evaluations.map((evaluation) =>
        createPromotionEvaluationEvidence(evaluation, cyclesById.get(evaluation.cycleId)));

      const now = FieldValue.serverTimestamp();
      transaction.set(planRef, {
        employeeId,
        leaderId: uid,
        teamIds: sharedTeamIds,
        targetPosition,
        status: "ACTIVE",
        createdAt: planSnapshot.data()?.createdAt ?? now,
        updatedAt: now,
      }, { merge: true });
      transaction.create(requestRef, {
        employeeId,
        leaderId: uid,
        developmentPlanId: employeeId,
        targetPosition,
        justification,
        ...createPromotionEvaluationPrivacyFields(),
        indicators: promotionDetails.indicators,
        competencies: promotionDetails.competencies,
        promotionResult: {
          indicatorWeightTotal: promotionDetails.indicatorWeightTotal,
          competenceWeightTotal: promotionDetails.competenceWeightTotal,
          indicatorTotal: promotionDetails.indicatorTotal,
          indicatorBase: promotionDetails.indicatorBase,
          competenceTotal: promotionDetails.competenceTotal,
          baseScore: promotionDetails.baseScore,
          extraScore: promotionDetails.extraScore,
          finalScore: promotionDetails.finalScore,
          classification: promotionDetails.classification,
        },
        status: "PENDING",
        submittedAt: now,
      });
      evidence.forEach((item) => {
        transaction.create(
          requestRef.collection("evaluationEvidence").doc(item.evaluationId),
          item,
        );
      });
      transaction.set(statusRef, {
        employeeId,
        leaderId: uid,
        teamIds: sharedTeamIds,
        requestId: requestRef.id,
        targetPosition,
        status: "PENDING",
        submittedAt: now,
        updatedAt: now,
      });
      return { requestId: requestRef.id };
    });
  } catch (error) {
    if (error instanceof PromotionApiError) throw error;
    console.error("Failed to submit promotion request.", error);
    throw new PromotionApiError("Não foi possível enviar a indicação de promoção.", 500);
  }
}

export async function decidePromotionRequest(
  uid: string,
  requestId: string,
  payload: JsonObject,
): Promise<{ status: "APPROVED" | "REJECTED" }> {
  const companyId = requireString(payload.companyId, "Empresa");
  const decision = payload.decision;
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    throw new PromotionApiError("Decisão inválida.", 400);
  }
  const adminNote = typeof payload.adminNote === "string" ? payload.adminNote.trim() : "";
  if (adminNote.length > 1000) {
    throw new PromotionApiError("A observação deve ter no máximo 1.000 caracteres.", 400);
  }

  const db = getAdminFirestore();
  const companyRef = db.collection("companies").doc(companyId);
  const requestRef = companyRef.collection("promotionRequests").doc(requestId);

  try {
    await db.runTransaction(async (transaction) => {
      const adminRef = companyRef.collection("members").doc(uid);
      const adminSnapshot = await transaction.get(adminRef);
      if (!adminSnapshot.exists || !isActivePromotionAdmin(adminSnapshot.data())) {
        throw new PromotionApiError("Somente a administração pode decidir uma indicação.", 403);
      }
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new PromotionApiError("A indicação não foi encontrada.", 404);
      const promotion = requestSnapshot.data()!;
      const employeeId = requireString(promotion.employeeId, "Colaborador");
      const statusRef = companyRef.collection("promotionStatuses").doc(employeeId);
      const employeeRef = companyRef.collection("members").doc(employeeId);
      const planRef = companyRef.collection("developmentPlans").doc(employeeId);
      const [statusSnapshot, employeeSnapshot, planSnapshot] = await Promise.all([
        transaction.get(statusRef),
        transaction.get(employeeRef),
        transaction.get(planRef),
      ]);
      if (promotion.status !== "PENDING" || !statusSnapshot.exists
        || statusSnapshot.data()?.status !== "PENDING"
        || statusSnapshot.data()?.requestId !== requestId) {
        throw new PromotionApiError("Esta indicação já foi analisada ou substituída.", 409);
      }
      if (!employeeSnapshot.exists || employeeSnapshot.data()?.status !== "ACTIVE"
        || employeeSnapshot.data()?.role !== "EMPLOYEE") {
        throw new PromotionApiError("O colaborador não está ativo para receber a promoção.", 409);
      }
      if (!planSnapshot.exists || planSnapshot.data()?.status !== "ACTIVE"
        || planSnapshot.data()?.leaderId !== promotion.leaderId
        || planSnapshot.data()?.targetPosition !== promotion.targetPosition) {
        throw new PromotionApiError("O PDI associado à indicação não está mais ativo.", 409);
      }

      const rosterRefs = decision === "APPROVED"
        ? getMemberTeamIds(employeeSnapshot.data()).map((teamId) =>
          companyRef.collection("teams").doc(teamId).collection("members").doc(employeeId))
        : [];
      const rosterSnapshots = rosterRefs.length ? await transaction.getAll(...rosterRefs) : [];
      const now = FieldValue.serverTimestamp();
      transaction.update(requestRef, { status: decision, adminId: uid, adminNote, decidedAt: now });
      transaction.update(statusRef, { status: decision, adminId: uid, adminNote, decidedAt: now, updatedAt: now });
      if (decision === "APPROVED") {
        transaction.update(planRef, { status: "PROMOTED", updatedAt: now });
        transaction.update(employeeRef, { positionTitle: promotion.targetPosition, updatedAt: now });
        rosterSnapshots.forEach((snapshot) => {
          if (snapshot.exists) transaction.update(snapshot.ref, { positionTitle: promotion.targetPosition });
        });
      }
    });
    return { status: decision };
  } catch (error) {
    if (error instanceof PromotionApiError) throw error;
    console.error("Failed to decide promotion request.", error);
    throw new PromotionApiError("Não foi possível registrar a decisão da indicação.", 500);
  }
}
