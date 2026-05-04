const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("professor import area includes an AI prompt hint for CSV template conversion", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.match(appJs, /AI formatting hint/);
  assert.match(appJs, /Convert these questions to CSV/);
  assert.match(appJs, /Download CSV template/);
});
