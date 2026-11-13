export interface OrganizationAnalyticsEvaluation {
  id: string;
  evaluatedUserId: string;
  evaluatedUserName: string;
  evaluatedUserRole: "ADMIN" | "LEADER" | "EMPLOYEE" | null;
  cycleId: string;
  type: "EMPLOYEE" | "LEADER" | null;
  score: number;
  submittedAt: string | null;
  teamIds: string[];
  departmentIds: string[];
  competencies: Array<{ criterionId: string; criterionName: string; score: number }>;
}

export interface OrganizationStoreAnalytics {
  indicators: {
    activeMembers: number;
    employees: number;
    leaders: number;
    administrators: number;
    openCycles: number;
    evaluations: number;
    evaluationsSubmitted: number;
    expectedEvaluations: number;
    openCycleEvaluationsSubmitted: number;
    evaluationsPending: number;
    evaluationCompletionRate: number | null;
    averagePerformance: number | null;
    classificationCounts: Record<"Excelente" | "Bom" | "Regular" | "Insuficiente", number>;
    activeDevelopmentPlans: number;
    pendingDevelopmentGoals: number;
    developmentPlans: number;
    customerFeedbackResponses: number;
    customerSatisfaction: number | null;
  };
  evaluationTrend: Array<{ month: string; evaluations: number; averageScore: number }>;
  feedbackTrend: Array<{ month: string; responses: number; averageRating: number }>;
  feedbackRecords: Array<{ overallRating: number; submittedAt: string | null }>;
  departments: Array<{ id: string; name: string; evaluations: number; averageScore: number | null }>;
  teams: Array<{ id: string; name: string; evaluations: number; averageScore: number | null }>;
  people: Array<{
    uid: string;
    name: string;
    role: "ADMIN" | "LEADER" | "EMPLOYEE";
    teamIds: string[];
    departmentIds: string[];
    evaluations: number;
    averageScore: number;
  }>;
  pdiRecords: Array<{
    employeeId: string;
    employeeName: string;
    teamIds: string[];
    departmentIds: string[];
    pendingGoals: number;
    totalGoals: number;
    targetPosition: string;
  }>;
  evaluationRecords: OrganizationAnalyticsEvaluation[];
  competencyRecords: Array<{
    criterionId: string;
    criterionName: string;
    score: number;
    submittedAt: string | null;
    teamIds: string[];
    departmentIds: string[];
  }>;
}

export function buildStoreAnalytics(input: {
  members: Array<{ uid: string; name: string; role: string; status: string; teamIds: string[] }>;
  teams: Array<{ id: string; name: string; departmentId: string; active: boolean }>;
  departments: Array<{ id: string; name: string; active: boolean }>;
  cycles: Array<{ id: string; status: string }>;
  evaluations: Array<{
    id: string;
    cycleId: string;
    evaluatorId: string;
    evaluatedUserId: string;
    type: string;
    status: string;
    averageScore: number | null;
    submittedAt: string | null;
  }>;
  criteria?: Array<{ id: string; name: string; evaluationType: string; active: boolean }>;
  answers?: Array<{ evaluationId: string; criterionId: string; score: number }>;
  plans: Array<{ employeeId: string; status: string; goals?: Array<{ completed?: boolean }> }>;
  feedback: Array<{ overallRating: number; submittedAt: string | null }>;
}): OrganizationStoreAnalytics;
