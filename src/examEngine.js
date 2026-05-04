const ANSWERS = ["A", "B", "C", "D", "E", "F"];
const MIN_CHOICES = 2;
const MAX_CHOICES = ANSWERS.length;

function clampChoiceCount(choiceCount = 4) {
  const parsed = Number(choiceCount);
  if (!Number.isFinite(parsed)) {
    return 4;
  }

  return Math.min(MAX_CHOICES, Math.max(MIN_CHOICES, Math.round(parsed)));
}

function getAnswerKeys(choiceCount = 4) {
  return ANSWERS.slice(0, clampChoiceCount(choiceCount));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeAnswer(value) {
  return cleanText(value).toUpperCase();
}

function readChoice(question, key) {
  if (question.options && question.options[key] !== undefined) {
    return question.options[key];
  }

  const lowerKey = key.toLowerCase();
  if (question[lowerKey] !== undefined) {
    return question[lowerKey];
  }

  return question[key];
}

function inferChoiceCount(question) {
  if (question.choiceCount !== undefined) {
    return clampChoiceCount(question.choiceCount);
  }

  const providedChoiceCount = ANSWERS.filter((key) => cleanText(readChoice(question, key))).length;
  return clampChoiceCount(providedChoiceCount || 4);
}

function normalizeQuestion(question, index) {
  const text = cleanText(question.text ?? question.question ?? question.prompt);
  if (!text) {
    throw new Error(`Question ${index + 1}: question text is required`);
  }

  const answerKeys = getAnswerKeys(inferChoiceCount(question));
  const options = answerKeys.reduce((result, key) => {
    const value = cleanText(readChoice(question, key));
    if (!value) {
      throw new Error(`Question ${index + 1}: option ${key} is required`);
    }
    result[key] = value;
    return result;
  }, {});

  const correctAnswer = normalizeAnswer(
    question.correctAnswer ?? question.correct ?? question.answer
  );
  if (!answerKeys.includes(correctAnswer)) {
    throw new Error(`Question ${index + 1}: correct answer must match one of this question's choices`);
  }

  return {
    id: cleanText(question.id) || `q-${index + 1}`,
    text,
    options,
    correctAnswer,
    explanation: cleanText(question.explanation),
  };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("At least one question is required");
  }

  return questions.map(normalizeQuestion);
}

function scoreSubmission(questions, answers = {}) {
  const questionResults = questions.map((question) => {
    const selectedAnswer = normalizeAnswer(answers[question.id]);
    const answerKeys = Object.keys(question.options || {});
    return {
      questionId: question.id,
      selectedAnswer: answerKeys.includes(selectedAnswer) ? selectedAnswer : "",
      isCorrect: selectedAnswer === question.correctAnswer,
    };
  });

  const score = questionResults.filter((result) => result.isCorrect).length;
  const total = questions.length;

  return {
    score,
    total,
    percentage: total ? Math.round((score / total) * 100) : 0,
    questionResults,
  };
}

function buildStudentReview(questions, result) {
  const resultByQuestion = new Map(
    (result?.questionResults || []).map((questionResult) => [
      questionResult.questionId,
      questionResult,
    ])
  );

  return questions.map((question) => {
    const questionResult = resultByQuestion.get(question.id) || {};
    return {
      questionId: question.id,
      text: question.text,
      options: question.options,
      selectedAnswer: questionResult.selectedAnswer || "",
      correctAnswer: question.correctAnswer,
      isCorrect: Boolean(questionResult.isCorrect),
      explanation: question.explanation || "",
    };
  });
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function distributionFor(percentages) {
  const buckets = [
    { label: "0-49", min: 0, max: 49 },
    { label: "50-59", min: 50, max: 59 },
    { label: "60-69", min: 60, max: 69 },
    { label: "70-79", min: 70, max: 79 },
    { label: "80-89", min: 80, max: 89 },
    { label: "90-100", min: 90, max: 100 },
  ];

  return buckets.map((bucket) => ({
    label: bucket.label,
    count: percentages.filter(
      (percentage) => percentage >= bucket.min && percentage <= bucket.max
    ).length,
  }));
}

function buildAnalytics(questions, participants) {
  const submitted = participants.filter(
    (participant) => participant.status === "submitted" && participant.result
  );

  const percentages = submitted.map((participant) => participant.result.percentage);
  const leaderboard = submitted
    .map((participant) => ({
      nickname: participant.nickname,
      score: participant.result.score,
      total: participant.result.total,
      percentage: participant.result.percentage,
      submittedAt: participant.submittedAt,
    }))
    .sort((a, b) => b.percentage - a.percentage || b.score - a.score || a.nickname.localeCompare(b.nickname));

  const questionPerformance = questions.map((question, index) => {
    const results = submitted
      .map((participant) => participant.result.questionResults[index])
      .filter(Boolean);
    const correctCount = results.filter((result) => result.isCorrect).length;

    return {
      questionId: question.id,
      questionText: question.text,
      correctAnswer: question.correctAnswer,
      correctCount,
      attemptedCount: results.length,
      percentageCorrect: results.length ? Math.round((correctCount / results.length) * 100) : 0,
    };
  });

  const averagePercentage = percentages.length
    ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length)
    : 0;

  return {
    totalParticipants: participants.length,
    submittedCount: submitted.length,
    averagePercentage,
    highestPercentage: percentages.length ? Math.max(...percentages) : 0,
    lowestPercentage: percentages.length ? Math.min(...percentages) : 0,
    medianPercentage: median(percentages),
    leaderboard,
    topPerformers: leaderboard.slice(0, 5),
    bottomPerformers: [...leaderboard].reverse().slice(0, 5),
    scoreDistribution: distributionFor(percentages),
    questionPerformance,
  };
}

function publicQuestions(questions) {
  return questions.map((question) => ({
    id: question.id,
    text: question.text,
    options: question.options,
  }));
}

module.exports = {
  ANSWERS,
  buildAnalytics,
  buildStudentReview,
  getAnswerKeys,
  publicQuestions,
  scoreSubmission,
  validateQuestions,
};
