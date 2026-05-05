const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createFileStateStorage, createRedisStateStorage } = require("../src/stateStorage");
const { createStore, getSession } = require("../src/sessionStore");

test("file state storage round-trips normalized exam state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cau-file-storage-"));
  const storage = createFileStateStorage({
    dataDir: tempDir,
    dataFile: path.join(tempDir, "state.json"),
  });
  const store = createStore({
    sessionCode: "CAU-7777",
    durationMinutes: 33,
  });

  await storage.save(store);
  const loaded = await storage.load();

  assert.equal(loaded.activeSessionCode, "CAU-7777");
  assert.equal(getSession(loaded, "CAU-7777").durationMinutes, 33);
});

test("redis state storage stores the shared Vercel state under one key", async () => {
  const values = new Map();
  const redis = {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
  };
  const storage = createRedisStateStorage({ redis, key: "exam-state-test" });
  const store = createStore({
    sessionCode: "CAU-8888",
    durationMinutes: 51,
  });

  await storage.save(store);
  const loaded = await storage.load();

  assert.equal(storage.durable, true);
  assert.equal(storage.mode, "upstash-redis");
  assert.equal(getSession(loaded, "CAU-8888").durationMinutes, 51);
});
