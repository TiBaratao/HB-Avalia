export type FirebaseRole = "ADMIN" | "LEADER" | "EMPLOYEE";
export type FirebaseEvaluationType = "EMPLOYEE" | "LEADER";
export type FirebaseEvaluationStatus = "DRAFT" | "SUBMITTED";

export type DocumentWithId<T> = T & { id: string };

export interface CompanyDocument {
  id?: string;
  name: string;
  ownerUid: string;
  createdAt?: unknown;
  teamRosterVersion?: number;
  teamRosterSyncedAt?: unknown;
}

export interface CompanyMember {
  uid: string;
  name: string;
  email: string;
  role: FirebaseRole;
  status: "ACTIVE" | "INACTIVE";
  teamIds: string[];
  positionTitle?: string;
}

export interface EvaluationDocument {
  cycleId: string;
  evaluatorId: string;
  evaluatedUserId: string;
  type: FirebaseEvaluationType;
  status: FirebaseEvaluationStatus;
  comment?: string;
  averageScore?: number;
  submittedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EvaluationAnswerDocument {
  criterionId: string;
  score: number;
}

export interface ChecklistTemplateDocument {
  name: string;
  departmentId: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  scheduleEnabled?: boolean;
  publishWeekday?: number;
  publishDayOfMonth?: number;
  responsible: "EMPLOYEE" | "LEADER" | "UNASSIGNED";
  items: Array<{ id: string; description: string; position: number }>;
  active: boolean;
  createdById?: string;
  teamIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DepartmentDocument {
  name: string;
  active: boolean;
}

export interface TeamDocument {
  name: string;
  departmentId: string;
  active: boolean;
}

export interface CriterionDocument {
  name: string;
  evaluationType: FirebaseEvaluationType;
  active: boolean;
  position: number;
}

export interface CycleDocument {
  name: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  startsAt?: string;
  endsAt?: string;
  startsAtAt?: unknown;
  endsAtAt?: unknown;
}

export interface SurveyQuestion {
  id: string;
  prompt: string;
  type: "TEXT" | "RATING";
}

export interface SurveyDocument {
  name: string;
  startsAt: string;
  endsAt: string;
  startsAtAt?: unknown;
  endsAtAt?: unknown;
  audience: Array<Exclude<FirebaseRole, "ADMIN">>;
  questions: SurveyQuestion[];
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SurveyResponseDocument {
  answers: Array<{ questionId: string; value: string | number }>;
  submittedAt?: unknown;
}

export interface DevelopmentGoal {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  completedAt?: number | null;
}

export interface DevelopmentPlanDocument {
  employeeId: string;
  leaderId: string;
  teamIds: string[];
  targetPosition: string;
  goals: DevelopmentGoal[];
  status: "ACTIVE" | "PROMOTED";
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PromotionEvaluationSnapshot {
  evaluationId: string;
  cycleName: string;
  score: number;
  comment: string;
  submittedAt?: unknown;
}

export interface PromotionRequestStatusDocument {
  employeeId: string;
  leaderId: string;
  teamIds: string[];
  requestId: string;
  targetPosition: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt?: unknown;
  adminId?: string;
  adminNote?: string;
  decidedAt?: unknown;
  updatedAt?: unknown;
}

export interface PromotionRequestDocument {
  employeeId: string;
  leaderId: string;
  developmentPlanId: string;
  targetPosition: string;
  justification: string;
  averageScore: number | null;
  evaluations: PromotionEvaluationSnapshot[];
  goals: DevelopmentGoal[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminId?: string;
  adminNote?: string;
  submittedAt?: unknown;
  decidedAt?: unknown;
}

export interface UserProfileDocument {
  companyId: string;
}

export interface ChecklistAssignmentDocument {
  templateId: string;
  name: string;
  departmentId: string;
  items: ChecklistTemplateDocument["items"];
  assignedToId: string;
  assignedById: string;
  status: "PENDING" | "COMPLETED";
  dueAt?: string;
  frequency?: ChecklistTemplateDocument["frequency"];
  scheduledFor?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChecklistResultDocument {
  status: "PENDING" | "COMPLETED";
  observation?: string;
  completedAt?: unknown;
}

export interface EvaluationAnswerWithId extends EvaluationAnswerDocument {
  id: string;
}

export interface EvaluationWithId extends EvaluationDocument {
  id: string;
}
