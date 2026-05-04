function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function answerFor(result, questionId) {
  return result?.questionResults?.find((questionResult) => questionResult.questionId === questionId);
}

function answeredCount(participant) {
  return Object.keys(participant.answers || {}).length;
}

function buildResultsCsv(exam) {
  const questionHeaders = exam.questions.flatMap((question, index) => [
    `Q${index + 1} selected`,
    `Q${index + 1} correct`,
    `Q${index + 1} result`,
  ]);
  const headers = [
    "nickname",
    "status",
    "score",
    "total",
    "percentage",
    "answered",
    "submittedAt",
    ...questionHeaders,
  ];

  const rows = [headers.map(csvCell).join(",")];
  for (const participant of exam.participants) {
    const result = participant.result || {};
    const questionCells = exam.questions.flatMap((question) => {
      const questionResult = answerFor(result, question.id);
      return [
        questionResult?.selectedAnswer || participant.answers?.[question.id] || "",
        question.correctAnswer,
        questionResult ? (questionResult.isCorrect ? "correct" : "incorrect") : "",
      ];
    });

    rows.push(
      [
        participant.nickname,
        participant.status,
        result.score ?? "",
        result.total ?? exam.questions.length,
        result.percentage ?? "",
        answeredCount(participant),
        participant.submittedAt || "",
        ...questionCells,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return `${rows.join("\n")}\n`;
}

module.exports = {
  buildResultsCsv,
};
