export interface PromotionSecurityMember {
  role?: string;
  status?: string;
  teamIds?: unknown;
}

export function getMemberTeamIds(member: PromotionSecurityMember | undefined): string[];
export function getActiveSharedTeamIds(
  leader: PromotionSecurityMember | undefined,
  employee: PromotionSecurityMember | undefined,
): string[];
export function isActivePromotionAdmin(member: PromotionSecurityMember | undefined): boolean;
export function createPromotionEvaluationPrivacyFields(): {
  averageScore: null;
  evaluations: [];
  evaluationEvidenceVersion: 2;
};
export function createPromotionEvaluationEvidence(
  evaluation: {
    id: string;
    averageScore: number;
    comment?: unknown;
    submittedAt?: unknown;
  },
  cycle?: { name?: unknown } | null,
): {
  evaluationId: string;
  cycleName: string;
  score: number;
  comment: string;
  submittedAt?: unknown;
};
