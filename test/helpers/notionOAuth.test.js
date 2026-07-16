const test = require("node:test");
const assert = require("node:assert/strict");

const tokenStorePath = require.resolve("../../src/helpers/tokenStore");
require.cache[tokenStorePath] = {
  id: tokenStorePath,
  filename: tokenStorePath,
  loaded: true,
  exports: { get: () => "openwhispr-bearer" },
};

const { NotionOAuth } = require("../../src/helpers/notionOAuth");

function createDatabase() {
  const state = {
    rotated: null,
    credentials: {
      id: 1,
      botId: "bot",
      workspaceId: "workspace",
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      accessTokenExpiresAt: Date.now() - 1000,
    },
  };
  return {
    state,
    getNotionConnectionCredentials: () => ({ ...state.credentials }),
    rotateNotionTokens: (_id, tokens) => {
      state.rotated = tokens;
      state.credentials = {
        ...state.credentials,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      };
    },
  };
}

test("concurrent refreshes share a single broker exchange", async () => {
  let brokerCalls = 0;
  const database = createDatabase();
  const oauth = new NotionOAuth(database, {
    apiUrl: "https://api.test",
    fetch: async () => {
      brokerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
        }),
      };
    },
  });

  const [first, second] = await Promise.all([oauth.refresh(1), oauth.refresh(1, { force: true })]);
  assert.equal(first, "new-access");
  assert.equal(second, "new-access");
  assert.equal(brokerCalls, 1);
  assert.equal(database.state.rotated.refreshToken, "refresh-2");
});

test("a later refresh after completion starts a fresh exchange", async () => {
  let brokerCalls = 0;
  const database = createDatabase();
  const oauth = new NotionOAuth(database, {
    apiUrl: "https://api.test",
    fetch: async () => {
      brokerCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: `access-${brokerCalls}`,
          refresh_token: `refresh-${brokerCalls + 1}`,
          expires_in: 3600,
        }),
      };
    },
  });

  assert.equal(await oauth.refresh(1), "access-1");
  assert.equal(await oauth.refresh(1, { force: true }), "access-2");
  assert.equal(brokerCalls, 2);
});

test("skips the broker while the stored access token is still valid", async () => {
  const database = createDatabase();
  database.state.credentials.accessToken = "valid-access";
  database.state.credentials.accessTokenExpiresAt = Date.now() + 10 * 60 * 1000;
  const oauth = new NotionOAuth(database, {
    apiUrl: "https://api.test",
    fetch: async () => {
      throw new Error("broker should not be called");
    },
  });

  assert.equal(await oauth.refresh(1), "valid-access");
});
