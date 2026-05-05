const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("professor dashboard uses import-only question setup", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.doesNotMatch(appJs, /data-action="add-question"/);
  assert.doesNotMatch(appJs, /Question text/);
  assert.doesNotMatch(appJs, /Add question/);
  assert.doesNotMatch(appJs, /questionFromForm/);
  assert.doesNotMatch(appJs, /add questions manually/);
});

test("student QR share is a right-column professor panel", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.match(appJs, /function renderStudentShare/);
  assert.match(appJs, /renderStudentShare\(snapshot\)/);
  assert.match(appJs, /Student QR/);
  assert.doesNotMatch(appJs, /top-qr/);
});

test("professor can delete the full imported question set at once", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.match(appJs, /data-action="clear-questions"/);
  assert.match(appJs, /Delete all questions/);
  assert.match(appJs, /snapshot\.questionCount === 0/);
  assert.match(appJs, /questions: \[\]/);
  assert.match(appJs, /All questions deleted/);
});

test("professor file upload uses a stable input outside the polling-rendered dashboard", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const questionManager = appJs.match(/function renderQuestionManager\(snapshot\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(appJs, /const fileImportInput = document\.createElement\("input"\)/);
  assert.match(appJs, /fileImportInput\.addEventListener\("change"/);
  assert.match(appJs, /data-action="choose-import-file"/);
  assert.doesNotMatch(questionManager, /type="file"/);
});

test("professor import controls are disabled when Vercel storage is missing", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const questionManager = appJs.match(/function renderQuestionManager\(snapshot\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(questionManager, /storageBlocked/);
  assert.match(questionManager, /snapshot\.storage\?\.durable === false/);
  assert.match(questionManager, /Question import is disabled until Upstash Redis is connected/);
  assert.match(questionManager, /storageBlocked \|\| snapshot\.status === "active"/);
});

test("session professor passcode is hidden until toggled", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.match(appJs, /showSessionPasscode: false/);
  assert.match(appJs, /data-action="toggle-session-passcode"/);
  assert.match(appJs, /aria-label="\$\{professorStore\.showSessionPasscode \? "Hide session passcode" : "Show session passcode"\}"/);
  assert.match(appJs, /professorStore\.showSessionPasscode \? escapeHtml\(snapshot\.professorPasscode \|\| "Not set"\) : "\*\*\*\*\*\*\*\*"/);
  assert.match(appJs, /eye-icon/);
});
