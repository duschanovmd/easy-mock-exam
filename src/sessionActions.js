function leaveParticipant(participants, studentId) {
  const participant = participants.find((student) => student.id === studentId);

  if (!participant) {
    return {
      participants,
      removed: false,
      keptResult: false,
    };
  }

  if (participant.status === "submitted" && participant.result) {
    return {
      participants,
      removed: false,
      keptResult: true,
    };
  }

  return {
    participants: participants.filter((student) => student.id !== studentId),
    removed: true,
    keptResult: false,
  };
}

function answerCount(participant = {}) {
  return Object.values(participant.answers || {}).filter(Boolean).length;
}

function removeParticipantByProfessor(participants, studentId) {
  const nextParticipants = participants.filter((student) => student.id !== studentId);
  return {
    participants: nextParticipants,
    removed: nextParticipants.length !== participants.length,
  };
}

function resetParticipantAttempt(exam, studentId) {
  const nextStatus = exam.status === "active" ? "answering" : "waiting";
  let reset = false;

  const participants = exam.participants.map((participant) => {
    if (participant.id !== studentId) {
      return participant;
    }

    reset = true;
    return {
      ...participant,
      status: nextStatus,
      answers: {},
      result: null,
      submittedAt: null,
      submittedByTimer: false,
    };
  });

  return {
    exam: {
      ...exam,
      participants,
    },
    reset,
  };
}

function shouldAutoEndExam(exam, now = Date.now()) {
  return (
    exam?.status === "active" &&
    Boolean(exam.endsAt) &&
    now >= Date.parse(exam.endsAt)
  );
}

function canStudentJoinExam(exam) {
  return exam?.status === "waiting" || exam?.status === "active";
}

module.exports = {
  answerCount,
  canStudentJoinExam,
  leaveParticipant,
  removeParticipantByProfessor,
  resetParticipantAttempt,
  shouldAutoEndExam,
};
