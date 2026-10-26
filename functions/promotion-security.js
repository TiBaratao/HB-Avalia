function teamIdsOf(member) {
  return Array.isArray(member?.teamIds)
    ? member.teamIds.filter((teamId) => typeof teamId === "string")
    : [];
}

function getMemberTeamIds(member) {
  return [...new Set(teamIdsOf(member))];
}

function getActiveSharedTeamIds(leader, employee) {
  if (leader?.status !== "ACTIVE" || leader.role !== "LEADER"
    || employee?.status !== "ACTIVE" || employee.role !== "EMPLOYEE") {
    return [];
  }
  const employeeTeamIds = new Set(teamIdsOf(employee));
  return [...new Set(teamIdsOf(leader).filter((teamId) => employeeTeamIds.has(teamId)))];
}

function isActivePromotionAdmin(member) {
  return member?.status === "ACTIVE" && member.role === "ADMIN";
}

function createPromotionEvaluationPrivacyFields() {
  return {
    averageScore: null,
    evaluations: [],
    evaluationEvidenceVersion: 2,
  };
}

function createPromotionEvaluationEvidence(evaluation, cycle) {
  return {
    evaluationId: evaluation.id,
    cycleName: typeof cycle?.name === "string" ? cycle.name : "Ciclo sem nome",
    score: evaluation.averageScore,
    comment: typeof evaluation.comment === "string" ? evaluation.comment : "",
    submittedAt: evaluation.submittedAt,
  };
}

module.exports = {
  getMemberTeamIds,
  getActiveSharedTeamIds,
  isActivePromotionAdmin,
  createPromotionEvaluationPrivacyFields,
  createPromotionEvaluationEvidence,
};
