const { getAnswerKeys } = require("./examEngine");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeTemplateOptions(options = {}) {
  return {
    questionCount: clampNumber(options.questions ?? options.questionCount, 1, 200, 20),
    choiceCount: clampNumber(options.choices ?? options.choiceCount, 2, 6, 4),
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildCsvTemplate(options = {}) {
  const { questionCount, choiceCount } = normalizeTemplateOptions(options);
  const answerKeys = getAnswerKeys(choiceCount);
  const headers = ["question", ...answerKeys, "correctAnswer", "explanation"];
  const rows = [headers.join(",")];

  for (let index = 1; index <= questionCount; index += 1) {
    rows.push(
      [
        csvCell(`Question ${index} text here`),
        ...answerKeys.map((key) => csvCell(`Option ${key}`)),
        csvCell(answerKeys[0]),
        csvCell("Optional explanation here"),
      ].join(",")
    );
  }

  return `${rows.join("\n")}\n`;
}

function buildJsonTemplate(options = {}) {
  const { questionCount, choiceCount } = normalizeTemplateOptions(options);
  const answerKeys = getAnswerKeys(choiceCount);
  const questions = [];

  for (let index = 1; index <= questionCount; index += 1) {
    questions.push({
      question: `Question ${index} text here`,
      ...Object.fromEntries(answerKeys.map((key) => [key, `Option ${key}`])),
      correctAnswer: answerKeys[0],
      explanation: "Optional explanation here",
    });
  }

  return `${JSON.stringify(questions, null, 2)}\n`;
}

module.exports = {
  buildCsvTemplate,
  buildJsonTemplate,
  normalizeTemplateOptions,
};
