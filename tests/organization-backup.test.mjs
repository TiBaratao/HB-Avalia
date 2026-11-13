import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  assertBackupOutsideWorkspace,
  countExportedDocuments,
  exportDocumentTree,
  writeOrganizationBackup,
} from "../src/lib/server/organization-backup-core.js";

function createSnapshot(path, data, collections = []) {
  const id = path.split("/").at(-1);
  return {
    id,
    exists: true,
    data: () => data,
    ref: {
      path,
      listCollections: async () => collections.map(({ id: collectionId, documents }) => ({
        id: collectionId,
        get: async () => ({ docs: documents }),
      })),
    },
  };
}

test("exports full nested Firestore document trees and counts all documents", async () => {
  const nestedAnswer = createSnapshot("companies/matriz/evaluations/eval-1/answers/answer-1", {
    score: 5,
  });
  const evaluation = createSnapshot("companies/matriz/evaluations/eval-1", {
    createdAt: Timestamp.fromDate(new Date("2024-01-02T03:04:05.000Z")),
  }, [{ id: "answers", documents: [nestedAnswer] }]);
  const company = createSnapshot("companies/matriz", { name: "Matriz" }, [
    { id: "evaluations", documents: [evaluation] },
  ]);

  const exported = await exportDocumentTree(company);
  assert.equal(countExportedDocuments([exported]), 3);
  assert.deepEqual(exported.subcollections[0].documents[0].data.createdAt, {
    __firestoreType: "timestamp",
    value: "2024-01-02T03:04:05.000Z",
  });
  assert.equal(
    exported.subcollections[0].documents[0].subcollections[0].documents[0].path,
    "companies/matriz/evaluations/eval-1/answers/answer-1",
  );
});

test("writes and verifies a checksummed complete backup outside the workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hb-avalia-backup-"));
  const backupPath = join(directory, "organization-backup.json");
  const company = createSnapshot("companies/matriz", { name: "Matriz" }, [
    { id: "members", documents: [createSnapshot("companies/matriz/members/u1", { role: "EMPLOYEE" })] },
  ]);

  try {
    const result = await writeOrganizationBackup({
      path: backupPath,
      workspaceRoot: process.cwd(),
      projectId: "hb-avalia2",
      organizationSnapshot: { exists: false, data: () => undefined },
      storeSnapshots: [{ ...createSnapshot("organizations/org/stores/matriz", { name: "Matriz" }) }],
      companySnapshots: [company],
      existingCompanies: ["matriz"],
    });
    const backup = JSON.parse(await readFile(backupPath, "utf8"));

    assert.equal(result.documentCount, 2);
    assert.equal(backup.documentCount, 2);
    assert.match(backup.checksum, /^[a-f0-9]{64}$/);
    assert.equal(backup.companies[0].documents[0].subcollections[0].documents.length, 1);
    assert.equal(backup.projectId, "hb-avalia2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects workspace backup paths and never removes an existing backup", async () => {
  const workspace = resolve(process.cwd());
  assert.throws(
    () => assertBackupOutsideWorkspace(join(workspace, "backup.json"), workspace),
    /fora da pasta do repositório/,
  );

  const directory = await mkdtemp(join(tmpdir(), "hb-avalia-backup-"));
  const backupPath = join(directory, "existing-backup.json");
  const existingContents = "{\"preserve\":true}";
  await writeFile(backupPath, existingContents, "utf8");
  try {
    await assert.rejects(writeOrganizationBackup({
      path: backupPath,
      workspaceRoot: workspace,
      projectId: "hb-avalia2",
      organizationSnapshot: { exists: false, data: () => undefined },
      storeSnapshots: [],
      companySnapshots: [],
      existingCompanies: [],
    }), { code: "EEXIST" });
    assert.equal(await readFile(backupPath, "utf8"), existingContents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
