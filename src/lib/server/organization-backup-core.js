/* eslint-disable @typescript-eslint/no-require-imports */
const { mkdir, open, readFile, unlink } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { dirname, isAbsolute, relative, resolve, sep } = require("node:path");
const { Timestamp } = require("firebase-admin/firestore");

function serializeFirestoreValue(value) {
  if (value instanceof Timestamp) return { __firestoreType: "timestamp", value: value.toDate().toISOString() };
  if (value instanceof Date) return { __firestoreType: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreType: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (value && typeof value === "object") {
    if (value.constructor?.name === "GeoPoint"
      && typeof value.latitude === "number" && typeof value.longitude === "number") {
      return {
        __firestoreType: "geoPoint",
        latitude: value.latitude,
        longitude: value.longitude,
      };
    }
    if (value.constructor?.name === "DocumentReference" && typeof value.path === "string") {
      return { __firestoreType: "documentReference", path: value.path };
    }
    if (value.constructor?.name === "Bytes" && typeof value.toBase64 === "function") {
      return { __firestoreType: "bytes", value: value.toBase64() };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, serializeFirestoreValue(item)]));
  }
  return value;
}

async function exportDocumentTree(snapshot) {
  const childCollections = await snapshot.ref.listCollections();
  const subcollections = await Promise.all(childCollections.map(async (collection) => {
    const documents = await collection.get();
    return {
      collectionId: collection.id,
      documents: await Promise.all(documents.docs.map(exportDocumentTree)),
    };
  }));
  return {
    path: snapshot.ref.path,
    data: serializeFirestoreValue(snapshot.data()),
    subcollections,
  };
}

function countExportedDocuments(documents) {
  return documents.reduce((total, document) => total + 1
    + document.subcollections.reduce((nestedTotal, collection) =>
      nestedTotal + countExportedDocuments(collection.documents), 0), 0);
}

function assertBackupOutsideWorkspace(path, workspaceRoot) {
  const backupPath = resolve(path);
  const relativePath = relative(resolve(workspaceRoot), backupPath);
  if (!isAbsolute(path) || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && relativePath !== "")) {
    throw new Error("O backup precisa ser um caminho absoluto fora da pasta do repositório.");
  }
  return backupPath;
}

async function writeOrganizationBackup({
  path,
  workspaceRoot,
  projectId,
  organizationSnapshot,
  storeSnapshots,
  companySnapshots,
  existingCompanies,
}) {
  const backupPath = assertBackupOutsideWorkspace(path, workspaceRoot);
  const payload = {
    formatVersion: 1,
    projectId,
    capturedAt: new Date().toISOString(),
    organization: organizationSnapshot.exists
      ? serializeFirestoreValue(organizationSnapshot.data())
      : null,
    stores: await Promise.all(storeSnapshots.map(async (snapshot) => ({
      storeId: snapshot.id,
      path: snapshot.ref.path,
      exists: snapshot.exists,
      data: snapshot.exists ? serializeFirestoreValue(snapshot.data()) : null,
    }))),
    companies: await Promise.all(companySnapshots.map(async (snapshot) => ({
      companyId: snapshot.id,
      path: snapshot.ref.path,
      exists: snapshot.exists,
      documents: snapshot.exists ? [await exportDocumentTree(snapshot)] : [],
    }))),
    existingCompanyIds: existingCompanies,
  };
  const documentCount = payload.companies.reduce((total, company) =>
    total + countExportedDocuments(company.documents), 0);
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const output = JSON.stringify({ ...payload, documentCount, checksum }, null, 2);
  let handle;
  let created = false;
  try {
    await mkdir(dirname(backupPath), { recursive: true });
    handle = await open(backupPath, "wx");
    created = true;
    await handle.writeFile(`${output}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    const writtenBackup = JSON.parse(await readFile(backupPath, "utf8"));
    const writtenDocumentCount = writtenBackup.companies.reduce((total, company) =>
      total + countExportedDocuments(company.documents), 0);
    const { checksum: writtenChecksum, documentCount: writtenCount, ...writtenPayload } = writtenBackup;
    const verifiedChecksum = createHash("sha256").update(JSON.stringify(writtenPayload)).digest("hex");
    if (writtenBackup.formatVersion !== 1 || writtenBackup.projectId !== projectId
      || writtenCount !== documentCount || writtenDocumentCount !== documentCount
      || writtenChecksum !== checksum || verifiedChecksum !== checksum
      || writtenBackup.companies.length !== companySnapshots.length
      || writtenBackup.stores.length !== storeSnapshots.length
      || writtenBackup.companies.some((company, index) =>
        company.exists !== companySnapshots[index].exists
        || company.companyId !== companySnapshots[index].id)
      || writtenBackup.stores.some((store, index) =>
        store.exists !== storeSnapshots[index].exists
        || store.storeId !== storeSnapshots[index].id)) {
      throw new Error("A validação do backup completo falhou.");
    }
    return { backupPath, documentCount };
  } catch (error) {
    if (handle) await handle.close();
    if (created) {
      await unlink(backupPath).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      });
    }
    throw error;
  }
}

module.exports = {
  assertBackupOutsideWorkspace,
  countExportedDocuments,
  exportDocumentTree,
  serializeFirestoreValue,
  writeOrganizationBackup,
};
