const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const QRCode = require("qrcode");

const {
  ANSWERS,
  buildAnalytics,
  buildStudentReview,
  publicQuestions,
  scoreSubmission,
  validateQuestions,
} = require("./src/examEngine");
const {
  buildCsvTemplate,
  buildJsonTemplate,
  normalizeTemplateOptions,
} = require("./src/templateBuilder");
const { previewQuestions } = require("./src/importPreview");
const { buildResultsCsv } = require("./src/resultExport");
const {
  answerCount,
  canStudentJoinExam,
  leaveParticipant,
  removeParticipantByProfessor,
  resetParticipantAttempt,
  shouldAutoEndExam,
} = require("./src/sessionActions");
const {
  cleanSessionCode,
  clearEndedSessions,
  createNewSession,
  createStore,
  findSessionByStudentId,
  generateProfessorPasscode,
  getSession,
  renameSession,
  setSession,
} = require("./src/sessionStore");

const PORT = Number(process.env.PORT || 3000);
const PROFESSOR_PASSCODE = process.env.PROFESSOR_PASSCODE || "CAU-PROF";
const PUBLIC_BASE_URL = cleanPublicBaseUrl(process.env.PUBLIC_BASE_URL);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR =
  process.env.DATA_DIR ||
  (process.env.VERCEL ? path.join("/tmp", "cau-mock-exam-portal") : path.join(ROOT, "data"));
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "exam-state.json");
const MAX_BODY_BYTES = 1_000_000;

const clients = new Set();
let state = loadState();

function nowIso() {
  return new Date().toISOString();
}

function cleanPublicBaseUrl(value = "") {
  const baseUrl = String(value).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(baseUrl) ? baseUrl : "";
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return createStore();
    }

    return createStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch (error) {
    console.error("Could not load saved exam state, starting fresh:", error.message);
    return createStore();
  }
}

function persistState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function secondsRemaining(exam) {
  if (exam.status !== "active" || !exam.endsAt) {
    return 0;
  }

  return Math.max(0, Math.ceil((Date.parse(exam.endsAt) - Date.now()) / 1000));
}

function submittedParticipants(exam) {
  return exam.participants.filter((participant) => participant.status === "submitted");
}

function resultsReady(exam) {
  return exam.status === "ended";
}

function endExam(exam, reason = "manual") {
  if (exam.status === "ended") {
    return exam;
  }

  const endedAt = nowIso();
  return {
    ...exam,
    status: "ended",
    endedAt,
    endReason: reason,
    participants: exam.participants.map((participant) => {
      if (participant.status === "submitted" && participant.result) {
        return participant;
      }

      const answers = participant.answers || {};
      return {
        ...participant,
        status: "submitted",
        submittedAt: endedAt,
        submittedByTimer: reason === "timer",
        result: scoreSubmission(exam.questions, answers),
      };
    }),
  };
}

function finishIfTimeElapsed(exam) {
  if (shouldAutoEndExam(exam)) {
    return endExam(exam, "timer");
  }

  return exam;
}

function saveExam(exam, options = {}) {
  state = setSession(state, exam, { makeActive: Boolean(options.makeActive) });
  if (options.persist !== false) {
    persistState();
  }
  if (options.broadcast !== false) {
    broadcast();
  }
}

function refreshExam(exam) {
  const refreshed = finishIfTimeElapsed(exam);
  if (refreshed !== exam) {
    saveExam(refreshed, { broadcast: false });
  }
  return refreshed;
}

function publicSessionList() {
  return Object.values(state.sessions).map((exam) => ({
    sessionCode: exam.sessionCode,
    status: exam.status,
    durationMinutes: exam.durationMinutes,
    questionCount: exam.questions.length,
  }));
}

function examFromRequest(url, fallbackToActive = true) {
  const sessionCode = cleanSessionCode(url.searchParams.get("sessionCode"));
  if (sessionCode) {
    return getSession(state, sessionCode);
  }

  return fallbackToActive ? getSession(state, state.activeSessionCode) : null;
}

function examFromStudent(studentId, sessionCode = "") {
  return getSession(state, sessionCode) || findSessionByStudentId(state, studentId);
}

function professorSessionCode(req, url, body = {}) {
  return (
    cleanSessionCode(req.headers["x-session-code"]) ||
    cleanSessionCode(url.searchParams.get("sessionCode")) ||
    cleanSessionCode(body.currentSessionCode) ||
    state.activeSessionCode
  );
}

