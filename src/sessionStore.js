const crypto = require("node:crypto");

const { validateQuestions } = require("./examEngine");
const { normalizeTemplateOptions } = require("./templateBuilder");
const sampleQuestions = require("./sampleQuestions");

function cleanSessionCode(sessionCode) {
  return String(sessionCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);
}

function generateSessionCode() {
  return `CAU-${Math.floor(1000 + Math.random() * 9000)}`;
}

function uniqueSessionCode(existingCodes = new Set()) {
  let code = generateSessionCode();
  while (existingCodes.has(code)) {
    code = generateSessionCode();
  }
  return code;
}

function generateProfessorPasscode() {
  return `CAU-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function normalizeExamQuestions(overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, "questions")) {
    if (Array.isArray(overrides.questions) && overrides.questions.length === 0) {
      return [];
    }
    return validateQuestions(overrides.questions);
  }

  return validateQuestions(sampleQuestions);
}

function createExamState(overrides = {}) {
  const templateOptions = normalizeTemplateOptions({
    questions: overrides.templateQuestionCount,
    choices: overrides.choiceCount,
  });
  const sessionCode = cleanSessionCode(overrides.sessionCode) || generateSessionCode();

  return {
    sessionCode,
    status: overrides.status || "waiting",
    durationMinutes: overrides.durationMinutes || 15,
    templateQuestionCount: templateOptions.questionCount,
    choiceCount: templateOptions.choiceCount,
    professorPasscode: overrides.professorPasscode || generateProfessorPasscode(),
    showExplanations: overrides.showExplanations !== false,
    startedAt: overrides.startedAt || null,
    endsAt: overrides.endsAt || null,
    endedAt: overrides.endedAt || null,
    endReason: overrides.endReason || null,
    questions: normalizeExamQuestions(overrides),
    participants: Array.isArray(overrides.participants) ? overrides.participants : [],
  };
}

function normalizeSessions(sessions = {}) {
  return Object.fromEntries(
    Object.entries(sessions).map(([code, exam]) => {
      const sessionCode = cleanSessionCode(exam?.sessionCode || code) || cleanSessionCode(code);
      return [sessionCode, createExamState({ ...exam, sessionCode })];
    })
  );
}

function createStore(loaded = null) {
  if (loaded?.sessions && typeof loaded.sessions === "object") {
    const sessions = normalizeSessions(loaded.sessions);
    const activeSessionCode =
      cleanSessionCode(loaded.activeSessionCode) in sessions
        ? cleanSessionCode(loaded.activeSessionCode)
        : Object.keys(sessions)[0];

    if (activeSessionCode) {
      return { activeSessionCode, sessions };
    }
  }

  const exam = createExamState(loaded || {});
  return {
    activeSessionCode: exam.sessionCode,
    sessions: {
      [exam.sessionCode]: exam,
    },
  };
}

function getSession(store, sessionCode) {
  const code = cleanSessionCode(sessionCode) || store.activeSessionCode;
  return store.sessions[code] || null;
}

function setSession(store, exam, options = {}) {
  const sessionCode = cleanSessionCode(exam.sessionCode);
  return {
    ...store,
    activeSessionCode: options.makeActive ? sessionCode : store.activeSessionCode,
    sessions: {
      ...store.sessions,
      [sessionCode]: exam,
    },
  };
}

function renameSession(store, oldCode, nextCode) {
  const currentCode = cleanSessionCode(oldCode) || store.activeSessionCode;
  const sessionCode = cleanSessionCode(nextCode);
  if (!sessionCode) {
    throw new Error("Session code is required");
  }

  if (sessionCode !== currentCode && store.sessions[sessionCode]) {
    throw new Error("That exam code already exists");
  }

  const exam = store.sessions[currentCode];
  if (!exam) {
    throw new Error("Exam session was not found");
  }

  const sessions = { ...store.sessions };
  delete sessions[currentCode];
  sessions[sessionCode] = {
    ...exam,
    sessionCode,
  };

  return {
    activeSessionCode: store.activeSessionCode === currentCode ? sessionCode : store.activeSessionCode,
    sessions,
  };
}

function createNewSession(store, overrides = {}) {
  const existingCodes = new Set(Object.keys(store.sessions));
  const sessionCode = cleanSessionCode(overrides.sessionCode) || uniqueSessionCode(existingCodes);
  if (store.sessions[sessionCode]) {
    throw new Error("That exam code already exists");
  }

  return setSession(
    store,
    createExamState({
      ...overrides,
      sessionCode,
    }),
    { makeActive: true }
  );
}

function clearEndedSessions(store, keepSessionCode = "") {
  const keepCode = cleanSessionCode(keepSessionCode) || store.activeSessionCode;
  const sessions = Object.fromEntries(
    Object.entries(store.sessions).filter(([code, exam]) => code === keepCode || exam.status !== "ended")
  );
  const activeSessionCode =
    sessions[store.activeSessionCode]
      ? store.activeSessionCode
      : sessions[keepCode]
        ? keepCode
        : Object.keys(sessions)[0];

  return {
    activeSessionCode,
    sessions,
  };
}

function findSessionByStudentId(store, studentId) {
  if (!studentId) {
    return null;
  }

  return (
    Object.values(store.sessions).find((exam) =>
      exam.participants.some((participant) => participant.id === studentId)
    ) || null
  );
}

module.exports = {
  cleanSessionCode,
  clearEndedSessions,
  createExamState,
  createNewSession,
  createStore,
  findSessionByStudentId,
  generateProfessorPasscode,
  getSession,
  renameSession,
  setSession,
};
