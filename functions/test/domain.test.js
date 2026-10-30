const assert = require("node:assert/strict");
const test = require("node:test");
const {
  averageEvaluationScores,
  calculateCompetencePoints,
  calculateEvaluationResult,
  calculateIndicatorPoints,
  calculatePromotionEvaluationResult,
  calculatePromotionIndicatorFactor,
  calculatePromotionIndicatorPoints,
  classifyEvaluationResult,
  classifyPromotionEvaluationResult,
  summarizeWeightValidation,
  validateEvaluationAnswers,
  validateSurveyAnswers,
} = require("../domain");
const {
  PROMOTION_COMPETENCIES,
  PROMOTION_INDICATORS,
  calculatePromotionEvaluationPreview,
  restorePromotionEvaluationInputs,
} = require("../promotion-scoring");
const {
  createPromotionEvaluationEvidence,
  createPromotionEvaluationPrivacyFields,
  getActiveSharedTeamIds,
  isActivePromotionAdmin,
} = require("../promotion-security");

const criteria = [
  { id: "quality", active: true },
  { id: "teamwork", active: true },
];

test("evaluation score is derived from one integer answer per active criterion", () => {
  const result = validateEvaluationAnswers(criteria, [
    { criterionId: "teamwork", score: 4 },
    { criterionId: "quality", score: 5 },
  ]);
  assert.deepEqual(result.answers, [
    { criterionId: "teamwork", score: 4 },
    { criterionId: "quality", score: 5 },
  ]);
  assert.equal(result.averageScore, 4.5);
});

test("evaluation rejects missing, duplicate, unknown, or out-of-range answers", () => {
  assert.throws(() => validateEvaluationAnswers(criteria, [{ criterionId: "quality", score: 5 }]), /todos os critérios/);
  assert.throws(() => validateEvaluationAnswers(criteria, [
    { criterionId: "quality", score: 5 },
    { criterionId: "quality", score: 3 },
  ]), /única vez/);
  assert.throws(() => validateEvaluationAnswers(criteria, [
    { criterionId: "quality", score: 5 },
    { criterionId: "inactive", score: 3 },
  ]), /inválido/);
  assert.throws(() => validateEvaluationAnswers(criteria, [
    { criterionId: "quality", score: 5.5 },
    { criterionId: "teamwork", score: 3 },
  ]), /inteiros/);
});

test("indicator score matches the configured weight and achievement level", () => {
  // The generic evaluator retains its existing 120% rule for unrelated flows.
  assert.equal(calculateIndicatorPoints(0.15, 80), 12);
  assert.equal(calculateIndicatorPoints(0.15, 100), 15);
  assert.equal(calculateIndicatorPoints(0.15, 110), 16.5);
  assert.equal(calculateIndicatorPoints(0.15, 120), 18);
});

test("promotion indicator criteria are capped at 100% without affecting the extra score", () => {
  assert.equal(calculatePromotionIndicatorFactor(100), 1);
  assert.equal(calculatePromotionIndicatorPoints(0.15, 100), 15);
  assert.equal(calculatePromotionIndicatorPoints(0.15, 87.5), 13.125);
  assert.throws(() => calculatePromotionIndicatorFactor(100.01), /0% e 100%/);
  assert.throws(() => calculatePromotionIndicatorPoints(0.15, -0.01), /0% e 100%/);
  assert.equal(calculatePromotionIndicatorPoints(0.15, 100, 1.2), 15);
});

test("competence score follows the 1 to 5 scale and rejects invalid values", () => {
  assert.equal(calculateCompetencePoints(0.08, 1), 1.6);
  assert.equal(calculateCompetencePoints(0.08, 3), 4.8);
  assert.equal(calculateCompetencePoints(0.08, 5), 8);
  assert.throws(() => calculateCompetencePoints(0.08, 0), /1 a 5/);
  assert.throws(() => calculateCompetencePoints(0.08, 6), /1 a 5/);
});

test("competence totals are signaled when they do not reach the expected 40% active weight", () => {
  const invalid = summarizeWeightValidation([
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
  ], 0.4, "competências");
  assert.equal(invalid.valid, false);
  assert.equal(invalid.total, 0.32);

  const valid = summarizeWeightValidation([
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
    { active: true, weight: 0.08 },
  ], 0.4, "competências");
  assert.equal(valid.valid, true);
  assert.equal(valid.total, 0.4);
});

