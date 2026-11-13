/* eslint-disable @typescript-eslint/no-require-imports */
const { FieldValue } = require("firebase-admin/firestore");

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object") {
    throw new Error("A configuração da organização é inválida.");
  }
  const { organizationId, organizationName, directorRole, schemaVersion, stores } = configuration;
  if (typeof organizationId !== "string" || !ID_PATTERN.test(organizationId)
    || typeof organizationName !== "string" || !organizationName.trim()
    || directorRole !== "DIRECTOR" || !Number.isInteger(schemaVersion) || schemaVersion < 1
    || !Array.isArray(stores) || stores.length !== 3) {
    throw new Error("A configuração precisa definir a organização e exatamente três lojas válidas.");
  }

  const storeIds = new Set();
  const companyIds = new Set();
  for (const store of stores) {
    if (!store || typeof store !== "object"
      || typeof store.storeId !== "string" || !ID_PATTERN.test(store.storeId)
      || typeof store.companyId !== "string" || !ID_PATTERN.test(store.companyId)
      || typeof store.name !== "string" || !store.name.trim()
      || store.mappingStatus !== "PENDING_CONFIRMATION") {
      throw new Error("Cada loja precisa ter identificadores estáveis e mapeamento pendente de confirmação.");
    }
    if (storeIds.has(store.storeId) || companyIds.has(store.companyId)) {
      throw new Error("Os identificadores de lojas e empresas devem ser únicos.");
    }
    storeIds.add(store.storeId);
    companyIds.add(store.companyId);
  }
}

function getConfirmedCompanyMappings(configuration, applyConfirmedCompanyMappings) {
  if (!applyConfirmedCompanyMappings) return new Map();
  const confirmation = configuration.companyInventory?.ownerMappingConfirmation;
  const migration = configuration.migrationMapping;
  const isPlanning = migration?.status === "OWNER_CONFIRMED_PLANNING_ONLY"
    && migration.appliedToFirestore === false
    && confirmation?.appliedToFirestore === false;
  const isApplied = migration?.status === "OWNER_CONFIRMED_APPLIED"
    && migration.appliedToFirestore === true
    && confirmation?.appliedToFirestore === true;
  if (confirmation?.status !== "CONFIRMED"
    || confirmation.source !== "EXPLICIT_CONFIRMATION_FROM_SYSTEM_OWNER"
    || migration?.source !== confirmation.source
    || (!isPlanning && !isApplied)
    || !Array.isArray(migration.storeAssignments)) {
    throw new Error("A confirmação explícita do responsável não autoriza este mapeamento.");
  }

  const confirmedMappings = new Map();
  for (const assignment of migration.storeAssignments) {
    if (assignment?.companyIdAction !== "KEEP_AS_OPERATIONAL_COMPANY_ID") continue;
    const store = configuration.stores.find((item) => item.storeId === assignment.storeId);
    if (!store || store.companyId !== assignment.companyId
      || store.companyId !== assignment.existingCompanyId
      || store.mappingStatus !== "PENDING_CONFIRMATION") {
      throw new Error(`O mapeamento confirmado para ${assignment?.storeId ?? "a loja"} diverge da estrutura.`);
    }
    confirmedMappings.set(store.storeId, store);
  }
  if (confirmedMappings.size !== 1 || !confirmedMappings.has("matriz")) {
    throw new Error("A aplicação de mapeamento confirmado deve apontar somente a empresa legada da Matriz.");
  }
  return confirmedMappings;
}

async function inspectExistingCompanies(db) {
  const snapshot = await db.collection("companies").select("organizationId", "storeId").get();
  return snapshot.docs.map((document) => ({
    companyId: document.id,
    organizationId: document.get("organizationId") ?? null,
    storeId: document.get("storeId") ?? null,
  }));
}

