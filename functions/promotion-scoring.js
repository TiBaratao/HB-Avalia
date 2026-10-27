const PROMOTION_INDICATORS = Object.freeze([
  Object.freeze({ id: "sector-sales-target", name: "Meta de vendas do setor", weight: 15 }),
  Object.freeze({ id: "sector-loss", name: "Perda do setor", weight: 12 }),
  Object.freeze({ id: "carcass-yield", name: "Rendimento de carcaça", weight: 10 }),
  Object.freeze({ id: "hygiene-good-practices", name: "Higiene e boas práticas", weight: 8 }),
  Object.freeze({ id: "weighing-labeling", name: "Pesagem e etiquetagem", weight: 8 }),
  Object.freeze({ id: "availability-absenteeism", name: "Disponibilidade/absenteísmo", weight: 7 }),
  Object.freeze({ id: "store-revenue-target", name: "Meta de faturamento da loja", weight: 10 }),
  Object.freeze({ id: "margin-target", name: "Meta de margem", weight: 10 }),
]);

const PROMOTION_COMPETENCIES = Object.freeze([
  Object.freeze({ id: "attendance-discipline", name: "Assiduidade e disciplina", weight: 8 }),
  Object.freeze({ id: "teamwork", name: "Trabalho em equipe", weight: 8 }),
  Object.freeze({ id: "proactivity", name: "Proatividade", weight: 8 }),
  Object.freeze({ id: "rules-safety-compliance", name: "Aderência a normas e segurança", weight: 8 }),
  Object.freeze({ id: "customer-service", name: "Atendimento ao cliente", weight: 8 }),
]);

const INDICATOR_WEIGHT_TOTAL = PROMOTION_INDICATORS.reduce((total, item) => total + item.weight, 0);
const COMPETENCY_WEIGHT_TOTAL = PROMOTION_COMPETENCIES.reduce((total, item) => total + item.weight, 0);
const INDICATOR_BASE_LIMIT = 60;
const PROMOTION_INDICATOR_PERCENTAGE_MAX = 100;

function round(value) {
  return Number(value.toFixed(4));
}

function validatePartialItems(items, definitions, fieldName) {
  if (!Array.isArray(items) || items.length > definitions.length) {
    throw new Error(`Há itens demais ou uma lista inválida em ${fieldName}.`);
  }
  const itemsById = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || itemsById.has(item.id)) {
      throw new Error(`Há um item inválido ou duplicado em ${fieldName}.`);
    }
    itemsById.set(item.id, item);
  }
  if ([...itemsById.keys()].some((id) => !definitions.some((definition) => definition.id === id))) {
    throw new Error(`Há um item desconhecido em ${fieldName}.`);
  }
  return definitions.map((definition) => ({ definition, item: itemsById.get(definition.id) }));
}

function classifyPromotionEvaluationResult(result) {
  if (!Number.isFinite(result)) throw new Error("O resultado da promoção precisa ser numérico.");
  if (result >= 90) return "Excelente";
  if (result >= 80) return "Bom";
  if (result >= 70) return "Regular";
  return "Insuficiente";
}

function restorePromotionEvaluationInputs(snapshot) {
  const indicators = Array.isArray(snapshot?.indicators) ? snapshot.indicators : [];
  const competencies = Array.isArray(snapshot?.competencies) ? snapshot.competencies : [];
  return {
    indicators: PROMOTION_INDICATORS.map(({ id }) => {
      const saved = indicators.find((item) => item?.id === id);
      return {
        id,
        percentage: Number.isFinite(saved?.percentage) && saved.percentage >= 0 && saved.percentage <= PROMOTION_INDICATOR_PERCENTAGE_MAX
          ? saved.percentage
          : "",
      };
    }),
    competencies: PROMOTION_COMPETENCIES.map(({ id }) => {
      const saved = competencies.find((item) => item?.id === id);
      return {
        id,
        score: Number.isInteger(saved?.score) && saved.score >= 1 && saved.score <= 5
          ? saved.score
          : "",
      };
    }),
  };
}

