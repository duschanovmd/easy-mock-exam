const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const handleRequest = require("../server");

function requestJson({ method = "GET", url, headers = {} }) {
  const req = {
    method,
    url,
    headers: {
      host: "localhost",
      ...headers,
    },
  };

  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(body = "") {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: body ? JSON.parse(body) : null,
        });
      },
    };

    handleRequest(req, res);
  });
}

test("default professor passcode is CAU-PROF", async () => {
  const response = await requestJson({
    url: "/api/professor/state",
    headers: {
      "x-professor-passcode": "CAU-PROF",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, "professor");
});

test("professor login bundle does not reveal the passcode", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  assert.doesNotMatch(appJs, /CAU-PROF/);
  assert.doesNotMatch(appJs, /default passcode/i);
});