function studentSnapshot(exam, studentId) {
  const freshExam = refreshExam(exam);
  const participant = freshExam.participants.find((student) => student.id === studentId);
  const shouldSendQuestions =
    freshExam.status === "active" && participant && participant.status !== "submitted";
  const shouldSendReview =
    freshExam.status === "ended" &&
    freshExam.showExplanations !== false &&
    participant?.status === "submitted" &&
    participant.result;

  return {
    role: "student",
    publicBaseUrl: PUBLIC_BASE_URL,
    sessionCode: freshExam.sessionCode,
    status: freshExam.status,
    durationMinutes: freshExam.durationMinutes,
    templateQuestionCount: freshExam.templateQuestionCount,
    choiceCount: freshExam.choiceCount,
    startedAt: freshExam.startedAt,
    endsAt: freshExam.endsAt,
    endedAt: freshExam.endedAt,
    endReason: freshExam.endReason,
    explanationsAvailable: freshExam.showExplanations !== false,
    timeRemainingSeconds: secondsRemaining(freshExam),
    questionCount: freshExam.questions.length,
    questions: shouldSendQuestions ? publicQuestions(freshExam.questions) : [],
    reviewQuestions: shouldSendReview
      ? buildStudentReview(freshExam.questions, participant.result)
      : [],
    student: participant
      ? {
          id: participant.id,
          nickname: participant.nickname,
          status: participant.status,
          joinedAt: participant.joinedAt,
          submittedAt: participant.submittedAt,
          submittedByTimer: Boolean(participant.submittedByTimer),
          answers: participant.answers || {},
          result: participant.result || null,
        }
      : null,
    sessions: participant ? [] : publicSessionList(),
  };
}

function professorSnapshot(exam) {
  const freshExam = refreshExam(exam);
  const participants = freshExam.participants.map((participant) => ({
    id: participant.id,
    nickname: participant.nickname,
    status: participant.status,
    joinedAt: participant.joinedAt,
    submittedAt: participant.submittedAt,
    submittedByTimer: Boolean(participant.submittedByTimer),
    answeredCount: answerCount(participant),
    result: participant.result || null,
  }));

  return {
    role: "professor",
    publicBaseUrl: PUBLIC_BASE_URL,
    sessionCode: freshExam.sessionCode,
    status: freshExam.status,
    durationMinutes: freshExam.durationMinutes,
    templateQuestionCount: freshExam.templateQuestionCount,
    choiceCount: freshExam.choiceCount,
    professorPasscode: freshExam.professorPasscode,
    showExplanations: freshExam.showExplanations !== false,
    startedAt: freshExam.startedAt,
    endsAt: freshExam.endsAt,
    endedAt: freshExam.endedAt,
    endReason: freshExam.endReason,
    timeRemainingSeconds: secondsRemaining(freshExam),
    questionCount: freshExam.questions.length,
    questions: freshExam.questions,
    participants,
    submittedCount: submittedParticipants(freshExam).length,
    resultsReady: resultsReady(freshExam),
    analytics: resultsReady(freshExam) ? buildAnalytics(freshExam.questions, participants) : null,
    sessions: publicSessionList(),
  };
}

function snapshotFor(client) {
  if (client.role === "professor") {
    const exam = getSession(state, client.sessionCode) || getSession(state, state.activeSessionCode);
    return professorSnapshot(exam);
  }

  const exam = examFromStudent(client.studentId, client.sessionCode) || getSession(state, state.activeSessionCode);
  return studentSnapshot(exam, client.studentId);
}

function sendEvent(client) {
  client.res.write("event: state\n");
  client.res.write(`data: ${JSON.stringify(snapshotFor(client))}\n\n`);
}

function broadcast() {
  for (const client of clients) {
    sendEvent(client);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function requireProfessor(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const passcode = req.headers["x-professor-passcode"] || url.searchParams.get("passcode");
  const sessionCode =
    cleanSessionCode(req.headers["x-session-code"]) ||
    cleanSessionCode(url.searchParams.get("sessionCode")) ||
    state.activeSessionCode;
  const exam = getSession(state, sessionCode);
  const acceptedPasscodes = new Set(
    [PROFESSOR_PASSCODE, exam?.professorPasscode].filter(Boolean)
  );

  if (!acceptedPasscodes.has(passcode)) {
    const error = new Error("Professor passcode is invalid");
    error.statusCode = 401;
    throw error;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }));
      }
    });
  });
}