async function provisionOrganizationStructure(
  db,
  configuration,
  { applyConfirmedCompanyMappings = false, provisionNewStores = false } = {},
) {
  validateConfiguration(configuration);
  const confirmedMappings = getConfirmedCompanyMappings(configuration, applyConfirmedCompanyMappings);
  const provisionedStores = new Set(
    provisionNewStores ? configuration.stores.filter(({ storeId }) => storeId !== "matriz").map(({ storeId }) => storeId) : [],
  );
  const existingCompanies = await inspectExistingCompanies(db);
  const companiesById = new Map(existingCompanies.map((company) => [company.companyId, company]));
  const stores = configuration.stores;

  for (const store of stores) {
    const company = companiesById.get(store.companyId);
    const isConfirmedLegacyMapping = confirmedMappings.has(store.storeId);
    if (company && (company.organizationId !== configuration.organizationId || company.storeId !== store.storeId)
      && !(isConfirmedLegacyMapping && company.organizationId == null && company.storeId == null)) {
      throw new Error(`O companyId proposto para ${store.name} já existe e não será associado automaticamente.`);
    }
    if (isConfirmedLegacyMapping && !company) {
      throw new Error(`A empresa legada confirmada para ${store.name} não existe; nenhum mapeamento foi aplicado.`);
    }
  }

  const organizationRef = db.collection("organizations").doc(configuration.organizationId);
  const storeRefs = stores.map((store) =>
    organizationRef.collection("stores").doc(store.storeId),
  );
  const companyRefs = stores.map((store) =>
    db.collection("companies").doc(store.companyId),
  );

  return db.runTransaction(async (transaction) => {
    const [organizationSnapshot, ...relatedSnapshots] = await Promise.all([
      transaction.get(organizationRef),
      ...storeRefs.map((storeRef) => transaction.get(storeRef)),
      ...companyRefs.map((companyRef) => transaction.get(companyRef)),
    ]);
    const storeSnapshots = relatedSnapshots.slice(0, storeRefs.length);
    const companySnapshots = relatedSnapshots.slice(storeRefs.length);

    if (organizationSnapshot.exists) {
      const current = organizationSnapshot.data();
      if (current.name !== configuration.organizationName
        || current.directorRole !== configuration.directorRole
        || current.schemaVersion !== configuration.schemaVersion) {
        throw new Error("A organização existente diverge da configuração; nenhuma alteração foi aplicada.");
      }
    }

    storeSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const store = stores[index];
      const current = snapshot.data();
      if (current.organizationId !== configuration.organizationId
        || current.storeId !== store.storeId
        || current.name !== store.name
        || current.companyId !== store.companyId
        || (current.companyMappingStatus !== store.mappingStatus
          && !((confirmedMappings.has(store.storeId) || provisionedStores.has(store.storeId))
            && current.companyMappingStatus === "CONFIRMED"))) {
        throw new Error(`A loja ${store.storeId} já existe com dados divergentes; nenhuma alteração foi aplicada.`);
      }
    });

    companySnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const store = stores[index];
      const alreadyLinked = snapshot.get("organizationId") === configuration.organizationId
        && snapshot.get("storeId") === store.storeId;
      const unlinkedLegacy = snapshot.get("organizationId") == null && snapshot.get("storeId") == null
        && confirmedMappings.has(store.storeId);
      if (!alreadyLinked && !unlinkedLegacy) {
        throw new Error(`O companyId proposto para ${store.name} já existe e não será associado automaticamente.`);
      }
    });

    const createdOrganization = !organizationSnapshot.exists;
    if (createdOrganization) {
      transaction.create(organizationRef, {
        name: configuration.organizationName,
        status: "ACTIVE",
        schemaVersion: configuration.schemaVersion,
        directorRole: configuration.directorRole,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const createdStores = [];
    storeSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists) return;
      const store = stores[index];
      const isConfirmedMapping = confirmedMappings.has(store.storeId) || provisionedStores.has(store.storeId);
      transaction.create(storeRefs[index], {
        organizationId: configuration.organizationId,
        storeId: store.storeId,
        name: store.name,
        companyId: store.companyId,
        status: "ACTIVE",
        companyMappingStatus: isConfirmedMapping ? "CONFIRMED" : store.mappingStatus,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createdStores.push(store.storeId);
    });
    storeSnapshots.forEach((snapshot, index) => {
      const store = stores[index];
      if (!snapshot.exists || (!confirmedMappings.has(store.storeId) && !provisionedStores.has(store.storeId))
        || snapshot.get("companyMappingStatus") === "CONFIRMED") return;
      transaction.update(storeRefs[index], {
        companyMappingStatus: "CONFIRMED",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    companySnapshots.forEach((snapshot, index) => {
      const store = stores[index];
      if (!confirmedMappings.has(store.storeId)
        || (snapshot.get("organizationId") === configuration.organizationId
          && snapshot.get("storeId") === store.storeId)) return;
      transaction.update(companyRefs[index], {
        organizationId: configuration.organizationId,
        storeId: store.storeId,
      });
    });
    companySnapshots.forEach((snapshot, index) => {
      const store = stores[index];
      if (!provisionedStores.has(store.storeId) || snapshot.exists) return;
      transaction.create(companyRefs[index], {
        name: store.name,
        organizationId: configuration.organizationId,
        storeId: store.storeId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      organizationId: configuration.organizationId,
      createdOrganization,
      createdStores,
      confirmedCompanyMappings: [...confirmedMappings.values()].map(({ storeId, companyId }) => ({
        storeId,
        companyId,
        applied: true,
      })),
      existingCompanyIds: existingCompanies.map((company) => company.companyId),
      pendingStoreMappings: stores
        .filter((store) => store.mappingStatus === "PENDING_CONFIRMATION"
          && !confirmedMappings.has(store.storeId)
          && !provisionedStores.has(store.storeId))
        .map((store) => ({
          storeId: store.storeId,
          companyId: store.companyId,
          existingCompanyId: null,
        })),
    };
  });
}

module.exports = {
  inspectExistingCompanies,
  provisionOrganizationStructure,
  validateConfiguration,
};
