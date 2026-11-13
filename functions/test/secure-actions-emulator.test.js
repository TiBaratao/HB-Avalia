const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
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
  rateLimitSlotId,
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
    db.collection("userProfiles").doc("leader").set({ companyId }),
    db.collection("userProfiles").doc("employee").set({ companyId }),
    db.collection("userProfiles").doc("inactive-leader").set({ companyId }),
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

test("server actions reject an otherwise active membership outside the account company", async () => {
  const accountCompany = await createCompany();
  const otherCompany = await createCompany();
  await db.collection("userProfiles").doc("leader").set({ companyId: accountCompany.companyId });

  const evaluationInput = {
    companyId: otherCompany.companyId,
    cycleId: "cycle",
    evaluatedUserId: "employee",
    type: "EMPLOYEE",
    answers: [{ criterionId: "quality", score: 4 }],
  };
  await assert.rejects(submitEvaluation(db, "leader", evaluationInput), (error) =>
    error instanceof SecureActionError && error.code === "permission-denied");
  await assert.rejects(submitSurveyResponse(db, "leader", {
    companyId: otherCompany.companyId,
    surveyId: "survey",
    answers: [{ questionId: "comment", value: "Sem acesso." }],
  }), (error) => error instanceof SecureActionError && error.code === "permission-denied");
  assert.equal((await otherCompany.company.collection("evaluations").get()).size, 0);
  assert.equal((await otherCompany.company.collection("surveys").doc("survey").collection("responses").get()).size, 0);
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
  const legacyToken = "legacy-feedback-token";
  const legacyCashierToken = "legacy-cashier-feedback-token";
  await Promise.all([
    company.set({ name: "Mercado de teste" }),
    db.collection("userProfiles").doc("admin").set({ companyId }),
    db.collection("userProfiles").doc("employee").set({ companyId }),
    company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" }),
    company.collection("members").doc("employee").set({ role: "EMPLOYEE", status: "ACTIVE" }),
    company.collection("customerFeedbackLocations").doc("legacy-general").set({
      kind: "GENERAL",
      name: "Supermercado",
      active: true,
      publicToken: legacyToken,
    }),
    db.collection("customerFeedbackQrTokens").doc(legacyToken).set({
      companyId,
      locationId: "legacy-general",
      active: true,
    }),
    company.collection("customerFeedbackLocations").doc("legacy-cashier").set({
      kind: "CASHIER",
      name: "Caixa anterior",
      active: true,
      publicToken: legacyCashierToken,
    }),
    db.collection("customerFeedbackQrTokens").doc(legacyCashierToken).set({
      companyId,
      locationId: "legacy-cashier",
      active: true,
    }),
    company.collection("customerFeedbackResponses").doc("legacy-response").set({
      sourceLocationId: "legacy-general",
      sourceLocationName: "Supermercado",
      overallRating: 5,
      cashierRating: null,
      comment: "Avaliação histórica sem mercado.",
      submittedAt: new Date(),
    }),
    otherCompany.set({ name: "Outro mercado" }),
    db.collection("userProfiles").doc("other-admin").set({ companyId: otherCompanyId }),
    otherCompany.collection("members").doc("other-admin").set({ role: "ADMIN", status: "ACTIVE" }),
    otherCompany.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" }),
  ]);

  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  await assert.rejects(manageCustomerFeedback(db, "admin", {
    companyId: otherCompanyId,
    action: "list",
  }), (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  const matriz = dashboard.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz");
  const summit = dashboard.locations.find((location) => location.kind === "MARKET" && location.marketId === "summit");
  assert.deepEqual(dashboard.locations.filter((location) => location.kind === "MARKET").map((location) => location.name).sort(), ["Loja 2", "Matriz", "Summit"]);
  assert.equal(dashboard.locations.some((location) => location.kind === "GENERAL"), false);
  assert.equal(dashboard.locations.some((location) => location.marketId === null), false);
  assert.equal(dashboard.recentResponses.some((response) => response.marketId === null), false);
  assert.ok(matriz?.publicToken);
  assert.ok(summit?.publicToken);
  assert.equal(dashboard.summary.averageRating, null);
  assert.deepEqual(dashboard.recentResponses, []);
  const cashier = await manageCustomerFeedback(db, "admin", {
    companyId,
    action: "createCashier",
    marketId: "matriz",
    name: "Caixa 01",
  });
  const dashboardWithCashier = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const matrizWithCashier = dashboardWithCashier.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz");
  assert.ok(matrizWithCashier?.publicToken);
  assert.equal(dashboardWithCashier.locations.find((location) => location.id === cashier.locationId).marketId, "matriz");
  assert.equal(dashboardWithCashier.locations.find((location) => location.id === cashier.locationId).cashierAverage, null);

  await assert.rejects(getPublicCustomerFeedbackForm(db, legacyToken), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");
  await assert.rejects(submitCustomerFeedback(db, { token: legacyToken, overallRating: 5 }, "legacy-client"), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");
  await assert.rejects(getPublicCustomerFeedbackForm(db, legacyCashierToken), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");
  await assert.rejects(submitCustomerFeedback(db, { token: legacyCashierToken, overallRating: 5 }, "legacy-cashier-client"), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");
  assert.equal((await company.collection("customerFeedbackResponses").doc("legacy-response").get()).exists, true);
  const marketForm = await getPublicCustomerFeedbackForm(db, matriz.publicToken);
  assert.equal(marketForm.location.name, "Matriz");
  assert.equal(marketForm.location.marketName, "Matriz");
  assert.deepEqual(marketForm.cashiers, [{ id: cashier.locationId, name: "Caixa 01" }]);
  const cashierForm = await getPublicCustomerFeedbackForm(db, cashier.token);
  assert.equal(cashierForm.location.kind, "CASHIER");
  assert.equal(cashierForm.location.name, "Caixa 01");
  assert.equal(cashierForm.location.marketName, "Matriz");
  await manageCustomerFeedback(db, "other-admin", { companyId: otherCompanyId, action: "list" });
  const otherCashier = await manageCustomerFeedback(db, "other-admin", {
    companyId: otherCompanyId,
    action: "createCashier",
    marketId: "matriz",
    name: "Caixa 01",
  });

  await submitCustomerFeedback(db, {
    token: matriz.publicToken,
    overallRating: 5,
    cashierId: cashier.locationId,
    cashierRating: 4,
    comment: "Atendimento muito bom.",
  }, "test-client");
  const dashboardBeforeThreshold = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(dashboardBeforeThreshold.summary.responseCount, 1);
  assert.equal(dashboardBeforeThreshold.summary.averageRating, null);
  assert.ok(dashboardBeforeThreshold.recentResponses.some((response) => response.comment === "Atendimento muito bom."));
  assert.equal(dashboardBeforeThreshold.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz").responseCount, 1);
  assert.equal(dashboardBeforeThreshold.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz").averageRating, null);
  assert.equal(dashboardBeforeThreshold.locations.find((location) => location.kind === "MARKET" && location.marketId === "summit").responseCount, 0);
  for (let index = 0; index < 4; index += 1) {
    await submitCustomerFeedback(db, {
      token: matriz.publicToken,
      overallRating: 4,
      cashierId: cashier.locationId,
      cashierRating: 4,
    }, `test-client-${index}`);
  }
  await assert.rejects(submitCustomerFeedback(db, {
    token: matriz.publicToken,
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

  assert.equal((await company.collection("customerFeedbackResponses").get()).size, 6);
  assert.equal((await company.collection("evaluations").get()).size, 0);
  const cashierSnapshot = await company.collection("customerFeedbackLocations").doc(cashier.locationId).get();
  assert.equal(cashierSnapshot.get("cashierRatingCount"), 5);
  assert.equal(cashierSnapshot.get("cashierRatingTotal"), 20);
  const adminDashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(adminDashboard.summary.responseCount, 5);
  assert.equal(adminDashboard.summary.averageRating, 4.2);
  assert.equal(adminDashboard.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz").averageRating, 4.2);
  assert.ok(adminDashboard.recentResponses.some((response) => response.comment === "Atendimento muito bom."));

  const summitResponse = await submitCustomerFeedback(db, {
    token: summit.publicToken,
    overallRating: 2,
    comment: "Avaliação exclusiva da Summit.",
  }, "summit-client");
  assert.equal(summitResponse.accepted, true);
  const dashboardAfterSummitResponse = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(dashboardAfterSummitResponse.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz").responseCount, 5);
  assert.equal(dashboardAfterSummitResponse.locations.find((location) => location.kind === "MARKET" && location.marketId === "summit").responseCount, 1);
  assert.equal(dashboardAfterSummitResponse.locations.find((location) => location.kind === "MARKET" && location.marketId === "summit").averageRating, null);
  assert.ok(dashboardAfterSummitResponse.recentResponses.some((response) =>
    response.marketId === "summit" && response.comment === "Avaliação exclusiva da Summit."));

  const secondCashier = await manageCustomerFeedback(db, "admin", {
    companyId,
    action: "createCashier",
    marketId: "matriz",
    name: "Caixa 02",
  });
  await submitCustomerFeedback(db, {
    token: matriz.publicToken,
    overallRating: 1,
    cashierId: secondCashier.locationId,
    cashierRating: 1,
    comment: "Comentário de um grupo pequeno.",
  }, "small-cashier-cohort");
  const dashboardWithSmallCashierCohort = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  assert.equal(dashboardWithSmallCashierCohort.summary.responseCount, 7);
  assert.equal(dashboardWithSmallCashierCohort.locations.find((location) => location.id === secondCashier.locationId).cashierAverage, null);
  assert.ok(dashboardWithSmallCashierCohort.recentResponses.some((response) => response.comment === "Comentário de um grupo pequeno."));

  await assert.rejects(manageCustomerFeedback(db, "employee", { companyId, action: "list" }),
    (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  await assert.rejects(manageCustomerFeedback(db, "other-admin", { companyId, action: "list" }),
    (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  await manageCustomerFeedback(db, "admin", { companyId, action: "setCashierActive", locationId: cashier.locationId, active: false });
  await assert.rejects(getPublicCustomerFeedbackForm(db, cashier.token),
    (error) => error instanceof CustomerFeedbackError && error.code === "not-found");
});

test("registered store feedback exposes and accepts only its own market", async () => {
  const organizationId = `feedback-org-${randomUUID()}`;
  const matrizCompanyId = `feedback-matriz-${randomUUID()}`;
  const summitCompanyId = `feedback-summit-${randomUUID()}`;
  const organization = db.collection("organizations").doc(organizationId);
  const matrizCompany = db.collection("companies").doc(matrizCompanyId);
  const summitCompany = db.collection("companies").doc(summitCompanyId);
  const foreignMarketToken = "A".repeat(43);

  await Promise.all([
    organization.set({ name: "Organização de teste", status: "ACTIVE" }),
    organization.collection("stores").doc("matriz").set({
      organizationId,
      storeId: "matriz",
      companyId: matrizCompanyId,
      status: "ACTIVE",
      companyMappingStatus: "CONFIRMED",
    }),
    organization.collection("stores").doc("summit").set({
      organizationId,
      storeId: "summit",
      companyId: summitCompanyId,
      status: "ACTIVE",
      companyMappingStatus: "CONFIRMED",
    }),
    matrizCompany.set({ name: "Matriz", organizationId, storeId: "matriz" }),
    summitCompany.set({ name: "Summit", organizationId, storeId: "summit" }),
    db.collection("userProfiles").doc("matriz-admin").set({ companyId: matrizCompanyId }),
    db.collection("userProfiles").doc("summit-admin").set({ companyId: summitCompanyId }),
    matrizCompany.collection("members").doc("matriz-admin").set({ role: "ADMIN", status: "ACTIVE" }),
    summitCompany.collection("members").doc("summit-admin").set({ role: "ADMIN", status: "ACTIVE" }),
    matrizCompany.collection("customerFeedbackLocations").doc("market-summit").set({
      kind: "MARKET",
      marketId: "summit",
      name: "Summit",
      active: true,
      publicToken: foreignMarketToken,
    }),
    db.collection("customerFeedbackQrTokens").doc(foreignMarketToken).set({
      companyId: matrizCompanyId,
      locationId: "market-summit",
      active: true,
    }),
  ]);

  const matrizDashboard = await manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "list",
  });
  const summitDashboard = await manageCustomerFeedback(db, "summit-admin", {
    companyId: summitCompanyId,
    action: "list",
  });
  assert.deepEqual(matrizDashboard.markets.map((market) => market.id), ["matriz"]);
  assert.deepEqual(matrizDashboard.locations.map((location) => location.marketId), ["matriz"]);
  assert.deepEqual(summitDashboard.markets.map((market) => market.id), ["summit"]);
  assert.deepEqual(summitDashboard.locations.map((location) => location.marketId), ["summit"]);

  const matrizMarket = matrizDashboard.locations[0];
  const summitMarket = summitDashboard.locations[0];
  await submitCustomerFeedback(db, { token: matrizMarket.publicToken, overallRating: 5 }, "matriz-feedback-client");
  await submitCustomerFeedback(db, { token: summitMarket.publicToken, overallRating: 1 }, "summit-feedback-client");
  const matrizAfterFeedback = await manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "list",
  });
  assert.equal(matrizAfterFeedback.summary.responseCount, 1);
  assert.ok(matrizAfterFeedback.recentResponses.every((response) => response.marketId === "matriz"));

  await assert.rejects(manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "createCashier",
    marketId: "summit",
    name: "Caixa Summit",
  }), (error) => error instanceof CustomerFeedbackError && error.code === "permission-denied");
  await assert.rejects(getPublicCustomerFeedbackForm(db, foreignMarketToken), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");
  await assert.rejects(submitCustomerFeedback(db, {
    token: foreignMarketToken,
    overallRating: 1,
  }, "foreign-market-client"), (error) =>
    error instanceof CustomerFeedbackError && error.code === "not-found");

  const matrizCashier = await manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "createCashier",
    marketId: "matriz",
    name: "Caixa Matriz",
  });
  await matrizCompany.collection("customerFeedbackLocations").doc(matrizCashier.locationId)
    .update({ publicToken: summitMarket.publicToken });
  await assert.rejects(manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "setCashierActive",
    locationId: matrizCashier.locationId,
    active: false,
  }), (error) => error instanceof CustomerFeedbackError && error.code === "failed-precondition");

  await matrizCompany.collection("customerFeedbackLocations").doc(matrizMarket.id)
    .update({ publicToken: summitMarket.publicToken });
  await assert.rejects(manageCustomerFeedback(db, "matriz-admin", {
    companyId: matrizCompanyId,
    action: "rotateQr",
    locationId: matrizMarket.id,
  }), (error) => error instanceof CustomerFeedbackError && error.code === "failed-precondition");
  assert.equal((await db.collection("customerFeedbackQrTokens").doc(summitMarket.publicToken).get()).get("active"), true);
});

test("confirmed legacy Matrix company preserves all feedback markets and unassigned general history", async () => {
  const organizationId = `legacy-matrix-org-${randomUUID()}`;
  const companyId = "hb-avalia";
  const company = db.collection("companies").doc(companyId);
  const organization = db.collection("organizations").doc(organizationId);
  const adminUid = `legacy-matrix-admin-${randomUUID()}`;
  const newTokens = {};
  for (const id of ["matriz", "loja-2", "summit", "general", "legacy-cashier"]) {
    newTokens[id] = randomUUID().replaceAll("-", "").padEnd(43, "X").slice(0, 43);
  }

  await Promise.all([
    organization.set({ name: "Hipermercado Baratão", status: "ACTIVE" }),
    organization.collection("stores").doc("matriz").set({
      organizationId,
      storeId: "matriz",
      companyId,
      status: "ACTIVE",
      companyMappingStatus: "CONFIRMED",
    }),
    company.set({ name: "Hiper Baratao", organizationId, storeId: "matriz" }),
    db.collection("userProfiles").doc(adminUid).set({ companyId }),
    company.collection("members").doc(adminUid).set({ role: "ADMIN", status: "ACTIVE" }),
    ...["matriz", "loja-2", "summit"].map((marketId) => company.collection("customerFeedbackLocations")
      .doc(`market-${marketId}`).set({
        kind: "MARKET",
        marketId,
        name: marketId,
        active: true,
        publicToken: newTokens[marketId],
        responseCount: 0,
        overallRatingTotal: 0,
      })),
    company.collection("customerFeedbackLocations").doc("general").set({
      kind: "GENERAL",
      name: "Supermercado",
      active: true,
      publicToken: newTokens.general,
    }),
    company.collection("customerFeedbackLocations").doc("legacy-cashier").set({
      kind: "CASHIER",
      name: "Caixa legado",
      active: true,
      publicToken: newTokens["legacy-cashier"],
    }),
    ...Object.entries(newTokens).map(([locationId, token]) => db.collection("customerFeedbackQrTokens")
      .doc(token).set({ companyId, locationId, active: true })),
    ...[
      { id: "feedback-matriz", marketId: "matriz", overallRating: 5 },
      { id: "feedback-loja-2", marketId: "loja-2", overallRating: 4 },
      { id: "feedback-summit", marketId: "summit", overallRating: 3 },
      { id: "feedback-null", marketId: null, overallRating: 2 },
      { id: "feedback-missing", overallRating: 1 },
    ].map(({ id, ...response }) => company.collection("customerFeedbackResponses").doc(id).set({
      sourceLocationId: response.marketId ? `market-${response.marketId}` : "general",
      sourceLocationName: response.marketId ?? "Supermercado",
      cashierRating: null,
      comment: id,
      submittedAt: new Date(),
      ...response,
    })),
    company.collection("customerFeedbackSummaries").doc("overall").set({
      responseCount: 5,
      overallRatingTotal: 15,
    }),
  ]);

  const dashboard = await manageCustomerFeedback(db, adminUid, { companyId, action: "list" });
  assert.deepEqual(dashboard.markets.map(({ id }) => id), ["matriz", "loja-2", "summit"]);
  assert.ok(dashboard.locations.some((location) => location.id === "general" && location.marketId === null));
  assert.equal(dashboard.summary.responseCount, 5);
  assert.equal(dashboard.summary.averageRating, 3);
  assert.deepEqual(
    new Set(dashboard.recentResponses.map((response) => response.id)),
    new Set(["feedback-matriz", "feedback-loja-2", "feedback-summit", "feedback-null", "feedback-missing"]),
  );
  assert.equal(dashboard.recentResponses.find((response) => response.id === "feedback-null").marketId, null);
  assert.equal(dashboard.recentResponses.find((response) => response.id === "feedback-missing").marketId, null);

  const generalForm = await getPublicCustomerFeedbackForm(db, newTokens.general);
  assert.equal(generalForm.location.kind, "GENERAL");
  assert.equal(generalForm.location.marketId, null);
  assert.deepEqual(generalForm.cashiers, [{ id: "legacy-cashier", name: "Caixa legado" }]);
  await submitCustomerFeedback(db, {
    token: newTokens.general,
    overallRating: 4,
  }, "legacy-matrix-client");

  const afterSubmission = await manageCustomerFeedback(db, adminUid, { companyId, action: "list" });
  assert.equal(afterSubmission.summary.responseCount, 6);
  assert.ok(afterSubmission.recentResponses.some((response) =>
    response.sourceLocationId === "general" && response.marketId === null));
});

test("customer feedback applies an atomic per-client submission limit", async () => {
  const companyId = `feedback-limit-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  await company.set({ name: "Mercado com limite" });
  await db.collection("userProfiles").doc("admin").set({ companyId });
  await company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" });
  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const matriz = dashboard.locations.find((location) => location.kind === "MARKET" && location.marketId === "matriz");
  assert.ok(matriz?.publicToken);

  const attempts = await Promise.allSettled(Array.from({ length: 11 }, () =>
    submitCustomerFeedback(db, { token: matriz.publicToken, overallRating: 5 }, "limited-client")));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 10);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected"
    && attempt.reason instanceof CustomerFeedbackError
    && attempt.reason.code === "resource-exhausted").length, 1);
  assert.equal((await company.collection("customerFeedbackResponses").get()).size, 10);
  const limits = await company.collection("customerFeedbackRateLimits").get();
  assert.equal(limits.size, 1);
  assert.match(limits.docs[0].id, /^slot-[0-9a-f]{4}$/);
  assert.equal(limits.docs[0].get("expiresAt"), undefined);
  const clients = limits.docs[0].get("clients");
  assert.deepEqual(Object.keys(clients), [createHmac("sha256",
    (await company.collection("customerFeedbackPrivate").doc("rateLimitSecret").get()).get("secret"))
    .update("limited-client").digest("hex")]);
  assert.equal(JSON.stringify(limits.docs[0].data()).includes("limited-client"), false);
});

test("customer feedback slot collisions keep independent per-client limits during simultaneous submissions", async () => {
  const companyId = `feedback-slot-collision-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  await company.set({ name: "Mercado com slots de limite" });
  await db.collection("userProfiles").doc("admin").set({ companyId });
  await company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" });
  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const location = dashboard.locations.find(({ kind }) => kind === "MARKET");
  assert.ok(location?.publicToken);

  await submitCustomerFeedback(db, { token: location.publicToken, overallRating: 5 }, "seed-address");
  const secret = (await company.collection("customerFeedbackPrivate").doc("rateLimitSecret").get()).get("secret");
  const addressesBySlot = new Map();
  let collidingAddresses;
  for (let index = 0; index < 20_000 && !collidingAddresses; index += 1) {
    const address = `slot-address-${index}`;
    const hash = createHmac("sha256", secret).update(address).digest("hex");
    const slotId = rateLimitSlotId(hash);
    const previousAddress = addressesBySlot.get(slotId);
    if (previousAddress) collidingAddresses = [previousAddress, address];
    else addressesBySlot.set(slotId, address);
  }
  assert.ok(collidingAddresses, "expected to find two addresses assigned to the same fixed slot");

  const [firstAddress, secondAddress] = collidingAddresses;
  const attempts = await Promise.allSettled([
    ...Array.from({ length: 10 }, () =>
      submitCustomerFeedback(db, { token: location.publicToken, overallRating: 4 }, firstAddress)),
    ...Array.from({ length: 10 }, () =>
      submitCustomerFeedback(db, { token: location.publicToken, overallRating: 3 }, secondAddress)),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 20);
  const firstHash = createHmac("sha256", secret).update(firstAddress).digest("hex");
  const slotSnapshot = await company.collection("customerFeedbackRateLimits")
    .doc(rateLimitSlotId(firstHash)).get();
  const clients = slotSnapshot.get("clients");
  assert.equal(Object.keys(clients).length, 2);
  for (const address of collidingAddresses) {
    await assert.rejects(
      submitCustomerFeedback(db, { token: location.publicToken, overallRating: 2 }, address),
      (error) => error instanceof CustomerFeedbackError && error.code === "resource-exhausted",
    );
  }
  const limits = await company.collection("customerFeedbackRateLimits").get();
  assert.ok(limits.size <= 65_536);
  assert.ok(limits.docs.every(({ id }) => /^slot-[0-9a-f]{4}$/.test(id)));
  for (const address of collidingAddresses) {
    const hash = createHmac("sha256", secret).update(address).digest("hex");
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(clients[hash].submissionCount, 10);
    assert.equal(JSON.stringify(slotSnapshot.data()).includes(address), false);
  }
  assert.equal((await company.collection("customerFeedbackResponses").get()).size, 21);
});

test("customer feedback resets expired counters and reuses slots without inheriting another client's limit", async () => {
  const companyId = `feedback-slot-window-${randomUUID()}`;
  const company = db.collection("companies").doc(companyId);
  await company.set({ name: "Mercado com janela expirada" });
  await db.collection("userProfiles").doc("admin").set({ companyId });
  await company.collection("members").doc("admin").set({ role: "ADMIN", status: "ACTIVE" });
  const dashboard = await manageCustomerFeedback(db, "admin", { companyId, action: "list" });
  const location = dashboard.locations.find(({ kind }) => kind === "MARKET");
  assert.ok(location?.publicToken);

  await submitCustomerFeedback(db, { token: location.publicToken, overallRating: 5 }, "seed-address");
  const secret = (await company.collection("customerFeedbackPrivate").doc("rateLimitSecret").get()).get("secret");
  const addressesBySlot = new Map();
  let collidingAddresses;
  for (let index = 0; index < 20_000 && !collidingAddresses; index += 1) {
    const address = `reused-slot-address-${index}`;
    const hash = createHmac("sha256", secret).update(address).digest("hex");
    const slotId = rateLimitSlotId(hash);
    const previousAddress = addressesBySlot.get(slotId);
    if (previousAddress) collidingAddresses = [previousAddress, address];
    else addressesBySlot.set(slotId, address);
  }
  assert.ok(collidingAddresses, "expected to find two addresses assigned to the same fixed slot");
  const [expiredAddress, reusedAddress] = collidingAddresses;
  const expiredHash = createHmac("sha256", secret).update(expiredAddress).digest("hex");
  const reusedHash = createHmac("sha256", secret).update(reusedAddress).digest("hex");
  const rateLimitRef = company.collection("customerFeedbackRateLimits").doc(rateLimitSlotId(expiredHash));
  await rateLimitRef.set({
    clients: {
      [expiredHash]: {
        windowStartedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
        submissionCount: 10,
      },
    },
  });

  await submitCustomerFeedback(db, { token: location.publicToken, overallRating: 4 }, reusedAddress);
  const limit = await rateLimitRef.get();
  const clients = limit.get("clients");
  assert.equal(clients[expiredHash], undefined);
  assert.equal(clients[reusedHash].submissionCount, 1);
  assert.ok(clients[reusedHash].windowStartedAt.toMillis() > Date.now() - 60_000);
});

test("scheduled checklist publication creates eligible assignments once", async () => {
  const { company } = await createCompany();
  await Promise.all([
    company.collection("members").doc("moved-employee").set({
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: ["team-1"],
    }),
    db.collection("userProfiles").doc("moved-employee").set({ companyId: "another-company" }),
  ]);
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
