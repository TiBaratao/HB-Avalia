import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const projectId = process.env.GCLOUD_PROJECT || "demo-hb-avalia";
let app;
let db;
let invitationsApi;
let organizationManagementApi;

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
  assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");
  process.env.RESEND_API_KEY = "";
  process.env.INVITATION_FROM_EMAIL = "";
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  app = initializeApp({ projectId }, "hb-avalia-server");
  db = getFirestore(app);
  invitationsApi = await import("../src/lib/server/invitations.ts");
  organizationManagementApi = await import("../src/lib/server/organization-management.ts");
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

async function createOrganizationFixture() {
  const organizationId = "hipermercado-baratao";
  const directorUid = `director-${randomUUID()}`;
  const sourceCompanyId = `store-source-${randomUUID()}`;
  const targetCompanyId = `store-target-${randomUUID()}`;
  const organizationRef = db.collection("organizations").doc(organizationId);
  const stores = [
    { storeId: "matriz", companyId: sourceCompanyId, name: "Matriz" },
    { storeId: "loja-2", companyId: targetCompanyId, name: "Loja 2" },
  ];

  await organizationRef.set({ name: "Hipermercado Baratão", status: "ACTIVE", directorRole: "DIRECTOR" });
  await organizationRef.collection("directors").doc(directorUid).set({
    uid: directorUid,
    email: "diretor@example.test",
    role: "DIRECTOR",
    status: "ACTIVE",
  });
  for (const store of stores) {
    await organizationRef.collection("stores").doc(store.storeId).set({
      ...store,
      organizationId,
      status: "ACTIVE",
      companyMappingStatus: "CONFIRMED",
    });
    await db.collection("companies").doc(store.companyId).set({
      name: store.name,
      organizationId,
      storeId: store.storeId,
      teamRosterVersion: 2,
    });
  }
  await db.collection("companies").doc(sourceCompanyId).collection("teams").doc("source-team").set({
    name: "Equipe origem",
    active: true,
  });
  await db.collection("companies").doc(targetCompanyId).collection("teams").doc("target-team").set({
    name: "Equipe destino",
    active: true,
  });
  return { organizationId, directorUid, sourceCompanyId, targetCompanyId, stores };
}

function tokenFrom(result) {
  return new URL(result.inviteUrl).hash.slice(1);
}

