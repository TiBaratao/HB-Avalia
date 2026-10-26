const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const {
  calculatePromotionEvaluationResult,
  validateEvaluationAnswers,
  validateSurveyAnswers,
} = require("./domain");
const {
  getActiveSharedTeamIds,
  getMemberTeamIds,
  isActivePromotionAdmin,
  createPromotionEvaluationEvidence,
  createPromotionEvaluationPrivacyFields,
} = require("./promotion-security");

const REGION = "southamerica-east1";
const MAX_PROMOTION_EVALUATIONS = 30;

function callableError(error, fallback) {
  if (error instanceof HttpsError) return error;
  logger.error(fallback, { message: error instanceof Error ? error.message : String(error) });
  return new HttpsError("internal", fallback);
}

function requireAuthenticatedUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Entre novamente para continuar.");
  return uid;
}

function requireString(value, label, maxLength = 150) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} inválido.`);
  }
  return value.trim();
}

function teamIdsOf(member) {
  return Array.isArray(member?.teamIds) ? member.teamIds.filter((id) => typeof id === "string") : [];
}

function sharesTeam(first, second) {
  const otherIds = new Set(teamIdsOf(second));
  return teamIdsOf(first).some((teamId) => otherIds.has(teamId));
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") return new Date(value).getTime();
  return NaN;
}

function cycleIsAvailable(cycle, now) {
  if (!cycle || cycle.status !== "OPEN") return false;
  const startsAt = timestampMillis(cycle.startsAtAt);
  const endsAt = timestampMillis(cycle.endsAtAt);
  return (!Number.isFinite(startsAt) || startsAt <= now)
    && (!Number.isFinite(endsAt) || endsAt >= now);
}

function surveyIsAvailable(survey, role, now) {
  if (!survey || survey.active !== true || !Array.isArray(survey.audience) || !survey.audience.includes(role)) return false;
  const startsAt = timestampMillis(survey.startsAtAt);
  const endsAt = timestampMillis(survey.endsAtAt);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && endsAt >= now;
}

function evaluationDocumentId(companyId, cycleId, evaluatorId, evaluatedUserId, type) {
  return `eval_${companyId}~${cycleId}~${evaluatorId}~${evaluatedUserId}~${type}`;
}

exports.submitEvaluation = onCall({ region: REGION }, async (request) => {
  const uid = requireAuthenticatedUid(request);
  const data = request.data || {};
  const companyId = requireString(data.companyId, "Empresa");
  const cycleId = requireString(data.cycleId, "Ciclo");
  const evaluatedUserId = requireString(data.evaluatedUserId, "Colaborador");
  const type = data.type;
  if (!["EMPLOYEE", "LEADER"].includes(type)) throw new HttpsError("invalid-argument", "Tipo de avaliação inválido.");
  const comment = typeof data.comment === "string" ? data.comment.trim() : "";
  if (comment.length > 2000) throw new HttpsError("invalid-argument", "O comentário pode ter até 2.000 caracteres.");
  const existingEvaluationId = data.existingEvaluationId == null
    ? null
    : requireString(data.existingEvaluationId, "Rascunho");

  const db = getFirestore();
  const companyRef = db.collection("companies").doc(companyId);
  const evaluationsRef = companyRef.collection("evaluations");
  const evaluationId = evaluationDocumentId(companyId, cycleId, uid, evaluatedUserId, type);
  const canonicalRef = evaluationsRef.doc(evaluationId);

  try {
    return await db.runTransaction(async (transaction) => {
      const evaluatorRef = companyRef.collection("members").doc(uid);
      const targetRef = companyRef.collection("members").doc(evaluatedUserId);
      const cycleRef = companyRef.collection("cycles").doc(cycleId);
      const criteriaQuery = companyRef.collection("criteria").where("evaluationType", "==", type);
      const duplicatesQuery = evaluationsRef
        .where("cycleId", "==", cycleId)
        .where("evaluatorId", "==", uid)
        .where("evaluatedUserId", "==", evaluatedUserId)
        .where("type", "==", type);
      const [evaluatorSnapshot, targetSnapshot, cycleSnapshot, criteriaSnapshot, duplicatesSnapshot] = await Promise.all([
        transaction.get(evaluatorRef),
        transaction.get(targetRef),
        transaction.get(cycleRef),
        transaction.get(criteriaQuery),
        transaction.get(duplicatesQuery),
      ]);

      const evaluator = evaluatorSnapshot.data();
      const target = targetSnapshot.data();
      if (!evaluatorSnapshot.exists || evaluator?.status !== "ACTIVE") throw new HttpsError("permission-denied", "Sua conta não está ativa nesta empresa.");
      if (!targetSnapshot.exists || target?.status !== "ACTIVE") throw new HttpsError("failed-precondition", "A pessoa avaliada não está ativa.");
      const permitted = type === "EMPLOYEE"
        ? evaluator.role === "LEADER" && target.role === "EMPLOYEE"
        : evaluator.role === "EMPLOYEE" && target.role === "LEADER";
      if (!permitted || !sharesTeam(evaluator, target)) throw new HttpsError("permission-denied", "Você não pode avaliar esta pessoa.");
      if (!cycleSnapshot.exists || !cycleIsAvailable(cycleSnapshot.data(), Date.now())) {
        throw new HttpsError("failed-precondition", "O ciclo de avaliação não está aberto neste momento.");
      }

      const criteria = criteriaSnapshot.docs
        .filter((criterion) => criterion.data().active === true)
        .map((criterion) => ({ id: criterion.id, ...criterion.data() }));
      let normalized;
      try {
        normalized = validateEvaluationAnswers(criteria, data.answers);
      } catch (error) {
        throw new HttpsError("invalid-argument", error.message);
      }

      const matching = duplicatesSnapshot.docs;
      const submitted = matching.find((snapshot) => snapshot.data().status === "SUBMITTED");
      if (submitted) throw new HttpsError("already-exists", "Esta avaliação já foi enviada neste ciclo.");
      const drafts = matching.filter((snapshot) => snapshot.data().status === "DRAFT");
      if (drafts.length > 1) throw new HttpsError("failed-precondition", "Há mais de um rascunho para esta avaliação. Peça à administração para revisar os dados.");

      let evaluationRef = canonicalRef;
      let existing = null;
      if (existingEvaluationId) {
        const selected = matching.find((snapshot) => snapshot.id === existingEvaluationId);
        if (!selected || selected.data().status !== "DRAFT") throw new HttpsError("failed-precondition", "Este rascunho não está mais disponível.");
        if (drafts.length !== 1 || drafts[0].id !== existingEvaluationId) throw new HttpsError("failed-precondition", "O rascunho informado não corresponde à avaliação aberta.");
        evaluationRef = selected.ref;
        existing = selected.data();
      } else if (drafts.length === 1) {
        evaluationRef = drafts[0].ref;
        existing = drafts[0].data();
      }

      if (existing && (existing.evaluatorId !== uid || existing.evaluatedUserId !== evaluatedUserId || existing.cycleId !== cycleId || existing.type !== type)) {
        throw new HttpsError("permission-denied", "Este rascunho pertence a outra avaliação.");
      }
      if (!existing && canonicalRef.id !== evaluationId) throw new HttpsError("internal", "Não foi possível preparar a avaliação.");

      const answersRef = evaluationRef.collection("answers");
      const existingAnswers = existing ? await transaction.get(answersRef) : null;
      const activeIds = new Set(normalized.answers.map((answer) => answer.criterionId));
      const evaluationData = {
        cycleId,
        evaluatorId: uid,
        evaluatedUserId,
        type,
        status: "SUBMITTED",
        comment,
        averageScore: normalized.averageScore,
        submittedAt: FieldValue.serverTimestamp(),
        createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (existing) transaction.set(evaluationRef, evaluationData);
      else transaction.create(evaluationRef, evaluationData);
      for (const answer of normalized.answers) {
        transaction.set(answersRef.doc(answer.criterionId), answer);
      }
      existingAnswers?.docs.forEach((answer) => {
        if (!activeIds.has(answer.id)) transaction.delete(answer.ref);
      });
      return { evaluationId: evaluationRef.id, averageScore: normalized.averageScore };
    });
  } catch (error) {
    throw callableError(error, "Não foi possível enviar a avaliação.");
  }
});

exports.submitPromotionRequest = onCall({ region: REGION }, async (request) => {
  const uid = requireAuthenticatedUid(request);
  const data = request.data || {};
  const companyId = requireString(data.companyId, "Empresa");
  const employeeId = requireString(data.employeeId, "Colaborador");
  const targetPosition = requireString(data.targetPosition, "Cargo desejado", 100);
  if (targetPosition.length < 2) throw new HttpsError("invalid-argument", "Informe o cargo desejado (2 a 100 caracteres).");
  const justification = typeof data.justification === "string" ? data.justification.trim() : "";
  if (justification.length < 20 || justification.length > 1500) {
    throw new HttpsError("invalid-argument", "Explique em 20 a 1.500 caracteres por que a pessoa está apta à promoção.");
  }
  let promotionDetails;
  try {
    promotionDetails = calculatePromotionEvaluationResult(data.indicators, data.competencies);
  } catch (error) {
    throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Os dados da avaliação de promoção são inválidos.");
  }

  const db = getFirestore();
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
      if (!leaderSnapshot.exists || leader?.status !== "ACTIVE" || leader.role !== "LEADER") throw new HttpsError("permission-denied", "Somente a liderança pode enviar uma indicação.");
      if (!employeeSnapshot.exists || employee?.status !== "ACTIVE" || employee.role !== "EMPLOYEE") {
        throw new HttpsError("permission-denied", "Você não pode indicar este colaborador.");
      }
      const sharedTeamIds = getActiveSharedTeamIds(leader, employee);
      if (!sharedTeamIds.length) throw new HttpsError("failed-precondition", "O colaborador não está em uma equipe compartilhada ativa.");
      if (statusSnapshot.exists && statusSnapshot.data().status === "PENDING") {
        throw new HttpsError("already-exists", "Já existe uma indicação em análise para este colaborador.");
      }

      const sourceSnapshots = evaluationsSnapshot.docs;
      const answerSnapshots = await Promise.all(sourceSnapshots.map((snapshot) =>
        transaction.get(snapshot.ref.collection("answers"))));
      const evaluations = sourceSnapshots.flatMap((snapshot, index) => {
        const answers = answerSnapshots[index].docs.map((answer) => ({
          id: answer.id,
          criterionId: answer.get("criterionId"),
          score: answer.get("score"),
        }));
        if (!answers.length || answers.some((answer) => answer.criterionId !== answer.id
          || !Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5)) return [];
        const averageScore = Number((answers.reduce((sum, answer) => sum + answer.score, 0) / answers.length).toFixed(2));
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
        .filter((id) => typeof id === "string"))];
      const cycleSnapshots = await Promise.all(cycleIds.map((cycleId) =>
        transaction.get(companyRef.collection("cycles").doc(cycleId))));
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
        transaction.create(requestRef.collection("evaluationEvidence").doc(item.evaluationId), item);
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
      return {
        requestId: requestRef.id,
        averageScore: null,
        evaluationCount: 0,
      };
    });
  } catch (error) {
    throw callableError(error, "Não foi possível enviar a indicação de promoção.");
  }
});

exports.decidePromotionRequest = onCall({ region: REGION }, async (request) => {
  const uid = requireAuthenticatedUid(request);
  const data = request.data || {};
  const companyId = requireString(data.companyId, "Empresa");
  const requestId = requireString(data.requestId, "Indicação");
  const decision = data.decision;
  if (!["APPROVED", "REJECTED"].includes(decision)) throw new HttpsError("invalid-argument", "Decisão inválida.");
  const adminNote = typeof data.adminNote === "string" ? data.adminNote.trim() : "";
  if (adminNote.length > 1000) throw new HttpsError("invalid-argument", "A observação deve ter no máximo 1.000 caracteres.");

  const db = getFirestore();
  const companyRef = db.collection("companies").doc(companyId);
  const requestRef = companyRef.collection("promotionRequests").doc(requestId);

  try {
    await db.runTransaction(async (transaction) => {
      const adminRef = companyRef.collection("members").doc(uid);
      const adminSnapshot = await transaction.get(adminRef);
      if (!adminSnapshot.exists || !isActivePromotionAdmin(adminSnapshot.data())) {
        throw new HttpsError("permission-denied", "Somente a administração pode decidir uma indicação.");
      }
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new HttpsError("not-found", "A indicação não foi encontrada.");
      const promotion = requestSnapshot.data();
      const employeeId = promotion.employeeId;
      const statusRef = companyRef.collection("promotionStatuses").doc(employeeId);
      const employeeRef = companyRef.collection("members").doc(employeeId);
      const planRef = companyRef.collection("developmentPlans").doc(employeeId);
      const [statusSnapshot, employeeSnapshot, planSnapshot] = await Promise.all([
        transaction.get(statusRef),
        transaction.get(employeeRef),
        transaction.get(planRef),
      ]);
      if (promotion.status !== "PENDING" || !statusSnapshot.exists || statusSnapshot.data().status !== "PENDING" || statusSnapshot.data().requestId !== requestId) {
        throw new HttpsError("failed-precondition", "Esta indicação já foi analisada ou substituída.");
      }
      if (!employeeSnapshot.exists || employeeSnapshot.data().status !== "ACTIVE" || employeeSnapshot.data().role !== "EMPLOYEE") {
        throw new HttpsError("failed-precondition", "O colaborador não está ativo para receber a promoção.");
      }
      if (!planSnapshot.exists || planSnapshot.data().status !== "ACTIVE" || planSnapshot.data().leaderId !== promotion.leaderId || planSnapshot.data().targetPosition !== promotion.targetPosition) {
        throw new HttpsError("failed-precondition", "O PDI associado à indicação não está mais ativo.");
      }

      const rosterRefs = decision === "APPROVED"
        ? getMemberTeamIds(employeeSnapshot.data()).map((teamId) => companyRef.collection("teams").doc(teamId).collection("members").doc(employeeId))
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
    throw callableError(error, "Não foi possível registrar a decisão da indicação.");
  }
});

exports.submitSurveyResponse = onCall({ region: REGION }, async (request) => {
  const uid = requireAuthenticatedUid(request);
  const data = request.data || {};
  const companyId = requireString(data.companyId, "Empresa");
  const surveyId = requireString(data.surveyId, "Pesquisa");
  const db = getFirestore();
  const companyRef = db.collection("companies").doc(companyId);
  const surveyRef = companyRef.collection("surveys").doc(surveyId);
  const participantRef = surveyRef.collection("participants").doc(uid);
  const responseRef = surveyRef.collection("responses").doc();

  try {
    return await db.runTransaction(async (transaction) => {
      const memberRef = companyRef.collection("members").doc(uid);
      const [memberSnapshot, surveySnapshot, participantSnapshot] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(surveyRef),
        transaction.get(participantRef),
      ]);
      const member = memberSnapshot.data();
      const survey = surveySnapshot.data();
      if (!memberSnapshot.exists || member?.status !== "ACTIVE") throw new HttpsError("permission-denied", "Sua conta não está ativa nesta empresa.");
      if (!surveySnapshot.exists || !surveyIsAvailable(survey, member.role, Date.now())) {
        throw new HttpsError("failed-precondition", "Esta pesquisa não está disponível para sua conta neste momento.");
      }
      if (participantSnapshot.exists) throw new HttpsError("already-exists", "Você já respondeu a esta pesquisa.");
      let answers;
      try {
        answers = validateSurveyAnswers(survey.questions, data.answers);
      } catch (error) {
        throw new HttpsError("invalid-argument", error.message);
      }
      transaction.create(participantRef, { completedAt: FieldValue.serverTimestamp() });
      transaction.create(responseRef, { answers });
      return { responseId: responseRef.id };
    });
  } catch (error) {
    throw callableError(error, "Não foi possível enviar sua resposta.");
  }
});
