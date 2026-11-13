import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
assert.match(emulatorHost, /^(localhost|127\.0\.0\.1):\d+$/, "Tests require the local Firestore emulator.");
assert.ok(projectId.startsWith("demo-"), "Tests refuse to run outside a demo Firebase project.");

let app;
let db;
let provisionOrganizationStructure;
let baseConfiguration;

before(async () => {
  const [{ initializeApp }, { getFirestore }, core, manifest] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/firestore"),
    import("../src/lib/server/organization-structure-core.js"),
    readFile(new URL("../config/organization-store-mapping.json", import.meta.url), "utf8"),
  ]);
  app = initializeApp({ projectId }, "organization-structure-test");
  db = getFirestore(app);
  provisionOrganizationStructure = core.provisionOrganizationStructure;
  baseConfiguration = JSON.parse(manifest);
});

function createTestConfiguration() {
  const suffix = randomUUID().slice(0, 8);
  return {
    ...baseConfiguration,
    organizationId: `${baseConfiguration.organizationId}-${suffix}`,
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      storeId: `${store.storeId}-${suffix}`,
      companyId: `${store.companyId}-${suffix}`,
    })),
  };
}

after(async () => {
  const { deleteApp } = await import("firebase-admin/app");
  if (app) await deleteApp(app);
});

test("provisions the organization and three independent stores idempotently without migrating existing companies", async () => {
  const configuration = createTestConfiguration();
  const legacyCompanyId = `legacy-${randomUUID()}`;
  await db.collection("companies").doc(legacyCompanyId).set({ name: "Empresa existente" });

  const first = await provisionOrganizationStructure(db, configuration);
  const second = await provisionOrganizationStructure(db, configuration);

  assert.equal(first.createdOrganization, true);
  assert.equal(first.createdStores.length, 3);
  assert.deepEqual(second.createdStores, []);
  assert.equal(second.createdOrganization, false);
  assert.ok(first.existingCompanyIds.includes(legacyCompanyId));
  assert.equal((await db.collection("companies").doc(legacyCompanyId).get()).get("organizationId"), undefined);

  const organization = await db.collection("organizations").doc(configuration.organizationId).get();
  assert.equal(organization.get("name"), "Hipermercado Baratão");
  assert.equal(organization.get("directorRole"), "DIRECTOR");

  const stores = await db.collection("organizations").doc(configuration.organizationId).collection("stores").get();
  assert.equal(stores.size, 3);
  for (const store of configuration.stores) {
    const registered = await db.collection("organizations").doc(configuration.organizationId)
      .collection("stores").doc(store.storeId).get();
    assert.equal(registered.get("companyId"), store.companyId);
    assert.equal(registered.get("companyMappingStatus"), "PENDING_CONFIRMATION");
    assert.equal((await db.collection("companies").doc(store.companyId).get()).exists, false);
  }
});

test("rejects a proposed companyId collision without writing the organization", async () => {
  const configuration = createTestConfiguration();
  const collisionConfiguration = {
    ...configuration,
    organizationId: `${configuration.organizationId}-collision`,
    stores: configuration.stores.map((store) => ({ ...store })),
  };
  await db.collection("companies").doc(collisionConfiguration.stores[0].companyId)
    .set({ name: "Não associar automaticamente" });

  await assert.rejects(
    provisionOrganizationStructure(db, collisionConfiguration),
    /já existe e não será associado automaticamente/,
  );
  assert.equal((await db.collection("organizations").doc(collisionConfiguration.organizationId).get()).exists, false);
});

