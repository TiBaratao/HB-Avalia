import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [companyId, emailArgument, nameArgument, companyNameArgument] = process.argv.slice(2);
const email = emailArgument?.trim().toLowerCase();
const name = nameArgument?.trim();
const companyName = companyNameArgument?.trim();

if (!companyId || companyId.includes("/") || !email || !name || name.length < 2) {
  console.error("Uso: node scripts/provision-initial-admin.mjs <companyId> <email> <nome> [nome-da-empresa]");
  process.exitCode = 1;
} else {
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) {
    throw new Error("Defina FIREBASE_SERVICE_ACCOUNT_JSON no ambiente local antes de executar.");
  }

  const serviceAccount = JSON.parse(credentialsJson);
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId || serviceAccount.project_id !== projectId) {
    throw new Error("FIREBASE_PROJECT_ID deve corresponder ao projeto da conta de serviço.");
  }

  const app = initializeApp({ credential: cert(serviceAccount), projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const user = await auth.getUserByEmail(email);
  const companyRef = db.collection("companies").doc(companyId);
  const memberRef = companyRef.collection("members").doc(user.uid);
  const profileRef = db.collection("userProfiles").doc(user.uid);

  await db.runTransaction(async (transaction) => {
    const [companySnapshot, membersSnapshot, memberSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(companyRef),
      transaction.get(companyRef.collection("members")),
      transaction.get(memberRef),
      transaction.get(profileRef),
    ]);

    if (membersSnapshot.docs.some((member) => member.get("role") === "ADMIN" && member.get("status") === "ACTIVE")) {
      throw new Error("A empresa já tem uma administradora ativa. Use o fluxo de convites do painel.");
    }
    if (memberSnapshot.exists || profileSnapshot.exists) {
      throw new Error("A conta já possui dados de associação. Revise-os antes de provisionar.");
    }
    if (!companySnapshot.exists && (!companyName || companyName.length < 2 || companyName.length > 100)) {
      throw new Error("Informe o nome da empresa se ela ainda não existir.");
    }

    if (!companySnapshot.exists) {
      transaction.create(companyRef, {
        name: companyName,
        ownerUid: user.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(memberRef, {
      uid: user.uid,
      name,
      email,
      role: "ADMIN",
      status: "ACTIVE",
      teamIds: [],
      positionTitle: "Atendente de Açougue Junior",
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(profileRef, {
      companyId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  console.log(`Acesso de administradora provisionado para ${email} em ${companyId}.`);
  console.log("A pessoa deve entrar com a conta Firebase já criada e verificar o e-mail antes de usar o painel.");
}
