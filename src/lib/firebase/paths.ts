import { collection, doc } from "firebase/firestore";
import { getFirebaseDb } from "./client";

export const companyDocument = (companyId: string) =>
  doc(getFirebaseDb(), "companies", companyId);

export const userProfileDocument = (uid: string) =>
  doc(getFirebaseDb(), "userProfiles", uid);

export const memberDocument = (companyId: string, uid: string) =>
  doc(getFirebaseDb(), "companies", companyId, "members", uid);

export const companyCollection = (
  companyId: string,
  name:
    | "members"
    | "departments"
    | "teams"
    | "criteria"
    | "cycles"
    | "checklistTemplates"
    | "checklistAssignments"
    | "evaluations"
    | "surveys"
    | "developmentPlans"
    | "promotionRequests",
) => collection(getFirebaseDb(), "companies", companyId, name);

export const surveyResponses = (companyId: string, surveyId: string) =>
  collection(getFirebaseDb(), "companies", companyId, "surveys", surveyId, "responses");

export const surveyParticipantDocument = (companyId: string, surveyId: string, uid: string) =>
  doc(getFirebaseDb(), "companies", companyId, "surveys", surveyId, "participants", uid);

export const memberCollection = (companyId: string) =>
  collection(getFirebaseDb(), "companies", companyId, "members");

export const checklistAssignmentDocument = (companyId: string, assignmentId: string) =>
  doc(getFirebaseDb(), "companies", companyId, "checklistAssignments", assignmentId);

export const checklistAssignmentResults = (companyId: string, assignmentId: string) =>
  collection(getFirebaseDb(), "companies", companyId, "checklistAssignments", assignmentId, "results");

export const developmentPlanCollection = (companyId: string) =>
  collection(getFirebaseDb(), "companies", companyId, "developmentPlans");

export const developmentPlanDocument = (companyId: string, employeeId: string) =>
  doc(getFirebaseDb(), "companies", companyId, "developmentPlans", employeeId);

export const promotionRequestCollection = (companyId: string) =>
  collection(getFirebaseDb(), "companies", companyId, "promotionRequests");

export const promotionRequestDocument = (companyId: string, requestId: string) =>
  doc(getFirebaseDb(), "companies", companyId, "promotionRequests", requestId);

export const promotionRequestStatusDocument = (companyId: string, employeeId: string) =>
  doc(getFirebaseDb(), "companies", companyId, "promotionStatuses", employeeId);

export const evaluationDocument = (companyId: string, evaluationId: string) =>
  doc(getFirebaseDb(), "companies", companyId, "evaluations", evaluationId);

export const evaluationAnswers = (companyId: string, evaluationId: string) =>
  collection(
    getFirebaseDb(),
    "companies",
    companyId,
    "evaluations",
    evaluationId,
    "answers",
  );
