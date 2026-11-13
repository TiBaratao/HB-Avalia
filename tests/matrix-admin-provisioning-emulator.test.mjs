import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
assert.match(emulatorHost, /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");

let app;
let db;
let provisionMatrixAdmin;

before(async () => {
  const [{ initializeApp }, { getFirestore }, core] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/firestore"),
    import("../src/lib/server/matrix-admin-provisioning-core.js"),
  ]);
  app = initializeApp({ projectId }, "matrix-admin-provisioning-test");
  db = getFirestore(app);
  provisionMatrixAdmin = core.provisionMatrixAdmin;

  const companyRef = db.collection("companies").doc("hb-avalia");
  const organizationRef = db.collection("organizations").doc("hipermercado-baratao");
  await Promise.all([
    organizationRef.set({
      name: "Hipermercado Baratão",
      status: "ACTIVE",
      directorRole: "DIRECTOR",
    }),
    organizationRef.collection("stores").doc("matriz").set({
      organizationId: "hipermercado-baratao",
      storeId: "matriz",
      companyId: "hb-avalia",
      status: "ACTIVE",
      companyMappingStatus: "CONFIRMED",
    }),
    companyRef.set({
      name: "Matriz",
      organizationId: "hipermercado-baratao",
      storeId: "matriz",
    }),
  ]);
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

test("provisions an explicitly authorized Matrix administrator idempotently", async () => {
  const uid = `matrix-admin-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const first = await provisionMatrixAdmin(db, { uid, email, name: "Administrador de teste" });
  const second = await provisionMatrixAdmin(db, { uid, email, name: "Administrador de teste" });

  assert.deepEqual(first, { created: true });
  assert.deepEqual(second, { created: false });
  const [member, profile] = await Promise.all([
    db.collection("companies").doc("hb-avalia").collection("members").doc(uid).get(),
    db.collection("userProfiles").doc(uid).get(),
  ]);
  assert.equal(member.get("role"), "ADMIN");
  assert.equal(member.get("status"), "ACTIVE");
  assert.deepEqual(member.get("teamIds"), []);
  assert.equal(profile.get("companyId"), "hb-avalia");
});

test("refuses conflicting pre-existing account associations without overwriting them", async () => {
  const uid = `matrix-admin-conflict-${randomUUID()}`;
  const profileRef = db.collection("userProfiles").doc(uid);
  await profileRef.set({ companyId: "another-company", preserved: true });

  await assert.rejects(
    provisionMatrixAdmin(db, { uid, email: `${uid}@example.test`, name: "Conflicting account" }),
    /dados de associação divergentes/,
  );
  assert.equal((await db.collection("companies").doc("hb-avalia").collection("members").doc(uid).get()).exists, false);
  assert.equal((await profileRef.get()).get("preserved"), true);
});

test("refuses to provision when the Matrix organization mapping is invalid", async () => {
  const uid = `matrix-admin-invalid-${randomUUID()}`;
  await db.collection("organizations").doc("hipermercado-baratao")
    .collection("stores").doc("matriz").update({ companyMappingStatus: "PENDING_CONFIRMATION" });

  await assert.rejects(
    provisionMatrixAdmin(db, { uid, email: `${uid}@example.test`, name: "Invalid mapping" }),
    /não está confirmada e ativa/,
  );
  assert.equal((await db.collection("companies").doc("hb-avalia").collection("members").doc(uid).get()).exists, false);
});
