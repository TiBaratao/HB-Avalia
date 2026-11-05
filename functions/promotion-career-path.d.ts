export const PROMOTION_CAREER_PATH: readonly string[];

export interface PromotionCareerProgress {
  currentPosition: string | null;
  nextPosition: string | null;
  isFinalPosition: boolean;
}

export function getPromotionCareerProgress(currentPosition: string | null | undefined): PromotionCareerProgress;
