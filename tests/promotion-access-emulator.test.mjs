import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const projectId = process.env.GCLOUD_PROJECT || "demo-hb-avalia";
let app;
let db;
let promotionApi;
let indicators;
let competencies;

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
  assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const scoring = await import("../functions/promotion-scoring.js");
  app = initializeApp({ projectId }, "hb-avalia-server");
  db = getFirestore(app);
  promotionApi = await import("../src/lib/server/promotion-actions.ts");
  indicators = scoring.PROMOTION_INDICATORS.map(({ id }) => ({ id, percentage: 100 }));
  competencies = scoring.PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score: 5 }));
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

test("promotion endpoints reject an active membership outside the account company", async () => {
  const companyId = `promotion-access-${randomUUID()}`;
  const companyRef = db.collection("companies").doc(companyId);
  await Promise.all([
    companyRef.set({ name: "Empresa de teste" }),
    companyRef.collection("members").doc("leader").set({
      uid: "leader",
      role: "LEADER",
      status: "ACTIVE",
      teamIds: ["team-1"],
    }),
    companyRef.collection("members").doc("employee").set({
      uid: "employee",
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: ["team-1"],
      positionTitle: "Atendente de Açougue Junior",
    }),
    db.collection("userProfiles").doc("leader").set({ companyId: "another-company" }),
    db.collection("userProfiles").doc("employee").set({ companyId }),
  ]);

  const payload = {
    companyId,
    employeeId: "employee",
    justification: "Colaborador demonstra desempenho consistente e está pronto para avançar.",
    indicators,
    competencies,
  };
  await assert.rejects(
    promotionApi.submitPromotionRequest("leader", payload),
    (error) => error instanceof promotionApi.PromotionApiError && error.status === 403,
  );
  await assert.rejects(
    promotionApi.listPromotionHistory("leader", companyId, "employee"),
    (error) => error instanceof promotionApi.PromotionApiError && error.status === 403,
  );
  await assert.rejects(
    promotionApi.decidePromotionRequest("leader", "request-1", {
      companyId,
      decision: "APPROVED",
    }),
    (error) => error instanceof promotionApi.PromotionApiError && error.status === 403,
  );
  assert.equal((await companyRef.collection("promotionRequests").get()).size, 0);
});
