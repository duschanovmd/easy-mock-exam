const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAnalytics,
  buildStudentReview,
  getAnswerKeys,
  scoreSubmission,
  validateQuestions,
} = require("../src/examEngine");

const questions = [
  {
    id: "q1",
    text: "Which chamber pumps blood into the pulmonary artery?",
    options: { A: "Left atrium", B: "Right ventricle", C: "Left ventricle", D: "Right atrium" },
    correctAnswer: "B",
    explanation: "The right ventricle pumps deoxygenated blood to the lungs.",
  },
  {
    id: "q2",
    text: "Which vitamin deficiency is classically associated with scurvy?",
    options: { A: "Vitamin A", B: "Vitamin B12", C: "Vitamin C", D: "Vitamin D" },
    correctAnswer: "C",
  },
  {
    id: "q3",
    text: "What is the normal adult resting heart rate range?",
    options: { A: "20-40 bpm", B: "40-50 bpm", C: "60-100 bpm", D: "120-160 bpm" },
    correctAnswer: "C",
  },
];

test("scoreSubmission scores answers and returns student-safe feedback", () => {
  const result = scoreSubmission(questions, { q1: "B", q2: "A", q3: "C" });

  assert.equal(result.score, 2);
  assert.equal(result.total, 3);
  assert.equal(result.percentage, 67);
  assert.deepEqual(result.questionResults, [
    { questionId: "q1", selectedAnswer: "B", isCorrect: true },
    { questionId: "q2", selectedAnswer: "A", isCorrect: false },
    { questionId: "q3", selectedAnswer: "C", isCorrect: true },
  ]);
});

test("buildStudentReview combines questions, selected answers, correct answers, and explanations", () => {
  const result = scoreSubmission(questions, { q1: "B", q2: "A", q3: "C" });
  const review = buildStudentReview(questions, result);

  assert.deepEqual(review[0], {
    questionId: "q1",
    text: "Which chamber pumps blood into the pulmonary artery?",
    options: { A: "Left atrium", B: "Right ventricle", C: "Left ventricle", D: "Right atrium" },
    selectedAnswer: "B",
    correctAnswer: "B",
    isCorrect: true,
    explanation: "The right ventricle pumps deoxygenated blood to the lungs.",
  });
  assert.deepEqual(review[1], {
    questionId: "q2",
    text: "Which vitamin deficiency is classically associated with scurvy?",
    options: { A: "Vitamin A", B: "Vitamin B12", C: "Vitamin C", D: "Vitamin D" },
    selectedAnswer: "A",
    correctAnswer: "C",
    isCorrect: false,
    explanation: "",
  });
});

test("validateQuestions normalizes imported questions and rejects invalid correct answers", () => {
  const imported = [
    {
      question: "Most abundant extracellular cation?",
      A: "Potassium",
      B: "Sodium",
      C: "Calcium",
      D: "Magnesium",
      correctAnswer: "B",
      explanation: "Sodium is the main extracellular cation.",
    },
  ];

  assert.deepEqual(validateQuestions(imported), [
    {
      id: "q-1",
      text: "Most abundant extracellular cation?",
      options: { A: "Potassium", B: "Sodium", C: "Calcium", D: "Magnesium" },
      correctAnswer: "B",
      explanation: "Sodium is the main extracellular cation.",
    },
  ]);

  assert.throws(
    () => validateQuestions([{ ...imported[0], correctAnswer: "E" }]),
    /correct answer must match one of this question's choices/
  );
});

test("validateQuestions supports questions with two to six choices", () => {
  assert.deepEqual(getAnswerKeys(2), ["A", "B"]);
  assert.deepEqual(getAnswerKeys(6), ["A", "B", "C", "D", "E", "F"]);

  const imported = [
    {
      question: "Which cranial nerve is primarily responsible for smell?",
      A: "Optic nerve",
      B: "Olfactory nerve",
      C: "Trigeminal nerve",
      D: "Facial nerve",
      E: "Vagus nerve",
      correctAnswer: "B",
    },
    {
      question: "Which answer confirms this two-choice item?",
      A: "True",
      B: "False",
      correctAnswer: "A",
    },
  ];

  const normalized = validateQuestions(imported);

  assert.deepEqual(Object.keys(normalized[0].options), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(Object.keys(normalized[1].options), ["A", "B"]);
  assert.equal(scoreSubmission(normalized, { "q-1": "E", "q-2": "A" }).questionResults[0].selectedAnswer, "E");

  assert.throws(
    () => validateQuestions([{ ...imported[1], correctAnswer: "C" }]),
    /correct answer must match one of this question's choices/
  );
});

test("buildAnalytics summarizes class results, rankings, score distribution, and question performance", () => {
  const participants = [
    {
      nickname: "Alpha",
      status: "submitted",
      result: scoreSubmission(questions, { q1: "B", q2: "C", q3: "C" }),
    },
    {
      nickname: "Beta",
      status: "submitted",
      result: scoreSubmission(questions, { q1: "A", q2: "C", q3: "A" }),
    },
    {
      nickname: "Gamma",
      status: "waiting",
    },
  ];

  const analytics = buildAnalytics(questions, participants);

  assert.equal(analytics.totalParticipants, 3);
  assert.equal(analytics.submittedCount, 2);
  assert.equal(analytics.averagePercentage, 67);
  assert.equal(analytics.highestPercentage, 100);
  assert.equal(analytics.lowestPercentage, 33);
  assert.equal(analytics.medianPercentage, 67);
  assert.deepEqual(
    analytics.leaderboard.map((student) => [student.nickname, student.percentage]),
    [
      ["Alpha", 100],
      ["Beta", 33],
    ]
  );
  assert.deepEqual(analytics.scoreDistribution, [
    { label: "0-49", count: 1 },
    { label: "50-59", count: 0 },
    { label: "60-69", count: 0 },
    { label: "70-79", count: 0 },
    { label: "80-89", count: 0 },
    { label: "90-100", count: 1 },
  ]);
  assert.deepEqual(
    analytics.questionPerformance.map((question) => ({
      questionId: question.questionId,
      correctCount: question.correctCount,
      percentageCorrect: question.percentageCorrect,
    })),
    [
      { questionId: "q1", correctCount: 1, percentageCorrect: 50 },
      { questionId: "q2", correctCount: 2, percentageCorrect: 100 },
      { questionId: "q3", correctCount: 1, percentageCorrect: 50 },
    ]
  );
});
