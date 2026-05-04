const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCsvTemplate,
  buildJsonTemplate,
  normalizeTemplateOptions,
} = require("../src/templateBuilder");

test("normalizeTemplateOptions clamps question and choice counts", () => {
  assert.deepEqual(normalizeTemplateOptions({ questions: 20, choices: 5 }), {
    questionCount: 20,
    choiceCount: 5,
  });
  assert.deepEqual(normalizeTemplateOptions({ questions: 0, choices: 1 }), {
    questionCount: 1,
    choiceCount: 2,
  });
  assert.deepEqual(normalizeTemplateOptions({ questions: 500, choices: 12 }), {
    questionCount: 200,
    choiceCount: 6,
  });
});

test("buildCsvTemplate creates the requested number of rows and choice columns", () => {
  const csv = buildCsvTemplate({ questions: 3, choices: 5 });
  const rows = csv.trim().split(/\r?\n/);

  assert.equal(rows.length, 4);
  assert.equal(rows[0], "question,A,B,C,D,E,correctAnswer,explanation");
  assert.match(rows[1], /"Question 1 text here"/);
  assert.match(rows[3], /"Question 3 text here"/);
});

test("buildJsonTemplate creates the requested number of question objects", () => {
  const json = JSON.parse(buildJsonTemplate({ questions: 2, choices: 6 }));

  assert.equal(json.length, 2);
  assert.deepEqual(Object.keys(json[0]), [
    "question",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "correctAnswer",
    "explanation",
  ]);
});
