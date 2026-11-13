import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const projectId = process.env.GCLOUD_PROJECT || "demo-hb-avalia";
let app;
let db;
let directorAccessApi;

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
  assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  app = initializeApp({ projectId }, "hb-avalia-server");
  db = getFirestore(app);
  directorAccessApi = await import("../src/lib/server/director-access.ts");
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

async function createDirectorFixture() {
  const uid = `director-${randomUUID()}`;
  const organizationId = "hipermercado-baratao";
  const organizationRef = db.collection("organizations").doc(organizationId);
  await organizationRef.set({
    name: "Hipermercado Baratão",
    status: "ACTIVE",
    directorRole: "DIRECTOR",
  });

  const stores = [
    { storeId: "matriz", name: "Matriz", companyId: `director-matriz-${randomUUID()}`, mappingStatus: "CONFIRMED" },
    { storeId: "loja-2", name: "Loja 2", companyId: `director-loja-2-${randomUUID()}`, mappingStatus: "PENDING_CONFIRMATION" },
    { storeId: "summit", name: "Summit", companyId: `director-summit-${randomUUID()}`, mappingStatus: "PENDING_CONFIRMATION" },
  ];

  for (const store of stores) {
    await organizationRef.collection("stores").doc(store.storeId).set({
      organizationId,
      storeId: store.storeId,
      name: store.name,
      companyId: store.companyId,
      status: "ACTIVE",
      companyMappingStatus: store.mappingStatus,
    });
  }
  await db.collection("companies").doc(stores[0].companyId).set({
    name: stores[0].name,
    organizationId,
    storeId: stores[0].storeId,
  });
  await organizationRef.collection("directors").doc(uid).set({
    uid,
    email: "diretor@example.test",
    role: "DIRECTOR",
    status: "ACTIVE",
  });
  return { uid, organizationId, stores };
}

test("active organization grant resolves only organization metadata and keeps unconfirmed stores non-operational", async () => {
  const fixture = await createDirectorFixture();
  const access = await directorAccessApi.readDirectorAccess(fixture.uid, " DIRETOR@EXAMPLE.TEST ");

  assert.equal(access.accessType, "DIRECTOR");
  assert.equal(access.organizationId, fixture.organizationId);
  assert.deepEqual(access.stores.map((store) => store.storeId), ["loja-2", "matriz", "summit"]);
  assert.equal(access.stores.find((store) => store.storeId === "matriz").operationalAccessReady, true);
  assert.equal(access.stores.find((store) => store.storeId === "loja-2").operationalAccessReady, false);
  assert.equal((await db.collection("userProfiles").doc(fixture.uid).get()).exists, false);
});

test("missing, inactive, or email-mismatched organization grants do not authorize a director", async () => {
  const fixture = await createDirectorFixture();

  assert.equal(await directorAccessApi.readDirectorAccess(`missing-${fixture.uid}`, "diretor@example.test"), null);
  await assert.rejects(
    directorAccessApi.readDirectorAccess(fixture.uid, "outra@example.test"),
    (error) => error instanceof directorAccessApi.DirectorAccessError && error.status === 403,
  );

  await db.collection("organizations").doc(fixture.organizationId)
    .collection("directors").doc(fixture.uid).update({ status: "INACTIVE" });
  await assert.rejects(
    directorAccessApi.readDirectorAccess(fixture.uid, "diretor@example.test"),
    (error) => error instanceof directorAccessApi.DirectorAccessError && error.status === 403,
  );

  await db.collection("organizations").doc(fixture.organizationId)
    .collection("directors").doc(fixture.uid).update({ status: "ACTIVE" });
  await db.collection("organizations").doc(fixture.organizationId).update({ status: "INACTIVE" });
  await assert.rejects(
    directorAccessApi.readDirectorAccess(fixture.uid, "diretor@example.test"),
    (error) => error instanceof directorAccessApi.DirectorAccessError && error.status === 403,
  );
});

test("rejects a company record whose organization/store linkage conflicts with the directory", async () => {
  const fixture = await createDirectorFixture();
  await db.collection("companies").doc(fixture.stores[0].companyId)
    .update({ storeId: "summit" });

  await assert.rejects(
    directorAccessApi.readDirectorAccess(fixture.uid, "diretor@example.test"),
    /não confirma o vínculo organizacional/,
  );
});
