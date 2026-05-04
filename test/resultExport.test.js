const test = require("node:test");
const assert = require("node:assert/strict");

const { buildResultsCsv } = require("../src/resultExport");
const { scoreSubmission } = require("../src/examEngine");

const questions = [
  {
    id: "q-1",
    text: "Question one?",
    options: { A: "A", B: "B" },
    correctAnswer: "A",
    explanation: "",
  },
  {
    id: "q-2",
    text: "Question two?",
    options: { A: "A", B: "B" },
    correctAnswer: "B",
    explanation: "",
  },
];

test("buildResultsCsv exports participant scores and per-question answers", () => {
  const exam = {
    questions,
    participants: [
      {
        nickname: "Alpha",
        status: "submitted",
        answers: { "q-1": "A", "q-2": "A" },
        submittedAt: "2026-05-04T10:00:00.000Z",
        result: scoreSubmission(questions, { "q-1": "A", "q-2": "A" }),
      },
    ],
  };

  const csv = buildResultsCsv(exam);

  assert.match(csv, /"nickname","status","score","total","percentage","answered","submittedAt","Q1 selected"/);
  assert.match(csv, /"Alpha","submitted","1","2","50","2","2026-05-04T10:00:00.000Z","A","A","correct","A","B","incorrect"/);
});
