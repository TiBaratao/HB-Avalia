import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { provisionOrganizationStructure } from "../src/lib/server/organization-structure-core.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
if (!/^(localhost|127\.0\.0\.1):\d+$/.test(emulatorHost) || !projectId.startsWith("demo-")) {
  throw new Error("A concessão de Diretor só pode ser provisionada no emulador Firestore de um projeto demo-.");
}

const uid = process.env.DIRECTOR_UID ?? "";
const email = (process.env.DIRECTOR_EMAIL ?? "").trim().toLowerCase();
if (!/^[^/]{1,128}$/.test(uid) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  throw new Error("Informe DIRECTOR_UID e DIRECTOR_EMAIL válidos para a conta de teste.");
}

const configurationPath = fileURLToPath(new URL("../config/organization-store-mapping.json", import.meta.url));
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const app = initializeApp({ projectId }, "hb-avalia-director-provision");

try {
  const db = getFirestore(app);
  await provisionOrganizationStructure(db, configuration);

  const organizationRef = db.collection("organizations").doc(configuration.organizationId);
  const directorRef = organizationRef.collection("directors").doc(uid);
  const created = await db.runTransaction(async (transaction) => {
    const [organizationSnapshot, directorSnapshot] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(directorRef),
    ]);
    if (!organizationSnapshot.exists
      || organizationSnapshot.get("status") !== "ACTIVE"
      || organizationSnapshot.get("directorRole") !== "DIRECTOR") {
      throw new Error("A organização não está provisionada para acesso de Diretor.");
    }

    if (directorSnapshot.exists) {
      const current = directorSnapshot.data();
      if (current.uid !== uid
        || String(current.email ?? "").trim().toLowerCase() !== email
        || current.role !== "DIRECTOR"
        || current.status !== "ACTIVE") {
        throw new Error("A concessão de Diretor existente diverge; nenhuma alteração foi aplicada.");
      }
      return false;
    }

    transaction.create(directorRef, {
      uid,
      email,
      role: "DIRECTOR",
      status: "ACTIVE",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  console.log(JSON.stringify({
    organizationId: configuration.organizationId,
    grantCreated: created,
    status: "Concessão de teste no emulador concluída.",
    warning: "Este script recusa qualquer conexão que não seja um emulador de projeto demo-.",
  }, null, 2));
} finally {
  await deleteApp(app);
}
