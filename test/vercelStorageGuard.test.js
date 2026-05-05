const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

function loadVercelServerWithoutRedis() {
  const previousEnv = {
    DATA_FILE: process.env.DATA_FILE,
    VERCEL: process.env.VERCEL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };

  process.env.DATA_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cau-vercel-storage-")),
    "exam-state.json"
  );
  process.env.VERCEL = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete require.cache[require.resolve("../server")];
  const handleRequest = require("../server");

  return {
    handleRequest,
    restore() {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      delete require.cache[require.resolve("../server")];
    },
  };
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
          body: responseBody ? JSON.parse(responseBody) : null,
        });
      },
    };

    handleRequest(req, res);
  });
}

test("Vercel without Redis blocks starting a classroom exam", async () => {
  const { handleRequest, restore } = loadVercelServerWithoutRedis();
  try {
    const response = await requestJson(handleRequest, {
      method: "POST",
      url: "/api/professor/start",
      headers: {
        "x-professor-passcode": "CAU-PROF",
      },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /Upstash Redis/);
    assert.equal(response.body.storage.durable, false);
  } finally {
    restore();
  }
});

test("Vercel without Redis tells students storage is missing instead of blaming the exam code", async () => {
  const { handleRequest, restore } = loadVercelServerWithoutRedis();
  try {
    const response = await requestJson(handleRequest, {
      method: "POST",
      url: "/api/student/join",
      headers: {
        "content-type": "application/json",
      },
      body: {
        nickname: "Ali",
        sessionCode: "CAU-8809",
      },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /persistent storage/i);
  } finally {
    restore();
  }
});

test("Vercel without Redis blocks importing professor questions", async () => {
  const { handleRequest, restore } = loadVercelServerWithoutRedis();
  try {
    const response = await requestJson(handleRequest, {
      method: "POST",
      url: "/api/professor/questions",
      headers: {
        "content-type": "application/json",
        "x-professor-passcode": "CAU-PROF",
      },
      body: {
        questions: [
          {
            question: "Which ion is the main extracellular cation?",
            A: "Sodium",
            B: "Potassium",
            C: "Calcium",
            D: "Magnesium",
            correctAnswer: "A",
            explanation: "Sodium is the main extracellular cation.",
          },
        ],
      },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /Upstash Redis/);
  } finally {
    restore();
  }
});
