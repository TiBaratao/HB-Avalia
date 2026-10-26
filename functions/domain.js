const MAX_EVALUATION_CRITERIA = 100;
const MAX_SURVEY_QUESTIONS = 20;
const MAX_TEXT_ANSWER_LENGTH = 2000;
const DEFAULT_INDICATOR_FACTOR_LIMIT = 1.2;
const DEFAULT_COMPETENCE_MAX_SCORE = 5;
const DEFAULT_COMPETENCE_TOTAL_WEIGHT = 0.4;
const {
  PROMOTION_INDICATOR_PERCENTAGE_MAX,
  calculatePromotionEvaluationResult,
  classifyPromotionEvaluationResult,
} = require("./promotion-scoring");

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function summarizeWeightValidation(items, expectedTotal, label) {
  const activeItems = (Array.isArray(items) ? items : []).filter((item) => item && item.active !== false);
  const total = activeItems.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
  const valid = Math.abs(total - expectedTotal) < 1e-9;
  return {
    valid,
    total,
    expectedTotal,
    label,
    activeCount: activeItems.length,
  };
}

function calculateIndicatorFactor(percentage, maximumFactor = DEFAULT_INDICATOR_FACTOR_LIMIT) {
  if (!Number.isFinite(percentage)) {
    throw new Error("O percentual de atingimento precisa ser numérico.");
  }
  if (percentage < 0 || percentage > 120) {
    throw new Error("O percentual de atingimento deve estar entre 0% e 120%.");
  }
  const factor = clamp(percentage / 100, 0, maximumFactor);
  return Number(factor.toFixed(6));
}

function calculatePromotionIndicatorFactor(percentage, maximumFactor = 1) {
  if (!Number.isFinite(percentage)) {
    throw new Error("O percentual de atingimento precisa ser numérico.");
  }
  if (percentage < 0 || percentage > PROMOTION_INDICATOR_PERCENTAGE_MAX) {
    throw new Error(`O percentual de atingimento deve estar entre 0% e ${PROMOTION_INDICATOR_PERCENTAGE_MAX}%.`);
  }
  if (!Number.isFinite(maximumFactor) || maximumFactor < 0) {
    throw new Error("O fator máximo do indicador precisa ser numérico e não negativo.");
  }
  return Number(clamp(percentage / 100, 0, Math.min(maximumFactor, 1)).toFixed(6));
}

function calculateIndicatorPoints(weight, percentage, maximumFactor = DEFAULT_INDICATOR_FACTOR_LIMIT) {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error("O peso do indicador precisa ser um valor numérico não negativo.");
  }
  const factor = calculateIndicatorFactor(percentage, maximumFactor);
  const points = weight * factor * 100;
  return Number(points.toFixed(4));
}

function calculateCompetencePoints(weight, score, maxScore = DEFAULT_COMPETENCE_MAX_SCORE) {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error("O peso da competência precisa ser um valor numérico não negativo.");
  }
  if (!Number.isInteger(score) || score < 1 || score > maxScore) {
    throw new Error("As notas devem ser números inteiros de 1 a 5.");
  }
  const points = weight * (score / maxScore) * 100;
  return Number(points.toFixed(4));
}

function calculatePromotionIndicatorPoints(weight, percentage, maximumFactor = 1) {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error("O peso do indicador precisa ser um valor numérico não negativo.");
  }
  const factor = calculatePromotionIndicatorFactor(percentage, maximumFactor);
  return Number((weight * factor * 100).toFixed(4));
}

function calculatePromotionCompetencePoints(weight, score, maxScore = DEFAULT_COMPETENCE_MAX_SCORE) {
  return calculateCompetencePoints(weight, score, maxScore);
}

function classifyEvaluationResult(result) {
  const normalized = Number(result ?? 0);
  if (normalized >= 90) return "Excelente";
  if (normalized >= 80) return "Bom";
  if (normalized >= 70) return "Regular";
  return "Insuficiente";
}

