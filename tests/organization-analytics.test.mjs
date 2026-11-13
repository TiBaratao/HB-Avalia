import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStoreAnalytics } from "../src/lib/server/organization-analytics-core.js";

test("organization analytics calculates roles, pending evaluations, scores, PDIs and feedback per tenant", () => {
  const analytics = buildStoreAnalytics({
    members: [
      { uid: "admin", name: "Admin", role: "ADMIN", status: "ACTIVE", teamIds: [] },
      { uid: "leader", name: "Líder", role: "LEADER", status: "ACTIVE", teamIds: ["team"] },
      { uid: "employee", name: "Pessoa", role: "EMPLOYEE", status: "ACTIVE", teamIds: ["team"] },
      { uid: "inactive", name: "Inativa", role: "EMPLOYEE", status: "INACTIVE", teamIds: ["team"] },
    ],
    teams: [{ id: "team", name: "Operação", departmentId: "department", active: true }],
    departments: [{ id: "department", name: "Loja", active: true }],
    cycles: [{ id: "open", status: "OPEN" }, { id: "closed", status: "CLOSED" }],
    evaluations: [
      {
        id: "submitted", cycleId: "open", evaluatorId: "leader", evaluatedUserId: "employee",
        type: "EMPLOYEE", status: "SUBMITTED", averageScore: 4.5, submittedAt: "2026-10-12T12:00:00.000Z",
      },
      {
        id: "draft", cycleId: "open", evaluatorId: "employee", evaluatedUserId: "leader",
        type: "LEADER", status: "DRAFT", averageScore: null, submittedAt: null,
      },
      {
        id: "old", cycleId: "closed", evaluatorId: "employee", evaluatedUserId: "leader",
        type: "LEADER", status: "SUBMITTED", averageScore: 3.5, submittedAt: "2026-09-10T12:00:00.000Z",
      },
    ],
    criteria: [
      { id: "quality", name: "Qualidade", evaluationType: "EMPLOYEE", active: true },
      { id: "leadership", name: "Liderança", evaluationType: "LEADER", active: true },
      { id: "inactive", name: "Critério inativo", evaluationType: "EMPLOYEE", active: false },
    ],
    answers: [
      { evaluationId: "submitted", criterionId: "quality", score: 5 },
      { evaluationId: "submitted", criterionId: "inactive", score: 4 },
      { evaluationId: "old", criterionId: "leadership", score: 3 },
      { evaluationId: "draft", criterionId: "quality", score: 1 },
    ],
    plans: [
      { employeeId: "employee", status: "ACTIVE", goals: [{ completed: true }, { completed: false }] },
      { employeeId: "leader", status: "PROMOTED", goals: [{ completed: false }] },
    ],
    feedback: [
      { overallRating: 5, submittedAt: "2026-10-15T12:00:00.000Z" },
      { overallRating: 2, submittedAt: "2026-09-15T12:00:00.000Z" },
      { overallRating: 7, submittedAt: "2026-10-15T12:00:00.000Z" },
    ],
  });

  assert.equal(analytics.indicators.activeMembers, 3);
  assert.equal(analytics.indicators.employees, 1);
  assert.equal(analytics.indicators.leaders, 1);
  assert.equal(analytics.indicators.administrators, 1);
  assert.equal(analytics.indicators.evaluationsSubmitted, 2);
  assert.equal(analytics.indicators.evaluationsPending, 1);
  assert.equal(analytics.indicators.evaluationCompletionRate, 50);
  assert.equal(analytics.indicators.averagePerformance, 4);
  assert.deepEqual(analytics.indicators.classificationCounts, {
    Excelente: 1,
    Bom: 0,
    Regular: 1,
    Insuficiente: 0,
  });
  assert.equal(analytics.indicators.activeDevelopmentPlans, 1);
  assert.equal(analytics.indicators.pendingDevelopmentGoals, 1);
  assert.equal(analytics.indicators.customerFeedbackResponses, 2);
  assert.equal(analytics.indicators.customerSatisfaction, 3.5);
  assert.equal(analytics.departments[0].name, "Loja");
  assert.equal(analytics.departments[0].averageScore, 4);
  assert.equal(analytics.teams[0].averageScore, 4);
  assert.equal(analytics.evaluationTrend.length, 2);
  assert.equal(analytics.feedbackRecords.length, 2);
  assert.equal(analytics.pdiRecords.length, 1);
  assert.deepEqual(analytics.competencyRecords.map(({ criterionName, score }) => ({ criterionName, score })), [
    { criterionName: "Qualidade", score: 5 },
    { criterionName: "Liderança", score: 3 },
  ]);
  assert.equal(analytics.evaluationRecords.find((record) => record.id === "submitted").competencies[0].criterionId, "quality");
});