test("confirmed Matrix mapping preserves the existing company and documents without moving operational data", async () => {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `legacy-matriz-${suffix}`;
  const configuration = {
    ...baseConfiguration,
    organizationId: `${baseConfiguration.organizationId}-${suffix}`,
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      companyId: store.storeId === "matriz" ? companyId : `${store.companyId}-${suffix}`,
    })),
    migrationMapping: {
      ...baseConfiguration.migrationMapping,
      storeAssignments: baseConfiguration.migrationMapping.storeAssignments.map((assignment) =>
        assignment.storeId === "matriz"
          ? { ...assignment, companyId, existingCompanyId: companyId }
          : { ...assignment, companyId: `${assignment.companyId}-${suffix}` }),
    },
  };
  const companyRef = db.collection("companies").doc(companyId);
  const profileRef = db.collection("userProfiles").doc(`matrix-user-${suffix}`);
  const evaluationRef = companyRef.collection("evaluations").doc("historic-evaluation");
  await Promise.all([
    companyRef.set({ name: "Empresa legada de teste", customSetting: "keep" }),
    profileRef.set({ companyId, customProfileField: true }),
    companyRef.collection("members").doc("matrix-user").set({
      uid: "matrix-user",
      role: "EMPLOYEE",
      status: "ACTIVE",
      teamIds: ["team-1"],
    }),
    evaluationRef.set({ evaluatedUserId: "matrix-user", status: "SUBMITTED" }),
    evaluationRef.collection("answers").doc("answer-1").set({ criterionId: "quality", score: 5 }),
    companyRef.collection("developmentPlans").doc("historic-plan").set({ employeeId: "matrix-user" }),
  ]);
  const first = await provisionOrganizationStructure(db, configuration, {
    applyConfirmedCompanyMappings: true,
  });
  const second = await provisionOrganizationStructure(db, configuration, {
    applyConfirmedCompanyMappings: true,
  });

  assert.equal(first.createdOrganization, true);
  assert.deepEqual(first.confirmedCompanyMappings, [{ storeId: "matriz", companyId, applied: true }]);
  assert.equal(first.pendingStoreMappings.length, 2);
  assert.equal(second.createdOrganization, false);
  assert.deepEqual(second.createdStores, []);
  assert.equal((await db.collection("organizations").doc(configuration.organizationId)
    .collection("stores").doc("matriz").get()).get("companyMappingStatus"), "CONFIRMED");

  const migratedCompany = await companyRef.get();
  assert.equal(migratedCompany.get("organizationId"), configuration.organizationId);
  assert.equal(migratedCompany.get("storeId"), "matriz");
  assert.equal(migratedCompany.get("customSetting"), "keep");
  assert.equal((await profileRef.get()).get("customProfileField"), true);
  assert.equal((await companyRef.collection("members").doc("matrix-user").get()).get("status"), "ACTIVE");
  assert.equal((await evaluationRef.get()).get("status"), "SUBMITTED");
  assert.equal((await evaluationRef.collection("answers").doc("answer-1").get()).get("score"), 5);
  assert.equal((await companyRef.collection("developmentPlans").doc("historic-plan").get()).exists, true);
  assert.equal((await db.collection("companies").doc(configuration.stores[0].companyId).get()).exists, true);
});

test("provisions confirmed independent store companies idempotently without creating users", async () => {
  const suffix = randomUUID().slice(0, 8);
  const configurationCompanyId = (storeId) => `hb-avalia-${storeId}-${suffix}`;
  const configuration = {
    ...baseConfiguration,
    migrationMapping: {
      ...baseConfiguration.migrationMapping,
      storeAssignments: baseConfiguration.migrationMapping.storeAssignments.map((assignment) => ({
        ...assignment,
        companyId: configurationCompanyId(assignment.storeId),
        existingCompanyId: assignment.storeId === "matriz"
          ? configurationCompanyId("matriz")
          : assignment.existingCompanyId,
      })),
    },
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      companyId: configurationCompanyId(store.storeId),
    })),
  };
  const matrixCompany = db.collection("companies").doc(configurationCompanyId("matriz"));
  await matrixCompany.set({ name: "Empresa existente da Matriz", ownerUid: "existing-owner" });

  const first = await provisionOrganizationStructure(db, configuration, {
    applyConfirmedCompanyMappings: true,
    provisionNewStores: true,
  });
  const second = await provisionOrganizationStructure(db, configuration, {
    applyConfirmedCompanyMappings: true,
    provisionNewStores: true,
  });

  assert.equal(first.createdOrganization, true);
  assert.deepEqual(first.createdStores, ["matriz", "loja-2", "summit"]);
  assert.deepEqual(first.pendingStoreMappings, []);
  assert.equal(second.createdOrganization, false);
  assert.deepEqual(second.createdStores, []);
  assert.deepEqual(second.confirmedCompanyMappings, [{
    storeId: "matriz",
    companyId: configurationCompanyId("matriz"),
    applied: true,
  }]);
  for (const store of configuration.stores) {
    const company = await db.collection("companies").doc(store.companyId).get();
    const registeredStore = await db.collection("organizations").doc(configuration.organizationId)
      .collection("stores").doc(store.storeId).get();
    assert.equal(company.get("organizationId"), configuration.organizationId);
    assert.equal(company.get("storeId"), store.storeId);
    assert.equal(company.get("name"), store.name === "Matriz" ? "Empresa existente da Matriz" : store.name);
    assert.equal(registeredStore.get("companyMappingStatus"), "CONFIRMED");
    assert.equal((await company.ref.collection("members").get()).size, 0);
  }
  assert.equal((await matrixCompany.get()).get("ownerUid"), "existing-owner");
});

