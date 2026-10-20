const assert = require("node:assert/strict");
const test = require("node:test");
const {
  averageEvaluationScores,
  validateEvaluationAnswers,
  validateSurveyAnswers,
} = require("../domain");

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

test("promotion average uses only the evaluation records supplied by the server", () => {
  assert.equal(averageEvaluationScores([{ averageScore: 4 }, { averageScore: 3.25 }]), 3.63);
  assert.equal(averageEvaluationScores([]), null);
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
