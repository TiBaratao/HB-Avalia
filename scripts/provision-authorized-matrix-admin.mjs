import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { provisionMatrixAdmin } from "../src/lib/server/matrix-admin-provisioning-core.js";
import nextEnv from "@next/env";

const EXPECTED_PROJECT_ID = "hb-avalia2";
const { loadEnvConfig } = nextEnv;

function parseArguments(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--inspect" || argument === "--apply" || argument === "--confirm-matrix-admin") {
      options.set(argument, true);
      continue;
    }
    if (argument === "--project" || argument === "--email") {
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

await loadEnvConfig(process.cwd());
const options = parseArguments(process.argv.slice(2));
const authorizedEmail = options.get("--email")?.trim().toLowerCase() ?? "";
if (options.get("--project") !== EXPECTED_PROJECT_ID
  || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorizedEmail)) {
  throw new Error("Informe o projeto hb-avalia2 e um e-mail autorizado válido.");
}
if (Boolean(options.get("--inspect")) === Boolean(options.get("--apply"))) {
  throw new Error("Escolha exatamente uma opção: --inspect ou --apply.");
}
if (options.get("--apply") && !options.get("--confirm-matrix-admin")) {
  throw new Error("--apply exige --confirm-matrix-admin.");
}
if (options.get("--inspect") && options.get("--confirm-matrix-admin")) {
  throw new Error("O modo --inspect não aceita confirmação de escrita.");
}

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não está configurada localmente.");
const serviceAccount = JSON.parse(serviceAccountJson);
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (projectId !== EXPECTED_PROJECT_ID || serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  throw new Error("As credenciais e FIREBASE_PROJECT_ID devem corresponder exatamente a hb-avalia2.");
}

const app = initializeApp({ credential: cert(serviceAccount), projectId }, "hb-avalia-authorized-matrix-admin");
try {
  const auth = getAuth(app);
  const db = getFirestore(app);
  const user = await auth.getUserByEmail(authorizedEmail);
  if (!user.emailVerified || user.disabled || user.email?.trim().toLowerCase() !== authorizedEmail) {
    throw new Error("A conta autorizada precisa estar ativa e com e-mail verificado.");
  }

  const companyRef = db.collection("companies").doc("hb-avalia");
  const organizationRef = db.collection("organizations").doc("hipermercado-baratao");
  const memberRef = companyRef.collection("members").doc(user.uid);
  const profileRef = db.collection("userProfiles").doc(user.uid);
  const [company, organization, store, member, profile] = await Promise.all([
    companyRef.get(),
    organizationRef.get(),
    organizationRef.collection("stores").doc("matriz").get(),
    memberRef.get(),
    profileRef.get(),
  ]);
  if (!company.exists || company.get("organizationId") !== "hipermercado-baratao"
    || company.get("storeId") !== "matriz"
    || !organization.exists || organization.get("status") !== "ACTIVE"
    || !store.exists || store.get("companyId") !== "hb-avalia"
    || store.get("status") !== "ACTIVE" || store.get("companyMappingStatus") !== "CONFIRMED") {
    throw new Error("A Matriz não está confirmada e ativa na organização esperada.");
  }
  const duplicateMembers = await companyRef.collection("members").where("email", "==", authorizedEmail).limit(5).get();
  if (duplicateMembers.docs.some((document) => document.id !== user.uid)) {
    throw new Error("Já existe uma associação para este e-mail com outro UID; nenhuma alteração foi aplicada.");
  }
  if ((member.exists && (member.get("email") !== authorizedEmail
    || member.get("role") !== "ADMIN" || member.get("status") !== "ACTIVE"))
    || (profile.exists && profile.get("companyId") !== "hb-avalia")) {
    throw new Error("A conta já possui dados de associação divergentes; nenhuma alteração foi aplicada.");
  }
  console.log(JSON.stringify({
    projectId: EXPECTED_PROJECT_ID,
    companyId: "hb-avalia",
    storeId: "matriz",
    accountExists: true,
    emailVerified: user.emailVerified,
    memberRecordExists: member.exists,
    profileRecordExists: profile.exists,
    mode: options.get("--inspect") ? "read-only" : "apply",
  }, null, 2));

  if (options.get("--inspect")) {
    console.log("Inspeção concluída; nenhuma escrita foi realizada.");
  } else {
    const result = await provisionMatrixAdmin(db, {
      uid: user.uid,
      email: user.email,
      name: user.displayName,
    });
    console.log(JSON.stringify({
      status: result.created ? "ADMIN da Matriz provisionado." : "A conta já estava provisionada; nenhuma alteração necessária.",
      companyId: "hb-avalia",
      storeId: "matriz",
      role: "ADMIN",
    }, null, 2));
  }
} finally {
  await deleteApp(app);
}
