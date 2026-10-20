const MAX_EVALUATION_CRITERIA = 100;
const MAX_SURVEY_QUESTIONS = 20;
const MAX_TEXT_ANSWER_LENGTH = 2000;

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
  averageEvaluationScores,
  validateEvaluationAnswers,
  validateSurveyAnswers,
};
