import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { inspectExistingCompanies, provisionOrganizationStructure } from "../src/lib/server/organization-structure-core.js";
import { writeOrganizationBackup } from "../src/lib/server/organization-backup-core.js";
import nextEnv from "@next/env";

const EXPECTED_PROJECT_ID = "hb-avalia2";
const { loadEnvConfig } = nextEnv;
const configurationPath = fileURLToPath(new URL("../config/organization-store-mapping.json", import.meta.url));

function parseArguments(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--inspect" || argument === "--apply"
      || argument === "--apply-confirmed-mappings" || argument === "--provision-new-stores") {
      options.set(argument, true);
      continue;
    }
    if (argument === "--project" || argument === "--backup-path") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} exige um valor.`);
      options.set(argument, value);
      index += 1;
      continue;
    }
    throw new Error(`Opção desconhecida: ${argument}`);
  }
  return options;
}

function requireProductionConfiguration(configuration) {
  const expectedStores = new Map([
    ["matriz", { name: "Matriz", companyId: "hb-avalia" }],
    ["loja-2", { name: "Loja 2", companyId: "hb-avalia-loja-2" }],
    ["summit", { name: "Summit", companyId: "hb-avalia-summit" }],
  ]);
  if (configuration.organizationId !== "hipermercado-baratao"
    || configuration.organizationName !== "Hipermercado Baratão"
    || configuration.stores.length !== expectedStores.size
    || configuration.stores.some((store) => {
      const expected = expectedStores.get(store.storeId);
      return !expected || store.name !== expected.name || store.companyId !== expected.companyId;
    })) {
    throw new Error("A configuração não corresponde exatamente à organização e às três lojas autorizadas.");
  }
  const matrixMapping = configuration.migrationMapping?.storeAssignments?.find(({ storeId }) => storeId === "matriz");
  if (configuration.companyInventory?.ownerMappingConfirmation?.status !== "CONFIRMED"
    || configuration.companyInventory.ownerMappingConfirmation.source !== "EXPLICIT_CONFIRMATION_FROM_SYSTEM_OWNER"
    || matrixMapping?.companyIdAction !== "KEEP_AS_OPERATIONAL_COMPANY_ID"
    || matrixMapping.companyId !== "hb-avalia"
    || matrixMapping.existingCompanyId !== "hb-avalia") {
    throw new Error("O vínculo confirmado de hb-avalia à Matriz não está validado no manifesto.");
  }
}

async function collectionCounts(documentReference) {
  const collections = await documentReference.listCollections();
  const counts = {};
  for (const collection of collections) {
    counts[collection.id] = (await collection.get()).size;
  }
  return counts;
}

async function inspectProduction(db, configuration) {
  const existingCompanies = await inspectExistingCompanies(db);
  const companiesById = new Map(existingCompanies.map((company) => [company.companyId, company]));
  const organizationRef = db.collection("organizations").doc(configuration.organizationId);
  const organizationSnapshot = await organizationRef.get();
  const [storeSnapshots, directorSnapshot] = await Promise.all([
    Promise.all(configuration.stores.map((store) =>
      organizationRef.collection("stores").doc(store.storeId).get())),
    organizationRef.collection("directors").get(),
  ]);
  const companySnapshots = await Promise.all(configuration.stores.map((store) =>
    db.collection("companies").doc(store.companyId).get()));
  const companyCollectionCounts = await Promise.all(configuration.stores.map(async (store, index) => ({
    storeId: store.storeId,
    companyId: store.companyId,
    counts: await collectionCounts(db.collection("companies").doc(store.companyId)),
    exists: companySnapshots[index].exists,
    name: companySnapshots[index].get("name") ?? null,
    organizationId: companiesById.get(store.companyId)?.organizationId ?? null,
    linkedStoreId: companiesById.get(store.companyId)?.storeId ?? null,
  })));

  const result = {
    projectId: EXPECTED_PROJECT_ID,
    organization: {
      exists: organizationSnapshot.exists,
      name: organizationSnapshot.get("name") ?? null,
      status: organizationSnapshot.get("status") ?? null,
      directorGrants: directorSnapshot.size,
    },
    stores: configuration.stores.map((store, index) => ({
      ...store,
      exists: storeSnapshots[index].exists,
      companyMappingStatus: storeSnapshots[index].get("companyMappingStatus") ?? null,
      linkedCompanyId: storeSnapshots[index].get("companyId") ?? null,
    })),
    companies: companyCollectionCounts,
    existingCompanyIds: existingCompanies.map(({ companyId }) => companyId).sort(),
  };
  return { result, organizationRef, organizationSnapshot, storeSnapshots, companySnapshots, existingCompanies };
}

async function assertSafeToProvision(db, configuration, inspection) {
  const matrix = inspection.result.companies.find(({ storeId }) => storeId === "matriz");
  if (!matrix?.exists) throw new Error("A empresa Matriz hb-avalia não existe; execução interrompida.");
  for (const company of inspection.result.companies.filter(({ storeId }) => storeId !== "matriz")) {
    const existingCompany = inspection.existingCompanies.find(({ companyId }) => companyId === company.companyId);
    if (existingCompany && (existingCompany.organizationId !== configuration.organizationId
      || existingCompany.storeId !== company.storeId)) {
      throw new Error(`A empresa ${company.companyId} existe sem vínculo confirmado; execução interrompida.`);
    }
    const store = inspection.result.stores.find(({ storeId }) => storeId === company.storeId);
    const alreadyProvisioned = company.exists
      && company.name === store.name
      && store.exists
      && store.companyMappingStatus === "CONFIRMED"
      && store.linkedCompanyId === company.companyId;
    if (company.exists && !alreadyProvisioned && Object.values(company.counts).some((count) => count > 0)) {
      throw new Error(`A empresa ${company.companyId} já contém registros; execução interrompida para evitar associação inadvertida.`);
    }
  }
}

await loadEnvConfig(process.cwd());
const options = parseArguments(process.argv.slice(2));
if (options.get("--project") !== EXPECTED_PROJECT_ID) {
  throw new Error(`Informe --project ${EXPECTED_PROJECT_ID}; nenhum outro projeto é permitido.`);
}
if (Boolean(options.get("--inspect")) === Boolean(options.get("--apply"))) {
  throw new Error("Escolha exatamente uma opção: --inspect ou --apply.");
}
if (options.get("--apply")
  && (!options.get("--apply-confirmed-mappings")
    || !options.get("--provision-new-stores")
    || typeof options.get("--backup-path") !== "string")) {
  throw new Error("--apply exige --apply-confirmed-mappings, --provision-new-stores e --backup-path.");
}
if (options.get("--inspect")
  && (options.get("--apply-confirmed-mappings") || options.get("--provision-new-stores") || options.has("--backup-path"))) {
  throw new Error("O modo --inspect é somente leitura e não aceita opções de aplicação ou backup.");
}

const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
requireProductionConfiguration(configuration);
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não está configurada localmente.");
const serviceAccount = JSON.parse(serviceAccountJson);
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (projectId !== EXPECTED_PROJECT_ID || serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  throw new Error("As credenciais e FIREBASE_PROJECT_ID devem corresponder exatamente a hb-avalia2.");
}

const app = initializeApp({ credential: cert(serviceAccount), projectId }, "hb-avalia-production-provision");
try {
  const db = getFirestore(app);
  const inspection = await inspectProduction(db, configuration);
  await assertSafeToProvision(db, configuration, inspection);
  console.log(JSON.stringify(inspection.result, null, 2));
  if (options.get("--inspect")) {
    console.log("Inspeção concluída em modo somente leitura; nenhuma escrita foi realizada.");
  } else {
    const backup = await writeOrganizationBackup({
      path: options.get("--backup-path"),
      workspaceRoot: process.cwd(),
      projectId: EXPECTED_PROJECT_ID,
      organizationSnapshot: inspection.organizationSnapshot,
      storeSnapshots: inspection.storeSnapshots,
      companySnapshots: inspection.companySnapshots,
      existingCompanies: inspection.existingCompanies,
    });
    const provisioned = await provisionOrganizationStructure(db, configuration, {
      applyConfirmedCompanyMappings: true,
      provisionNewStores: true,
    });
    const verified = await inspectProduction(db, configuration);
    await assertSafeToProvision(db, configuration, verified);
    const statusesValid = verified.result.stores.every((store) =>
      store.exists
      && store.companyMappingStatus === "CONFIRMED"
      && store.linkedCompanyId === store.companyId);
    const companyLinksValid = verified.result.companies.every((company) =>
      company.exists && company.organizationId === configuration.organizationId
      && company.linkedStoreId === company.storeId);
    if (!verified.result.organization.exists || !statusesValid || !companyLinksValid) {
      throw new Error("A verificação posterior ao provisionamento falhou; conferir backup e estado Firestore.");
    }
    console.log(JSON.stringify({
      status: "Provisionamento concluído e verificado.",
      backupPath: backup.backupPath,
      backupDocumentCount: backup.documentCount,
      createdOrganization: provisioned.createdOrganization,
      createdStores: provisioned.createdStores,
      confirmedCompanyMappings: provisioned.confirmedCompanyMappings,
      verifiedStores: verified.result.stores.map(({ storeId, companyId, companyMappingStatus }) => ({
        storeId, companyId, companyMappingStatus,
      })),
      directorGrants: verified.result.organization.directorGrants,
    }, null, 2));
  }
} finally {
  await deleteApp(app);
}
