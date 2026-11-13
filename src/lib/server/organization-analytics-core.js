function monthKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  return value.slice(0, 7);
}

function classificationForScore(score) {
  const normalized = score * 20;
  if (normalized >= 90) return "Excelente";
  if (normalized >= 80) return "Bom";
  if (normalized >= 70) return "Regular";
  return "Insuficiente";
}

function createAverageGroup() {
  return { evaluations: 0, scoreTotal: 0 };
}

function addToGroup(groups, id, name, score) {
  const group = groups.get(id) ?? { id, name, ...createAverageGroup() };
  group.evaluations += 1;
  group.scoreTotal += score;
  groups.set(id, group);
}

function finalizeGroups(groups) {
  return [...groups.values()]
    .map(({ scoreTotal, ...group }) => ({
      ...group,
      averageScore: group.evaluations ? Number((scoreTotal / group.evaluations).toFixed(2)) : null,
    }))
    .sort((first, second) => (second.averageScore ?? 0) - (first.averageScore ?? 0));
}

export function buildStoreAnalytics({
  members, teams, departments, cycles, evaluations, plans, feedback, criteria = [], answers = [],
}) {
  const activeMembers = members.filter((member) => member.status === "ACTIVE"
    && ["ADMIN", "LEADER", "EMPLOYEE"].includes(member.role));
  const memberById = new Map(members.map((member) => [member.uid, member]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const submitted = evaluations.filter((evaluation) => evaluation.status === "SUBMITTED"
    && Number.isFinite(evaluation.averageScore)
    && evaluation.averageScore >= 1 && evaluation.averageScore <= 5);
  const drafts = evaluations.filter((evaluation) => evaluation.status === "DRAFT");
  const openCycles = cycles.filter((cycle) => cycle.status === "OPEN");
  const expectedEvaluationIds = new Set();
  for (const cycle of openCycles) {
    for (const team of teams.filter((item) => item.active)) {
      const teamMembers = activeMembers.filter((member) => member.teamIds.includes(team.id));
      const leaders = teamMembers.filter((member) => member.role === "LEADER");
      const employees = teamMembers.filter((member) => member.role === "EMPLOYEE");
      for (const leader of leaders) {
        for (const employee of employees) {
          expectedEvaluationIds.add(`${cycle.id}|${leader.uid}|${employee.uid}|EMPLOYEE`);
          expectedEvaluationIds.add(`${cycle.id}|${employee.uid}|${leader.uid}|LEADER`);
        }
      }
    }
  }
  const submittedExpectedIds = new Set(submitted.map((evaluation) =>
    `${evaluation.cycleId}|${evaluation.evaluatorId}|${evaluation.evaluatedUserId}|${evaluation.type}`,
  ).filter((id) => expectedEvaluationIds.has(id)));
  const pendingEvaluations = Math.max(0, expectedEvaluationIds.size - submittedExpectedIds.size);
  const scoreTotal = submitted.reduce((sum, evaluation) => sum + evaluation.averageScore, 0);
  const classificationCounts = {
    Excelente: 0,
    Bom: 0,
    Regular: 0,
    Insuficiente: 0,
  };
  const monthly = new Map();
  const departmentGroups = new Map();
  const teamGroups = new Map();
  const employeeEvaluations = new Map();
  const criteriaById = new Map(criteria
    .filter((criterion) => criterion.active && ["EMPLOYEE", "LEADER"].includes(criterion.evaluationType))
    .map((criterion) => [criterion.id, criterion]));
  const answersByEvaluation = new Map();
  for (const answer of answers) {
    if (!Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5
      || !criteriaById.has(answer.criterionId)) continue;
    answersByEvaluation.set(answer.evaluationId, [
      ...(answersByEvaluation.get(answer.evaluationId) ?? []),
      answer,
    ]);
  }
  const competencyRecords = [];

  const evaluationRecords = submitted.map((evaluation) => {
    const member = memberById.get(evaluation.evaluatedUserId);
    const teamIds = member?.teamIds ?? [];
    const departmentIds = [...new Set(teamIds
      .map((teamId) => teamById.get(teamId)?.departmentId)
      .filter((id) => typeof id === "string"))];
    classificationCounts[classificationForScore(evaluation.averageScore)] += 1;
    const key = monthKey(evaluation.submittedAt);
    if (key) {
      const group = monthly.get(key) ?? { month: key, evaluations: 0, scoreTotal: 0 };
      group.evaluations += 1;
      group.scoreTotal += evaluation.averageScore;
      monthly.set(key, group);
    }
    for (const teamId of new Set(teamIds)) {
      const team = teamById.get(teamId);
      if (team?.active) addToGroup(teamGroups, teamId, team.name, evaluation.averageScore);
    }
    for (const departmentId of departmentIds) {
      addToGroup(departmentGroups, departmentId, departmentById.get(departmentId)?.name ?? "Setor", evaluation.averageScore);
    }
    if (member) {
      const person = employeeEvaluations.get(member.uid) ?? {
        uid: member.uid,
        name: member.name,
        role: member.role,
        teamIds: [...teamIds],
        departmentIds,
        evaluations: 0,
        scoreTotal: 0,
      };
      person.evaluations += 1;
      person.scoreTotal += evaluation.averageScore;
      employeeEvaluations.set(member.uid, person);
    }
    const competencies = (answersByEvaluation.get(evaluation.id) ?? []).map((answer) => {
      const criterion = criteriaById.get(answer.criterionId);
      return {
        criterionId: answer.criterionId,
        criterionName: criterion.name,
        score: answer.score,
      };
    });
    for (const competency of competencies) {
      competencyRecords.push({
        ...competency,
        submittedAt: evaluation.submittedAt,
        teamIds: [...teamIds],
        departmentIds: [...departmentIds],
      });
    }
    return {
      id: evaluation.id,
      evaluatedUserId: evaluation.evaluatedUserId,
      evaluatedUserName: member?.name ?? "Pessoa não localizada",
      evaluatedUserRole: member?.role ?? null,
      cycleId: evaluation.cycleId,
      type: evaluation.type,
      score: evaluation.averageScore,
      submittedAt: evaluation.submittedAt,
      teamIds,
      departmentIds,
      competencies,
    };
  });

  const feedbackMonthly = new Map();
  const feedbackRatings = feedback.filter((item) => Number.isInteger(item.overallRating)
    && item.overallRating >= 1 && item.overallRating <= 5);
  for (const item of feedbackRatings) {
    const key = monthKey(item.submittedAt);
    if (!key) continue;
    const group = feedbackMonthly.get(key) ?? { month: key, responses: 0, ratingTotal: 0 };
    group.responses += 1;
    group.ratingTotal += item.overallRating;
    feedbackMonthly.set(key, group);
  }
  const feedbackRatingTotal = feedbackRatings.reduce((sum, item) => sum + item.overallRating, 0);
  const activePlans = plans.filter((plan) => plan.status === "ACTIVE");
  const pendingGoals = activePlans.reduce((total, plan) =>
    total + (Array.isArray(plan.goals) ? plan.goals.filter((goal) => goal && goal.completed !== true).length : 0), 0);
  const pdiRecords = activePlans.map((plan) => {
    const member = memberById.get(plan.employeeId);
    const pending = Array.isArray(plan.goals)
      ? plan.goals.filter((goal) => goal && goal.completed !== true).length
      : 0;
    return {
      employeeId: plan.employeeId,
      employeeName: member?.name ?? "Pessoa não localizada",
      teamIds: member?.teamIds ?? [],
      departmentIds: [...new Set((member?.teamIds ?? [])
        .map((teamId) => teamById.get(teamId)?.departmentId)
        .filter((id) => typeof id === "string"))],
      pendingGoals: pending,
      totalGoals: Array.isArray(plan.goals) ? plan.goals.length : 0,
      targetPosition: typeof plan.targetPosition === "string" ? plan.targetPosition : "",
    };
  });

  return {
    indicators: {
      activeMembers: activeMembers.length,
      employees: activeMembers.filter((member) => member.role === "EMPLOYEE").length,
      leaders: activeMembers.filter((member) => member.role === "LEADER").length,
      administrators: activeMembers.filter((member) => member.role === "ADMIN").length,
      openCycles: openCycles.length,
      evaluations: evaluations.length,
      evaluationsSubmitted: submitted.length,
      expectedEvaluations: expectedEvaluationIds.size,
      openCycleEvaluationsSubmitted: submittedExpectedIds.size,
      evaluationsPending: Math.max(pendingEvaluations, drafts.length),
      evaluationCompletionRate: expectedEvaluationIds.size
        ? Number(((expectedEvaluationIds.size - pendingEvaluations) / expectedEvaluationIds.size * 100).toFixed(1))
        : null,
      averagePerformance: submitted.length ? Number((scoreTotal / submitted.length).toFixed(2)) : null,
      classificationCounts,
      activeDevelopmentPlans: activePlans.length,
      pendingDevelopmentGoals: pendingGoals,
      developmentPlans: plans.length,
      customerFeedbackResponses: feedbackRatings.length,
      customerSatisfaction: feedbackRatings.length
        ? Number((feedbackRatingTotal / feedbackRatings.length).toFixed(2))
        : null,
    },
    evaluationTrend: [...monthly.values()].sort((first, second) => first.month.localeCompare(second.month))
      .map(({ scoreTotal: total, ...item }) => ({
        ...item,
        averageScore: Number((total / item.evaluations).toFixed(2)),
      })),
    feedbackTrend: [...feedbackMonthly.values()].sort((first, second) => first.month.localeCompare(second.month))
      .map(({ ratingTotal: total, ...item }) => ({
        ...item,
        averageRating: Number((total / item.responses).toFixed(2)),
      })),
    feedbackRecords: feedbackRatings.map((item) => ({
      overallRating: item.overallRating,
      submittedAt: item.submittedAt,
    })),
    departments: finalizeGroups(departmentGroups),
    teams: finalizeGroups(teamGroups),
    people: [...employeeEvaluations.values()]
      .map(({ scoreTotal: total, ...person }) => ({
        ...person,
        averageScore: Number((total / person.evaluations).toFixed(2)),
      }))
      .sort((first, second) => first.name.localeCompare(second.name, "pt-BR")),
    pdiRecords,
    evaluationRecords,
    competencyRecords,
  };
}
