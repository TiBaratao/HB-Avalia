import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
assert.match(emulatorHost, /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");

let app;
let db;
let provisionDirectorGrant;

before(async () => {
  const [{ initializeApp }, { getFirestore }, core] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/firestore"),
    import("../src/lib/server/director-grant-core.js"),
  ]);
  app = initializeApp({ projectId }, "director-grant-test");
  db = getFirestore(app);
  provisionDirectorGrant = core.provisionDirectorGrant;

  const organizationRef = db.collection("organizations").doc("hipermercado-baratao");
  await organizationRef.set({ status: "ACTIVE", directorRole: "DIRECTOR" });
  for (const [storeId, companyId] of [
    ["matriz", "hb-avalia"],
    ["loja-2", "hb-avalia-loja-2"],
    ["summit", "hb-avalia-summit"],
  ]) {
    await Promise.all([
      organizationRef.collection("stores").doc(storeId).set({
        organizationId: "hipermercado-baratao",
        storeId,
        companyId,
        status: "ACTIVE",
        companyMappingStatus: "CONFIRMED",
      }),
      db.collection("companies").doc(companyId).set({
        organizationId: "hipermercado-baratao",
        storeId,
      }),
    ]);
  }
});

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

test("adds an independent Director grant idempotently without changing the Matrix ADMIN membership", async () => {
  const uid = `director-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const memberRef = db.collection("companies").doc("hb-avalia").collection("members").doc(uid);
  const profileRef = db.collection("userProfiles").doc(uid);
  await Promise.all([
    memberRef.set({
      uid,
      email,
      role: "ADMIN",
      status: "ACTIVE",
      teamIds: [],
    }),
    profileRef.set({ companyId: "hb-avalia" }),
  ]);

  const first = await provisionDirectorGrant(db, { uid, email });
  const second = await provisionDirectorGrant(db, { uid, email });
  const grant = await db.collection("organizations").doc("hipermercado-baratao")
    .collection("directors").doc(uid).get();
  const member = await memberRef.get();
  const profile = await profileRef.get();

  assert.deepEqual(first, { created: true });
  assert.deepEqual(second, { created: false });
  assert.equal(grant.get("role"), "DIRECTOR");
  assert.equal(grant.get("status"), "ACTIVE");
  assert.equal(member.get("role"), "ADMIN");
  assert.equal(member.get("status"), "ACTIVE");
  assert.equal(profile.get("companyId"), "hb-avalia");
});

test("rejects an email already granted to another Director UID", async () => {
  const email = `duplicate-${randomUUID()}@example.test`;
  await db.collection("organizations").doc("hipermercado-baratao")
    .collection("directors").doc(`other-${randomUUID()}`).set({
      uid: "other",
      email,
      role: "DIRECTOR",
      status: "ACTIVE",
    });

  await assert.rejects(
    provisionDirectorGrant(db, { uid: `new-${randomUUID()}`, email }),
    /já possui um grant de Diretor para outro UID/,
  );
});

test("repairs a matching active grant stored under the wrong document ID", async () => {
  const uid = `misplaced-director-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const directors = db.collection("organizations").doc("hipermercado-baratao").collection("directors");
  const misplacedRef = directors.doc(`misplaced-${randomUUID()}`);
  await misplacedRef.set({
    uid,
    email,
    role: "DIRECTOR",
    status: "ACTIVE",
    retainedMetadata: "preserved",
  });

  const result = await provisionDirectorGrant(db, { uid, email });
  const [misplaced, canonical] = await Promise.all([
    misplacedRef.get(),
    directors.doc(uid).get(),
  ]);
  assert.deepEqual(result, { created: true, repairedDocumentPath: true });
  assert.equal(misplaced.exists, false);
  assert.equal(canonical.get("uid"), uid);
  assert.equal(canonical.get("retainedMetadata"), "preserved");
});

test("rejects the grant if any store linkage is not confirmed", async () => {
  const uid = `unconfirmed-${randomUUID()}`;
  await db.collection("organizations").doc("hipermercado-baratao")
    .collection("stores").doc("summit").update({ companyMappingStatus: "PENDING_CONFIRMATION" });

  await assert.rejects(
    provisionDirectorGrant(db, { uid, email: `${uid}@example.test` }),
    /vínculo operacional de summit não está confirmado/,
  );
  assert.equal((await db.collection("organizations").doc("hipermercado-baratao")
    .collection("directors").doc(uid).get()).exists, false);
});