test("only the Director can issue, list, resend and cancel store administrator invitations", async () => {
  const fixture = await createOrganizationFixture();
  const matrixCompany = db.collection("companies").doc(fixture.sourceCompanyId);
  await Promise.all([
    matrixCompany.collection("members").doc("active-admin").set({
      uid: "active-admin", name: "Admin", email: "admin@example.test",
      role: "ADMIN", status: "ACTIVE", teamIds: [],
    }),
    matrixCompany.collection("members").doc("inactive-user").set({
      uid: "inactive-user", name: "Inactive", email: "inactive@example.test",
      role: "EMPLOYEE", status: "INACTIVE", teamIds: [],
    }),
    matrixCompany.collection("teams").doc("source-team").set({ name: "Equipe origem", active: true }),
    matrixCompany.collection("cycles").doc("cycle-open").set({ status: "OPEN" }),
    matrixCompany.collection("cycles").doc("cycle-closed").set({ status: "CLOSED" }),
    matrixCompany.collection("evaluations").doc("evaluation-1").set({
      status: "SUBMITTED",
      cycleId: "cycle-open",
      evaluatorId: "active-admin",
      evaluatedUserId: "active-admin",
      type: "EMPLOYEE",
      averageScore: 4,
      submittedAt: new Date("2026-10-12T12:00:00.000Z"),
    }),
    matrixCompany.collection("criteria").doc("criterion-quality").set({
      name: "Qualidade",
      evaluationType: "EMPLOYEE",
      active: true,
    }),
    matrixCompany.collection("evaluations").doc("evaluation-1").collection("answers")
      .doc("criterion-quality").set({ criterionId: "criterion-quality", score: 5 }),
    matrixCompany.collection("developmentPlans").doc("pdi-1").set({}),
    matrixCompany.collection("promotionRequests").doc("promotion-1").set({}),
    matrixCompany.collection("customerFeedbackResponses").doc("feedback-1").set({}),
  ]);
  const management = await organizationManagementApi.readOrganizationManagement(
    fixture.directorUid,
    "diretor@example.test",
  );
  assert.ok(management.stores.some((store) => store.storeId === "matriz"));
  assert.ok(management.stores.some((store) => store.storeId === "loja-2"));
  assert.equal(management.consolidated.operationalStores, 2);
  const matrix = management.stores.find((store) => store.storeId === "matriz");
  assert.deepEqual(matrix.indicators, {
    activeMembers: 1,
    activeTeams: 1,
    openCycles: 1,
    evaluations: 1,
    developmentPlans: 1,
    promotionRequests: 1,
    customerFeedbackResponses: 1,
  });
  assert.equal(management.consolidated.evaluations, 1);
  assert.equal(management.stores.find((store) => store.storeId === "loja-2").indicators.evaluations, 0);
  assert.deepEqual(matrix.analytics.competencyRecords.map((record) => ({
    criterionName: record.criterionName,
    score: record.score,
  })), [{ criterionName: "Qualidade", score: 5 }]);
  assert.equal(management.stores.find((store) => store.storeId === "loja-2").analytics.competencyRecords.length, 0);
  await assert.rejects(
    organizationManagementApi.readOrganizationManagement("not-director", "not-director@example.test"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
  await assert.rejects(
    invitationsApi.createInvitation(fixture.directorUid, {
      companyId: fixture.sourceCompanyId,
      email: "local-admin@example.test",
      role: "ADMIN",
      teamIds: [],
    }, "https://hbavalia.vercel.app"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );

  const created = await invitationsApi.createStoreAdminInvitation(
    fixture.directorUid,
    "diretor@example.test",
    { storeId: "matriz", email: "new-admin@example.test" },
    "https://hbavalia.vercel.app",
  );
  const invitationRef = db.collection("invitations").doc(created.invitation.id);
  assert.equal((await invitationRef.get()).get("invitationScope"), "STORE_ADMIN");
  assert.equal((await invitationRef.get()).get("companyId"), fixture.sourceCompanyId);
  assert.equal(created.invitation.role, "ADMIN");
  assert.equal((await invitationsApi.listInvitations(
    fixture.directorUid,
    "diretor@example.test",
    fixture.sourceCompanyId,
    "matriz",
  )).length, 1);
  await assert.rejects(
    invitationsApi.listInvitations("not-director", "not-director@example.test", fixture.sourceCompanyId, "matriz"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );

  const resent = await invitationsApi.resendInvitation(
    fixture.directorUid,
    "diretor@example.test",
    { invitationId: created.invitation.id },
    "https://hbavalia.vercel.app",
  );
  assert.notEqual(tokenFrom(created), tokenFrom(resent));
  await assert.rejects(
    invitationsApi.cancelInvitation("not-director", "not-director@example.test", { invitationId: created.invitation.id }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
  await invitationsApi.cancelInvitation(fixture.directorUid, "diretor@example.test", { invitationId: created.invitation.id });
  assert.equal((await invitationRef.get()).get("status"), "CANCELED");

  const acceptedInvite = await invitationsApi.createStoreAdminInvitation(
    fixture.directorUid,
    "diretor@example.test",
    { storeId: "matriz", email: "accepted-admin@example.test" },
    "https://hbavalia.vercel.app",
  );
  const accepted = await invitationsApi.acceptInvitation(
    `new-admin-${randomUUID()}`,
    "accepted-admin@example.test",
    true,
    {
      invitationId: acceptedInvite.invitation.id,
      token: tokenFrom(acceptedInvite),
      name: "Nova administradora",
    },
  );
  assert.equal(accepted.companyId, fixture.sourceCompanyId);
  assert.equal(accepted.alreadyAccepted, false);
});

test("Director transfer changes the active tenant, synchronizes rosters and preserves source history", async () => {
  const fixture = await createOrganizationFixture();
  const memberUid = `employee-${randomUUID()}`;
  const sourceCompany = db.collection("companies").doc(fixture.sourceCompanyId);
  const targetCompany = db.collection("companies").doc(fixture.targetCompanyId);
  await Promise.all([
    db.collection("userProfiles").doc(memberUid).set({ companyId: fixture.sourceCompanyId }),
    sourceCompany.collection("members").doc(memberUid).set({
      uid: memberUid,
      name: "Pessoa Transferida",
      email: "pessoa@example.test",
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: ["source-team"],
      positionTitle: "Atendente",
    }),
    sourceCompany.collection("teams").doc("source-team").collection("members").doc(memberUid).set({
      uid: memberUid,
      status: "ACTIVE",
    }),
    sourceCompany.collection("evaluations").doc("historical-evaluation").set({ evaluatorId: "leader", evaluatedUserId: memberUid }),
  ]);

  const result = await organizationManagementApi.transferOrganizationMember(
    fixture.directorUid,
    "diretor@example.test",
    {
      memberUid,
      sourceStoreId: "matriz",
      targetStoreId: "loja-2",
      targetTeamIds: ["target-team"],
    },
  );

  assert.equal(result.memberUid, memberUid);
  assert.equal((await db.collection("userProfiles").doc(memberUid).get()).get("companyId"), fixture.targetCompanyId);
  assert.equal((await sourceCompany.collection("members").doc(memberUid).get()).get("status"), "INACTIVE");
  assert.deepEqual((await sourceCompany.collection("members").doc(memberUid).get()).get("teamIds"), []);
  assert.equal((await targetCompany.collection("members").doc(memberUid).get()).get("status"), "ACTIVE");
  assert.deepEqual((await targetCompany.collection("members").doc(memberUid).get()).get("teamIds"), ["target-team"]);
  assert.equal((await sourceCompany.collection("teams").doc("source-team").collection("members").doc(memberUid).get()).exists, false);
  assert.equal((await targetCompany.collection("teams").doc("target-team").collection("members").doc(memberUid).get()).get("status"), "ACTIVE");
  assert.equal((await sourceCompany.collection("evaluations").doc("historical-evaluation").get()).exists, true);
  assert.equal((await targetCompany.collection("evaluations").doc("historical-evaluation").get()).exists, false);
  assert.equal((await db.collection("organizations").doc(fixture.organizationId)
    .collection("transfers").doc(result.transferId).get()).exists, true);
});

test("transfers reject non-Directors, invalid target mappings and unconfirmed users", async () => {
  const fixture = await createOrganizationFixture();
  const memberUid = `employee-${randomUUID()}`;
  const sourceCompany = db.collection("companies").doc(fixture.sourceCompanyId);
  await Promise.all([
    db.collection("userProfiles").doc(memberUid).set({ companyId: fixture.sourceCompanyId }),
    sourceCompany.collection("members").doc(memberUid).set({
      uid: memberUid,
      name: "Pessoa",
      email: "pessoa@example.test",
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: [],
    }),
  ]);
  const payload = { memberUid, sourceStoreId: "matriz", targetStoreId: "loja-2", targetTeamIds: [] };
  await assert.rejects(
    organizationManagementApi.transferOrganizationMember("local-admin", "admin@example.test", payload),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );

  await db.collection("organizations").doc(fixture.organizationId).collection("stores").doc("loja-2")
    .update({ companyMappingStatus: "PENDING_CONFIRMATION" });
  await assert.rejects(
    organizationManagementApi.transferOrganizationMember(fixture.directorUid, "diretor@example.test", payload),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 409,
  );
  assert.equal((await db.collection("userProfiles").doc(memberUid).get()).get("companyId"), fixture.sourceCompanyId);
  assert.equal((await db.collection("companies").doc(fixture.targetCompanyId).collection("members").doc(memberUid).get()).exists, false);
});
