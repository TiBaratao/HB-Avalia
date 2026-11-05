const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { after, before, test } = require("node:test");
const rootRequire = createRequire(require.resolve("../../package.json"));
const { deleteApp, initializeApp } = rootRequire("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore } = rootRequire("firebase-admin/firestore");
const {
  SecureActionError,
  submitEvaluation,
  submitSurveyResponse,
} = require("../../src/lib/server/secure-actions-core");
const {
  CustomerFeedbackError,
  getPublicCustomerFeedbackForm,
  manageCustomerFeedback,
  submitCustomerFeedback,
} = require("../../src/lib/server/customer-feedback-core");
const { publishScheduledChecklists } = require("../scheduled-checklists-core");

const projectId = process.env.GCLOUD_PROJECT || "demo-hb-avalia";
const app = initializeApp({ projectId }, `server-actions-test-${process.pid}`);
const db = getFirestore(app);

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is required; refusing to run against production.");
});

after(async () => {
  await deleteApp(app);
});

async function createCompany({ leaderTeamIds = ["team-1"], employeeTeamIds = ["team-1"] } = {}) {
  const companyId = `test-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  await Promise.all([
    company.set({ ownerUid: "leader" }),
    company.collection("members").doc("leader").set({
      role: "LEADER",
      status: "ACTIVE",
      teamIds: leaderTeamIds,
    }),
    company.collection("members").doc("employee").set({
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: employeeTeamIds,
    }),
    company.collection("members").doc("inactive-leader").set({
      role: "LEADER",
      status: "DISABLED",
      teamIds: ["team-1"],
    }),
    company.collection("cycles").doc("cycle").set({
      status: "OPEN",
      startsAtAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
      endsAtAt: Timestamp.fromDate(new Date(Date.now() + 60_000)),
    }),
    company.collection("criteria").doc("quality").set({
      evaluationType: "EMPLOYEE",
      active: true,
    }),
    company.collection("surveys").doc("survey").set({
      active: true,
      audience: ["LEADER"],
      startsAtAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
      endsAtAt: Timestamp.fromDate(new Date(Date.now() + 60_000)),
      questions: [{ id: "comment", type: "TEXT" }],
    }),
  ]);
  return { companyId, company };
}

test("server accepts a valid evaluation and stores normalized answers", async () => {
  const { companyId, company } = await createCompany();
  const result = await submitEvaluation(db, "leader", {
    companyId,
    cycleId: "cycle",
    evaluatedUserId: "employee",
    type: "EMPLOYEE",
    comment: "Bom trabalho.",
    answers: [{ criterionId: "quality", score: 4 }],
  });

  assert.equal(result.averageScore, 4);
  const saved = await company.collection("evaluations").doc(result.evaluationId).get();
  assert.equal(saved.get("evaluatorId"), "leader");
  assert.equal(saved.get("status"), "SUBMITTED");
  const answer = await saved.ref.collection("answers").doc("quality").get();
  assert.equal(answer.get("score"), 4);
});

test("server rejects evaluations across teams and from inactive members", async () => {
  const { companyId } = await createCompany({ employeeTeamIds: ["team-2"] });
  const input = {
    companyId,
    cycleId: "cycle",
    evaluatedUserId: "employee",
    type: "EMPLOYEE",
    answers: [{ criterionId: "quality", score: 4 }],
  };
  await assert.rejects(submitEvaluation(db, "leader", input), (error) =>
    error instanceof SecureActionError && error.code === "permission-denied");

  await assert.rejects(submitEvaluation(db, "inactive-leader", input), (error) =>
    error instanceof SecureActionError && error.code === "permission-denied");
});

test("server rejects duplicate submissions and invalid answers", async () => {
  const { companyId } = await createCompany();
  const input = {
    companyId,
    cycleId: "cycle",
    evaluatedUserId: "employee",
    type: "EMPLOYEE",
    answers: [{ criterionId: "quality", score: 4 }],
  };
  await submitEvaluation(db, "leader", input);
  await assert.rejects(submitEvaluation(db, "leader", input), (error) =>
    error instanceof SecureActionError && error.code === "already-exists");

  const another = await createCompany();
  await assert.rejects(submitEvaluation(db, "leader", {
    ...input,
    companyId: another.companyId,
    answers: [{ criterionId: "quality", score: 6 }],
  }), (error) => error instanceof SecureActionError && error.code === "invalid-argument");
});

test("survey responses require active membership, matching audience, and a single response", async () => {
  const { companyId, company } = await createCompany();
  const input = {
    companyId,
    surveyId: "survey",
    answers: [{ questionId: "comment", value: "Minha resposta" }],
  };
  const first = await submitSurveyResponse(db, "leader", input);
  assert.ok(first.responseId);
  assert.equal((await company.collection("surveys").doc("survey").collection("responses").doc(first.responseId).get()).exists, true);
  await assert.rejects(submitSurveyResponse(db, "leader", input), (error) =>
    error instanceof SecureActionError && error.code === "already-exists");
  await assert.rejects(submitSurveyResponse(db, "employee", input), (error) =>
    error instanceof SecureActionError && error.code === "failed-precondition");
  await assert.rejects(submitSurveyResponse(db, "inactive-leader", input), (error) =>
    error instanceof SecureActionError && error.code === "permission-denied");
});

test("customer QR feedback is isolated from internal evaluations and requires active cashier selection", async () => {
  const companyId = `feedback-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  const otherCompanyId = `feedback-other-${randomUUID()}`;
  const otherCompany = db.collection("companies").doc(otherCompanyId);
  await Promise.all([
    company.set({ name: "Mercado de teste" }),
    company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" }),
    company.collection("members").doc("employee").set({ role: "EMPLOYEE", status: "ACTIVE" }),
    otherCompany.set({ name: "Outro mercado" }),
    otherCompany.collection("members").doc("other-admin").set({ role: "ADMIN", status: "ACTIVE" }),
  ]);

  const cashier = await manageCustomerFeedback(db, "admin", {
    companyId,
    action: "createCashier",
    name: "Caixa 01",
  });
  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const general = dashboard.locations.find((location) => location.kind === "GENERAL");
  assert.ok(general?.publicToken);
  assert.equal(dashboard.summary.averageRating, null);
  assert.deepEqual(dashboard.recentResponses, []);
  assert.equal(dashboard.locations.find((location) => location.id === cashier.locationId).cashierAverage, null);

  const generalForm = await getPublicCustomerFeedbackForm(db, general.publicToken);
  assert.equal(generalForm.companyName, "Mercado de teste");
  assert.deepEqual(generalForm.cashiers, [{ id: cashier.locationId, name: "Caixa 01" }]);
  const cashierForm = await getPublicCustomerFeedbackForm(db, cashier.token);
  assert.equal(cashierForm.location.kind, "CASHIER");
  assert.equal(cashierForm.location.name, "Caixa 01");
  const otherCashier = await manageCustomerFeedback(db, "other-admin", {
    companyId: otherCompanyId,
    action: "createCashier",
    name: "Caixa 01",
  });

  await submitCustomerFeedback(db, {
    token: general.publicToken,
    overallRating: 5,
    cashierId: cashier.locationId,
    cashierRating: 4,
    comment: "Atendimento muito bom.",
  }, "test-client");
  for (let index = 0; index < 4; index += 1) {
    await submitCustomerFeedback(db, {
      token: general.publicToken,
      overallRating: 4,
      cashierId: cashier.locationId,
      cashierRating: 4,
    }, `test-client-${index}`);
  }
  await assert.rejects(submitCustomerFeedback(db, {
    token: general.publicToken,
    overallRating: 4,
    cashierId: otherCashier.locationId,
    cashierRating: 2,
  }, "cross-company-client"), (error) => error instanceof CustomerFeedbackError && error.code === "failed-precondition");
  await assert.rejects(submitCustomerFeedback(db, {
    token: cashier.token,
    overallRating: 5,
    cashierId: "another-cashier",
    cashierRating: 1,
  }, "another-client"), (error) => error instanceof CustomerFeedbackError && error.code === "invalid-argument");

  assert.equal((await company.collection("customerFeedbackResponses").get()).size, 5);
  assert.equal((await company.collection("evaluations").get()).size, 0);
  const cashierSnapshot = await company.collection("customerFeedbackLocations").doc(cashier.locationId).get();
  assert.equal(cashierSnapshot.get("cashierRatingCount"), 5);
  assert.equal(cashierSnapshot.get("cashierRatingTotal"), 20);
  const adminDashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(adminDashboard.summary.responseCount, 5);
  assert.equal(adminDashboard.summary.averageRating, 4.2);
  assert.ok(adminDashboard.recentResponses.some((response) => response.comment === "Atendimento muito bom."));

  const secondCashier = await manageCustomerFeedback(db, "admin", {
    companyId,
    action: "createCashier",
    name: "Caixa 02",
  });
  await submitCustomerFeedback(db, {
    token: general.publicToken,
    overallRating: 1,
    cashierId: secondCashier.locationId,
    cashierRating: 1,
    comment: "Comentário de um grupo pequeno.",
  }, "small-cashier-cohort");
  const dashboardWithSmallCashierCohort = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(dashboardWithSmallCashierCohort.summary.responseCount, 6);
  assert.equal(dashboardWithSmallCashierCohort.locations.find((location) => location.id === secondCashier.locationId).cashierAverage, null);
  assert.equal(dashboardWithSmallCashierCohort.recentResponses.some((response) => response.comment === "Comentário de um grupo pequeno."), false);

  await assert.rejects(manageCustomerFeedback(db, "employee", { companyId, action: "list" }),
    (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  await assert.rejects(manageCustomerFeedback(db, "other-admin", { companyId, action: "list" }),
    (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  await manageCustomerFeedback(db, "admin", { companyId, action: "setCashierActive", locationId: cashier.locationId, active: false });
  await assert.rejects(getPublicCustomerFeedbackForm(db, cashier.token),
    (error) => error instanceof CustomerFeedbackError && error.code === "not-found");
});

test("customer feedback applies an atomic per-client submission limit", async () => {
  const companyId = `feedback-limit-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  await company.set({ name: "Mercado com limite" });
  await company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" });
  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const general = dashboard.locations.find((location) => location.kind === "GENERAL");
  assert.ok(general?.publicToken);

  const attempts = await Promise.allSettled(Array.from({ length: 11 }, () =>
    submitCustomerFeedback(db, { token: general.publicToken, overallRating: 5 }, "limited-client")));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 10);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected"
    && attempt.reason instanceof CustomerFeedbackError
    && attempt.reason.code === "resource-exhausted").length, 1);
  assert.equal((await company.collection("customerFeedbackResponses").get()).size, 10);
});

test("scheduled checklist publication creates eligible assignments once", async () => {
  const { company } = await createCompany();
  await company.collection("checklistTemplates").doc("daily").set({
    active: true,
    scheduleEnabled: true,
    frequency: "DAILY",
    responsible: "EMPLOYEE",
    teamIds: ["team-1"],
    createdById: "leader",
    name: "Checklist diário",
    departmentId: "operations",
    items: [{ id: "task-1", label: "Tarefa" }],
  });

  await publishScheduledChecklists(db, { fieldValue: FieldValue, logger: { info() {}, error() {} } });
  await publishScheduledChecklists(db, { fieldValue: FieldValue, logger: { info() {}, error() {} } });

  const assignments = await company.collection("checklistAssignments").get();
  assert.equal(assignments.size, 1);
  assert.equal(assignments.docs[0].get("assignedToId"), "employee");
  assert.equal(assignments.docs[0].get("frequency"), "DAILY");
  assert.equal((await assignments.docs[0].ref.collection("results").get()).size, 1);
});
