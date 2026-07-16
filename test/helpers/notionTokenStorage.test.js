const test = require("node:test");
const assert = require("node:assert/strict");

const secretCryptoPath = require.resolve("../../src/helpers/secretCrypto");
require.cache[secretCryptoPath] = {
  id: secretCryptoPath,
  filename: secretCryptoPath,
  loaded: true,
  exports: {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decrypt: (value) => ({
      value: Buffer.from(value)
        .toString("utf8")
        .replace(/^encrypted:/, ""),
      needsReencrypt: false,
    }),
  },
};

const DatabaseManager = require("../../src/helpers/database");

test("rotates access and refresh tokens together as encrypted blobs", () => {
  let transactionCalls = 0;
  let updateArgs;
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = {
    transaction: (callback) => () => {
      transactionCalls += 1;
      return callback();
    },
    prepare: (sql) => {
      if (sql.includes("UPDATE notion_connections")) {
        return {
          run: (...args) => {
            updateArgs = args;
            return { changes: 1 };
          },
        };
      }
      return {
        get: () => ({
          id: 4,
          bot_id: "bot",
          workspace_id: "workspace",
          workspace_name: "Workspace",
          workspace_icon: null,
          access_token_expires_at: 1234,
          connected_at: "now",
          updated_at: "now",
        }),
      };
    },
  };

  manager.rotateNotionTokens(4, {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    accessTokenExpiresAt: 1234,
  });

  assert.equal(transactionCalls, 1);
  assert.ok(Buffer.isBuffer(updateArgs[0]));
  assert.ok(Buffer.isBuffer(updateArgs[1]));
  assert.equal(updateArgs[0].toString(), "encrypted:new-access");
  assert.equal(updateArgs[1].toString(), "encrypted:new-refresh");
  assert.equal(updateArgs[2], 1234);
  assert.equal(updateArgs[3], 4);
  assert.equal(updateArgs.includes("new-access"), false);
  assert.equal(updateArgs.includes("new-refresh"), false);
});

test("rotates a connection that has no refresh token without throwing", () => {
  let updateArgs;
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = {
    transaction: (callback) => () => callback(),
    prepare: (sql) => {
      if (sql.includes("UPDATE notion_connections")) {
        return {
          run: (...args) => {
            updateArgs = args;
            return { changes: 1 };
          },
        };
      }
      return { get: () => ({ id: 4 }) };
    },
  };

  manager.rotateNotionTokens(4, {
    accessToken: "new-access",
    refreshToken: null,
    accessTokenExpiresAt: null,
  });

  assert.ok(Buffer.isBuffer(updateArgs[0]));
  assert.equal(updateArgs[1], null);
});
