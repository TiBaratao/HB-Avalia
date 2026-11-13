import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { provisionDirectorGrant } from "../src/lib/server/director-grant-core.js";
import nextEnv from "@next/env";

const EXPECTED_PROJECT_ID = "hb-avalia2";
const AUTHORIZED_EMAIL = "deividanjos016@gmail.com";
const ORGANIZATION_ID = "hipermercado-baratao";
const { loadEnvConfig } = nextEnv;

function parseArguments(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--inspect" || argument === "--apply" || argument === "--grant-director") {
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
if (options.get("--project") !== EXPECTED_PROJECT_ID
  || options.get("--email")?.trim().toLowerCase() !== AUTHORIZED_EMAIL) {
  throw new Error("Informe exatamente o projeto hb-avalia2 e o e-mail explicitamente autorizado.");
}
if (Boolean(options.get("--inspect")) === Boolean(options.get("--apply"))) {
  throw new Error("Escolha exatamente uma opção: --inspect ou --apply.");
}
if (options.get("--apply") && !options.get("--grant-director")) {
  throw new Error("--apply exige --grant-director.");
}
if (options.get("--inspect") && options.get("--grant-director")) {
  throw new Error("O modo --inspect não aceita confirmação de escrita.");
}

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não está configurada localmente.");
const serviceAccount = JSON.parse(serviceAccountJson);
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (projectId !== EXPECTED_PROJECT_ID || serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  throw new Error("As credenciais e FIREBASE_PROJECT_ID devem corresponder exatamente a hb-avalia2.");
}

const app = initializeApp({ credential: cert(serviceAccount), projectId }, "hb-avalia-authorized-director");
try {
  const auth = getAuth(app);
  const db = getFirestore(app);
  const user = await auth.getUserByEmail(AUTHORIZED_EMAIL);
  if (!user.emailVerified || user.disabled || user.email?.trim().toLowerCase() !== AUTHORIZED_EMAIL) {
    throw new Error("A conta autorizada precisa estar ativa e com e-mail verificado.");
  }

  const companyRef = db.collection("companies").doc("hb-avalia");
  const memberRef = companyRef.collection("members").doc(user.uid);
  const profileRef = db.collection("userProfiles").doc(user.uid);
  const organizationRef = db.collection("organizations").doc(ORGANIZATION_ID);
  const grantRef = organizationRef.collection("directors").doc(user.uid);
  const [company, member, profile, organization, grant, grantsWithEmail] = await Promise.all([
    companyRef.get(),
    memberRef.get(),
    profileRef.get(),
    organizationRef.get(),
    grantRef.get(),
    organizationRef.collection("directors").where("email", "==", AUTHORIZED_EMAIL).get(),
  ]);
  if (!company.exists || company.get("organizationId") !== ORGANIZATION_ID
    || company.get("storeId") !== "matriz"
    || !profile.exists || profile.get("companyId") !== "hb-avalia"
    || !member.exists || member.get("uid") !== user.uid
    || member.get("email")?.trim().toLowerCase() !== AUTHORIZED_EMAIL
    || member.get("role") !== "ADMIN" || member.get("status") !== "ACTIVE") {
    throw new Error("A conta não possui o vínculo ADMIN ativo esperado na Matriz.");
  }
  if (!organization.exists || organization.get("status") !== "ACTIVE"
    || organization.get("directorRole") !== "DIRECTOR") {
    throw new Error("A organização não está provisionada para acesso de Diretor.");
  }
  if (grantsWithEmail.size > 1 || grantsWithEmail.docs.some((document) =>
    document.get("uid") !== user.uid
    || document.get("email")?.trim().toLowerCase() !== AUTHORIZED_EMAIL
    || document.get("role") !== "DIRECTOR"
    || document.get("status") !== "ACTIVE")) {
    throw new Error("O e-mail possui grants divergentes ou duplicados; nenhuma alteração foi aplicada.");
  }
  const stores = await Promise.all(["matriz", "loja-2", "summit"].map(async (storeId) => {
    const store = await organizationRef.collection("stores").doc(storeId).get();
    const companyId = store.get("companyId");
    const storeCompany = typeof companyId === "string"
      ? await db.collection("companies").doc(companyId).get()
      : null;
    return {
      storeId,
      companyId,
      operationalAccessReady: store.exists
        && store.get("organizationId") === ORGANIZATION_ID
        && store.get("storeId") === storeId
        && store.get("status") === "ACTIVE"
        && store.get("companyMappingStatus") === "CONFIRMED"
        && storeCompany?.exists === true
        && storeCompany.get("organizationId") === ORGANIZATION_ID
        && storeCompany.get("storeId") === storeId,
    };
  }));
  if (stores.some((store) => !store.operationalAccessReady)) {
    throw new Error("Nem todas as lojas estão operacionais; grant não será criado.");
  }
  if (grant.exists && (grant.get("uid") !== user.uid
    || grant.get("email")?.trim().toLowerCase() !== AUTHORIZED_EMAIL
    || grant.get("role") !== "DIRECTOR" || grant.get("status") !== "ACTIVE")) {
    throw new Error("O grant de Diretor existente diverge; nenhuma alteração foi aplicada.");
  }
  const misplacedGrant = grantsWithEmail.docs.find((document) => document.id !== user.uid);
  if (grant.exists && misplacedGrant) {
    throw new Error("Há grants duplicados para a conta; nenhuma alteração foi aplicada.");
  }

  console.log(JSON.stringify({
    projectId: EXPECTED_PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    authorizedAccountActive: true,
    emailVerified: true,
    matrixAdminMembershipPreserved: true,
    existingDirectorGrant: grant.exists || Boolean(misplacedGrant),
    existingGrantPathNeedsRepair: Boolean(misplacedGrant),
    stores,
    mode: options.get("--inspect") ? "read-only" : "apply",
  }, null, 2));
  if (options.get("--inspect")) {
    console.log("Inspeção concluída; nenhuma escrita foi realizada.");
  } else {
    const result = await provisionDirectorGrant(db, { uid: user.uid, email: user.email });
    console.log(JSON.stringify({
      status: result.repairedDocumentPath
        ? "Grant ativo movido atomicamente para o caminho UID esperado pelo servidor."
        : result.created
          ? "Grant de Diretor criado."
          : "Grant de Diretor já estava ativo; nenhuma alteração necessária.",
      organizationId: ORGANIZATION_ID,
      role: "DIRECTOR",
      matrixAdminMembershipPreserved: true,
      stores,
    }, null, 2));
  }
} finally {
  await deleteApp(app);
}
