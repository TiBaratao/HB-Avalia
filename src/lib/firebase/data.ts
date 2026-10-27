import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getCountFromServer,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "./client";
import {
  checklistAssignmentDocument,
  checklistAssignmentResults,
  companyCollection,
  companyDocument,
  developmentPlanCollection,
  developmentPlanDocument,
  promotionRequestCollection,
  promotionRequestDocument,
  promotionRequestStatusDocument,
  evaluationAnswers,
  evaluationDocument,
  memberCollection,
  memberDocument,
  surveyParticipantDocument,
  surveyResponses,
  userProfileDocument,
} from "./paths";
import type {
  ChecklistAssignmentDocument,
  ChecklistResultDocument,
  ChecklistTemplateDocument,
  CompanyDocument,
  CompanyMember,
  DevelopmentPlanDocument,
  PromotionRequestDocument,
  PromotionRequestStatusDocument,
  CriterionDocument,
  CycleDocument,
  DepartmentDocument,
  DocumentWithId,
  EvaluationAnswerWithId,
  EvaluationWithId,
  FirebaseEvaluationType,
  FirebaseRole,
  PromotionEvaluationSnapshot,
  SurveyDocument,
  SurveyQuestion,
  SurveyResponseDocument,
  TeamDocument,
} from "./models";

export const MIN_SURVEY_RESPONSES_FOR_RESULTS = 5;

export interface WorkspaceData {
  company: DocumentWithId<CompanyDocument>;
  member: CompanyMember;
  members: Array<DocumentWithId<CompanyMember>>;
  departments: Array<DocumentWithId<DepartmentDocument>>;
  teams: Array<DocumentWithId<TeamDocument>>;
  criteria: Array<DocumentWithId<CriterionDocument>>;
  cycles: Array<DocumentWithId<CycleDocument>>;
  surveys: Array<DocumentWithId<SurveyDocument>>;
  completedSurveyIds: string[];
  templates: Array<DocumentWithId<ChecklistTemplateDocument>>;
  assignments: Array<DocumentWithId<ChecklistAssignmentDocument>>;
  results: Record<string, Array<DocumentWithId<ChecklistResultDocument>>>;
  evaluations: Array<EvaluationWithId>;
  developmentPlans: Array<DocumentWithId<DevelopmentPlanDocument>>;
  promotionRequests: Array<DocumentWithId<PromotionRequestDocument>>;
  developmentAccessAvailable: boolean;
  restrictedPromotionHistory: boolean;
}

function evaluationDraftId(companyId: string, cycleId: string, evaluatorId: string, evaluatedUserId: string, type: FirebaseEvaluationType) {
  return `eval_${companyId}~${cycleId}~${evaluatorId}~${evaluatedUserId}~${type}`;
}
function withIds<T>(snapshot: Pick<QuerySnapshot<DocumentData>, "docs">) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Array<DocumentWithId<T>>;
}