function calculatePromotionEvaluationPreview(indicators = [], competencies = []) {
  const calculatedIndicators = validatePartialItems(indicators, PROMOTION_INDICATORS, "indicadores")
    .flatMap(({ definition, item }) => {
      if (!item || item.percentage === undefined || item.percentage === "") return [];
      if (!Number.isFinite(item.percentage) || item.percentage < 0 || item.percentage > PROMOTION_INDICATOR_PERCENTAGE_MAX) {
        throw new Error(`O percentual de "${definition.name}" deve estar entre 0% e ${PROMOTION_INDICATOR_PERCENTAGE_MAX}%.`);
      }
      let effectivePercentage = item.percentage;
      if (definition.id === "sector-loss") {
        effectivePercentage = Math.max(0, PROMOTION_INDICATOR_PERCENTAGE_MAX - item.percentage);
      }
      const points = round(definition.weight * (effectivePercentage / 100));
      return [{
        id: definition.id,
        name: definition.name,
        weight: definition.weight,
        percentage: item.percentage,
        points,
      }];
    });
  const calculatedCompetencies = validatePartialItems(competencies, PROMOTION_COMPETENCIES, "competências")
    .flatMap(({ definition, item }) => {
      if (!item || item.score === undefined || item.score === "") return [];
      if (!Number.isInteger(item.score) || item.score < 1 || item.score > 5) {
        throw new Error(`A nota de "${definition.name}" deve ser um número inteiro de 1 a 5.`);
      }
      return [{
        id: definition.id,
        name: definition.name,
        weight: definition.weight,
        score: item.score,
        points: round((item.score / 5) * definition.weight),
      }];
    });

  const indicatorTotal = round(calculatedIndicators.reduce((total, item) => total + item.points, 0));
  const indicatorBase = round(Math.min(indicatorTotal, INDICATOR_BASE_LIMIT));
  const extraScore = round(Math.max(0, indicatorTotal - INDICATOR_BASE_LIMIT));
  const competenceTotal = round(calculatedCompetencies.reduce((total, item) => total + item.points, 0));
  const baseScore = round(indicatorBase + competenceTotal);
  const finalScore = round(baseScore + extraScore);
  const complete = calculatedIndicators.length === PROMOTION_INDICATORS.length
    && calculatedCompetencies.length === PROMOTION_COMPETENCIES.length;

  return {
    indicators: calculatedIndicators,
    competencies: calculatedCompetencies,
    indicatorWeightTotal: INDICATOR_WEIGHT_TOTAL,
    competenceWeightTotal: COMPETENCY_WEIGHT_TOTAL,
    indicatorTotal,
    indicatorBase,
    extraScore,
    competenceTotal,
    baseScore,
    finalScore,
    complete,
    classification: complete ? classifyPromotionEvaluationResult(finalScore) : null,
  };
}

function calculatePromotionEvaluationResult(indicators, competencies) {
  if (!Array.isArray(indicators) || indicators.length !== PROMOTION_INDICATORS.length) {
    throw new Error(`Informe todos os ${PROMOTION_INDICATORS.length} itens de indicadores.`);
  }
  if (!Array.isArray(competencies) || competencies.length !== PROMOTION_COMPETENCIES.length) {
    throw new Error(`Informe todos os ${PROMOTION_COMPETENCIES.length} itens de competências.`);
  }
  const preview = calculatePromotionEvaluationPreview(indicators, competencies);
  if (!preview.complete) throw new Error("Preencha todos os indicadores e competências antes de concluir a avaliação.");
  return { ...preview, classification: classifyPromotionEvaluationResult(preview.finalScore) };
}

module.exports = {
  PROMOTION_INDICATORS,
  PROMOTION_COMPETENCIES,
  INDICATOR_WEIGHT_TOTAL,
  COMPETENCY_WEIGHT_TOTAL,
  INDICATOR_BASE_LIMIT,
  PROMOTION_INDICATOR_PERCENTAGE_MAX,
  calculatePromotionEvaluationResult,
  calculatePromotionEvaluationPreview,
  classifyPromotionEvaluationResult,
  restorePromotionEvaluationInputs,
};