function cleanNickname(nickname) {
  return String(nickname || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function cleanAnswers(answers = {}) {
  return Object.fromEntries(
    Object.entries(answers)
      .map(([questionId, answer]) => [questionId, String(answer || "").trim().toUpperCase()])
      .filter(([, answer]) => ANSWERS.includes(answer))
  );
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const activeExam = getSession(state, state.activeSessionCode);
    sendJson(res, 200, {
      ok: true,
      status: activeExam.status,
      activeSessionCode: state.activeSessionCode,
      sessionCount: Object.keys(state.sessions).length,
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/template/csv" || url.pathname === "/api/template/json")) {
    const options = normalizeTemplateOptions({
      questions: url.searchParams.get("questions"),
      choices: url.searchParams.get("choices"),
    });
    const format = url.pathname.endsWith("/json") ? "json" : "csv";
    const body =
      format === "json" ? buildJsonTemplate(options) : buildCsvTemplate(options);

    sendText(res, 200, body, {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cau-mcq-template-${options.questionCount}q-${options.choiceCount}choices.${format}"`,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/qr") {
    const data = String(url.searchParams.get("data") || "").slice(0, 1000);
    if (!data) {
      sendJson(res, 400, { error: "QR data is required." });
      return;
    }

    const svg = await QRCode.toString(data, {
      type: "svg",
      margin: 1,
      width: 260,
      errorCorrectionLevel: "M",
    });
    sendText(res, 200, svg, {
      "Content-Type": "image/svg+xml; charset=utf-8",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/public") {
    const exam = examFromRequest(url);
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }
    sendJson(res, 200, studentSnapshot(exam, url.searchParams.get("studentId")));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/join") {
    const body = await readJsonBody(req);
    const nickname = cleanNickname(body.nickname);
    const sessionCode = cleanSessionCode(body.sessionCode);
    const exam = getSession(state, sessionCode);

    if (!nickname || nickname.length < 2) {
      sendJson(res, 400, { error: "Please enter a nickname with at least 2 characters." });
      return;
    }

    if (!sessionCode || !exam) {
      sendJson(res, 400, { error: "No mock exam was found for this exam code." });
      return;
    }

    const freshExam = refreshExam(exam);
    if (!canStudentJoinExam(freshExam)) {
      sendJson(res, 400, { error: "This exam has ended. Ask the professor for a new exam code." });
      return;
    }

    const existingParticipant = freshExam.participants.find(
      (participant) => participant.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (existingParticipant) {
      sendJson(res, 200, {
        studentId: existingParticipant.id,
        sessionCode: freshExam.sessionCode,
        reconnected: true,
        snapshot: studentSnapshot(freshExam, existingParticipant.id),
      });
      return;
    }

    const participant = {
      id: crypto.randomUUID(),
      nickname,
      status: freshExam.status === "active" ? "answering" : "waiting",
      joinedAt: nowIso(),
      submittedAt: null,
      submittedByTimer: false,
      answers: {},
      result: null,
    };

    const nextExam = {
      ...freshExam,
      participants: [...freshExam.participants, participant],
    };
    saveExam(nextExam, { makeActive: false });
    sendJson(res, 200, {
      studentId: participant.id,
      sessionCode: nextExam.sessionCode,
      snapshot: studentSnapshot(nextExam, participant.id),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/answers") {
    const body = await readJsonBody(req);
    const exam = examFromStudent(body.studentId, body.sessionCode);
    const participant = exam?.participants.find((student) => student.id === body.studentId);

    if (!exam || !participant) {
      sendJson(res, 404, { error: "Student session was not found." });
      return;
    }

    const freshExam = refreshExam(exam);
    const freshParticipant = freshExam.participants.find((student) => student.id === body.studentId);
    if (freshExam.status !== "active" || freshParticipant.status === "submitted") {
      sendJson(res, 200, { snapshot: studentSnapshot(freshExam, freshParticipant.id) });
      return;
    }

    const nextExam = {
      ...freshExam,
      participants: freshExam.participants.map((student) =>
        student.id === freshParticipant.id
          ? { ...student, answers: cleanAnswers(body.answers) }
          : student
      ),
    };
    saveExam(nextExam, { makeActive: false });
    sendJson(res, 200, { snapshot: studentSnapshot(nextExam, freshParticipant.id) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/leave") {
    const body = await readJsonBody(req);
    const exam = examFromStudent(body.studentId, body.sessionCode);
    if (!exam) {
      sendJson(res, 200, {
        removed: false,
        keptResult: false,
        snapshot: studentSnapshot(getSession(state, state.activeSessionCode), null),
      });
      return;
    }

    const result = leaveParticipant(exam.participants, body.studentId);
    let nextExam = {
      ...exam,
      participants: result.participants,
    };

    saveExam(nextExam, { makeActive: false });
    sendJson(res, 200, {
      removed: result.removed,
      keptResult: result.keptResult,
      snapshot: studentSnapshot(nextExam, null),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/submit") {
    const body = await readJsonBody(req);
    const exam = examFromStudent(body.studentId, body.sessionCode);
    const participant = exam?.participants.find((student) => student.id === body.studentId);

    if (!exam || !participant) {
      sendJson(res, 404, { error: "Student session was not found." });
      return;
    }

    const freshExam = refreshExam(exam);
    const freshParticipant = freshExam.participants.find((student) => student.id === body.studentId);
    if (freshParticipant.status === "submitted" && freshParticipant.result) {
      sendJson(res, 200, { snapshot: studentSnapshot(freshExam, freshParticipant.id) });
      return;
    }

    if (freshExam.status !== "active") {
      sendJson(res, 400, { error: "The exam is not active." });
      return;
    }

    let nextExam = {
      ...freshExam,
      participants: freshExam.participants.map((student) => {
        if (student.id !== freshParticipant.id) {
          return student;
        }

        const answers = cleanAnswers(body.answers);
        return {
          ...student,
          answers,
          status: "submitted",
          submittedAt: nowIso(),
          result: scoreSubmission(freshExam.questions, answers),
        };
      }),
    };

    saveExam(nextExam, { makeActive: false });
    sendJson(res, 200, { snapshot: studentSnapshot(nextExam, freshParticipant.id) });
    return;
  }

  if (url.pathname.startsWith("/api/professor")) {
    requireProfessor(req);
  }

  if (req.method === "GET" && url.pathname === "/api/professor/state") {
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }
    if (exam.status !== "ended" && state.activeSessionCode !== exam.sessionCode) {
      state = setSession(state, exam, { makeActive: true });
      persistState();
    }
    sendJson(res, 200, professorSnapshot(exam));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/professor/export.csv") {
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const filename = `cau-mock-exam-${exam.sessionCode}-results.csv`;
    sendText(res, 200, buildResultsCsv(refreshExam(exam)), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/import-preview") {
    const body = await readJsonBody(req);
    sendJson(res, 200, previewQuestions(body.questions));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/security/regenerate") {
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const nextExam = {
      ...exam,
      professorPasscode: generateProfessorPasscode(),
    };
    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/explanations") {
    const body = await readJsonBody(req);
    const exam = getSession(state, professorSessionCode(req, url, body));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const nextExam = {
      ...exam,
      showExplanations: Boolean(body.showExplanations),
    };
    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/sessions/clear-ended") {
    const currentCode = professorSessionCode(req, url);
    state = clearEndedSessions(state, currentCode);
    persistState();
    broadcast();
    sendJson(res, 200, professorSnapshot(getSession(state, currentCode) || getSession(state, state.activeSessionCode)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/student/remove") {
    const body = await readJsonBody(req);
    const exam = getSession(state, professorSessionCode(req, url, body));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const result = removeParticipantByProfessor(exam.participants, body.studentId);
    if (!result.removed) {
      sendJson(res, 404, { error: "Student was not found." });
      return;
    }

    const nextExam = {
      ...exam,
      participants: result.participants,
    };
    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/student/reset") {
    const body = await readJsonBody(req);
    const exam = getSession(state, professorSessionCode(req, url, body));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const result = resetParticipantAttempt(exam, body.studentId);
    if (!result.reset) {
      sendJson(res, 404, { error: "Student was not found." });
      return;
    }

    saveExam(result.exam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(result.exam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/config") {
    const body = await readJsonBody(req);
    const currentCode = professorSessionCode(req, url, body);
    let exam = getSession(state, currentCode);
    const durationMinutes = Number(body.durationMinutes);
    const templateOptions = normalizeTemplateOptions({
      questions: body.templateQuestionCount,
      choices: body.choiceCount,
    });

    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
      sendJson(res, 400, { error: "Duration must be between 1 and 240 minutes." });
      return;
    }

    if (exam.status === "active") {
      sendJson(res, 400, { error: "Duration and code cannot be changed while the exam is active." });
      return;
    }

    const nextCode = cleanSessionCode(body.sessionCode) || exam.sessionCode;
    if (nextCode !== exam.sessionCode) {
      state = renameSession(state, exam.sessionCode, nextCode);
      exam = getSession(state, nextCode);
    }

    const nextExam = {
      ...exam,
      durationMinutes: Math.round(durationMinutes),
      templateQuestionCount: templateOptions.questionCount,
      choiceCount: templateOptions.choiceCount,
    };
    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/questions") {
    const body = await readJsonBody(req);
    const exam = getSession(state, professorSessionCode(req, url, body));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    if (exam.status === "active") {
      sendJson(res, 400, { error: "Questions cannot be changed while the exam is active." });
      return;
    }

    const questions = Array.isArray(body.questions) && body.questions.length === 0
      ? []
      : validateQuestions(body.questions);
    const shouldClearParticipants = exam.status === "ended";
    const nextExam = {
      ...exam,
      questions,
      participants: shouldClearParticipants ? [] : exam.participants,
      status: "waiting",
      startedAt: null,
      endsAt: null,
      endedAt: null,
      endReason: null,
    };

    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/start") {
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    if (exam.status === "active") {
      sendJson(res, 200, professorSnapshot(exam));
      return;
    }

    if (exam.questions.length === 0) {
      sendJson(res, 400, { error: "Add at least one question before starting." });
      return;
    }

    const startedAt = Date.now();
    const nextExam = {
      ...exam,
      status: "active",
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(startedAt + exam.durationMinutes * 60_000).toISOString(),
      endedAt: null,
      endReason: null,
      participants: exam.participants.map((participant) => ({
        ...participant,
        status: participant.status === "submitted" ? "submitted" : "answering",
      })),
    };

    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/end") {
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const nextExam = endExam(exam, "manual");
    saveExam(nextExam, { makeActive: true });
    sendJson(res, 200, professorSnapshot(nextExam));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/professor/reset") {
    const body = await readJsonBody(req);
    const exam = getSession(state, professorSessionCode(req, url));
    if (!exam) {
      sendJson(res, 404, { error: "Exam session was not found." });
      return;
    }

    const clearQuestions = body.clearQuestions !== false;
    state = createNewSession(state, {
      durationMinutes: exam.durationMinutes,
      templateQuestionCount: exam.templateQuestionCount,
      choiceCount: exam.choiceCount,
      questions: clearQuestions ? [] : exam.questions,
    });
    persistState();
    broadcast();
    sendJson(res, 200, professorSnapshot(getSession(state, state.activeSessionCode)));
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(pathname)}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    };

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

function handleEvents(req, res, url) {
  const role = url.pathname === "/events/professor" ? "professor" : "student";

  if (role === "professor") {
    try {
      requireProfessor(req);
    } catch {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
  }

  const client = {
    role,
    sessionCode: cleanSessionCode(url.searchParams.get("sessionCode")),
    studentId: url.searchParams.get("studentId"),
    res,
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  clients.add(client);
  sendEvent(client);
  req.on("close", () => clients.delete(client));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/events/")) {
      handleEvents(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
}

const server = http.createServer(handleRequest);
let autoEndTimer = null;

function startAutoEndTimer() {
  if (autoEndTimer) {
    return;
  }

  autoEndTimer = setInterval(() => {
    let changed = false;
    let hasActive = false;
    const sessions = { ...state.sessions };

    for (const [code, exam] of Object.entries(state.sessions)) {
      const freshExam = finishIfTimeElapsed(exam);
      sessions[code] = freshExam;
      changed = changed || freshExam !== exam;
      hasActive = hasActive || freshExam.status === "active";
    }

    if (changed) {
      state = { ...state, sessions };
      persistState();
    }

    if (changed || hasActive) {
      broadcast();
    }
  }, 1000);

  if (typeof autoEndTimer.unref === "function") {
    autoEndTimer.unref();
  }
}

startAutoEndTimer();

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`CAU Mock Exam Portal running at http://localhost:${PORT}`);
    console.log(`Professor passcode: ${PROFESSOR_PASSCODE}`);
  });
}

module.exports = handleRequest;
module.exports.handleRequest = handleRequest;
module.exports.server = server;
