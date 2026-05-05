const app = document.querySelector("#app");
const tabs = document.querySelectorAll("[data-route]");
const fileImportInput = document.createElement("input");

fileImportInput.type = "file";
fileImportInput.accept = ".json,.csv,text/csv,application/json";
fileImportInput.hidden = true;
document.body.appendChild(fileImportInput);

const studentStore = {
  id: localStorage.getItem("cau.studentId") || "",
  nickname: localStorage.getItem("cau.nickname") || "",
  sessionCode: localStorage.getItem("cau.studentSessionCode") || "",
  answers: {},
  currentQuestion: 0,
  snapshot: null,
  error: "",
  message: "",
};

const professorStore = {
  passcode: localStorage.getItem("cau.professorPasscode") || "",
  sessionCode: "",
  authenticated: sessionStorage.getItem("cau.professorAuthenticated") === "true",
  snapshot: null,
  importPreview: null,
  pendingImportText: "",
  previewedImportText: "",
  pendingImportQuestions: null,
  showSessionPasscode: false,
  error: "",
  message: "",
};

const initialParams = new URLSearchParams(location.search);
if (initialParams.get("examCode")) {
  studentStore.sessionCode = initialParams.get("examCode").trim().toUpperCase();
  localStorage.setItem("cau.studentSessionCode", studentStore.sessionCode);
}

if (initialParams.get("sessionCode")) {
  professorStore.sessionCode = initialParams.get("sessionCode").trim().toUpperCase();
  localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
}

let syncTimer = null;
let syncInFlight = false;
let saveTimer = null;

function route() {
  return location.hash.includes("professor") ? "professor" : "student";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function answerKeys(choiceCount = 4) {
  const count = Math.min(6, Math.max(2, Math.round(Number(choiceCount) || 4)));
  return ["A", "B", "C", "D", "E", "F"].slice(0, count);
}

function templateHref(format, snapshot) {
  const questions = Number(snapshot.templateQuestionCount) || 20;
  const choices = Number(snapshot.choiceCount) || 4;
  return `/api/template/${format}?questions=${encodeURIComponent(questions)}&choices=${encodeURIComponent(choices)}`;
}

function statusLabel(status) {
  const labels = {
    waiting: "Waiting",
    active: "Active",
    ended: "Ended",
    answering: "Answering",
    submitted: "Submitted",
  };
  return labels[status] || status;
}

function statusPill(status) {
  return `<span class="status-pill ${status === "active" ? "active" : ""} ${status === "ended" ? "ended" : ""}">${statusLabel(status)}</span>`;
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (options.professor) {
    const sessionCode = Object.prototype.hasOwnProperty.call(options, "sessionCode")
      ? options.sessionCode
      : professorStore.sessionCode || professorStore.snapshot?.sessionCode || "";
    headers["x-professor-passcode"] = professorStore.passcode;
    headers["x-session-code"] = sessionCode || "";
  }

  if (options.sessionCode && !options.professor) {
    headers["x-session-code"] = options.sessionCode;
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function setActiveTab() {
  const currentRoute = route();
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route === currentRoute);
  });
}

function stopStream() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  syncInFlight = false;
}

function startPolling(callback) {
  stopStream();

  const tick = async () => {
    if (syncInFlight) {
      return;
    }

    syncInFlight = true;
    try {
      await callback();
    } finally {
      syncInFlight = false;
    }
  };

  syncTimer = setInterval(tick, 1500);
  tick();
}

function connectStudentStream() {
  if (!studentStore.id) {
    stopStream();
    return;
  }

  startPolling(() => loadPublicState({ silent: true }));
}

function connectProfessorStream() {
  if (!professorStore.passcode || !professorStore.authenticated) {
    stopStream();
    return;
  }

  startPolling(() => loadProfessorState({ connect: false, silent: true }));
}

async function loadPublicState(options = {}) {
  try {
    const params = new URLSearchParams();
    if (studentStore.id) {
      params.set("studentId", studentStore.id);
    }
    if (studentStore.sessionCode) {
      params.set("sessionCode", studentStore.sessionCode);
    }
    const data = await request(`/api/public?${params.toString()}`);
    studentStore.snapshot = data;
    if (data.student) {
      studentStore.answers = {
        ...(data.student.answers || {}),
        ...studentStore.answers,
      };
    }
    if (!options.silent) {
      studentStore.error = "";
    }
  } catch (error) {
    if (!options.silent || !studentStore.snapshot) {
      studentStore.error = error.message;
    }
  }

  if (options.render !== false) {
    render();
  }
}

async function loadProfessorState(options = {}) {
  if (!professorStore.passcode || !professorStore.authenticated) {
    if (options.render !== false) {
      render();
    }
    return;
  }

  try {
    const params = new URLSearchParams();
    if (professorStore.sessionCode) {
      params.set("sessionCode", professorStore.sessionCode);
    }
    professorStore.snapshot = await request(`/api/professor/state?${params.toString()}`, {
      professor: true,
      sessionCode: professorStore.sessionCode,
    });
    professorStore.sessionCode = professorStore.snapshot.sessionCode;
    professorStore.error = "";
    localStorage.setItem("cau.professorPasscode", professorStore.passcode);
    localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
    if (options.connect !== false) {
      connectProfessorStream();
    }
  } catch (error) {
    if (!options.silent || !professorStore.snapshot) {
      professorStore.error = error.message;
    }
    if (!options.silent) {
      professorStore.snapshot = null;
      professorStore.authenticated = false;
      sessionStorage.removeItem("cau.professorAuthenticated");
      localStorage.removeItem("cau.professorPasscode");
    }
  }

  if (options.render !== false) {
    render();
  }
}

function bootRoute() {
  setActiveTab();
  stopStream();
  studentStore.error = "";
  professorStore.error = "";

  if (route() === "professor") {
    loadProfessorState();
  } else {
    loadPublicState().then(() => {
      if (studentStore.id) {
        connectStudentStream();
      }
    });
  }
}