function withAccessContext<T>(label: string, operation: Promise<T>): Promise<T> {
  return operation.catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${detail}`);
  });
}
async function withOptionalAccess<T>(label: string, operation: Promise<T>, fallback: T) {
  try {
    return { value: await operation, available: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "permission-denied" || /missing or insufficient permissions/i.test(detail)) {
      return { value: fallback, available: false };
    }
    throw new Error(`${label}: ${detail}`);
  }
}

export async function readUserProfile(uid: string) {
  const snapshot = await getDoc(userProfileDocument(uid));
  return snapshot.exists() ? snapshot.data() as { companyId: string } : null;
}

export async function createCompanyForAdmin(input: {
  companyId: string;
  uid: string;
  email: string;
  name: string;
  companyName: string;
}) {
  const db = getFirebaseDb();
  const companyRef = doc(db, "companies", input.companyId);
  const batch = writeBatch(db);
  const cleanCompanyName = input.companyName.trim();
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim();
  batch.set(companyRef, {
    name: cleanCompanyName,
    ownerUid: input.uid,
    selfEnrollmentEnabled: true,
    defaultMemberRole: "EMPLOYEE" satisfies FirebaseRole,
    createdAt: serverTimestamp(),
  });
  batch.set(memberDocument(companyRef.id, input.uid), {
    uid: input.uid,
    name: cleanName,
    email: cleanEmail,
    role: "ADMIN" satisfies FirebaseRole,
    status: "ACTIVE",
    teamIds: [],
    positionTitle: "Atendente de Açougue Junior",
    createdAt: serverTimestamp(),
  });
  batch.set(userProfileDocument(input.uid), {
    companyId: companyRef.id,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return companyRef.id;
}

export async function selfEnrollInCompany(input: {
  companyId: string;
  uid: string;
  email: string;
  name: string;
}) {
  const db = getFirebaseDb();
  const cleanEmail = input.email.trim().toLowerCase();
  const batch = writeBatch(db);
  batch.set(memberDocument(input.companyId, input.uid), {
    uid: input.uid,
    name: input.name.trim(),
    email: cleanEmail,
    role: "EMPLOYEE" satisfies FirebaseRole,
    status: "ACTIVE",
    teamIds: [],
    positionTitle: "Atendente de Açougue Junior",
    createdAt: serverTimestamp(),
  });
  batch.set(userProfileDocument(input.uid), {
    companyId: input.companyId,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function loadWorkspaceData(companyId: string, uid: string): Promise<WorkspaceData> {
  const db = getFirebaseDb();
  const companyRef = companyDocument(companyId);
  const currentMemberRef = memberDocument(companyId, uid);
  const [companySnapshot, memberSnapshot] = await Promise.all([
    withAccessContext("Leitura da empresa", getDoc(companyRef)),
    withAccessContext("Leitura do perfil de membro", getDoc(currentMemberRef)),
  ]);
  if (!companySnapshot.exists() || !memberSnapshot.exists()) {
    throw new Error("Sua conta não está associada a uma empresa ativa.");
  }

  const company = { id: companyId, ...companySnapshot.data() } as DocumentWithId<CompanyDocument>;
  const member = { uid, ...memberSnapshot.data() } as CompanyMember;
  if (member.status !== "ACTIVE") throw new Error("Seu acesso está desativado. Peça ajuda à administradora.");

  const memberRef = memberCollection(companyId);
  let peoplePromise: Promise<Array<DocumentWithId<CompanyMember>>>;
  if (member.role === "ADMIN") {
    peoplePromise = withAccessContext("Leitura da lista de membros", getDocs(memberRef).then(withIds<CompanyMember>));
  } else if (member.teamIds?.length) {
    const relatedRole = member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
    peoplePromise = withAccessContext("Leitura das pessoas que compartilham suas equipes", Promise.all(
      member.teamIds.map((teamId) => getDocs(query(
        collection(db, "companies", companyId, "teams", teamId, "members"),
        where("role", "==", relatedRole),
      ))),
    ).then((snapshots) => [...new Map(
      snapshots.flatMap((snapshot) => withIds<CompanyMember>(snapshot))
        .filter((person) => person.status === "ACTIVE")
        .map((person) => [person.uid, person]),
    ).values()]));
  } else {
    peoplePromise = Promise.resolve([]);
  }

  const common = Promise.all([
    peoplePromise,
    withAccessContext("Leitura dos setores", getDocs(companyCollection(companyId, "departments"))),
    withAccessContext("Leitura das equipes", getDocs(companyCollection(companyId, "teams"))),
    withAccessContext("Leitura dos critérios", getDocs(companyCollection(companyId, "criteria"))),
    withAccessContext("Leitura dos ciclos", getDocs(companyCollection(companyId, "cycles"))),
    withAccessContext("Leitura das pesquisas", getDocs(member.role === "ADMIN"
      ? companyCollection(companyId, "surveys")
      : query(companyCollection(companyId, "surveys"), where("active", "==", true)))),
    withAccessContext("Leitura dos modelos de checklist", getDocs(member.role === "ADMIN"
      ? companyCollection(companyId, "checklistTemplates")
      : member.role === "LEADER"
        ? query(companyCollection(companyId, "checklistTemplates"), where("createdById", "==", uid))
        : query(companyCollection(companyId, "checklistTemplates"), where("active", "==", true)))),
  ] as const);

  let evaluationQuery;
  if (member.role === "ADMIN") {
    evaluationQuery = companyCollection(companyId, "evaluations");
  } else {
    const type: FirebaseEvaluationType = member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
    evaluationQuery = query(
      companyCollection(companyId, "evaluations"),
      where("evaluatorId", "==", uid),
      where("type", "==", type),
    );
  }
  const evaluationPromise = withAccessContext("Leitura das avaliações", getDocs(evaluationQuery).then((snapshot) =>
    snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as EvaluationWithId),
  ));

  const [parts, evaluationItems] = await Promise.all([common, evaluationPromise]);
  const [
    members, departmentSnapshots, teamSnapshots, criterionSnapshots, cycleSnapshots,
    surveySnapshots, templateSnapshots,
  ] = parts;
  const surveys = withIds<SurveyDocument>(surveySnapshots);
  const surveyStates = await Promise.all(surveys.map(async (survey) => {
    if (member.role === "ADMIN") {
      return [survey.id, false] as const;
    }
    const participant = await withAccessContext(
      "Leitura da participação na pesquisa",
      getDoc(surveyParticipantDocument(companyId, survey.id, uid)),
    );
    return [survey.id, participant.exists()] as const;
  }));
  if (member.role === "ADMIN" && company.teamRosterVersion !== 2) {
    await withAccessContext("Preparação das listas de pessoas por equipe", syncTeamRosters(companyId, members));
  }

  const assignmentIds = [uid];
  const assignmentTargets = member.role === "ADMIN"
    ? []
    : member.role === "LEADER"
      ? [...new Set([uid, ...members.filter((person) => person.role === "EMPLOYEE").map((person) => person.uid)])]
      : assignmentIds;
  const assignmentSnapshots = member.role === "ADMIN"
    ? [await withAccessContext("Leitura das atribuições de checklist", getDocs(companyCollection(companyId, "checklistAssignments")))]
    : await Promise.all(assignmentTargets.map((personId) => withAccessContext("Leitura das atribuições de checklist", getDocs(query(
      companyCollection(companyId, "checklistAssignments"),
      where("assignedToId", "==", personId),
    )))));
  const assignments = assignmentSnapshots.flatMap(withIds<ChecklistAssignmentDocument>);
  const today = localDateString();
  const uniqueAssignments = [...new Map(assignments.map((item) => [item.id, item])).values()]
    .filter((assignment) => member.role === "ADMIN" || !assignment.scheduledFor || assignment.scheduledFor <= today);
  const resultPairs = await Promise.all(uniqueAssignments.map(async (assignment) => {
    const snapshot = await withAccessContext("Leitura dos resultados do checklist", getDocs(collection(
      db,
      "companies", companyId,
      "checklistAssignments", assignment.id,
      "results",
    )));
    return [assignment.id, withIds<ChecklistResultDocument>(snapshot)] as const;
  }));

  const leaderPdiEmployees = member.role === "LEADER"
    ? members.filter((person) => person.role === "EMPLOYEE"
      && person.status === "ACTIVE"
      && person.teamIds.some((teamId) => member.teamIds.includes(teamId)))
    : [];
  let restrictedPromotionHistory = false;
  const [planRead, requestRead] = await Promise.all([
    withOptionalAccess<DocumentSnapshot<DocumentData>[]>(
      member.role === "ADMIN" ? "Leitura dos PDIs" : member.role === "LEADER" ? "Leitura dos PDIs da equipe" : "Leitura do seu PDI",
      member.role === "ADMIN"
        ? getDocs(developmentPlanCollection(companyId)).then((snapshot) => snapshot.docs)
        : member.role === "LEADER"
          ? Promise.all(leaderPdiEmployees
            .map((person) => getDoc(developmentPlanDocument(companyId, person.uid))))
            .then((snapshots) => snapshots.filter((snapshot) => snapshot.exists()))
          : getDoc(developmentPlanDocument(companyId, uid)).then((snapshot) => snapshot.exists() ? [snapshot] : []),
      [],
    ),
    withOptionalAccess<DocumentSnapshot<DocumentData>[]>(
      member.role === "ADMIN" ? "Leitura das indicacoes de promocao" : "Leitura das indicacoes da equipe",
      member.role === "ADMIN"
        ? getDocs(promotionRequestCollection(companyId)).then((snapshot) => snapshot.docs)
        : member.role === "LEADER"
          ? Promise.all(leaderPdiEmployees
            .map(async (person) => {
              const statusSnapshot = await getDoc(promotionRequestStatusDocument(companyId, person.uid));
              if (!statusSnapshot.exists()) return null;
              const status = statusSnapshot.data() as PromotionRequestStatusDocument;
              if (!status.requestId) return null;
              try {
                const requestSnapshot = await getDoc(promotionRequestDocument(companyId, status.requestId));
                return requestSnapshot.exists() ? requestSnapshot : null;
              } catch (error) {
                const code = error && typeof error === "object" && "code" in error
                  ? String((error as { code?: unknown }).code)
                  : "";
                const detail = error instanceof Error ? error.message : String(error);
                if (code === "permission-denied" || /missing or insufficient permissions/i.test(detail)) {
                  restrictedPromotionHistory = true;
                  return null;
                }
                throw error;
              }
            }))
            .then((snapshots) => snapshots.filter((snapshot) => snapshot !== null) as DocumentSnapshot<DocumentData>[])
          : Promise.resolve([] as DocumentSnapshot<DocumentData>[]),
      [],
    ),
  ]);
  const developmentPlanSnapshots = planRead.value;
  const promotionRequestSnapshots = requestRead.value;
  const promotionRequests = await Promise.all(promotionRequestSnapshots.map(async (snapshot) => {
    const request = snapshot.data() as PromotionRequestDocument;
    if (member.role !== "ADMIN" || request.evaluationEvidenceVersion !== 2) {
      return { id: snapshot.id, ...request } as DocumentWithId<PromotionRequestDocument>;
    }

    const evidenceSnapshot = await withAccessContext(
      "Leitura das evidências confidenciais da indicação",
      getDocs(collection(db, "companies", companyId, "promotionRequests", snapshot.id, "evaluationEvidence")),
    );
    const evaluations = withIds<PromotionEvaluationSnapshot>(evidenceSnapshot);
    const averageScore = evaluations.length
      ? Number((evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length).toFixed(2))
      : null;
    return {
      id: snapshot.id,
      ...request,
      averageScore,
      evaluations,
    } as DocumentWithId<PromotionRequestDocument>;
  }));

  return {
    company,
    member,
    members,
    departments: withIds<DepartmentDocument>(departmentSnapshots),
    teams: withIds<TeamDocument>(teamSnapshots),
    criteria: withIds<CriterionDocument>(criterionSnapshots),
    cycles: withIds<CycleDocument>(cycleSnapshots),
    surveys,
    completedSurveyIds: surveyStates.filter(([, completed]) => completed).map(([surveyId]) => surveyId),
    templates: withIds<ChecklistTemplateDocument>(templateSnapshots),
    assignments: uniqueAssignments,
    results: Object.fromEntries(resultPairs),
    evaluations: evaluationItems,
    developmentPlans: developmentPlanSnapshots.map((item) => ({ id: item.id, ...item.data() }) as DocumentWithId<DevelopmentPlanDocument>),
    promotionRequests,
    developmentAccessAvailable: planRead.available && requestRead.available,
    restrictedPromotionHistory,
  };
}

async function requestServerApi(url: string, method: "POST" | "PATCH", input: object): Promise<Record<string, unknown>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Faça login para continuar.");
  const idToken = await user.getIdToken();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  const result = payload as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Não foi possível processar a solicitação.");
  }
  return result;
}

export async function submitPromotionRequest(input: {
  companyId: string;
  employeeId: string;
  targetPosition: string;
  justification: string;
  indicators: Array<{ id: string; percentage: number }>;
  competencies: Array<{ id: string; score: number }>;
}) {
  const result = await requestServerApi("/api/promotion-requests", "POST", input);
  if (typeof result.requestId !== "string") {
    throw new Error("O servidor não retornou o identificador da indicação.");
  }
  return result.requestId;
}

export async function decidePromotionRequest(input: {
  companyId: string;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  adminNote: string;
}) {
  const result = await requestServerApi(
    `/api/promotion-requests/${encodeURIComponent(input.requestId)}/decision`,
    "PATCH",
    input,
  );
  if (result.status !== "APPROVED" && result.status !== "REJECTED") {
    throw new Error("O servidor não retornou uma decisão válida para a indicação.");
  }
  return result.status;
}
export type SurveyResponseCursor = QueryDocumentSnapshot<DocumentData>;

export async function loadSurveyResponsePage(
  companyId: string,
  surveyId: string,
  cursor?: SurveyResponseCursor | null,
) {
  const responsesRef = surveyResponses(companyId, surveyId);
  const countSnapshot = await withAccessContext(
    "Contagem das respostas da pesquisa",
    getCountFromServer(responsesRef),
  );
  const totalCount = countSnapshot.data().count;
  if (totalCount < MIN_SURVEY_RESPONSES_FOR_RESULTS) {
    return { responses: [], cursor: null, hasMore: false, totalCount };
  }

  const pageQuery = query(
    responsesRef,
    ...(cursor ? [startAfter(cursor)] : []),
    limit(21),
  );
  const responseSnapshot = await withAccessContext(
    "Leitura das respostas da pesquisa",
    getDocs(pageQuery),
  );
  const pageDocuments = responseSnapshot.docs.slice(0, 20);
  const lastDocument = pageDocuments.at(-1) ?? null;
  return {
    responses: withIds<SurveyResponseDocument>({ docs: pageDocuments }),
    cursor: lastDocument,
    hasMore: responseSnapshot.size > 20,
    totalCount,
  };
}
async function syncTeamRosters(companyId: string, members: Array<DocumentWithId<CompanyMember>>) {
  const db = getFirebaseDb();
  const operations: Array<{ type: "set" | "delete"; ref: ReturnType<typeof doc>; data?: CompanyMember }> = [];
  for (const member of members) {
    const teamIds = Array.isArray(member.teamIds) ? member.teamIds : [];
    for (const teamId of teamIds) {
      const ref = doc(db, "companies", companyId, "teams", teamId, "members", member.uid);
      if (member.role !== "ADMIN" && member.status === "ACTIVE") {
        operations.push({ type: "set", ref, data: {
          uid: member.uid, name: member.name, email: member.email, role: member.role,
          status: member.status, teamIds, ...(typeof member.positionTitle === "string" ? { positionTitle: member.positionTitle } : {}),
        } });
      } else {
        operations.push({ type: "delete", ref });
      }
    }
  }

  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(offset, offset + 450)) {
      if (operation.type === "set") batch.set(operation.ref, operation.data!);
      else batch.delete(operation.ref);
    }
    await batch.commit();
  }
  await updateDoc(companyDocument(companyId), {
    teamRosterVersion: 2, teamRosterSyncedAt: serverTimestamp(),
  });
}

export async function updateMember(
  companyId: string,
  member: DocumentWithId<CompanyMember>,
  changes: Partial<Pick<CompanyMember, "role" | "status" | "teamIds" | "name" | "positionTitle">>,
) {
  const db = getFirebaseDb();
  const next = { ...member, ...changes };
  const oldTeamIds = Array.isArray(member.teamIds) ? member.teamIds : [];
  const nextTeamIds = Array.isArray(next.teamIds) ? next.teamIds : [];
  const batch = writeBatch(db);
  batch.update(memberDocument(companyId, member.uid), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  for (const teamId of new Set([...oldTeamIds, ...nextTeamIds])) {
    const rosterRef = doc(db, "companies", companyId, "teams", teamId, "members", member.uid);
    if (nextTeamIds.includes(teamId) && next.status === "ACTIVE" && next.role !== "ADMIN") {
      batch.set(rosterRef, {
        uid: member.uid, name: next.name, email: next.email, role: next.role,
        status: next.status, teamIds: nextTeamIds, ...(typeof next.positionTitle === "string" ? { positionTitle: next.positionTitle } : {}),
      });
    } else {
      batch.delete(rosterRef);
    }
  }
  await batch.commit();
}

export async function createDepartment(companyId: string, name: string) {
  return addDoc(companyCollection(companyId, "departments"), {
    name: name.trim(), active: true, createdAt: serverTimestamp(),
  });
}

export async function updateDepartment(companyId: string, departmentId: string, name: string) {
  const cleanName = name.trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error("O nome do setor deve ter entre 2 e 100 caracteres.");
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "departments", departmentId), {
    name: cleanName, updatedAt: serverTimestamp(),
  });
}

export async function updateCompanyName(companyId: string, name: string) {
  await updateDoc(companyDocument(companyId), {
    name: name.trim(), updatedAt: serverTimestamp(),
  });
}

export async function createTeam(companyId: string, name: string, departmentId: string) {
  return addDoc(companyCollection(companyId, "teams"), {
    name: name.trim(), departmentId, active: true, createdAt: serverTimestamp(),
  });
}

export async function updateTeam(companyId: string, teamId: string, name: string) {
  const cleanName = name.trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error("O nome da equipe deve ter entre 2 e 100 caracteres.");
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "teams", teamId), {
    name: cleanName, updatedAt: serverTimestamp(),
  });
}

export async function createCriterion(companyId: string, name: string, evaluationType: FirebaseEvaluationType, position: number) {
  return addDoc(companyCollection(companyId, "criteria"), {
    name: name.trim(), evaluationType, position, active: true, createdAt: serverTimestamp(),
  });
}

export async function updateCriterion(companyId: string, criterionId: string, changes: Partial<CriterionDocument>) {
  if (changes.name !== undefined) {
    const cleanName = changes.name.trim();
    if (cleanName.length < 2 || cleanName.length > 100) throw new Error("O nome do critério deve ter entre 2 e 100 caracteres.");
    changes = { ...changes, name: cleanName };
  }
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "criteria", criterionId), {
    ...changes, updatedAt: serverTimestamp(),
  });
}

function validateCycleDates(input: Pick<CycleDocument, "name" | "startsAt" | "endsAt">) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) throw new Error("O nome do ciclo deve ter entre 2 e 100 caracteres.");
  if (!isValidDate(input.startsAt ?? "") || !isValidDate(input.endsAt ?? "") || input.startsAt! > input.endsAt!) {
    throw new Error("Informe datas válidas e garanta que o início seja anterior ou igual ao fim.");
  }
}

function cycleDateBoundaries(startsAt: string, endsAt: string) {
  const [startYear, startMonth, startDay] = startsAt.split("-").map(Number);
  const [endYear, endMonth, endDay] = endsAt.split("-").map(Number);
  return {
    startsAtAt: Timestamp.fromDate(new Date(startYear, startMonth - 1, startDay)),
    endsAtAt: Timestamp.fromDate(new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999)),
  };
}

export async function createCycle(
  companyId: string,
  input: { name: string; startsAt: string; endsAt: string; status: CycleDocument["status"] },
  existingCycles: Array<DocumentWithId<CycleDocument>>,
) {
  validateCycleDates(input);
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  const cycleRef = doc(companyCollection(companyId, "cycles"));
  if (input.status === "OPEN") {
    existingCycles.filter((cycle) => cycle.status === "OPEN").forEach((cycle) => {
      batch.update(doc(db, "companies", companyId, "cycles", cycle.id), {
        status: "CLOSED", updatedAt: serverTimestamp(),
      });
    });
  }
  batch.set(cycleRef, {
    ...input,
    name: input.name.trim(),
    ...cycleDateBoundaries(input.startsAt, input.endsAt),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return cycleRef;
}

export async function updateCycle(
  companyId: string,
  cycleId: string,
  changes: { name: string; startsAt: string; endsAt: string; status: CycleDocument["status"] },
  existingCycles: Array<DocumentWithId<CycleDocument>>,
) {
  validateCycleDates(changes);
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  if (changes.status === "OPEN") {
    existingCycles.filter((cycle) => cycle.id !== cycleId && cycle.status === "OPEN").forEach((cycle) => {
      batch.update(doc(db, "companies", companyId, "cycles", cycle.id), {
        status: "CLOSED", updatedAt: serverTimestamp(),
      });
    });
  }
  batch.update(doc(db, "companies", companyId, "cycles", cycleId), {
    ...changes,
    name: changes.name.trim(),
    ...cycleDateBoundaries(changes.startsAt, changes.endsAt),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export async function createSurvey(companyId: string, input: {
  name: string;
  startsAt: string;
  endsAt: string;
  audience: Array<Exclude<FirebaseRole, "ADMIN">>;
  questions: Array<{ prompt: string; type: SurveyQuestion["type"] }>;
}) {
  const name = input.name.trim();
  const questions = input.questions.map((question, position) => ({
    id: `question-${position + 1}`,
    prompt: question.prompt.trim(),
    type: question.type,
  }));
  if (name.length < 2 || name.length > 100) throw new Error("O nome da pesquisa deve ter entre 2 e 100 caracteres.");
  if (!isValidDate(input.startsAt) || !isValidDate(input.endsAt) || input.startsAt > input.endsAt) {
    throw new Error("Informe datas válidas e garanta que o início seja anterior ou igual ao fim.");
  }
  if (!input.audience.length || input.audience.some((role) => role !== "LEADER" && role !== "EMPLOYEE")) {
    throw new Error("Selecione pelo menos um público para responder à pesquisa.");
  }
  if (!questions.length || questions.length > 20 || questions.some((question) =>
    question.prompt.length < 2 || question.prompt.length > 500 || !["TEXT", "RATING"].includes(question.type),
  )) {
    throw new Error("A pesquisa precisa ter de 1 a 20 perguntas válidas.");
  }
  return addDoc(companyCollection(companyId, "surveys"), {
    name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...cycleDateBoundaries(input.startsAt, input.endsAt),
    audience: [...new Set(input.audience)],
    questions,
    active: true,
    createdAt: serverTimestamp(),
  } satisfies Omit<SurveyDocument, "createdAt"> & { createdAt: unknown });
}

export async function updateSurveyStatus(companyId: string, surveyId: string, active: boolean) {
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "surveys", surveyId), {
    active,
    updatedAt: serverTimestamp(),
  });
}

export async function submitSurveyResponse(input: {
  companyId: string;
  surveyId: string;
  answers: Array<{ questionId: string; value: string | number }>;
}) {
  const result = await requestServerApi("/api/surveys/responses", "POST", input);
  if (typeof result.responseId !== "string") throw new Error("O servidor não retornou o identificador da resposta.");
  return result.responseId;
}
export async function createChecklistTemplate(companyId: string, input: {
  name: string;
  departmentId: string;
  frequency: ChecklistTemplateDocument["frequency"];
  scheduleEnabled?: boolean;
  publishWeekday?: number;
  publishDayOfMonth?: number;
  responsible: ChecklistTemplateDocument["responsible"];
  items: string[];
  createdById: string;
  teamIds: string[];
}) {
  const cleanName = input.name.trim();
  const cleanItems = input.items.map((description) => description.trim()).filter(Boolean);
  const teamIds = [...new Set(input.teamIds)];
  if (cleanName.length < 2 || cleanName.length > 100) {
    throw new Error("O nome do checklist deve ter entre 2 e 100 caracteres.");
  }
  if (!cleanItems.length || cleanItems.length > 450) {
    throw new Error("O checklist precisa ter entre 1 e 450 tarefas.");
  }
  if (!teamIds.length) {
    throw new Error("Selecione ao menos uma equipe para este checklist.");
  }
  validateChecklistSchedule(input.frequency, input.scheduleEnabled, input.publishWeekday, input.publishDayOfMonth);
  return addDoc(companyCollection(companyId, "checklistTemplates"), {
    ...input,
    name: cleanName,
    teamIds,
    items: cleanItems.map((description, position) => ({
      id: `item-${position + 1}`,
      description: description.trim(),
      position,
    })),
    active: true,
    createdAt: serverTimestamp(),
  });
}

export async function updateChecklistTemplate(companyId: string, templateId: string, active: boolean) {
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "checklistTemplates", templateId), {
    active, updatedAt: serverTimestamp(),
  });
}

export async function saveChecklistTemplate(companyId: string, templateId: string, input: {
  name: string;
  departmentId: string;
  frequency: ChecklistTemplateDocument["frequency"];
  scheduleEnabled?: boolean;
  publishWeekday?: number;
  publishDayOfMonth?: number;
  responsible: ChecklistTemplateDocument["responsible"];
  items: string[];
  teamIds: string[];
}) {
  const cleanName = input.name.trim();
  const cleanItems = input.items.map((description) => description.trim()).filter(Boolean);
  const teamIds = [...new Set(input.teamIds)];
  if (cleanName.length < 2 || cleanName.length > 100) {
    throw new Error("O nome do checklist deve ter entre 2 e 100 caracteres.");
  }
  if (!cleanItems.length || cleanItems.length > 450) {
    throw new Error("O checklist precisa ter entre 1 e 450 tarefas.");
  }
  if (!teamIds.length) {
    throw new Error("Selecione ao menos uma equipe para este checklist.");
  }
  validateChecklistSchedule(input.frequency, input.scheduleEnabled, input.publishWeekday, input.publishDayOfMonth);
  await updateDoc(doc(getFirebaseDb(), "companies", companyId, "checklistTemplates", templateId), {
    name: cleanName,
    departmentId: input.departmentId,
    frequency: input.frequency,
    scheduleEnabled: input.scheduleEnabled ?? false,
    publishWeekday: input.publishWeekday ?? null,
    publishDayOfMonth: input.publishDayOfMonth ?? null,
    responsible: input.responsible,
    teamIds,
    items: cleanItems.map((description, position) => ({
      id: `item-${position + 1}`,
      description: description.trim(),
      position,
    })),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteChecklistTemplate(companyId: string, templateId: string) {
  await deleteDoc(doc(getFirebaseDb(), "companies", companyId, "checklistTemplates", templateId));
}

/**
 * Remove em lotes todos os documentos de uma coleção (ou subcoleção).
 * O Firestore não faz exclusão em cascata, então limpamos as subcoleções
 * antes de remover o documento pai.
 */
async function deleteCollectionDocuments(collectionRef: CollectionReference) {
  for (;;) {
    const snapshot = await getDocs(query(collectionRef, limit(450)));
    if (!snapshot.size) return;
    const batch = writeBatch(getFirebaseDb());
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    if (snapshot.size < 450) return;
  }
}

export async function deleteDepartment(companyId: string, departmentId: string) {
  await deleteDoc(doc(getFirebaseDb(), "companies", companyId, "departments", departmentId));
}

export async function deleteTeam(companyId: string, teamId: string) {
  const db = getFirebaseDb();
  await deleteCollectionDocuments(collection(db, "companies", companyId, "teams", teamId, "members"));
  await deleteDoc(doc(db, "companies", companyId, "teams", teamId));
}

export async function deleteCriterion(companyId: string, criterionId: string) {
  await deleteDoc(doc(getFirebaseDb(), "companies", companyId, "criteria", criterionId));
}

export async function deleteCycle(companyId: string, cycleId: string) {
  await deleteDoc(doc(getFirebaseDb(), "companies", companyId, "cycles", cycleId));
}

export async function deleteSurvey(companyId: string, surveyId: string) {
  const db = getFirebaseDb();
  await deleteCollectionDocuments(surveyResponses(companyId, surveyId));
  await deleteCollectionDocuments(collection(db, "companies", companyId, "surveys", surveyId, "participants"));
  await deleteDoc(doc(db, "companies", companyId, "surveys", surveyId));
}

export async function deleteChecklistAssignment(companyId: string, assignmentId: string) {
  await deleteCollectionDocuments(checklistAssignmentResults(companyId, assignmentId));
  await deleteDoc(checklistAssignmentDocument(companyId, assignmentId));
}

export async function removeMember(companyId: string, memberUid: string, teamIds: string[]) {
  const db = getFirebaseDb();
  const batch = writeBatch(db);
  for (const teamId of new Set(teamIds ?? [])) {
    batch.delete(doc(db, "companies", companyId, "teams", teamId, "members", memberUid));
  }
  batch.delete(memberDocument(companyId, memberUid));
  await batch.commit();
}

export async function createChecklistAssignments(input: {
  companyId: string;
  templateId: string;
  template: ChecklistTemplateDocument;
  assignedToIds: string[];
  assignedById: string;
  assignedByRole: FirebaseRole;
  dueAt?: string;
  publishOn?: "TODAY" | "TOMORROW";
}) {
  const db = getFirebaseDb();
  const targets = [...new Set(input.assignedToIds)];
  if (!targets.length) throw new Error("Selecione ao menos uma pessoa para atribuir o checklist.");
  if (input.template.items.length > 450) throw new Error("Este checklist tem tarefas demais para ser atribuído.");
  const scheduledFor = getChecklistPublicationDate(input.publishOn ?? "TODAY");
  const dueAt = input.template.frequency === "CUSTOM"
    ? input.dueAt
    : calculateChecklistDueDate(input.template.frequency, scheduledFor);
  if (!dueAt) throw new Error("Informe o prazo para checklists personalizados.");
  if (input.template.frequency === "CUSTOM" && dueAt < scheduledFor) {
    throw new Error("O prazo do checklist precisa ser igual ou posterior à data de publicação.");
  }
  if (input.assignedByRole !== "ADMIN" && (
    input.template.responsible !== "EMPLOYEE"
    || input.template.createdById !== input.assignedById
    || !input.template.teamIds?.length
  )) {
    throw new Error("Líderes só podem atribuir modelos próprios de colaboradores às equipes vinculadas.");
  }

  const assignments = targets.map((assignedToId) => ({
    ref: doc(companyCollection(input.companyId, "checklistAssignments")),
    data: {
      templateId: input.templateId,
      name: input.template.name,
      departmentId: input.template.departmentId,
      items: input.template.items,
      assignedToId,
      assignedById: input.assignedById,
      status: "PENDING",
      dueAt,
      frequency: input.template.frequency,
      scheduledFor,
      createdAt: serverTimestamp(),
    } satisfies Omit<ChecklistAssignmentDocument, "createdAt"> & { createdAt: unknown },
  }));
  let batch = writeBatch(db);
  let operationCount = 0;
  for (const assignment of assignments) {
    if (operationCount + 1 > 450) {
      await batch.commit();
      batch = writeBatch(db);
      operationCount = 0;
    }

    batch.set(assignment.ref, assignment.data);
    operationCount += 1;
  }
  await batch.commit();

  batch = writeBatch(db);
  operationCount = 0;
  for (const assignment of assignments) {
    for (const item of input.template.items) {
      if (operationCount + 1 > 450) {
        await batch.commit();
        batch = writeBatch(db);
        operationCount = 0;
      }
      batch.set(doc(checklistAssignmentResults(input.companyId, assignment.ref.id), item.id), {
        status: "PENDING",
        observation: "",
        completedAt: null,
      });
      operationCount += 1;
    }
  }
  if (operationCount) await batch.commit();
}

export function calculateChecklistDueDate(
  frequency: ChecklistTemplateDocument["frequency"],
  fromDate: string | Date = new Date(),
) {
  if (frequency === "CUSTOM") return undefined;
  const dueDate = typeof fromDate === "string"
    ? parseLocalDate(fromDate)
    : new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  if (frequency === "WEEKLY") dueDate.setDate(dueDate.getDate() + ((7 - dueDate.getDay()) % 7));
  if (frequency === "MONTHLY") {
    dueDate.setDate(1);
    dueDate.setMonth(dueDate.getMonth() + 1);
    dueDate.setDate(0);
  }
  return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`;
}