test("evaluation totals, extra percentage and classification follow the weighted model", () => {
  const baseCase = calculateEvaluationResult(
    [
      { weight: 0.15, percentage: 80 },
      { weight: 0.15, percentage: 80 },
      { weight: 0.15, percentage: 80 },
      { weight: 0.15, percentage: 80 },
    ],
    [
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
    ],
  );
  assert.equal(baseCase.indicatorTotal, 48);
  assert.equal(baseCase.competenceTotal, 40);
  assert.equal(baseCase.baseScore, 88);
  assert.equal(baseCase.extraScore, 0);
  assert.equal(baseCase.finalScore, 88);
  assert.equal(baseCase.classification, "Bom");

  const superatedCase = calculateEvaluationResult(
    [
      { weight: 0.4, percentage: 100 },
      { weight: 0.4, percentage: 100 },
      { weight: 0.2, percentage: 100 },
    ],
    [
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
      { weight: 0.08, score: 5 },
    ],
  );
  assert.equal(superatedCase.indicatorTotal, 100);
  assert.equal(superatedCase.competenceTotal, 40);
  assert.equal(superatedCase.baseScore, 100);
  assert.equal(superatedCase.extraScore, 40);
  assert.equal(superatedCase.finalScore, 140);
  assert.equal(superatedCase.classification, "Excelente");

  assert.equal(classifyEvaluationResult(121.6), "Excelente");
  assert.equal(classifyEvaluationResult(100), "Excelente");
  assert.equal(classifyEvaluationResult(90), "Excelente");
  assert.equal(classifyEvaluationResult(89.9), "Bom");
  assert.equal(classifyEvaluationResult(80), "Bom");
  assert.equal(classifyEvaluationResult(79.9), "Regular");
  assert.equal(classifyEvaluationResult(70), "Regular");
  assert.equal(classifyEvaluationResult(69.9), "Insuficiente");
});

test("promotion model uses the official PDI names and fixed section weights", () => {
  assert.deepEqual(PROMOTION_INDICATORS.map(({ name, weight }) => [name, weight]), [
    ["Meta de vendas do setor", 15],
    ["Perda do setor", 12],
    ["Rendimento de carcaça", 10],
    ["Higiene e boas práticas", 8],
    ["Pesagem e etiquetagem", 8],
    ["Disponibilidade/absenteísmo", 7],
    ["Meta de faturamento da loja", 10],
    ["Meta de margem", 10],
  ]);
  assert.deepEqual(PROMOTION_COMPETENCIES.map(({ name, weight }) => [name, weight]), [
    ["Assiduidade e disciplina", 8],
    ["Trabalho em equipe", 8],
    ["Proatividade", 8],
    ["Aderência a normas e segurança", 8],
    ["Atendimento ao cliente", 8],
  ]);
  assert.equal(PROMOTION_INDICATORS.reduce((sum, item) => sum + item.weight, 0), 80);
  assert.equal(PROMOTION_COMPETENCIES.reduce((sum, item) => sum + item.weight, 0), 40);
});

