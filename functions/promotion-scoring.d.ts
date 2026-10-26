export interface PromotionIndicatorDefinition {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}

export interface PromotionCompetencyDefinition {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}

export interface PromotionIndicatorInput {
  id: string;
  percentage: number;
}

export interface PromotionCompetencyInput {
  id: string;
  score: number;
}

export interface PromotionIndicatorResult extends PromotionIndicatorDefinition {
  percentage: number;
  points: number;
}

export interface PromotionCompetencyResult extends PromotionCompetencyDefinition {
  score: number;
  points: number;
}

export interface PromotionEvaluationResult {
  indicators: PromotionIndicatorResult[];
  competencies: PromotionCompetencyResult[];
  indicatorWeightTotal: number;
  competenceWeightTotal: number;
  indicatorTotal: number;
  indicatorBase: number;
  extraScore: number;
  competenceTotal: number;
  baseScore: number;
  finalScore: number;
  classification: "Excelente" | "Bom" | "Regular" | "Insuficiente";
}

export interface PromotionEvaluationPreview extends Omit<PromotionEvaluationResult, "classification"> {
  complete: boolean;
  classification: PromotionEvaluationResult["classification"] | null;
}

export interface RestoredPromotionEvaluationInputs {
  indicators: Array<{ id: string; percentage: number | "" }>;
  competencies: Array<{ id: string; score: number | "" }>;
}

export const PROMOTION_INDICATORS: readonly PromotionIndicatorDefinition[];
export const PROMOTION_COMPETENCIES: readonly PromotionCompetencyDefinition[];
export const INDICATOR_WEIGHT_TOTAL: number;
export const COMPETENCY_WEIGHT_TOTAL: number;
export const INDICATOR_BASE_LIMIT: number;
export const PROMOTION_INDICATOR_PERCENTAGE_MAX: number;
export function calculatePromotionEvaluationResult(
  indicators: PromotionIndicatorInput[],
  competencies: PromotionCompetencyInput[],
): PromotionEvaluationResult;
export function calculatePromotionEvaluationPreview(
  indicators: Array<{ id: string; percentage?: number | "" }>,
  competencies: Array<{ id: string; score?: number | "" }>,
): PromotionEvaluationPreview;
export function classifyPromotionEvaluationResult(
  result: number,
): PromotionEvaluationResult["classification"];
export function restorePromotionEvaluationInputs(snapshot?: {
  indicators?: Array<{ id?: string; percentage?: number }>;
  competencies?: Array<{ id?: string; score?: number }>;
} | null): RestoredPromotionEvaluationInputs;