function getChecklistPublicationDate(publishOn: "TODAY" | "TOMORROW") {
  const date = new Date();
  if (publishOn === "TOMORROW") date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validateChecklistSchedule(
  frequency: ChecklistTemplateDocument["frequency"],
  scheduleEnabled = false,
  publishWeekday?: number,
  publishDayOfMonth?: number,
) {
  if (!scheduleEnabled) return;
  if (frequency === "CUSTOM") throw new Error("Checklists personalizados não podem ser publicados automaticamente.");
  if (frequency === "WEEKLY" && (!Number.isInteger(publishWeekday) || publishWeekday! < 0 || publishWeekday! > 6)) {
    throw new Error("Escolha o dia da semana para publicação.");
  }
  if (frequency === "MONTHLY" && (!Number.isInteger(publishDayOfMonth) || publishDayOfMonth! < 1 || publishDayOfMonth! > 31)) {
    throw new Error("Escolha o dia do mês para publicação.");
  }
}

export async function saveChecklistResult(input: {
  companyId: string;
  assignmentId: string;
  itemId: string;
  complete: boolean;
  observation?: string;
}) {
  await updateDoc(doc(checklistAssignmentResults(input.companyId, input.assignmentId), input.itemId), {
    status: input.complete ? "COMPLETED" : "PENDING",
    observation: input.observation ?? "",
    completedAt: input.complete ? serverTimestamp() : null,
  });
}

export async function updateAssignmentStatus(companyId: string, assignmentId: string, status: "PENDING" | "COMPLETED") {
  await updateDoc(checklistAssignmentDocument(companyId, assignmentId), {
    status, updatedAt: serverTimestamp(),
  });
}

export async function submitEvaluation(input: {
  companyId: string;
  cycleId: string;
  evaluatorId: string;
  evaluatedUserId: string;
  type: FirebaseEvaluationType;
  comment: string;
  answers: Array<{ criterionId: string; score: number }>;
}, existingEvaluationId?: string) {
  const result = await requestServerApi("/api/evaluations", "POST", { ...input, existingEvaluationId });
  if (typeof result.evaluationId !== "string") throw new Error("O servidor não retornou o identificador da avaliação.");
  return result.evaluationId;
}
export async function saveEvaluationDraft(input: {
  companyId: string;
  cycleId: string;
  evaluatorId: string;
  evaluatedUserId: string;
  type: FirebaseEvaluationType;
  comment: string;
  answers: Array<{ criterionId: string; score: number }>;
}, existingEvaluationId?: string) {
  if (input.answers.some((answer) => !Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5)) {
    throw new Error("As notas do rascunho precisam estar entre 1 e 5.");
  }
  const db = getFirebaseDb();
  const draftData = {
    cycleId: input.cycleId,
    evaluatorId: input.evaluatorId,
    evaluatedUserId: input.evaluatedUserId,
    type: input.type,
    status: "DRAFT" as const,
    comment: input.comment.trim(),
    updatedAt: serverTimestamp(),
  };
  const evaluationRef = existingEvaluationId
    ? evaluationDocument(input.companyId, existingEvaluationId)
    : evaluationDocument(input.companyId, evaluationDraftId(input.companyId, input.cycleId, input.evaluatorId, input.evaluatedUserId, input.type));
  if (existingEvaluationId) await updateDoc(evaluationRef, draftData);
  else await setDoc(evaluationRef, { ...draftData, createdAt: serverTimestamp() });

  const answerBatch = writeBatch(db);
  for (const answer of input.answers) {
    answerBatch.set(doc(evaluationAnswers(input.companyId, evaluationRef.id), answer.criterionId), answer);
  }
  await answerBatch.commit();
  return evaluationRef.id;
}

export async function loadEvaluationAnswers(companyId: string, evaluationId: string) {
  const snapshot = await getDocs(evaluationAnswers(companyId, evaluationId));
  return withIds<EvaluationAnswerWithId>(snapshot);
}
