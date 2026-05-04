const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("professor login starts with an empty optional exam code", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.doesNotMatch(appJs, /sessionCode: localStorage\.getItem\("cau\.professorSessionCode"\)/);
  assert.match(appJs, /const professorStore = \{[\s\S]*sessionCode: ""/);
  assert.match(appJs, /initialParams\.get\("sessionCode"\)/);
});
