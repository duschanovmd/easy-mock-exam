const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("browser sync uses polling instead of server-sent event streams", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.doesNotMatch(appJs, /new EventSource/);
  assert.match(appJs, /setInterval/);
  assert.match(appJs, /loadPublicState/);
  assert.match(appJs, /loadProfessorState/);
});