function messageHtml(message, type = "") {
  if (!message) {
    return "";
  }
  return `<div class="message ${type}">${escapeHtml(message)}</div>`;
}

function studentShell(content, timer = "") {
  const snapshot = studentStore.snapshot;
  return `
    <section class="hero-band">
      <div>
        <p class="eyebrow">Central Asian University</p>
        <h1>Mock exam room</h1>
        <p class="lede">Nickname-only practice testing for live classroom sessions.</p>
      </div>
      ${timer || `<div class="code-block">${escapeHtml(snapshot?.sessionCode || "CAU")}</div>`}
    </section>
    ${content}
  `;
}

function renderStudentJoin() {
  const snapshot = studentStore.snapshot;
  return studentShell(`
    <section class="workspace split">
      <form class="panel" data-action="join-student">
        <div class="panel-header">
          <h2>Join exam</h2>
          ${statusPill(snapshot?.status || "waiting")}
        </div>
        <div class="field-grid">
          <label class="field">
            <span>Nickname only</span>
            <input name="nickname" maxlength="24" autocomplete="off" value="${escapeHtml(studentStore.nickname)}" required />
          </label>
          <label class="field">
            <span>Exam code</span>
            <input name="sessionCode" maxlength="16" autocomplete="off" placeholder="${escapeHtml(snapshot?.sessionCode || "CAU-1234")}" value="${escapeHtml(studentStore.sessionCode)}" required />
          </label>
        </div>
        <div class="button-row" style="margin-top: 18px">
          <button class="primary" type="submit">Join waiting room</button>
        </div>
        ${messageHtml(studentStore.error, "error")}
      </form>

      <aside class="panel tight">
        <h2>Session</h2>
        <div class="metrics-grid" style="grid-template-columns: 1fr">
          <div class="metric">
            <span>Questions</span>
            <strong>${snapshot?.questionCount || 0}</strong>
          </div>
          <div class="metric">
            <span>Duration</span>
            <strong>${snapshot?.durationMinutes || 0} min</strong>
          </div>
        </div>
      </aside>
    </section>
  `);
}

function renderWaitingRoom(snapshot) {
  return studentShell(`
    <section class="workspace split">
      <div class="panel">
        <div class="panel-header">
          <h2>Waiting room</h2>
          ${statusPill(snapshot.status)}
        </div>
        <p class="lede">You are signed in as <strong>${escapeHtml(snapshot.student.nickname)}</strong>.</p>
        <div class="message success">Keep this screen open. The exam will appear when the professor starts.</div>
        <div class="button-row" style="margin-top: 18px">
          <button class="secondary" type="button" data-action="exit-room">Exit room</button>
        </div>
      </div>
      <aside class="panel tight">
        <h2>Exam code</h2>
        <div class="code-block">${escapeHtml(snapshot.sessionCode)}</div>
      </aside>
    </section>
  `);
}

