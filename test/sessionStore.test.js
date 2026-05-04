const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanSessionCode,
  clearEndedSessions,
  createExamState,
  createNewSession,
  createStore,
  getSession,
  renameSession,
} = require("../src/sessionStore");

const question = {
  question: "Which ion is the main extracellular cation?",
  A: "Sodium",
  B: "Potassium",
  C: "Calcium",
  D: "Magnesium",
  correctAnswer: "A",
};

test("createStore migrates a legacy single exam state into a session map", () => {
  const store = createStore({
    sessionCode: "cau-1111",
    status: "waiting",
    durationMinutes: 10,
    questions: [question],
    participants: [{ id: "s1", nickname: "Alpha", status: "waiting" }],
  });

  assert.equal(store.activeSessionCode, "CAU-1111");
  assert.equal(Object.keys(store.sessions).length, 1);
  assert.equal(getSession(store, "cau-1111").participants[0].nickname, "Alpha");
});

test("createStore keeps multiple exams isolated by code", () => {
  const store = createStore({
    activeSessionCode: "CAU-2222",
    sessions: {
      "CAU-1111": createExamState({ sessionCode: "CAU-1111", questions: [question] }),
      "CAU-2222": createExamState({
        sessionCode: "CAU-2222",
        questions: [question],
        participants: [{ id: "s2", nickname: "Beta", status: "waiting" }],
      }),
    },
  });

  assert.equal(getSession(store, "CAU-1111").participants.length, 0);
  assert.equal(getSession(store, "CAU-2222").participants[0].nickname, "Beta");
});

test("renameSession changes one session code without overwriting another", () => {
  const store = createStore({
    activeSessionCode: "CAU-1111",
    sessions: {
      "CAU-1111": createExamState({ sessionCode: "CAU-1111", questions: [question] }),
      "CAU-2222": createExamState({ sessionCode: "CAU-2222", questions: [question] }),
    },
  });

  const renamed = renameSession(store, "CAU-1111", "cau-3333");

  assert.equal(renamed.activeSessionCode, "CAU-3333");
  assert.equal(getSession(renamed, "CAU-3333").sessionCode, "CAU-3333");
  assert.throws(() => renameSession(renamed, "CAU-3333", "CAU-2222"), /already exists/);
});

test("cleanSessionCode normalizes professor and student entered codes", () => {
  assert.equal(cleanSessionCode(" cau 44 55!! "), "CAU4455");
});

test("clearEndedSessions archives ended sessions while keeping the selected session", () => {
  const store = createStore({
    activeSessionCode: "CAU-1111",
    sessions: {
      "CAU-1111": createExamState({ sessionCode: "CAU-1111", status: "ended", questions: [question] }),
      "CAU-2222": createExamState({ sessionCode: "CAU-2222", status: "ended", questions: [question] }),
      "CAU-3333": createExamState({ sessionCode: "CAU-3333", status: "waiting", questions: [question] }),
    },
  });

  const cleared = clearEndedSessions(store, "CAU-1111");

  assert.deepEqual(Object.keys(cleared.sessions).sort(), ["CAU-1111", "CAU-3333"]);
  assert.equal(cleared.activeSessionCode, "CAU-1111");
});

test("createNewSession can start with no uploaded questions", () => {
  const store = createStore({
    activeSessionCode: "CAU-1111",
    sessions: {
      "CAU-1111": createExamState({ sessionCode: "CAU-1111", questions: [question] }),
    },
  });

  const nextStore = createNewSession(store, {
    sessionCode: "CAU-2222",
    questions: [],
  });

  assert.equal(nextStore.activeSessionCode, "CAU-2222");
  assert.deepEqual(getSession(nextStore, "CAU-2222").questions, []);
});
