const fs = require("node:fs");
const path = require("node:path");

const { createStore } = require("./sessionStore");

const DEFAULT_REDIS_KEY = "cau-mock-exam-portal:exam-state";

function parseStoredState(value) {
  if (!value) {
    return createStore();
  }

  if (typeof value === "string") {
    return createStore(JSON.parse(value));
  }

  return createStore(value);
}

function createFileStateStorage({ dataDir, dataFile }) {
  return {
    mode: process.env.VERCEL ? "vercel-tmp-file" : "local-file",
    durable: !process.env.VERCEL,
    async load() {
      try {
        if (!fs.existsSync(dataFile)) {
          return createStore();
        }

        return parseStoredState(fs.readFileSync(dataFile, "utf8"));
      } catch (error) {
        console.error("Could not load saved exam state, starting fresh:", error.message);
        return createStore();
      }
    },
    async save(store) {
      fs.mkdirSync(dataDir || path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
    },
  };
}

function createRedisStateStorage({ redis, key = process.env.STATE_KEY || DEFAULT_REDIS_KEY }) {
  return {
    mode: "upstash-redis",
    durable: true,
    async load() {
      try {
        return parseStoredState(await redis.get(key));
      } catch (error) {
        console.error("Could not load exam state from Redis, starting fresh:", error.message);
        return createStore();
      }
    },
    async save(store) {
      await redis.set(key, JSON.stringify(store));
    },
  };
}

function hasUpstashEnvironment() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function createStateStorage(options = {}) {
  if (options.redisClient) {
    return createRedisStateStorage({
      redis: options.redisClient,
      key: options.redisKey,
    });
  }

  if (hasUpstashEnvironment()) {
    const { Redis } = require("@upstash/redis");
    return createRedisStateStorage({
      redis: Redis.fromEnv(),
      key: options.redisKey,
    });
  }

  return createFileStateStorage(options);
}

module.exports = {
  createFileStateStorage,
  createRedisStateStorage,
  createStateStorage,
  hasUpstashEnvironment,
};
