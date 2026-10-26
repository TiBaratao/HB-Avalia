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
