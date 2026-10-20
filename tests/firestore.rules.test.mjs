import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-hb-avalia-rules";
const companyId = "hb-avalia";
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Date.now();
    await setDoc(doc(db, `companies/${companyId}`), {
      name: "Empresa de teste",
      ownerUid: "admin",
      selfEnrollmentEnabled: true,
      defaultMemberRole: "EMPLOYEE",
    });
    await setDoc(doc(db, `companies/${companyId}/members/admin`), {
      uid: "admin", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE", teamIds: [],
    });
    await setDoc(doc(db, `companies/${companyId}/members/leader`), {
      uid: "leader", email: "leader@example.test", name: "Líder", role: "LEADER", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, `companies/${companyId}/members/employee`), {
      uid: "employee", email: "employee@example.test", name: "Colaborador", role: "EMPLOYEE", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, `companies/${companyId}/cycles/cycle-1`), { name: "Ciclo atual", status: "OPEN" });
    await setDoc(doc(db, `companies/${companyId}/criteria/quality`), {
      name: "Qualidade", evaluationType: "EMPLOYEE", active: true,
    });
    await setDoc(doc(db, `companies/${companyId}/surveys/survey-1`), {
      name: "Pesquisa", startsAt: "2020-01-01", endsAt: "2099-12-31",
      startsAtAt: Timestamp.fromMillis(now - 60_000),
      endsAtAt: Timestamp.fromMillis(now + 86_400_000),
      audience: ["EMPLOYEE"], active: true,
      questions: [{ id: "q1", prompt: "Como foi?", type: "TEXT" }],
    });
  });
});

test("leaders can save draft answers but cannot submit a score from the client", async () => {
  const db = testEnv.authenticatedContext("leader", { email: "leader@example.test" }).firestore();
  const evaluation = doc(db, `companies/${companyId}/evaluations/eval_hb-avalia~cycle-1~leader~employee~EMPLOYEE`);
  await assertSucceeds(setDoc(evaluation, {
    cycleId: "cycle-1", evaluatorId: "leader", evaluatedUserId: "employee", type: "EMPLOYEE",
    status: "DRAFT", comment: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(evaluation, "answers/quality"), { criterionId: "quality", score: 4 }));
  await assertFails(updateDoc(evaluation, {
    status: "SUBMITTED", averageScore: 4, submittedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test("a browser cannot create a submitted evaluation directly", async () => {
  const db = testEnv.authenticatedContext("leader", { email: "leader@example.test" }).firestore();
  await assertFails(setDoc(doc(db, `companies/${companyId}/evaluations/forged`), {
    cycleId: "cycle-1", evaluatorId: "leader", evaluatedUserId: "employee", type: "EMPLOYEE",
    status: "SUBMITTED", comment: "", averageScore: 5,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: serverTimestamp(),
  }));
});

test("only the callable server path can record survey participation and responses", async () => {
  const db = testEnv.authenticatedContext("employee", { email: "employee@example.test" }).firestore();
  await assertFails(setDoc(doc(db, `companies/${companyId}/surveys/survey-1/participants/employee`), {
    completedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, `companies/${companyId}/surveys/survey-1/responses/response-1`), {
    answers: [{ questionId: "q1", value: "Minha resposta" }],
  }));
});

test("a browser cannot forge promotion evidence or change promotion status", async () => {
  const db = testEnv.authenticatedContext("leader", { email: "leader@example.test" }).firestore();
  await assertFails(setDoc(doc(db, `companies/${companyId}/promotionRequests/forged`), {
    employeeId: "employee", leaderId: "leader", developmentPlanId: "employee",
    targetPosition: "Analista", justification: "Uma justificativa suficientemente longa para o teste.",
    averageScore: 5, evaluations: [], goals: [], status: "PENDING", submittedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, `companies/${companyId}/promotionStatuses/employee`), {
    employeeId: "employee", leaderId: "leader", teamIds: ["team-1"], requestId: "forged",
    targetPosition: "Analista", status: "PENDING", submittedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});
