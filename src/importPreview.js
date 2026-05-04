const { validateQuestions } = require("./examEngine");

function previewQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      valid: false,
      questionCount: 0,
      validCount: 0,
      errors: ["At least one question is required"],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  let validCount = 0;

  questions.forEach((question, index) => {
    try {
      const normalized = validateQuestions([question])[0];
      validCount += 1;
      if (!normalized.explanation) {
        warnings.push(`Question ${index + 1}: explanation is empty`);
      }
    } catch (error) {
      errors.push(error.message.replace("Question 1:", `Question ${index + 1}:`));
    }
  });

  return {
    valid: errors.length === 0,
    questionCount: questions.length,
    validCount,
    errors,
    warnings,
  };
}

module.exports = {
  previewQuestions,
};
