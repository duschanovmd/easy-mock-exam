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
