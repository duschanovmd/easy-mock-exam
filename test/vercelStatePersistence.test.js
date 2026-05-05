const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

function loadServer(dataFile) {
  process.env.DATA_FILE = dataFile;
  delete require.cache[require.resolve("../server")];
  return require("../server");
}

function requestJson(handleRequest, { method = "GET", url, headers = {}, body }) {
  const req = {
    method,
    url,
    headers: {
      host: "localhost",
      ...headers,
    },
    on(event, callback) {
      if (event === "data" && body !== undefined) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        callback();
      }
      return this;
    },
    destroy() {},
  };

  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(statusCode, responseHeaders = {}) {
        this.statusCode = statusCode;
        this.headers = responseHeaders;
      },
      end(responseBody = "") {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: responseBody ? JSON.parse(responseBody) : null,
        });
      },
    };

    handleRequest(req, res);
  });
}

test("separate function instances reload saved state before handling professor actions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cau-state-"));
  const dataFile = path.join(tempDir, "exam-state.json");
  const firstInstance = loadServer(dataFile);
  const secondInstance = loadServer(dataFile);
  const headers = {
    "x-professor-passcode": "CAU-PROF",
  };

  const configResponse = await requestJson(firstInstance, {
    method: "POST",
    url: "/api/professor/config",
    headers,
    body: {
      durationMinutes: 42,
    },
  });

  assert.equal(configResponse.statusCode, 200);
  assert.equal(configResponse.body.durationMinutes, 42);

  const stateResponse = await requestJson(secondInstance, {
    url: "/api/professor/state",
    headers,
  });

  assert.equal(stateResponse.statusCode, 200);
  assert.equal(stateResponse.body.durationMinutes, 42);

  const startResponse = await requestJson(secondInstance, {
    method: "POST",
    url: "/api/professor/start",
    headers,
  });

  assert.equal(startResponse.statusCode, 200);
  assert.equal(startResponse.body.status, "active");

  const refreshedResponse = await requestJson(firstInstance, {
    url: "/api/professor/state",
    headers,
  });

  assert.equal(refreshedResponse.statusCode, 200);
  assert.equal(refreshedResponse.body.status, "active");
  assert.equal(refreshedResponse.body.durationMinutes, 42);
});