test("owner confirmation alone does not apply the Matrix mapping without explicit migration option", async () => {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `legacy-matriz-${suffix}`;
  const configuration = {
    ...baseConfiguration,
    organizationId: `${baseConfiguration.organizationId}-${suffix}`,
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      companyId: store.storeId === "matriz" ? companyId : `${store.companyId}-${suffix}`,
    })),
    migrationMapping: {
      ...baseConfiguration.migrationMapping,
      storeAssignments: baseConfiguration.migrationMapping.storeAssignments.map((assignment) =>
        assignment.storeId === "matriz"
          ? { ...assignment, companyId, existingCompanyId: companyId }
          : { ...assignment, companyId: `${assignment.companyId}-${suffix}` }),
    },
  };
  await db.collection("companies").doc(companyId).set({ name: "Legado não vinculado" });

  await assert.rejects(
    provisionOrganizationStructure(db, configuration),
    /já existe e não será associado automaticamente/,
  );
  assert.equal((await db.collection("companies").doc(companyId).get()).get("organizationId"), undefined);
  assert.equal((await db.collection("organizations").doc(configuration.organizationId).get()).exists, false);
});

test("applied owner-confirmed manifest remains safe for idempotent provisioning", async () => {
  const suffix = randomUUID().slice(0, 8);
  const testConfiguration = {
    ...baseConfiguration,
    organizationId: `${baseConfiguration.organizationId}-${suffix}`,
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      companyId: `${store.companyId}-${suffix}`,
    })),
  };
  const matrixCompanyId = testConfiguration.stores[0].companyId;
  const configuration = {
    ...testConfiguration,
    migrationMapping: {
      ...testConfiguration.migrationMapping,
      storeAssignments: testConfiguration.migrationMapping.storeAssignments.map((assignment, index) =>
        assignment.storeId === "matriz"
          ? { ...assignment, companyId: matrixCompanyId, existingCompanyId: matrixCompanyId }
          : { ...assignment, companyId: testConfiguration.stores[index].companyId }),
    },
  };
  await db.collection("companies").doc(configuration.stores[0].companyId).set({
    name: "Empresa existente da Matriz",
  });
  const first = await provisionOrganizationStructure(db, configuration, {
    applyConfirmedCompanyMappings: true,
    provisionNewStores: true,
  });
  const appliedConfiguration = {
    ...configuration,
    companyInventory: {
      ...configuration.companyInventory,
      ownerMappingConfirmation: {
        ...configuration.companyInventory.ownerMappingConfirmation,
        appliedToFirestore: true,
      },
    },
    migrationMapping: {
      ...configuration.migrationMapping,
      status: "OWNER_CONFIRMED_APPLIED",
      appliedToFirestore: true,
    },
  };
  const second = await provisionOrganizationStructure(db, appliedConfiguration, {
    applyConfirmedCompanyMappings: true,
    provisionNewStores: true,
  });

  assert.equal(first.createdOrganization, true);
  assert.deepEqual(second.createdStores, []);
  assert.equal(second.createdOrganization, false);
  assert.deepEqual(second.confirmedCompanyMappings, [{
    storeId: "matriz",
    companyId: configuration.stores[0].companyId,
    applied: true,
  }]);
});

test("confirmed Matrix mapping refuses an existing company linked to a different store", async () => {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `legacy-matriz-${suffix}`;
  const configuration = {
    ...baseConfiguration,
    organizationId: `${baseConfiguration.organizationId}-${suffix}`,
    stores: baseConfiguration.stores.map((store) => ({
      ...store,
      companyId: store.storeId === "matriz" ? companyId : `${store.companyId}-${suffix}`,
    })),
    migrationMapping: {
      ...baseConfiguration.migrationMapping,
      storeAssignments: baseConfiguration.migrationMapping.storeAssignments.map((assignment) =>
        assignment.storeId === "matriz"
          ? { ...assignment, companyId, existingCompanyId: companyId }
          : { ...assignment, companyId: `${assignment.companyId}-${suffix}` }),
    },
  };
  await db.collection("companies").doc(companyId).set({
    name: "Empresa já vinculada",
    organizationId: "outra-organizacao",
    storeId: "summit",
  });

  await assert.rejects(
    provisionOrganizationStructure(db, configuration, { applyConfirmedCompanyMappings: true }),
    /já existe e não será associado automaticamente/,
  );
  assert.equal((await db.collection("companies").doc(companyId).get()).get("storeId"), "summit");
  assert.equal((await db.collection("organizations").doc(configuration.organizationId).get()).exists, false);
});

test("rejects divergent existing organization and store identities", async () => {
  const configuration = createTestConfiguration();
  const divergentConfiguration = {
    ...configuration,
    organizationId: `${configuration.organizationId}-divergent`,
  };
  const organizationRef = db.collection("organizations").doc(divergentConfiguration.organizationId);
  await organizationRef.set({
    name: "Outra organização",
    status: "ACTIVE",
    schemaVersion: divergentConfiguration.schemaVersion,
    directorRole: "DIRECTOR",
  });

  await assert.rejects(
    provisionOrganizationStructure(db, divergentConfiguration),
    /diverge da configuração/,
  );
  assert.equal((await organizationRef.collection("stores").get()).size, 0);
});