test("promotion scoring calculates zero, full attainment, extra above the indicator base, and decimals", () => {
  // "Perda do setor" is entered as a loss percentage, so 100% attainment means 0% loss.
  const indicatorsAt = (percentage) => PROMOTION_INDICATORS.map(({ id }) => ({
    id,
    percentage: id === "sector-loss" ? 100 - percentage : percentage,
  }));
  const competenciesAt = (score) => PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score }));

  const zero = calculatePromotionEvaluationResult(indicatorsAt(0), competenciesAt(1));
  assert.equal(zero.indicatorTotal, 0);
  assert.equal(zero.competenceTotal, 8);
  assert.equal(zero.finalScore, 8);

  const full = calculatePromotionEvaluationResult(indicatorsAt(100), competenciesAt(5));
  assert.equal(full.indicatorTotal, 80);
  assert.equal(full.indicatorBase, 60);
  assert.equal(full.extraScore, 20);
  assert.equal(full.competenceTotal, 40);
  assert.equal(full.baseScore, 100);
  assert.equal(full.finalScore, 120);
  assert.equal(full.classification, "Excelente");
  assert.deepEqual(full.indicators.map((item) => item.weight), [15, 12, 10, 8, 8, 7, 10, 10]);
  assert.deepEqual(full.competencies.map((item) => item.points), [8, 8, 8, 8, 8]);

  const extra = calculatePromotionEvaluationResult(indicatorsAt(100), competenciesAt(5));
  assert.equal(extra.indicatorTotal, 80);
  assert.equal(extra.indicatorBase, 60);
  assert.equal(extra.extraScore, 20);
  assert.equal(extra.baseScore, 100);
  assert.equal(extra.finalScore, 120);
  assert.ok(extra.finalScore > 100);

  const decimal = calculatePromotionEvaluationResult(
    // 87.5% attainment on indicator 0 and 99.99% loss on "Perda do setor" (i.e. 0.01% attainment).
    PROMOTION_INDICATORS.map(({ id }, index) => ({ id, percentage: index === 0 ? 87.5 : index === 1 ? 99.99 : 0 })),
    competenciesAt(1),
  );
  assert.equal(decimal.indicators[0].points, 13.125);
  assert.equal(decimal.indicators[1].points, 0.0012);
  assert.equal(decimal.indicatorTotal, 13.1262);
  assert.equal(decimal.competencies[0].points, 1.6);
});

test("promotion loss indicator inverts the loss percentage into attainment points", () => {
  const lossAt = (percentage) => PROMOTION_INDICATORS.map(({ id }) => ({
    id,
    percentage: id === "sector-loss" ? percentage : 0,
  }));
  const competenciesAt = (score) => PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score }));

  const lossFree = calculatePromotionEvaluationResult(lossAt(0), competenciesAt(1));
  assert.equal(lossFree.indicators.find((item) => item.id === "sector-loss").points, 12);
  assert.equal(lossFree.indicatorTotal, 12);

  const halfLoss = calculatePromotionEvaluationResult(lossAt(50), competenciesAt(1));
  assert.equal(halfLoss.indicators.find((item) => item.id === "sector-loss").points, 6);
  assert.equal(halfLoss.indicatorTotal, 6);

  const fullLoss = calculatePromotionEvaluationResult(lossAt(100), competenciesAt(1));
  assert.equal(fullLoss.indicators.find((item) => item.id === "sector-loss").points, 0);
  assert.equal(fullLoss.indicatorTotal, 0);
});

test("promotion preview recalculates partial answers and classifies only complete evaluations", () => {
  const preview = calculatePromotionEvaluationPreview(
    [{ id: PROMOTION_INDICATORS[0].id, percentage: 100 }],
    [{ id: PROMOTION_COMPETENCIES[0].id, score: 3 }],
  );

  assert.equal(preview.complete, false);
  assert.equal(preview.indicators[0].points, 15);
  assert.equal(preview.indicatorTotal, 15);
  assert.equal(preview.competencies[0].points, 4.8);
  assert.equal(preview.competenceTotal, 4.8);
  assert.equal(preview.baseScore, 19.8);
  assert.equal(preview.classification, null);

  const completed = calculatePromotionEvaluationPreview(
    PROMOTION_INDICATORS.map(({ id }) => ({ id, percentage: id === "sector-loss" ? 0 : 100 })),
    PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score: 5 })),
  );
  assert.equal(completed.complete, true);
  assert.equal(completed.finalScore, 120);
  assert.equal(completed.classification, "Excelente");

  assert.throws(() => calculatePromotionEvaluationPreview(
    [{ id: PROMOTION_INDICATORS[0].id, percentage: 100.01 }],
    [],
  ), /entre 0% e 100%/);
  assert.throws(() => calculatePromotionEvaluationPreview(
    [{ id: PROMOTION_INDICATORS[0].id, percentage: -0.01 }],
    [],
  ), /entre 0% e 100%/);
});

