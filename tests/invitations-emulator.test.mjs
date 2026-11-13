import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const projectId = process.env.GCLOUD_PROJECT || "demo-hb-avalia";
let app;
let db;
let invitationsApi;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is required; refusing to run against production.");
  process.env.RESEND_API_KEY = "";
  process.env.INVITATION_FROM_EMAIL = "";
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  app = initializeApp({ projectId }, "hb-avalia-server");
  db = getFirestore(app);
  invitationsApi = await import("../src/lib/server/invitations.ts");
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

async function createCompany() {
  const companyId = `invites-${randomUUID()}`;
  const companyRef = db.collection("companies").doc(companyId);
  await Promise.all([
    companyRef.set({ name: "Empresa de convites" }),
    db.collection("userProfiles").doc("admin-1").set({ companyId }),
    db.collection("userProfiles").doc("leader-1").set({ companyId }),
    companyRef.collection("members").doc("admin-1").set({
      uid: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      teamIds: [],
    }),
    companyRef.collection("members").doc("leader-1").set({
      uid: "leader-1",
      email: "leader@example.test",
      role: "LEADER",
      status: "ACTIVE",
      teamIds: ["team-1"],
    }),
    companyRef.collection("teams").doc("team-1").set({ name: "Equipe de teste", active: true }),
  ]);
  return companyId;
}

function tokenFrom(result) {
  return new URL(result.inviteUrl).hash.slice(1);
}

test("admin invitations are email-bound, expiring, single-use, and server-managed", async () => {
  const companyId = await createCompany();
  const invitationResult = await invitationsApi.createInvitation("admin-1", {
    companyId,
    email: " New.Person@Example.test ",
    role: "EMPLOYEE",
    teamIds: ["team-1"],
  }, "https://hbavalia.vercel.app");
  const invitationId = invitationResult.invitation.id;
  const token = tokenFrom(invitationResult);
  const stored = await db.collection("invitations").doc(invitationId).get();

  assert.equal(invitationResult.invitation.email, "new.person@example.test");
  assert.equal(invitationResult.emailSent, false);
  assert.ok(invitationResult.emailWarning);
  assert.notEqual(stored.get("tokenHash"), token);
  assert.equal(stored.get("status"), "PENDING");
  assert.equal((await invitationsApi.lookupInvitation({ invitationId, token })).teamNames[0], "Equipe de teste");

  await assert.rejects(
    invitationsApi.createInvitation("leader-1", { companyId, email: "leader-invite@example.test", role: "EMPLOYEE", teamIds: [] }, "https://hbavalia.vercel.app"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
  await assert.rejects(
    invitationsApi.createInvitation("admin-1", { companyId, email: "new.person@example.test", role: "EMPLOYEE", teamIds: ["team-1"] }, "https://hbavalia.vercel.app"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 409,
  );
  await assert.rejects(
    invitationsApi.acceptInvitation("new-user", "other@example.test", true, { invitationId, token }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
  await assert.rejects(
    invitationsApi.acceptInvitation("new-user", "new.person@example.test", false, { invitationId, token }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
  assert.equal((await db.collection("userProfiles").doc("new-user").get()).exists, false);

  const accepted = await invitationsApi.acceptInvitation("new-user", "new.person@example.test", true, {
    invitationId,
    token,
    name: "Pessoa Convidada",
  });
  assert.deepEqual(accepted, { companyId, alreadyAccepted: false });
  assert.equal((await db.collection("userProfiles").doc("new-user").get()).get("companyId"), companyId);
  assert.equal((await db.collection("companies").doc(companyId).collection("members").doc("new-user").get()).get("status"), "ACTIVE");
  assert.deepEqual(
    await invitationsApi.acceptInvitation("new-user", "new.person@example.test", true, { invitationId, token }),
    { companyId, alreadyAccepted: true },
  );
  await assert.rejects(
    invitationsApi.acceptInvitation("another-user", "new.person@example.test", true, { invitationId, token }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 410,
  );
  assert.deepEqual(await invitationsApi.readCurrentAccess("new-user", "new.person@example.test"), { companyId });
  await assert.rejects(
    invitationsApi.readCurrentAccess("new-user", "wrong@example.test"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );
});

test("resending rotates the token and canceled invitations cannot be looked up", async () => {
  const companyId = await createCompany();
  const original = await invitationsApi.createInvitation("admin-1", {
    companyId,
    email: "resend@example.test",
    role: "LEADER",
    teamIds: ["team-1"],
  }, "https://hbavalia.vercel.app");
  const invitationId = original.invitation.id;
  const oldToken = tokenFrom(original);
  const resent = await invitationsApi.resendInvitation("admin-1", "admin@example.test", { invitationId }, "https://hbavalia.vercel.app");
  const newToken = tokenFrom(resent);

  assert.notEqual(oldToken, newToken);
  await assert.rejects(
    invitationsApi.lookupInvitation({ invitationId, token: oldToken }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 404,
  );
  assert.equal((await invitationsApi.lookupInvitation({ invitationId, token: newToken })).email, "resend@example.test");

  await invitationsApi.cancelInvitation("admin-1", "admin@example.test", { invitationId });
  await assert.rejects(
    invitationsApi.lookupInvitation({ invitationId, token: newToken }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 410,
  );
  assert.equal((await invitationsApi.listInvitations("admin-1", "admin@example.test", companyId))[0].status, "CANCELED");
});

test("company administrators cannot manage another tenant and accepted users cannot join a second tenant", async () => {
  const firstCompanyId = await createCompany();
  const secondCompanyId = await createCompany();
  await db.collection("userProfiles").doc("admin-1").set({ companyId: firstCompanyId });
  await db.collection("userProfiles").doc("existing-user").set({ companyId: firstCompanyId });
  await db.collection("companies").doc(secondCompanyId).collection("members").doc("admin-1").set({
    uid: "admin-1",
    email: "admin@example.test",
    role: "ADMIN",
    status: "ACTIVE",
    teamIds: [],
  });

  await assert.rejects(
    invitationsApi.createInvitation("admin-1", {
      companyId: secondCompanyId,
      email: "other-tenant@example.test",
      role: "EMPLOYEE",
      teamIds: [],
    }, "https://hbavalia.vercel.app"),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 403,
  );

  await db.collection("companies").doc(secondCompanyId).collection("teams").doc("team-1")
    .set({ name: "Equipe de teste", active: true });
  await db.collection("userProfiles").doc("admin-1").set({ companyId: secondCompanyId });
  const invitation = await invitationsApi.createInvitation("admin-1", {
    companyId: secondCompanyId,
    email: "existing@example.test",
    role: "EMPLOYEE",
    teamIds: ["team-1"],
  }, "https://hbavalia.vercel.app");
  await assert.rejects(
    invitationsApi.acceptInvitation("existing-user", "existing@example.test", true, {
      invitationId: invitation.invitation.id,
      token: tokenFrom(invitation),
    }),
    (error) => error instanceof invitationsApi.InvitationApiError && error.status === 409,
  );
  assert.equal((await db.collection("companies").doc(secondCompanyId).collection("members").doc("existing-user").get()).exists, false);
});