function calculateEvaluationResult(indicators = [], competencies = []) {
  const indicatorTotal = (Array.isArray(indicators) ? indicators : []).reduce((sum, indicator) => {
    const weight = Number(indicator?.weight ?? 0);
    const percentage = Number(indicator?.percentage ?? 0);
    if (weight < 0 || percentage < 0) {
      throw new Error("Indicadores com peso ou percentual inválidos não podem ser calculados.");
    }
    return sum + calculateIndicatorPoints(weight, percentage);
  }, 0);

  const competenceTotal = (Array.isArray(competencies) ? competencies : []).reduce((sum, competence) => {
    const weight = Number(competence?.weight ?? 0);
    const score = Number(competence?.score ?? 0);
    if (weight < 0 || !Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error("Competências com peso ou nota inválidas não podem ser calculadas.");
    }
    return sum + calculateCompetencePoints(weight, score);
  }, 0);

  const finalScore = indicatorTotal + competenceTotal;
  const baseScore = Math.min(100, finalScore);
  const extraScore = Math.max(0, finalScore - 100);

  return {
    indicatorTotal: Number(indicatorTotal.toFixed(4)),
    competenceTotal: Number(competenceTotal.toFixed(4)),
    baseScore: Number(baseScore.toFixed(4)),
    extraScore: Number(extraScore.toFixed(4)),
    finalScore: Number(finalScore.toFixed(4)),
    classification: classifyEvaluationResult(finalScore),
  };
}

function validateEvaluationAnswers(criteria, answers) {
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > MAX_EVALUATION_CRITERIA) {
    throw new Error("O ciclo precisa ter entre 1 e 100 critérios ativos para este tipo de avaliação.");
  }
  if (!Array.isArray(answers) || answers.length !== criteria.length) {
    throw new Error("Responda todos os critérios ativos antes de enviar.");
  }

  const validIds = new Set(criteria.map((criterion) => criterion.id));
  const seenIds = new Set();
  const normalizedAnswers = answers.map((answer) => {
    if (!answer || typeof answer.criterionId !== "string" || !validIds.has(answer.criterionId)) {
      throw new Error("A avaliação contém um critério inválido ou inativo.");
    }
    if (seenIds.has(answer.criterionId)) {
      throw new Error("Cada critério deve ser respondido uma única vez.");
    }
    if (!Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5) {
      throw new Error("As notas devem ser números inteiros de 1 a 5.");
    }
    seenIds.add(answer.criterionId);
    return { criterionId: answer.criterionId, score: answer.score };
  });

  const averageScore = Number((normalizedAnswers.reduce((sum, answer) => sum + answer.score, 0) / normalizedAnswers.length).toFixed(2));
  return { answers: normalizedAnswers, averageScore };
}

function validateSurveyAnswers(questions, answers) {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > MAX_SURVEY_QUESTIONS) {
    throw new Error("A pesquisa não possui uma quantidade válida de perguntas.");
  }
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error("Responda todas as perguntas antes de enviar.");
  }

  const answersById = new Map();
  for (const answer of answers) {
    if (!answer || typeof answer.questionId !== "string" || answersById.has(answer.questionId)) {
      throw new Error("Cada pergunta deve ter exatamente uma resposta.");
    }
    answersById.set(answer.questionId, answer.value);
  }

  return questions.map((question) => {
    if (!question || typeof question.id !== "string" || !["TEXT", "RATING"].includes(question.type)) {
      throw new Error("A pesquisa contém uma pergunta inválida.");
    }
    const value = answersById.get(question.id);
    if (question.type === "TEXT") {
      if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT_ANSWER_LENGTH) {
        throw new Error("As respostas abertas devem ter entre 1 e 2.000 caracteres.");
      }
      return { questionId: question.id, value: value.trim() };
    }
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error("As notas da pesquisa devem ser números inteiros de 1 a 5.");
    }
    return { questionId: question.id, value };
  });
}

function averageEvaluationScores(evaluations) {
  if (!evaluations.length) return null;
  return Number((evaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / evaluations.length).toFixed(2));
}

module.exports = {
  MAX_EVALUATION_CRITERIA,
  MAX_SURVEY_QUESTIONS,
  DEFAULT_INDICATOR_FACTOR_LIMIT,
  DEFAULT_COMPETENCE_MAX_SCORE,
  DEFAULT_COMPETENCE_TOTAL_WEIGHT,
  clamp,
  calculateIndicatorFactor,
  calculatePromotionIndicatorFactor,
  calculateIndicatorPoints,
  calculatePromotionIndicatorPoints,
  calculateCompetencePoints,
  calculatePromotionCompetencePoints,
  classifyEvaluationResult,
  classifyPromotionEvaluationResult,
  calculateEvaluationResult,
  calculatePromotionEvaluationResult,
  summarizeWeightValidation,
  averageEvaluationScores,
  validateEvaluationAnswers,
  validateSurveyAnswers,
};