test("promotion scoring rejects missing, duplicate, unknown, out-of-range, and non-integer answers", () => {
  const indicators = PROMOTION_INDICATORS.map(({ id }) => ({ id, percentage: 100 }));
  const competencies = PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score: 5 }));
  assert.throws(() => calculatePromotionEvaluationResult(indicators.slice(1), competencies), /todos os 8/);
  assert.throws(() => calculatePromotionEvaluationResult(
    indicators.map((item, index) => index === 0 ? { ...item, id: indicators[1].id } : item),
    competencies,
  ), /inválido ou duplicado/);
  assert.throws(() => calculatePromotionEvaluationResult([
    ...indicators.slice(1),
    { id: "unknown-indicator", percentage: 100 },
  ], competencies), /item desconhecido/);
  assert.throws(() => calculatePromotionEvaluationResult(
    indicators.map((item, index) => index === 0 ? { ...item, percentage: 100.01 } : item),
    competencies,
  ), /0% e 100%/);
  assert.throws(() => calculatePromotionEvaluationResult(
    indicators.map((item, index) => index === 0 ? { ...item, percentage: -0.01 } : item),
    competencies,
  ), /0% e 100%/);
  assert.throws(() => calculatePromotionEvaluationResult(
    indicators,
    competencies.map((item, index) => index === 0 ? { ...item, score: 2.5 } : item),
  ), /número inteiro de 1 a 5/);
  assert.throws(() => calculatePromotionEvaluationResult(
    indicators,
    competencies.map((item, index) => index === 0 ? { ...item, score: 6 } : item),
  ), /número inteiro de 1 a 5/);
});

test("server promotion calculation rejects forged percentages above 100 before persistence", () => {
  const indicators = PROMOTION_INDICATORS.map(({ id }) => ({ id, percentage: 100 }));
  const competencies = PROMOTION_COMPETENCIES.map(({ id }) => ({ id, score: 5 }));
  indicators[0].percentage = 100.01;

  assert.throws(() => calculatePromotionEvaluationResult(indicators, competencies), /0% e 100%/);
});

test("promotion answers and calculated points persist and restore without fabricating legacy values", () => {
  const indicators = PROMOTION_INDICATORS.map(({ id }, index) => ({ id, percentage: index === 0 ? 87.5 : 100 }));
  const competencies = PROMOTION_COMPETENCIES.map(({ id }, index) => ({ id, score: index + 1 }));
  const calculated = calculatePromotionEvaluationResult(indicators, competencies);
  const storedDocument = JSON.parse(JSON.stringify({
    indicators: calculated.indicators,
    competencies: calculated.competencies,
    promotionResult: {
      indicatorTotal: calculated.indicatorTotal,
      indicatorBase: calculated.indicatorBase,
      extraScore: calculated.extraScore,
      competenceTotal: calculated.competenceTotal,
      baseScore: calculated.baseScore,
      finalScore: calculated.finalScore,
      classification: calculated.classification,
    },
  }));
  const restored = restorePromotionEvaluationInputs(storedDocument);

  assert.deepEqual(restored.indicators, indicators);
  assert.deepEqual(restored.competencies, competencies);
  assert.equal(storedDocument.indicators[0].weight, 15);
  assert.equal(storedDocument.indicators[0].points, 13.125);
  assert.equal(storedDocument.competencies[0].weight, 8);
  assert.equal(storedDocument.competencies[0].points, 1.6);
  assert.equal(storedDocument.promotionResult.finalScore, calculated.finalScore);

  const legacyOverLimit = restorePromotionEvaluationInputs({
    indicators: [{ id: PROMOTION_INDICATORS[0].id, percentage: 120 }],
  });
  assert.equal(legacyOverLimit.indicators[0].percentage, "");

  const legacy = restorePromotionEvaluationInputs({ averageScore: 4.5 });
  assert.equal(legacy.indicators.every((item) => item.percentage === ""), true);
  assert.equal(legacy.competencies.every((item) => item.score === ""), true);
});

test("promotion classification boundaries do not change conventional evaluation calculations", () => {
  assert.equal(classifyPromotionEvaluationResult(90), "Excelente");
  assert.equal(classifyPromotionEvaluationResult(89.99), "Bom");
  assert.equal(classifyPromotionEvaluationResult(80), "Bom");
  assert.equal(classifyPromotionEvaluationResult(79.99), "Regular");
  assert.equal(classifyPromotionEvaluationResult(70), "Regular");
  assert.equal(classifyPromotionEvaluationResult(69.99), "Insuficiente");
  assert.equal(calculateEvaluationResult(
    [{ weight: 0.15, percentage: 80 }],
    [{ weight: 0.08, score: 5 }],
  ).finalScore, 20);
});

