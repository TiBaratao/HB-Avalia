/* eslint-disable @typescript-eslint/no-require-imports */
const { FieldValue } = require("firebase-admin/firestore");

const ORGANIZATION_ID = "hipermercado-baratao";
const COMPANY_ID = "hb-avalia";
const STORE_ID = "matriz";
const INITIAL_POSITION = "Atendente de Açougue Junior";

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function provisionMatrixAdmin(db, { uid, email: emailValue, name }) {
  const email = normalizeEmail(emailValue);
  const displayName = typeof name === "string" ? name.trim().slice(0, 100) : "";
  if (!uid || uid.includes("/") || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A identidade autorizada da conta é inválida.");
  }

  const companyRef = db.collection("companies").doc(COMPANY_ID);
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const storeRef = organizationRef.collection("stores").doc(STORE_ID);
  const memberRef = companyRef.collection("members").doc(uid);
  const profileRef = db.collection("userProfiles").doc(uid);

  return db.runTransaction(async (transaction) => {
    const [company, organization, store, member, profile] = await Promise.all([
      transaction.get(companyRef),
      transaction.get(organizationRef),
      transaction.get(storeRef),
      transaction.get(memberRef),
      transaction.get(profileRef),
    ]);

    if (!company.exists || company.get("organizationId") !== ORGANIZATION_ID
      || company.get("storeId") !== STORE_ID
      || !organization.exists || organization.get("status") !== "ACTIVE"
      || organization.get("directorRole") !== "DIRECTOR"
      || !store.exists || store.get("organizationId") !== ORGANIZATION_ID
      || store.get("storeId") !== STORE_ID || store.get("companyId") !== COMPANY_ID
      || store.get("status") !== "ACTIVE" || store.get("companyMappingStatus") !== "CONFIRMED") {
      throw new Error("A Matriz não está confirmada e ativa na organização esperada.");
    }

    if (member.exists || profile.exists) {
      const currentMember = member.data();
      const isAlreadyProvisioned = member.exists && profile.exists
        && profile.get("companyId") === COMPANY_ID
        && currentMember.uid === uid
        && currentMember.email === email
        && currentMember.role === "ADMIN"
        && currentMember.status === "ACTIVE"
        && Array.isArray(currentMember.teamIds)
        && currentMember.teamIds.length === 0;
      if (isAlreadyProvisioned) return { created: false };
      throw new Error("A conta já possui dados de associação divergentes; nenhuma alteração foi aplicada.");
    }

    transaction.create(memberRef, {
      uid,
      name: displayName || email.split("@")[0],
      email,
      role: "ADMIN",
      status: "ACTIVE",
      teamIds: [],
      positionTitle: INITIAL_POSITION,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(profileRef, {
      companyId: COMPANY_ID,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { created: true };
  });
}

module.exports = { provisionMatrixAdmin };