function renderStudentExam(snapshot) {
  const questions = snapshot.questions || [];
  const index = Math.min(studentStore.currentQuestion, Math.max(questions.length - 1, 0));
  const question = questions[index];
  const answer = studentStore.answers[question?.id];
  const answeredCount = questions.filter((item) => studentStore.answers[item.id]).length;

  if (!question) {
    return studentShell(`<section class="workspace"><div class="panel">Waiting for questions.</div></section>`);
  }

  const timer = `
    <div class="timer">
      <span>Time left</span>
      <strong>${formatTime(snapshot.timeRemainingSeconds)}</strong>
    </div>
  `;

  return studentShell(`
    <section class="workspace">
      <div class="question-panel">
        <div class="question-meta">
          <div>
            ${statusPill(snapshot.status)}
            <span class="status-pill">${answeredCount}/${questions.length} answered</span>
          </div>
          <strong>Question ${index + 1} of ${questions.length}</strong>
        </div>
        <p class="question-text">${escapeHtml(question.text)}</p>
        <div class="options">
          ${Object.entries(question.options)
            .map(
              ([key, value]) => `
                <button class="option ${answer === key ? "selected" : ""}" type="button" data-action="select-answer" data-question-id="${escapeHtml(question.id)}" data-answer="${key}">
                  <span class="option-key">${key}</span>
                  <span>${escapeHtml(value)}</span>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="question-nav">
          <div class="pills">
            ${questions
              .map(
                (item, itemIndex) => `
                  <button class="pill-button ${itemIndex === index ? "current" : ""} ${studentStore.answers[item.id] ? "answered" : ""}" type="button" data-action="go-question" data-index="${itemIndex}">
                    ${itemIndex + 1}
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="button-row">
            <button class="secondary" type="button" data-action="previous-question" ${index === 0 ? "disabled" : ""}>Previous</button>
            <button class="secondary" type="button" data-action="next-question" ${index === questions.length - 1 ? "disabled" : ""}>Next</button>
            <button class="ghost" type="button" data-action="exit-room">Exit room</button>
            <button class="primary" type="button" data-action="submit-exam">Submit exam</button>
          </div>
        </div>
      </div>
      ${messageHtml(studentStore.error, "error")}
    </section>
  `, timer);
}

function renderStudentResult(snapshot) {
  const result = snapshot.student?.result;
  const reviewQuestions = snapshot.reviewQuestions || [];
  const reviewMessage = reviewQuestions.length
    ? "Your review is available below."
    : snapshot.status === "ended" && snapshot.explanationsAvailable === false
      ? "The professor has kept explanations hidden for this session."
      : "You submitted early. Question explanations unlock when the professor ends the exam or releases them.";
  if (!result) {
    return renderWaitingRoom(snapshot);
  }

  return studentShell(`
    <section class="workspace">
      <div class="split">
        <div class="result-banner">
          <div>
            <p class="eyebrow">Your result</p>
            <h1>${result.score}/${result.total}</h1>
          </div>
          <div class="score-display">
            <strong>${result.percentage}%</strong>
            <span>${snapshot.student.submittedByTimer ? "Submitted when time ended" : "Submitted"}</span>
          </div>
          <p class="lede">${escapeHtml(reviewMessage)}</p>
        </div>
        <aside class="panel tight">
          <h2>Status</h2>
          ${statusPill(snapshot.status)}
          <div class="metric" style="margin-top: 14px">
            <span>Nickname</span>
            <strong>${escapeHtml(snapshot.student.nickname)}</strong>
          </div>
          <div class="button-row" style="margin-top: 14px">
            <button class="secondary" type="button" data-action="exit-room">Exit room</button>
          </div>
        </aside>
      </div>
      ${
        reviewQuestions.length
          ? renderResultReview(reviewQuestions)
          : `<div class="panel"><h2>Question review</h2><div class="empty-state">${escapeHtml(reviewMessage)}</div></div>`
      }
    </section>
  `);
}

function renderResultReview(reviewQuestions) {
  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Question review</h2>
        <span class="status-pill ended">Explanations unlocked</span>
      </div>
      <div class="review-list">
        ${reviewQuestions
          .map(
            (question, index) => `
              <article class="review-card ${question.isCorrect ? "correct" : "incorrect"}">
                <div class="question-meta">
                  <strong>Question ${index + 1}</strong>
                  <span class="status-pill ${question.isCorrect ? "active" : "ended"}">${question.isCorrect ? "Correct" : "Incorrect"}</span>
                </div>
                <p class="question-text">${escapeHtml(question.text)}</p>
                <div class="review-options">
                  ${Object.entries(question.options)
                    .map(([key, value]) => {
                      const isCorrect = key === question.correctAnswer;
                      const isSelected = key === question.selectedAnswer;
                      return `
                        <div class="review-option ${isCorrect ? "correct-answer" : ""} ${isSelected ? "selected-answer" : ""}">
                          <span class="option-key">${key}</span>
                          <span>${escapeHtml(value)}</span>
                          ${isCorrect ? `<strong>Correct answer</strong>` : ""}
                          ${isSelected && !isCorrect ? `<strong>Your answer</strong>` : ""}
                        </div>
                      `;
                    })
                    .join("")}
                </div>
                <div class="message ${question.isCorrect ? "success" : "error"}">
                  <strong>Your answer:</strong> ${escapeHtml(question.selectedAnswer || "Not answered")} &nbsp;
                  <strong>Correct:</strong> ${escapeHtml(question.correctAnswer)}
                </div>
                ${
                  question.explanation
                    ? `<p class="review-explanation">${escapeHtml(question.explanation)}</p>`
                    : `<p class="review-explanation muted">No explanation was provided for this question.</p>`
                }
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderStudent() {
  const snapshot = studentStore.snapshot;
  if (!snapshot) {
    app.innerHTML = document.querySelector("#loading-template").innerHTML;
    return;
  }

  const student = snapshot.student;
  if (!studentStore.id || !student) {
    app.innerHTML = renderStudentJoin();
    return;
  }

  if (student.status === "submitted") {
    app.innerHTML = renderStudentResult(snapshot);
    return;
  }

  if (snapshot.status === "active") {
    app.innerHTML = renderStudentExam(snapshot);
    return;
  }

  app.innerHTML = renderWaitingRoom(snapshot);
}

function professorLogin() {
  return `
    <section class="hero-band">
      <div>
        <p class="eyebrow">Professor dashboard</p>
        <h1>Exam control room</h1>
        <p class="lede">Question setup, synchronized start, live status, and private class analytics.</p>
      </div>
    </section>
    <section class="workspace split">
      <form class="panel" data-action="professor-login">
        <h2>Enter passcode</h2>
        <label class="field">
          <span>Professor passcode</span>
          <input name="passcode" type="password" autocomplete="current-password" value="${escapeHtml(professorStore.passcode)}" required />
        </label>
        <label class="field" style="margin-top: 12px">
          <span>Exam code optional</span>
          <input name="sessionCode" maxlength="16" autocomplete="off" value="${escapeHtml(professorStore.sessionCode)}" />
        </label>
        <div class="button-row" style="margin-top: 18px">
          <button class="primary" type="submit">Open dashboard</button>
        </div>
        ${messageHtml(professorStore.error, "error")}
      </form>
      <aside class="panel tight">
        <h2>Private access</h2>
        <p class="muted">Use the professor access code shared for this classroom session.</p>
      </aside>
    </section>
  `;
}

function renderProfessorHeader(snapshot) {
  return `
    <section class="hero-band">
      <div>
        <p class="eyebrow">Professor dashboard</p>
        <h1>CAU Mock Exam</h1>
        <p class="lede">Code ${escapeHtml(snapshot.sessionCode)}. Students join with nicknames only.</p>
      </div>
      <div class="timer">
        <span>${snapshot.status === "active" ? "Time left" : "Duration"}</span>
        <strong>${snapshot.status === "active" ? formatTime(snapshot.timeRemainingSeconds) : `${snapshot.durationMinutes} min`}</strong>
      </div>
    </section>
  `;
}

function renderControls(snapshot) {
  const selectedChoiceCount = Number(snapshot.choiceCount) || 4;
  const answeredTotal = snapshot.participants.reduce((sum, student) => sum + (Number(student.answeredCount) || 0), 0);
  const possibleAnswers = Math.max(1, snapshot.participants.length * Math.max(1, snapshot.questionCount));
  const answeredPercent = Math.round((answeredTotal / possibleAnswers) * 100);
  const endedSessionCount = (snapshot.sessions || []).filter((session) => session.status === "ended" && session.sessionCode !== snapshot.sessionCode).length;
  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Session control</h2>
        ${statusPill(snapshot.status)}
      </div>
      ${
        snapshot.storage?.durable === false
          ? `<div class="message error">Vercel persistent storage is not connected. Saves may reset until Upstash Redis is added to the project.</div>`
          : ""
      }
      <div class="metrics-grid">
        <div class="metric">
          <span>Code</span>
          <strong>${escapeHtml(snapshot.sessionCode)}</strong>
        </div>
        <div class="metric">
          <span>Students</span>
          <strong>${snapshot.participants.length}</strong>
        </div>
        <div class="metric">
          <span>Submitted</span>
          <strong>${snapshot.submittedCount}</strong>
        </div>
        <div class="metric">
          <span>Questions</span>
          <strong>${snapshot.questionCount}</strong>
        </div>
        <div class="metric">
          <span>Answered</span>
          <strong>${answeredPercent}%</strong>
        </div>
      </div>
      <div class="button-row" style="margin-top: 16px">
        <button class="primary" type="button" data-action="start-exam" ${snapshot.status === "active" || snapshot.questionCount === 0 ? "disabled" : ""}>Start exam</button>
        <button class="danger" type="button" data-action="end-exam" ${snapshot.status !== "active" ? "disabled" : ""}>End now</button>
        <button class="secondary" type="button" data-action="reset-session">New session</button>
        <button class="secondary" type="button" data-action="download-results">Download results CSV</button>
      </div>
      <div class="control-list">
        <div class="control-line">
          <div>
            <span class="field-label">Session professor passcode</span>
            <div class="passcode-row">
              <strong>${professorStore.showSessionPasscode ? escapeHtml(snapshot.professorPasscode || "Not set") : "********"}</strong>
              <button
                class="ghost icon-button passcode-toggle"
                type="button"
                data-action="toggle-session-passcode"
                aria-label="${professorStore.showSessionPasscode ? "Hide session passcode" : "Show session passcode"}"
                title="${professorStore.showSessionPasscode ? "Hide session passcode" : "Show session passcode"}"
              >
                <span class="eye-icon ${professorStore.showSessionPasscode ? "visible" : ""}" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <button class="ghost" type="button" data-action="regenerate-passcode">Regenerate</button>
        </div>
        <div class="control-line">
          <div>
            <span class="field-label">Student explanations</span>
            <strong>${snapshot.showExplanations ? "Released after exam ends" : "Hidden from students"}</strong>
          </div>
          <button class="ghost" type="button" data-action="toggle-explanations" data-next="${snapshot.showExplanations ? "false" : "true"}">
            ${snapshot.showExplanations ? "Hide explanations" : "Release explanations"}
          </button>
        </div>
      </div>
      <form class="field-grid" style="margin-top: 18px" data-action="save-config">
        <label class="field">
          <span>Duration minutes</span>
          <input name="durationMinutes" type="number" min="1" max="240" value="${snapshot.durationMinutes}" ${snapshot.status === "active" ? "disabled" : ""} />
        </label>
        <label class="field">
          <span>Exam code</span>
          <input name="sessionCode" maxlength="16" value="${escapeHtml(snapshot.sessionCode)}" ${snapshot.status === "active" ? "disabled" : ""} />
        </label>
        <label class="field">
          <span>Questions in template</span>
          <input name="templateQuestionCount" type="number" min="1" max="200" value="${Number(snapshot.templateQuestionCount) || 20}" ${snapshot.status === "active" ? "disabled" : ""} />
        </label>
        <label class="field">
          <span>Choices per question</span>
          <select name="choiceCount" ${snapshot.status === "active" ? "disabled" : ""}>
            ${[2, 3, 4, 5, 6]
              .map(
                (count) => `<option value="${count}" ${count === selectedChoiceCount ? "selected" : ""}>${count} choices</option>`
              )
              .join("")}
          </select>
        </label>
        <div class="field full button-row">
          <button class="secondary" type="submit" ${snapshot.status === "active" ? "disabled" : ""}>Save settings</button>
        </div>
      </form>
      ${
        snapshot.sessions?.length
          ? `
            <div class="session-strip">
              <span class="field-label">Sessions</span>
              <div class="button-row">
                ${snapshot.sessions
                  .map(
                    (session) => `
                      <button class="session-chip ${session.sessionCode === snapshot.sessionCode ? "current" : ""}" type="button" data-action="open-session" data-session-code="${escapeHtml(session.sessionCode)}" ${session.sessionCode === snapshot.sessionCode ? "disabled" : ""}>
                        ${escapeHtml(session.sessionCode)} · ${statusLabel(session.status)}
                      </button>
                    `
                  )
                  .join("")}
                <button class="ghost" type="button" data-action="clear-ended-sessions" ${endedSessionCount === 0 ? "disabled" : ""}>Clear ended sessions</button>
              </div>
            </div>
          `
          : ""
      }
      ${messageHtml(professorStore.message, "success")}
      ${messageHtml(professorStore.error, "error")}
    </div>
  `;
}

function renderStudentShare(snapshot) {
  const baseUrl = (snapshot.publicBaseUrl || location.origin).replace(/\/+$/, "");
  const studentUrl = `${baseUrl}/?examCode=${encodeURIComponent(snapshot.sessionCode)}#/student`;
  const qrUrl = `/api/qr?data=${encodeURIComponent(studentUrl)}`;

  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Student QR</h2>
        <span class="status-pill">${escapeHtml(snapshot.sessionCode)}</span>
      </div>
      <div class="qr-share">
        <img src="${escapeHtml(qrUrl)}" alt="QR code for student exam link" />
        <div>
          <h3>Share exam room</h3>
          <p class="muted small">Show this QR code to students. It opens the student side with exam code ${escapeHtml(snapshot.sessionCode)}.</p>
          <div class="button-row">
            <button class="ghost" type="button" data-action="copy-link" data-link="${escapeHtml(studentUrl)}">Copy student link</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderImportPreview() {
  const preview = professorStore.importPreview;
  if (!preview) {
    return `<div class="empty-state">Preview pasted or uploaded questions before replacing the exam set.</div>`;
  }

  const errors = preview.errors || [];
  const warnings = preview.warnings || [];
  return `
    <div class="import-preview ${preview.valid ? "valid" : "invalid"}">
      <div class="panel-header">
        <h3>Import preview</h3>
        <span class="status-pill ${preview.valid ? "active" : "ended"}">${preview.valid ? "Ready" : "Needs fixes"}</span>
      </div>
      <div class="metrics-grid compact">
        <div class="metric">
          <span>Total rows</span>
          <strong>${preview.questionCount}</strong>
        </div>
        <div class="metric">
          <span>Valid</span>
          <strong>${preview.validCount}</strong>
        </div>
        <div class="metric">
          <span>Warnings</span>
          <strong>${warnings.length}</strong>
        </div>
        <div class="metric">
          <span>Errors</span>
          <strong>${errors.length}</strong>
        </div>
      </div>
      ${
        errors.length
          ? `<div class="preview-list error">${errors.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>`
          : ""
      }
      ${
        warnings.length
          ? `<div class="preview-list warning">${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>`
          : ""
      }
    </div>
  `;
}

function renderQuestionManager(snapshot) {
  const keys = answerKeys(snapshot.choiceCount);
  const placeholder = `question,${keys.join(",")},correctAnswer,explanation`;
  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Question import</h2>
        <span class="status-pill">${snapshot.questionCount} items</span>
      </div>
      <div class="import-box">
        <label class="field">
          <span>Paste JSON or CSV</span>
          <textarea name="importText" data-import-text placeholder="${escapeHtml(placeholder)}">${escapeHtml(professorStore.pendingImportText)}</textarea>
        </label>
        <div class="button-row">
          <button class="secondary" type="button" data-action="preview-import" ${snapshot.status === "active" ? "disabled" : ""}>Preview import</button>
          <button class="primary" type="button" data-action="import-previewed" ${snapshot.status === "active" || !professorStore.importPreview?.valid ? "disabled" : ""}>Import previewed</button>
          <button class="danger" type="button" data-action="clear-questions" ${snapshot.status === "active" || snapshot.questionCount === 0 ? "disabled" : ""}>Delete all questions</button>
          <button class="secondary" type="button" data-action="choose-import-file" ${snapshot.status === "active" ? "disabled" : ""}>Upload and import file</button>
          <a class="link-button ghost" href="${escapeHtml(templateHref("csv", snapshot))}" download>Download CSV template</a>
          <a class="link-button ghost" href="${escapeHtml(templateHref("json", snapshot))}" download>Download JSON template</a>
        </div>
        <p class="template-prompt-hint">
          <strong>AI formatting hint:</strong> Download the CSV template, then give the template and your mock questions file to an AI tool with:
          "The first file is my mock questions. Give me them back as the attached template CSV."
        </p>
        ${renderImportPreview()}
      </div>
      <div class="question-list">
        ${
          snapshot.questions.length
            ? snapshot.questions
                .map(
                  (question, index) => `
              <article class="question-item">
                <div class="question-item-top">
                  <p><strong>${index + 1}.</strong> ${escapeHtml(question.text)}</p>
                  <button class="ghost" type="button" data-action="remove-question" data-index="${index}" ${snapshot.status === "active" ? "disabled" : ""}>Remove</button>
                </div>
                <span class="answer-key">Correct: ${escapeHtml(question.correctAnswer)}</span>
              </article>
            `
                )
                .join("")
            : `<div class="empty-state">No questions loaded yet. Upload a CSV/JSON file or paste AI-formatted questions.</div>`
        }
      </div>
    </div>
  `;
}

function renderParticipants(snapshot) {
  const rows = snapshot.participants
    .map(
      (student, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(student.nickname)}</strong></td>
          <td>${statusPill(student.status)}</td>
          <td>${Number(student.answeredCount) || 0}/${snapshot.questionCount}</td>
          <td>${snapshot.resultsReady && student.result ? `${student.result.score}/${student.result.total}` : "-"}</td>
          <td>${snapshot.resultsReady && student.result ? `${student.result.percentage}%` : "-"}</td>
          <td>
            <div class="button-row nowrap">
              <button class="ghost compact-button" type="button" data-action="reset-student" data-student-id="${escapeHtml(student.id)}">Reset</button>
              <button class="danger compact-button" type="button" data-action="remove-student" data-student-id="${escapeHtml(student.id)}">Remove</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Students</h2>
        <span class="status-pill">${snapshot.participants.length} joined</span>
      </div>
      ${
        rows
          ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nickname</th>
                    <th>Status</th>
                    <th>Answered</th>
                    <th>Score</th>
                    <th>Percent</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `
          : `<div class="empty-state">No students have joined yet.</div>`
      }
    </div>
  `;
}

function distributionChart(distribution) {
  const max = Math.max(1, ...distribution.map((bucket) => bucket.count));
  return `
    <div class="distribution" aria-label="Score distribution">
      ${distribution
        .map(
          (bucket) => `
            <div class="dist-col">
              <div class="dist-bar" style="height: ${Math.max(6, (bucket.count / max) * 150)}px"></div>
              <div class="dist-label">${escapeHtml(bucket.label)}<br /><strong>${bucket.count}</strong></div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function barList(items, valueKey = "percentage", labelKey = "nickname", red = false) {
  return `
    <div class="bar-list">
      ${items
        .map(
          (item) => `
            <div class="bar-row">
              <div class="bar-label" title="${escapeHtml(item[labelKey])}">${escapeHtml(item[labelKey])}</div>
              <div class="bar-track"><div class="bar-fill ${red ? "red" : ""}" style="width: ${Number(item[valueKey]) || 0}%"></div></div>
              <div class="bar-value">${Number(item[valueKey]) || 0}%</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAnalytics(snapshot) {
  const analytics = snapshot.analytics;
  if (!snapshot.resultsReady || !analytics) {
    return `
      <div class="panel">
        <div class="panel-header">
          <h2>Class performance</h2>
          <span class="status-pill">Private</span>
        </div>
        <div class="empty-state">Results appear here after the professor ends the exam or the timer reaches zero.</div>
      </div>
    `;
  }

  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Class performance</h2>
        <span class="status-pill ended">Results ready</span>
      </div>
      <div class="metrics-grid">
        <div class="metric">
          <span>Average</span>
          <strong>${analytics.averagePercentage}%</strong>
        </div>
        <div class="metric">
          <span>Highest</span>
          <strong>${analytics.highestPercentage}%</strong>
        </div>
        <div class="metric">
          <span>Lowest</span>
          <strong>${analytics.lowestPercentage}%</strong>
        </div>
        <div class="metric">
          <span>Median</span>
          <strong>${analytics.medianPercentage}%</strong>
        </div>
      </div>
    </div>
    <div class="panel">
      <h2>Score distribution</h2>
      ${distributionChart(analytics.scoreDistribution)}
    </div>
    <div class="panel">
      <h2>Student scores</h2>
      ${barList(analytics.leaderboard)}
    </div>
    <div class="panel">
      <h2>Question performance</h2>
      ${barList(
        analytics.questionPerformance.map((question, index) => ({
          label: `Q${index + 1}. ${question.questionText}`,
          percentage: question.percentageCorrect,
        })),
        "percentage",
        "label",
        true
      )}
    </div>
  `;
}

function renderProfessorQuestionReview(snapshot) {
  if (!snapshot.resultsReady) {
    return "";
  }

  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Questions and explanations</h2>
        <span class="status-pill ended">${snapshot.questions.length} questions</span>
      </div>
      <div class="review-list">
        ${snapshot.questions
          .map(
            (question, index) => `
              <article class="review-card">
                <div class="question-meta">
                  <strong>Question ${index + 1}</strong>
                  <span class="status-pill">Correct ${escapeHtml(question.correctAnswer)}</span>
                </div>
                <p class="question-text">${escapeHtml(question.text)}</p>
                <div class="review-options">
                  ${Object.entries(question.options)
                    .map(
                      ([key, value]) => `
                        <div class="review-option ${key === question.correctAnswer ? "correct-answer" : ""}">
                          <span class="option-key">${key}</span>
                          <span>${escapeHtml(value)}</span>
                          ${key === question.correctAnswer ? "<strong>Correct answer</strong>" : ""}
                        </div>
                      `
                    )
                    .join("")}
                </div>
                ${
                  question.explanation
                    ? `<p class="review-explanation">${escapeHtml(question.explanation)}</p>`
                    : `<p class="review-explanation muted">No explanation was provided for this question.</p>`
                }
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderProfessor() {
  if (!professorStore.passcode || !professorStore.authenticated || !professorStore.snapshot) {
    app.innerHTML = professorLogin();
    return;
  }

  const snapshot = professorStore.snapshot;
  const postExam = snapshot.resultsReady;
  app.innerHTML = `
    ${renderProfessorHeader(snapshot)}
    <section class="workspace dashboard-grid">
      <div class="stack">
        ${renderControls(snapshot)}
        ${renderParticipants(snapshot)}
      </div>
      <div class="stack">
        ${renderAnalytics(snapshot)}
        ${postExam ? "" : renderStudentShare(snapshot)}
        ${postExam ? renderProfessorQuestionReview(snapshot) : renderQuestionManager(snapshot)}
      </div>
    </section>
  `;
}

function render() {
  setActiveTab();
  if (route() === "professor") {
    renderProfessor();
  } else {
    renderStudent();
  }
}

async function joinStudent(form) {
  studentStore.error = "";
  studentStore.nickname = form.nickname.value.trim();
  studentStore.sessionCode = form.sessionCode.value.trim().toUpperCase();

  try {
    const data = await request("/api/student/join", {
      method: "POST",
      body: {
        nickname: form.nickname.value,
        sessionCode: studentStore.sessionCode,
      },
    });
    studentStore.id = data.studentId;
    studentStore.sessionCode = data.sessionCode || studentStore.sessionCode;
    studentStore.snapshot = data.snapshot;
    studentStore.answers = {};
    localStorage.setItem("cau.studentId", data.studentId);
    localStorage.setItem("cau.nickname", studentStore.nickname);
    localStorage.setItem("cau.studentSessionCode", studentStore.sessionCode);
    connectStudentStream();
  } catch (error) {
    studentStore.error = error.message;
  }
  render();
}

function clearStudentSession(snapshot = null) {
  stopStream();
  localStorage.removeItem("cau.studentId");
  studentStore.id = "";
  studentStore.answers = {};
  studentStore.currentQuestion = 0;
  studentStore.error = "";
  studentStore.snapshot = snapshot || {
    ...(studentStore.snapshot || {}),
    questions: [],
    student: null,
  };
}

async function exitRoom() {
  const snapshot = studentStore.snapshot;
  const isActiveAttempt =
    snapshot?.status === "active" && snapshot.student?.status !== "submitted";
  const confirmed =
    !isActiveAttempt ||
    window.confirm("Exit this exam room? Your current unsent answers will not be submitted.");

  if (!confirmed) {
    return;
  }

  try {
    if (studentStore.id) {
      const data = await request("/api/student/leave", {
        method: "POST",
        body: {
          studentId: studentStore.id,
          sessionCode: studentStore.sessionCode,
        },
      });
      clearStudentSession(data.snapshot);
    } else {
      clearStudentSession();
    }
  } catch (error) {
    clearStudentSession();
    studentStore.error = error.message;
  }

  await loadPublicState();
}

function saveAnswersSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!studentStore.id) {
      return;
    }
    try {
      await request("/api/student/answers", {
        method: "POST",
        body: {
          studentId: studentStore.id,
          sessionCode: studentStore.sessionCode,
          answers: studentStore.answers,
        },
      });
    } catch (error) {
      studentStore.error = error.message;
      render();
    }
  }, 250);
}

async function submitExam() {
  if (!studentStore.id) {
    return;
  }

  const snapshot = studentStore.snapshot;
  const unanswered = (snapshot?.questions || []).filter((question) => !studentStore.answers[question.id]).length;
  const confirmed =
    unanswered === 0 ||
    window.confirm(`${unanswered} question${unanswered === 1 ? "" : "s"} unanswered. Submit now?`);

  if (!confirmed) {
    return;
  }

  try {
    const data = await request("/api/student/submit", {
      method: "POST",
      body: {
        studentId: studentStore.id,
        sessionCode: studentStore.sessionCode,
        answers: studentStore.answers,
      },
    });
    studentStore.snapshot = data.snapshot;
    studentStore.error = "";
  } catch (error) {
    studentStore.error = error.message;
  }
  render();
}

async function professorAction(path, body = {}, options = {}) {
  professorStore.error = "";
  professorStore.message = "";
  try {
    const previousCode = professorStore.sessionCode;
    const previousPasscode = professorStore.passcode;
    professorStore.snapshot = await request(path, {
      method: "POST",
      professor: true,
      sessionCode: professorStore.sessionCode,
      body,
    });
    professorStore.sessionCode = professorStore.snapshot.sessionCode;
    professorStore.authenticated = true;
    sessionStorage.setItem("cau.professorAuthenticated", "true");
    localStorage.setItem("cau.professorPasscode", professorStore.passcode);
    if (options.useReturnedPasscode && professorStore.snapshot.professorPasscode) {
      professorStore.passcode = professorStore.snapshot.professorPasscode;
      localStorage.setItem("cau.professorPasscode", professorStore.passcode);
    }
    localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
    if (previousCode !== professorStore.sessionCode || previousPasscode !== professorStore.passcode) {
      connectProfessorStream();
    }
    professorStore.message = options.message || "Saved.";
  } catch (error) {
    professorStore.error = error.message;
  }
  render();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  );
}

function parseQuestions(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Import text is empty.");
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.questions;
  }

  return parseCsv(trimmed);
}

async function importQuestions(text) {
  professorStore.error = "";
  professorStore.message = "";
  try {
    const questions = parseQuestions(text);
    professorStore.snapshot = await request("/api/professor/questions", {
      method: "POST",
      professor: true,
      body: { questions },
    });
    professorStore.sessionCode = professorStore.snapshot.sessionCode;
    localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
    professorStore.message = "Questions imported.";
    professorStore.pendingImportText = "";
    professorStore.previewedImportText = "";
    professorStore.pendingImportQuestions = null;
    professorStore.importPreview = null;
  } catch (error) {
    professorStore.error = error.message;
  }
  render();
}

async function importUploadedFile(text) {
  professorStore.error = "";
  professorStore.message = "";
  professorStore.pendingImportText = text;

  try {
    const questions = parseQuestions(text);
    professorStore.pendingImportQuestions = questions;
    professorStore.previewedImportText = text;
    professorStore.importPreview = await request("/api/professor/import-preview", {
      method: "POST",
      professor: true,
      body: { questions },
    });

    if (!professorStore.importPreview.valid) {
      professorStore.message = "File uploaded, but the preview found issues. Fix them before importing.";
      render();
      return;
    }

    professorStore.snapshot = await request("/api/professor/questions", {
      method: "POST",
      professor: true,
      body: { questions },
    });
    professorStore.sessionCode = professorStore.snapshot.sessionCode;
    localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
    professorStore.pendingImportText = "";
    professorStore.previewedImportText = "";
    professorStore.pendingImportQuestions = null;
    professorStore.importPreview = null;
    professorStore.message = `File uploaded and ${questions.length} questions imported.`;
  } catch (error) {
    professorStore.importPreview = null;
    professorStore.previewedImportText = "";
    professorStore.pendingImportQuestions = null;
    professorStore.error = error.message;
  }
  render();
}

async function previewImportText(text) {
  professorStore.error = "";
  professorStore.message = "";
  professorStore.pendingImportText = text;

  try {
    const questions = parseQuestions(text);
    professorStore.pendingImportQuestions = questions;
    professorStore.previewedImportText = text;
    professorStore.importPreview = await request("/api/professor/import-preview", {
      method: "POST",
      professor: true,
      body: { questions },
    });
    professorStore.message = professorStore.importPreview.valid
      ? "Import preview is ready."
      : "Import preview found issues.";
  } catch (error) {
    professorStore.importPreview = null;
    professorStore.previewedImportText = "";
    professorStore.pendingImportQuestions = null;
    professorStore.error = error.message;
  }
  render();
}

async function importPreviewed(currentText = professorStore.pendingImportText) {
  if (!professorStore.importPreview?.valid) {
    professorStore.error = "Preview and fix the import before replacing questions.";
    render();
    return;
  }

  if (currentText !== professorStore.previewedImportText) {
    professorStore.error = "Preview again after editing the import text.";
    professorStore.importPreview = null;
    professorStore.pendingImportText = currentText;
    render();
    return;
  }

  await importQuestions(professorStore.pendingImportText);
}

async function downloadResultsCsv() {
  professorStore.error = "";
  professorStore.message = "";
  const sessionCode = professorStore.sessionCode || professorStore.snapshot?.sessionCode || "";

  try {
    const response = await fetch(`/api/professor/export.csv?sessionCode=${encodeURIComponent(sessionCode)}`, {
      headers: {
        "x-professor-passcode": professorStore.passcode,
        "x-session-code": sessionCode,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = "Could not export results.";
      try {
        message = JSON.parse(text).error || message;
      } catch {
        message = text || message;
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cau-mock-exam-${sessionCode || "results"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    professorStore.message = "Results CSV downloaded.";
  } catch (error) {
    professorStore.error = error.message;
  }
  render();
}

app.addEventListener("submit", async (event) => {
  const form = event.target;
  const action = form.dataset.action;
  if (!action) {
    return;
  }

  event.preventDefault();

  if (action === "join-student") {
    await joinStudent(form);
  }

  if (action === "professor-login") {
    professorStore.passcode = form.passcode.value;
    professorStore.sessionCode = form.sessionCode.value.trim().toUpperCase();
    professorStore.authenticated = true;
    sessionStorage.setItem("cau.professorAuthenticated", "true");
    await loadProfessorState();
  }

  if (action === "save-config") {
    await professorAction("/api/professor/config", {
      durationMinutes: form.durationMinutes.value,
      sessionCode: form.sessionCode.value,
      templateQuestionCount: form.templateQuestionCount.value,
      choiceCount: form.choiceCount.value,
    });
  }

});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;

  if (action === "select-answer") {
    studentStore.answers[target.dataset.questionId] = target.dataset.answer;
    saveAnswersSoon();
    render();
  }

  if (action === "go-question") {
    studentStore.currentQuestion = Number(target.dataset.index);
    render();
  }

  if (action === "previous-question") {
    studentStore.currentQuestion = Math.max(0, studentStore.currentQuestion - 1);
    render();
  }

  if (action === "next-question") {
    studentStore.currentQuestion += 1;
    render();
  }

  if (action === "submit-exam") {
    await submitExam();
  }

  if (action === "exit-room") {
    await exitRoom();
  }

  if (action === "start-exam") {
    await professorAction("/api/professor/start");
  }

  if (action === "end-exam") {
    await professorAction("/api/professor/end");
  }

  if (action === "reset-session") {
    const confirmed = window.confirm("Create a fresh room and clear all uploaded questions?");
    if (confirmed) {
      await professorAction(
        "/api/professor/reset",
        { clearQuestions: true },
        { message: "Fresh room created. Upload questions to begin." }
      );
    }
  }

  if (action === "download-results") {
    await downloadResultsCsv();
  }

  if (action === "regenerate-passcode") {
    const confirmed = window.confirm("Regenerate this session's professor passcode?");
    if (confirmed) {
      await professorAction(
        "/api/professor/security/regenerate",
        {},
        { useReturnedPasscode: true, message: "Session passcode regenerated." }
      );
    }
  }

  if (action === "toggle-session-passcode") {
    professorStore.showSessionPasscode = !professorStore.showSessionPasscode;
    render();
  }

  if (action === "toggle-explanations") {
    await professorAction(
      "/api/professor/explanations",
      { showExplanations: target.dataset.next === "true" },
      { message: target.dataset.next === "true" ? "Student explanations released." : "Student explanations hidden." }
    );
  }

  if (action === "open-session") {
    professorStore.sessionCode = target.dataset.sessionCode;
    localStorage.setItem("cau.professorSessionCode", professorStore.sessionCode);
    await loadProfessorState();
  }

  if (action === "clear-ended-sessions") {
    const confirmed = window.confirm("Clear old ended sessions from this browser dashboard?");
    if (confirmed) {
      await professorAction(
        "/api/professor/sessions/clear-ended",
        {},
        { message: "Ended sessions cleared." }
      );
    }
  }

  if (action === "reset-student") {
    const confirmed = window.confirm("Reset this student's attempt and let them answer again?");
    if (confirmed) {
      await professorAction(
        "/api/professor/student/reset",
        { studentId: target.dataset.studentId },
        { message: "Student attempt reset." }
      );
    }
  }

  if (action === "remove-student") {
    const confirmed = window.confirm("Remove this student from the session?");
    if (confirmed) {
      await professorAction(
        "/api/professor/student/remove",
        { studentId: target.dataset.studentId },
        { message: "Student removed." }
      );
    }
  }

  if (action === "remove-question") {
    const index = Number(target.dataset.index);
    const questions = professorStore.snapshot.questions.filter((_, itemIndex) => itemIndex !== index);
    await professorAction("/api/professor/questions", { questions });
  }

  if (action === "clear-questions") {
    const confirmed = window.confirm("Delete all imported questions?");
    if (confirmed) {
      professorStore.importPreview = null;
      await professorAction(
        "/api/professor/questions",
        { questions: [] },
        { message: "All questions deleted." }
      );
    }
  }

  if (action === "copy-link") {
    try {
      await navigator.clipboard.writeText(target.dataset.link);
      professorStore.message = "Student link copied.";
    } catch {
      professorStore.message = "Student link: " + target.dataset.link;
    }
    professorStore.error = "";
    render();
  }

  if (action === "preview-import") {
    const textarea = app.querySelector("[data-import-text]");
    await previewImportText(textarea.value);
  }

  if (action === "import-previewed") {
    const textarea = app.querySelector("[data-import-text]");
    await importPreviewed(textarea.value);
  }

  if (action === "choose-import-file") {
    fileImportInput.value = "";
    fileImportInput.click();
  }
});

fileImportInput.addEventListener("change", async () => {
  const file = fileImportInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    professorStore.pendingImportText = text;
    await importUploadedFile(text);
  } catch (error) {
    professorStore.error = error.message;
    render();
  } finally {
    fileImportInput.value = "";
  }
});

window.addEventListener("hashchange", bootRoute);

setInterval(() => {
  const snapshot = studentStore.snapshot;
  if (
    route() === "student" &&
    snapshot?.status === "active" &&
    snapshot.timeRemainingSeconds <= 1 &&
    snapshot.student?.status !== "submitted"
  ) {
    submitExam();
  }
}, 1000);

if (!location.hash) {
  location.hash = "#/student";
} else {
  bootRoute();
}
