import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
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
    await setDoc(doc(db, `companies/${companyId}/members/inactive-admin`), {
      uid: "inactive-admin", email: "inactive-admin@example.test", name: "Admin inativo", role: "ADMIN", status: "DISABLED", teamIds: [],
    });
    await setDoc(doc(db, `companies/${companyId}/members/leader`), {
      uid: "leader", email: "leader@example.test", name: "Líder", role: "LEADER", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, `companies/${companyId}/members/leader-2`), {
      uid: "leader-2", email: "leader2@example.test", name: "Outra liderança", role: "LEADER", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, `companies/${companyId}/members/leader-other-team`), {
      uid: "leader-other-team", email: "otherteam@example.test", name: "Liderança de outra equipe", role: "LEADER", status: "ACTIVE", teamIds: ["team-2"],
    });
    await setDoc(doc(db, `companies/${companyId}/members/inactive-leader`), {
      uid: "inactive-leader", email: "inactive@example.test", name: "Liderança inativa", role: "LEADER", status: "DISABLED", teamIds: ["team-1"],
    });
    await setDoc(doc(db, "companies/another-company"), {
      name: "Outra empresa",
      ownerUid: "admin-other-company",
      selfEnrollmentEnabled: true,
      defaultMemberRole: "EMPLOYEE",
    });
    await setDoc(doc(db, "companies/another-company/members/admin-other-company"), {
      uid: "admin-other-company", email: "admin-other@example.test", name: "Admin de outra empresa", role: "ADMIN", status: "ACTIVE", teamIds: [],
    });
    await setDoc(doc(db, "companies/another-company/members/leader-other-company"), {
      uid: "leader-other-company", email: "leader-other@example.test", name: "Líder de outra empresa", role: "LEADER", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, "companies/another-company/members/employee"), {
      uid: "employee", email: "employee@example.test", name: "Colaborador da outra empresa", role: "EMPLOYEE", status: "ACTIVE", teamIds: ["team-1"],
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

test("promotion evidence is readable only when its source evaluation is authorized or sanitized", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `companies/${companyId}/evaluations/private-evaluation`), {
      cycleId: "cycle-1",
      evaluatorId: "leader",
      evaluatedUserId: "employee",
      type: "EMPLOYEE",
      status: "SUBMITTED",
      comment: "Comentário confidencial",
      averageScore: 4.5,
    });
    await setDoc(doc(db, `companies/${companyId}/promotionRequests/legacy-request`), {
      employeeId: "employee",
      leaderId: "leader",
      averageScore: 4.5,
      evaluations: [{
        evaluationId: "private-evaluation",
        score: 4.5,
        comment: "Comentário confidencial",
      }],
      status: "PENDING",
    });
    await setDoc(doc(db, `companies/${companyId}/promotionRequests/sanitized-request`), {
      employeeId: "employee",
      leaderId: "leader",
      averageScore: null,
      evaluations: [],
      evaluationEvidenceVersion: 2,
      status: "PENDING",
    });
    await setDoc(doc(db, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/private-evaluation`), {
      evaluationId: "private-evaluation",
      score: 4.5,
      comment: "Comentário confidencial",
    });
    await setDoc(doc(db, "companies/another-company/promotionRequests/other-company-request"), {
      employeeId: "employee",
      leaderId: "leader-other-company",
      averageScore: null,
      evaluations: [],
      evaluationEvidenceVersion: 2,
      status: "PENDING",
    });
    await setDoc(doc(db, "companies/another-company/promotionRequests/other-company-request/evaluationEvidence/private-evaluation"), {
      evaluationId: "private-evaluation",
      score: 4.5,
      comment: "Evidência da outra empresa",
    });
  });

  const authorDb = testEnv.authenticatedContext("leader", { email: "leader@example.test" }).firestore();
  const peerLeaderDb = testEnv.authenticatedContext("leader-2", { email: "leader2@example.test" }).firestore();
  const otherTeamDb = testEnv.authenticatedContext("leader-other-team", { email: "otherteam@example.test" }).firestore();
  const inactiveLeaderDb = testEnv.authenticatedContext("inactive-leader", { email: "inactive@example.test" }).firestore();
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  const inactiveAdminDb = testEnv.authenticatedContext("inactive-admin", { email: "inactive-admin@example.test" }).firestore();
  const otherCompanyAdminDb = testEnv.authenticatedContext("admin-other-company", { email: "admin-other@example.test" }).firestore();
  const otherCompanyLeaderDb = testEnv.authenticatedContext("leader-other-company", { email: "leader-other@example.test" }).firestore();

  await assertSucceeds(getDoc(doc(authorDb, `companies/${companyId}/evaluations/private-evaluation`)));
  await assertFails(getDoc(doc(peerLeaderDb, `companies/${companyId}/evaluations/private-evaluation`)));
  await assertFails(getDoc(doc(authorDb, `companies/${companyId}/promotionRequests/legacy-request`)));
  await assertFails(getDoc(doc(peerLeaderDb, `companies/${companyId}/promotionRequests/legacy-request`)));
  await assertSucceeds(getDoc(doc(adminDb, `companies/${companyId}/promotionRequests/legacy-request`)));
  await assertSucceeds(getDoc(doc(peerLeaderDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertSucceeds(getDoc(doc(adminDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertFails(getDoc(doc(inactiveAdminDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertFails(getDoc(doc(peerLeaderDb, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/private-evaluation`)));
  await assertSucceeds(getDoc(doc(adminDb, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/private-evaluation`)));
  await assertFails(getDoc(doc(inactiveAdminDb, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/private-evaluation`)));
  await assertFails(setDoc(doc(peerLeaderDb, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/forged`), {
    evaluationId: "forged",
    score: 5,
    comment: "Tentativa de gravação direta",
  }));
  await assertFails(getDoc(doc(otherTeamDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertFails(getDoc(doc(inactiveLeaderDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertFails(getDoc(doc(peerLeaderDb, "companies/another-company/promotionRequests/sanitized-request")));
  await assertSucceeds(getDoc(doc(otherCompanyAdminDb, "companies/another-company/promotionRequests/other-company-request")));
  await assertFails(getDoc(doc(otherCompanyAdminDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertSucceeds(getDoc(doc(otherCompanyLeaderDb, "companies/another-company/promotionRequests/other-company-request")));
  await assertFails(getDoc(doc(otherCompanyLeaderDb, `companies/${companyId}/promotionRequests/sanitized-request`)));
  await assertSucceeds(getDoc(doc(otherCompanyAdminDb, "companies/another-company/promotionRequests/other-company-request/evaluationEvidence/private-evaluation")));
  await assertFails(getDoc(doc(otherCompanyAdminDb, `companies/${companyId}/promotionRequests/sanitized-request/evaluationEvidence/private-evaluation`)));
});

test("a leader can start a new development plan after an approved promotion", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `companies/${companyId}/developmentPlans/employee`), {
      employeeId: "employee",
      leaderId: "leader",
      teamIds: ["team-1"],
      targetPosition: "Analista",
      goals: [{ id: "goal-1", title: "Meta concluída", description: "", completed: true, completedAt: null }],
      status: "PROMOTED",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, `companies/${companyId}/promotionStatuses/employee`), {
      employeeId: "employee",
      leaderId: "leader",
      teamIds: ["team-1"],
      requestId: "approved-request",
      targetPosition: "Analista",
      status: "APPROVED",
    });
  });

  const db = testEnv.authenticatedContext("leader", { email: "leader@example.test" }).firestore();
  await assertSucceeds(setDoc(doc(db, `companies/${companyId}/developmentPlans/employee`), {
    employeeId: "employee",
    leaderId: "leader",
    teamIds: ["team-1"],
    targetPosition: "Analista Sênior",
    goals: [{ id: "goal-2", title: "Nova meta", description: "Meta do novo PDI", completed: false, completedAt: null }],
    status: "ACTIVE",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
});
