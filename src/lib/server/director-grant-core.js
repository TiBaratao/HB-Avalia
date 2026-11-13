/* eslint-disable @typescript-eslint/no-require-imports */
const { FieldValue } = require("firebase-admin/firestore");

const ORGANIZATION_ID = "hipermercado-baratao";
const STORE_IDS = ["matriz", "loja-2", "summit"];

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function provisionDirectorGrant(db, { uid, email: emailValue }) {
  const email = normalizeEmail(emailValue);
  if (!uid || uid.includes("/") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A identidade autorizada para o grant de Diretor é inválida.");
  }

  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const directorRef = organizationRef.collection("directors").doc(uid);
  const storeRefs = STORE_IDS.map((storeId) => organizationRef.collection("stores").doc(storeId));
  const companyIds = ["hb-avalia", "hb-avalia-loja-2", "hb-avalia-summit"];
  const companyRefs = companyIds.map((companyId) => db.collection("companies").doc(companyId));

  return db.runTransaction(async (transaction) => {
    const [organization, existingGrant, ...related] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(directorRef),
      ...storeRefs.map((ref) => transaction.get(ref)),
      ...companyRefs.map((ref) => transaction.get(ref)),
      transaction.get(organizationRef.collection("directors").where("email", "==", email)),
    ]);
    const storeSnapshots = related.slice(0, storeRefs.length);
    const companySnapshots = related.slice(storeRefs.length, storeRefs.length + companyRefs.length);
    const grantsWithEmail = related.at(-1);

    if (!organization.exists || organization.get("status") !== "ACTIVE"
      || organization.get("directorRole") !== "DIRECTOR") {
      throw new Error("A organização não está ativa para concessão de Diretor.");
    }

    storeSnapshots.forEach((store, index) => {
      if (!store.exists || store.get("organizationId") !== ORGANIZATION_ID
        || store.get("storeId") !== STORE_IDS[index]
        || store.get("companyId") !== companyIds[index]
        || store.get("status") !== "ACTIVE"
        || store.get("companyMappingStatus") !== "CONFIRMED"
        || !companySnapshots[index].exists
        || companySnapshots[index].get("organizationId") !== ORGANIZATION_ID
        || companySnapshots[index].get("storeId") !== STORE_IDS[index]) {
        throw new Error(`O vínculo operacional de ${STORE_IDS[index]} não está confirmado.`);
      }
    });

    if (existingGrant.exists) {
      const current = existingGrant.data();
      if (current.uid !== uid || normalizeEmail(current.email) !== email
        || current.role !== "DIRECTOR" || current.status !== "ACTIVE") {
        throw new Error("O grant de Diretor existente diverge; nenhuma alteração foi aplicada.");
      }
      return { created: false };
    }

    if (grantsWithEmail.size) {
      if (grantsWithEmail.size !== 1) {
        throw new Error("Há grants duplicados para este e-mail; nenhuma alteração foi aplicada.");
      }
      const misplacedGrant = grantsWithEmail.docs[0];
      const current = misplacedGrant.data();
      if (current.uid !== uid || normalizeEmail(current.email) !== email
        || current.role !== "DIRECTOR" || current.status !== "ACTIVE") {
        throw new Error("O e-mail já possui um grant de Diretor para outro UID.");
      }
      transaction.create(directorRef, {
        ...current,
        uid,
        email,
        role: "DIRECTOR",
        status: "ACTIVE",
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(misplacedGrant.ref);
      return { created: true, repairedDocumentPath: true };
    }

    transaction.create(directorRef, {
      uid,
      email,
      role: "DIRECTOR",
      status: "ACTIVE",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { created: true };
  });
}

module.exports = { provisionDirectorGrant };
