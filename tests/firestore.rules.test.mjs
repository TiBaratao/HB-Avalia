import assert from "node:assert/strict";
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
    });
    await setDoc(doc(db, "companies/another-company/members/admin"), {
      uid: "admin", email: "admin@example.test", name: "Admin", role: "ADMIN", status: "ACTIVE", teamIds: [],
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
    for (const uid of ["admin", "inactive-admin", "leader", "leader-2", "leader-other-team", "inactive-leader", "employee"]) {
      await setDoc(doc(db, `userProfiles/${uid}`), { companyId });
    }
    for (const uid of ["admin-other-company", "leader-other-company"]) {
      await setDoc(doc(db, `userProfiles/${uid}`), { companyId: "another-company" });
    }
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

test("clients cannot self-enroll, create a company, or write a user profile", async () => {
  const memberDb = testEnv.authenticatedContext("new-member", { email: "new-member@example.test" }).firestore();
  await assertFails(setDoc(doc(memberDb, `companies/${companyId}/members/new-member`), {
    uid: "new-member",
    name: "Novo Colaborador",
    email: "new-member@example.test",
    role: "EMPLOYEE",
    status: "ACTIVE",
    teamIds: [],
    positionTitle: "Atendente de Açougue Junior",
    createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(memberDb, "userProfiles/new-member"), {
    companyId,
    createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(memberDb, `companies/${companyId}-new`), {
    name: "Nova Empresa",
    ownerUid: "first-admin",
    createdAt: serverTimestamp(),
  }));
});

test("an active membership in another company cannot override the account company binding", async () => {
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  await assertFails(getDoc(doc(adminDb, "companies/another-company")));
  await assertFails(getDoc(doc(adminDb, "companies/another-company/members/admin")));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "companies/another-company/members/employee"), {
      uid: "employee", email: "employee@example.test", role: "EMPLOYEE", status: "ACTIVE", teamIds: ["team-1"],
    });
    await setDoc(doc(db, "companies/another-company/checklistAssignments/assigned-to-employee"), {
      assignedToId: "employee",
      status: "PENDING",
    });
    await setDoc(doc(db, "companies/another-company/checklistAssignments/assigned-to-employee/results/item-1"), {
      status: "PENDING",
    });
    await setDoc(doc(db, "companies/another-company/surveys/survey-1"), { active: true });
    await setDoc(doc(db, "companies/another-company/surveys/survey-1/participants/employee"), {
      completedAt: Timestamp.now(),
    });
  });

  const employeeDb = testEnv.authenticatedContext("employee", { email: "employee@example.test" }).firestore();
  await assertFails(getDoc(doc(employeeDb, "companies/another-company/checklistAssignments/assigned-to-employee")));
  await assertFails(getDoc(doc(employeeDb, "companies/another-company/checklistAssignments/assigned-to-employee/results/item-1")));
  await assertFails(getDoc(doc(employeeDb, "companies/another-company/surveys/survey-1/participants/employee")));
});

test("the legacy Matrix tenant remains usable before organization metadata is provisioned", async () => {
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  const matrix = doc(adminDb, "companies/hb-avalia");
  const matrixSnapshot = await getDoc(matrix);

  assert.equal(matrixSnapshot.get("organizationId"), undefined);
  assert.equal(matrixSnapshot.get("storeId"), undefined);
  await assertSucceeds(updateDoc(matrix, { name: "Matriz atualizada" }));
  assert.equal((await getDoc(matrix)).get("name"), "Matriz atualizada");
  await assertFails(getDoc(doc(adminDb, "companies/another-company")));
});

test("no browser client, including an administrator, can create a company member", async () => {
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  await assertFails(setDoc(doc(adminDb, `companies/${companyId}/members/invited-member`), {
    uid: "invited-member",
    name: "Convidada",
    email: "invited@example.test",
    role: "EMPLOYEE",
    status: "ACTIVE",
    teamIds: ["team-1"],
    positionTitle: "Atendente de Açougue Junior",
    createdAt: serverTimestamp(),
  }));
});

test("invitation records are inaccessible through Firestore clients", async () => {
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  await assertFails(getDoc(doc(anonymousDb, "invitations/invite-1")));
  await assertFails(setDoc(doc(adminDb, "invitations/invite-1"), {
    companyId,
    invitedEmail: "person@example.test",
    status: "PENDING",
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

test("customer feedback data and public QR mappings are inaccessible through Firestore clients", async () => {
  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  const anonymousDb = testEnv.unauthenticatedContext().firestore();
  const responsePath = `companies/${companyId}/customerFeedbackResponses/response-1`;
  const locationPath = `companies/${companyId}/customerFeedbackLocations/general`;
  const rateLimitPath = `companies/${companyId}/customerFeedbackRateLimits/hash`;
  const privateRateLimitSecretPath = `companies/${companyId}/customerFeedbackPrivate/rateLimitSecret`;
  const qrTokenPath = "customerFeedbackQrTokens/public-token";

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, responsePath), { overallRating: 5, comment: "Avaliação" });
    await setDoc(doc(db, locationPath), { kind: "GENERAL", name: "Supermercado" });
    await setDoc(doc(db, rateLimitPath), { submissionCount: 1 });
    await setDoc(doc(db, privateRateLimitSecretPath), { secret: "server-only-secret-value" });
    await setDoc(doc(db, qrTokenPath), { companyId, locationId: "general", active: true });
  });

  for (const db of [adminDb, anonymousDb]) {
    await assertFails(getDoc(doc(db, responsePath)));
    await assertFails(getDoc(doc(db, locationPath)));
    await assertFails(getDoc(doc(db, rateLimitPath)));
    await assertFails(getDoc(doc(db, privateRateLimitSecretPath)));
    await assertFails(getDoc(doc(db, qrTokenPath)));
    await assertFails(setDoc(doc(db, responsePath), { overallRating: 1 }));
    await assertFails(setDoc(doc(db, qrTokenPath), { companyId, locationId: "general" }));
  }
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

test("organization registry remains inaccessible to browser clients, including director claims", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "organizations/hipermercado-baratao"), {
      name: "Hipermercado Baratão",
      status: "ACTIVE",
      schemaVersion: 1,
      directorRole: "DIRECTOR",
    });
    await setDoc(doc(db, "organizations/hipermercado-baratao/stores/matriz"), {
      organizationId: "hipermercado-baratao",
      storeId: "matriz",
      companyId: "hb-avalia-matriz",
      name: "Matriz",
      status: "ACTIVE",
      companyMappingStatus: "PENDING_CONFIRMATION",
    });
  });

  const adminDb = testEnv.authenticatedContext("admin", { email: "admin@example.test" }).firestore();
  const directorDb = testEnv.authenticatedContext("director", { role: "DIRECTOR" }).firestore();
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  for (const db of [adminDb, directorDb, anonymousDb]) {
    await assertFails(getDoc(doc(db, "organizations/hipermercado-baratao")));
    await assertFails(getDoc(doc(db, "organizations/hipermercado-baratao/stores/matriz")));
  }
  await assertFails(setDoc(doc(directorDb, "organizations/hipermercado-baratao/stores/summit"), {
    organizationId: "hipermercado-baratao",
    storeId: "summit",
    companyId: "hb-avalia-summit",
    name: "Summit",
  }));
});
