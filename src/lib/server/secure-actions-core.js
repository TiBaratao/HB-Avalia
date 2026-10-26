/* eslint-disable @typescript-eslint/no-require-imports */
const { FieldValue } = require("firebase-admin/firestore");
const {
  validateEvaluationAnswers,
  validateSurveyAnswers,
} = require("../../../functions/domain");

class SecureActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SecureActionError";
    this.code = code;
  }
}

function requireString(value, label, maxLength = 150) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("/")) {
    throw new SecureActionError("invalid-argument", `${label} inválido.`);
  }
  return value.trim();
}

function sharesTeam(first, second) {
  const otherIds = new Set(Array.isArray(second?.teamIds) ? second.teamIds.filter((id) => typeof id === "string") : []);
  const firstIds = Array.isArray(first?.teamIds) ? first.teamIds.filter((id) => typeof id === "string") : [];
  return firstIds.some((teamId) => otherIds.has(teamId));
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

async function submitEvaluation(db, uid, data) {
  const companyId = requireString(data.companyId, "Empresa");
  const cycleId = requireString(data.cycleId, "Ciclo");
  const evaluatedUserId = requireString(data.evaluatedUserId, "Colaborador");
  const type = data.type;
  if (!["EMPLOYEE", "LEADER"].includes(type)) throw new SecureActionError("invalid-argument", "Tipo de avaliação inválido.");
  const comment = typeof data.comment === "string" ? data.comment.trim() : "";
  if (comment.length > 2000) throw new SecureActionError("invalid-argument", "O comentário pode ter até 2.000 caracteres.");
  const existingEvaluationId = data.existingEvaluationId == null
    ? null
    : requireString(data.existingEvaluationId, "Rascunho");

  const companyRef = db.collection("companies").doc(companyId);
  const evaluationsRef = companyRef.collection("evaluations");
  const evaluationId = evaluationDocumentId(companyId, cycleId, uid, evaluatedUserId, type);
  const canonicalRef = evaluationsRef.doc(evaluationId);

  return db.runTransaction(async (transaction) => {
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
    if (!evaluatorSnapshot.exists || evaluator?.status !== "ACTIVE") throw new SecureActionError("permission-denied", "Sua conta não está ativa nesta empresa.");
    if (!targetSnapshot.exists || target?.status !== "ACTIVE") throw new SecureActionError("failed-precondition", "A pessoa avaliada não está ativa.");
    const permitted = type === "EMPLOYEE"
      ? evaluator.role === "LEADER" && target.role === "EMPLOYEE"
      : evaluator.role === "EMPLOYEE" && target.role === "LEADER";
    if (!permitted || !sharesTeam(evaluator, target)) throw new SecureActionError("permission-denied", "Você não pode avaliar esta pessoa.");
    if (!cycleSnapshot.exists || !cycleIsAvailable(cycleSnapshot.data(), Date.now())) {
      throw new SecureActionError("failed-precondition", "O ciclo de avaliação não está aberto neste momento.");
    }

    const criteria = criteriaSnapshot.docs
      .filter((criterion) => criterion.data().active === true)
      .map((criterion) => ({ id: criterion.id, ...criterion.data() }));
    let normalized;
    try {
      normalized = validateEvaluationAnswers(criteria, data.answers);
    } catch (error) {
      throw new SecureActionError("invalid-argument", error.message);
    }

    const matching = duplicatesSnapshot.docs;
    const submitted = matching.find((snapshot) => snapshot.data().status === "SUBMITTED");
    if (submitted) throw new SecureActionError("already-exists", "Esta avaliação já foi enviada neste ciclo.");
    const drafts = matching.filter((snapshot) => snapshot.data().status === "DRAFT");
    if (drafts.length > 1) throw new SecureActionError("failed-precondition", "Há mais de um rascunho para esta avaliação. Peça à administração para revisar os dados.");

    let evaluationRef = canonicalRef;
    let existing = null;
    if (existingEvaluationId) {
      const selected = matching.find((snapshot) => snapshot.id === existingEvaluationId);
      if (!selected || selected.data().status !== "DRAFT") throw new SecureActionError("failed-precondition", "Este rascunho não está mais disponível.");
      if (drafts.length !== 1 || drafts[0].id !== existingEvaluationId) throw new SecureActionError("failed-precondition", "O rascunho informado não corresponde à avaliação aberta.");
      evaluationRef = selected.ref;
      existing = selected.data();
    } else if (drafts.length === 1) {
      evaluationRef = drafts[0].ref;
      existing = drafts[0].data();
    }

    if (existing && (existing.evaluatorId !== uid || existing.evaluatedUserId !== evaluatedUserId || existing.cycleId !== cycleId || existing.type !== type)) {
      throw new SecureActionError("permission-denied", "Este rascunho pertence a outra avaliação.");
    }
    if (!existing && canonicalRef.id !== evaluationId) throw new SecureActionError("internal", "Não foi possível preparar a avaliação.");

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
}

async function submitSurveyResponse(db, uid, data) {
  const companyId = requireString(data.companyId, "Empresa");
  const surveyId = requireString(data.surveyId, "Pesquisa");
  const companyRef = db.collection("companies").doc(companyId);
  const surveyRef = companyRef.collection("surveys").doc(surveyId);
  const participantRef = surveyRef.collection("participants").doc(uid);
  const responseRef = surveyRef.collection("responses").doc();

  return db.runTransaction(async (transaction) => {
    const memberRef = companyRef.collection("members").doc(uid);
    const [memberSnapshot, surveySnapshot, participantSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(surveyRef),
      transaction.get(participantRef),
    ]);
    const member = memberSnapshot.data();
    const survey = surveySnapshot.data();
    if (!memberSnapshot.exists || member?.status !== "ACTIVE") throw new SecureActionError("permission-denied", "Sua conta não está ativa nesta empresa.");
    if (!surveySnapshot.exists || !surveyIsAvailable(survey, member.role, Date.now())) {
      throw new SecureActionError("failed-precondition", "Esta pesquisa não está disponível para sua conta neste momento.");
    }
    if (participantSnapshot.exists) throw new SecureActionError("already-exists", "Você já respondeu a esta pesquisa.");
    let answers;
    try {
      answers = validateSurveyAnswers(survey.questions, data.answers);
    } catch (error) {
      throw new SecureActionError("invalid-argument", error.message);
    }
    transaction.create(participantRef, { completedAt: FieldValue.serverTimestamp() });
    transaction.create(responseRef, { answers });
    return { responseId: responseRef.id };
  });
}

module.exports = {
  SecureActionError,
  submitEvaluation,
  submitSurveyResponse,
};