test("promotion average uses only the evaluation records supplied by the server", () => {
  assert.equal(averageEvaluationScores([{ averageScore: 4 }, { averageScore: 3.25 }]), 3.63);
  assert.equal(averageEvaluationScores([]), null);
});

test("promotion requests exclude conventional scores and comments while retaining custom scoring", () => {
  const privateEvaluation = {
    averageScore: 4.5,
    evaluations: [{
      evaluationId: "source-evaluation",
      score: 4.5,
      comment: "Comentário confidencial",
    }],
  };
  const request = {
    ...privateEvaluation,
    ...createPromotionEvaluationPrivacyFields(),
    promotionResult: { finalScore: 92, classification: "Excelente" },
  };

  assert.equal(request.averageScore, null);
  assert.deepEqual(request.evaluations, []);
  assert.equal(request.evaluationEvidenceVersion, 2);
  assert.deepEqual(request.promotionResult, { finalScore: 92, classification: "Excelente" });
});

test("confidential evaluation snapshots retain only the admin evidence projection", () => {
  assert.deepEqual(createPromotionEvaluationEvidence({
    id: "source-evaluation",
    averageScore: 4.5,
    comment: "Comentário original",
    submittedAt: 1234,
  }, { name: "Ciclo atual" }), {
    evaluationId: "source-evaluation",
    cycleName: "Ciclo atual",
    score: 4.5,
    comment: "Comentário original",
    submittedAt: 1234,
  });
});

test("promotion authorization requires active roles and a shared team", () => {
  const leader = { role: "LEADER", status: "ACTIVE", teamIds: ["team-1", "team-1"] };
  const activeEmployee = { role: "EMPLOYEE", status: "ACTIVE", teamIds: ["team-1", "team-2"] };

  assert.deepEqual(getActiveSharedTeamIds(leader, activeEmployee), ["team-1"]);
  assert.deepEqual(getActiveSharedTeamIds({ ...leader, status: "DISABLED" }, activeEmployee), []);
  assert.deepEqual(getActiveSharedTeamIds({ ...leader, role: "ADMIN" }, activeEmployee), []);
  assert.deepEqual(getActiveSharedTeamIds(leader, { ...activeEmployee, status: "DISABLED" }), []);
  assert.deepEqual(getActiveSharedTeamIds(leader, { ...activeEmployee, role: "LEADER" }), []);
  assert.deepEqual(getActiveSharedTeamIds(leader, { ...activeEmployee, teamIds: ["team-other"] }), []);
  assert.equal(isActivePromotionAdmin({ role: "ADMIN", status: "ACTIVE" }), true);
  assert.equal(isActivePromotionAdmin({ role: "ADMIN", status: "DISABLED" }), false);
  assert.equal(isActivePromotionAdmin({ role: "LEADER", status: "ACTIVE" }), false);
});

test("survey answers follow stored question definitions and trim open text", () => {
  const questions = [
    { id: "comment", prompt: "Comentário", type: "TEXT" },
    { id: "rating", prompt: "Nota", type: "RATING" },
  ];
  assert.deepEqual(validateSurveyAnswers(questions, [
    { questionId: "rating", value: 5 },
    { questionId: "comment", value: "  Bom atendimento  " },
  ]), [
    { questionId: "comment", value: "Bom atendimento" },
    { questionId: "rating", value: 5 },
  ]);
});

test("survey rejects duplicate, missing, unknown, malformed, and overlong answers", () => {
  const questions = [{ id: "text", type: "TEXT" }, { id: "rating", type: "RATING" }];
  assert.throws(() => validateSurveyAnswers(questions, [{ questionId: "text", value: "ok" }]), /todas as perguntas/);
  assert.throws(() => validateSurveyAnswers(questions, [
    { questionId: "text", value: "ok" },
    { questionId: "text", value: "again" },
  ]), /exatamente uma/);
  assert.throws(() => validateSurveyAnswers(questions, [
    { questionId: "text", value: "ok" },
    { questionId: "rating", value: 6 },
  ]), /1 a 5/);
  assert.throws(() => validateSurveyAnswers(questions, [
    { questionId: "text", value: "x".repeat(2001) },
    { questionId: "rating", value: 3 },
  ]), /2.000 caracteres/);
});
