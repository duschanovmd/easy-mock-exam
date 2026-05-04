const test = require("node:test");
const assert = require("node:assert/strict");

const {
  answerCount,
  canStudentJoinExam,
  removeParticipantByProfessor,
  resetParticipantAttempt,
  shouldAutoEndExam,
  leaveParticipant,
} = require("../src/sessionActions");

test("leaveParticipant removes a waiting student from the room", () => {
  const participants = [
    { id: "s1", nickname: "Alpha", status: "waiting" },
    { id: "s2", nickname: "Beta", status: "waiting" },
  ];

  const result = leaveParticipant(participants, "s1");

  assert.equal(result.removed, true);
  assert.equal(result.keptResult, false);
  assert.deepEqual(result.participants, [{ id: "s2", nickname: "Beta", status: "waiting" }]);
});

test("leaveParticipant removes an answering student before submission", () => {
  const participants = [
    { id: "s1", nickname: "Alpha", status: "answering", answers: { "q-1": "A" } },
  ];

  const result = leaveParticipant(participants, "s1");

  assert.equal(result.removed, true);
  assert.deepEqual(result.participants, []);
});

test("leaveParticipant keeps submitted results for professor analytics", () => {
  const participants = [
    {
      id: "s1",
      nickname: "Alpha",
      status: "submitted",
      result: { score: 2, total: 3, percentage: 67 },
    },
  ];

  const result = leaveParticipant(participants, "s1");

  assert.equal(result.removed, false);
  assert.equal(result.keptResult, true);
  assert.deepEqual(result.participants, participants);
});

test("shouldAutoEndExam only ends active exams when time has expired", () => {
  const futureExam = {
    status: "active",
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    participants: [{ id: "s1", status: "submitted" }],
  };
  const expiredExam = {
    status: "active",
    endsAt: new Date(Date.now() - 1_000).toISOString(),
    participants: [{ id: "s1", status: "answering" }],
  };

  assert.equal(shouldAutoEndExam(futureExam), false);
  assert.equal(shouldAutoEndExam(expiredExam), true);
  assert.equal(shouldAutoEndExam({ ...expiredExam, status: "waiting" }), false);
});

test("canStudentJoinExam allows waiting and active exams but blocks ended exams", () => {
  assert.equal(canStudentJoinExam({ status: "waiting" }), true);
  assert.equal(canStudentJoinExam({ status: "active" }), true);
  assert.equal(canStudentJoinExam({ status: "ended" }), false);
});

test("answerCount reports saved answers for live professor status", () => {
  assert.equal(answerCount({ answers: { "q-1": "A", "q-2": "", "q-3": "C" } }), 2);
  assert.equal(answerCount({ answers: null }), 0);
});

test("resetParticipantAttempt clears a student's current attempt without removing them", () => {
  const exam = {
    status: "active",
    participants: [
      {
        id: "s1",
        nickname: "Alpha",
        status: "submitted",
        answers: { "q-1": "A" },
        result: { score: 1, total: 1, percentage: 100 },
        submittedAt: "2026-05-04T10:00:00.000Z",
        submittedByTimer: true,
      },
    ],
  };

  const result = resetParticipantAttempt(exam, "s1");

  assert.equal(result.reset, true);
  assert.equal(result.exam.participants[0].status, "answering");
  assert.deepEqual(result.exam.participants[0].answers, {});
  assert.equal(result.exam.participants[0].result, null);
  assert.equal(result.exam.participants[0].submittedAt, null);
  assert.equal(result.exam.participants[0].submittedByTimer, false);
});

test("removeParticipantByProfessor removes submitted and unsubmitted students", () => {
  const participants = [
    { id: "s1", nickname: "Alpha", status: "submitted", result: { score: 1 } },
    { id: "s2", nickname: "Beta", status: "answering" },
  ];

  const result = removeParticipantByProfessor(participants, "s1");

  assert.equal(result.removed, true);
  assert.deepEqual(result.participants, [{ id: "s2", nickname: "Beta", status: "answering" }]);
});
