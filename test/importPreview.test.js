const test = require("node:test");
const assert = require("node:assert/strict");

const { previewQuestions } = require("../src/importPreview");

test("previewQuestions reports valid count, warnings, and row-specific errors", () => {
  const preview = previewQuestions([
    {
      question: "Valid question?",
      A: "First",
      B: "Second",
      correctAnswer: "A",
    },
    {
      question: "",
      A: "First",
      B: "Second",
      correctAnswer: "A",
    },
  ]);

  assert.equal(preview.valid, false);
  assert.equal(preview.questionCount, 2);
  assert.equal(preview.validCount, 1);
  assert.deepEqual(preview.warnings, ["Question 1: explanation is empty"]);
  assert.match(preview.errors[0], /Question 2: question text is required/);
});
