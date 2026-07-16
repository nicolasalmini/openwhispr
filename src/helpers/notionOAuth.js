const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, net, shell } = require("electron");
const debugLogger = require("./debugLogger");
const tokenStore = require("./tokenStore");

const FLOW_TTL_MS = 10 * 60 * 1000;

class NotionOAuthError extends Error {
  constructor(message, { code = "NOTION_OAUTH_ERROR", status = 0, retryable = false } = {}) {
    super(message);
    this.name = "NotionOAuthError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function resolveApiUrl() {
  let runtimeEnv = {};
  try {
    const envPath = path.join(__dirname, "..", "dist", "runtime-env.json");
    if (fs.existsSync(envPath)) runtimeEnv = JSON.parse(fs.readFileSync(envPath, "utf8"));
  } catch {}
  return (
    process.env.OPENWHISPR_API_URL ||
    process.env.VITE_OPENWHISPR_API_URL ||
    runtimeEnv.VITE_OPENWHISPR_API_URL ||
    ""
  ).replace(/\/+$/, "");
}

function expiresAtFromPayload(payload) {
  if (payload.access_token_expires_at) return Number(payload.access_token_expires_at);
  if (payload.expires_at) return Number(payload.expires_at);
  if (payload.expires_in) return Date.now() + Number(payload.expires_in) * 1000;
  return null;
}

class NotionOAuth {
  constructor(databaseManager, options = {}) {
    this.databaseManager = databaseManager;
    this.oauthProtocol = options.oauthProtocol || "openwhispr";
    this.fetch = options.fetch || net.fetch;
    this.openExternal = options.openExternal || ((url) => shell.openExternal(url));
    this.apiUrl = options.apiUrl || resolveApiUrl();
    this.pendingFlows = new Map();
    this.refreshPromises = new Map();
    this.onConnectionChanged = options.onConnectionChanged || (() => {});
  }

  async _brokerRequest(endpoint, body, method = "POST") {
    if (!this.apiUrl) {
      throw new NotionOAuthError("OpenWhispr Cloud is not configured", {
        code: "BROKER_UNAVAILABLE",
        retryable: true,
      });
    }
    const bearer = tokenStore.get();
    if (!bearer) {
      throw new NotionOAuthError("Sign in to OpenWhispr before connecting Notion", {
        code: "AUTH_REQUIRED",
        status: 401,
      });
    }

    let response;
    try {
      response = await this.fetch(`${this.apiUrl}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
        useSessionCookies: false,
      });
    } catch (error) {
      throw new NotionOAuthError("OpenWhispr Cloud is temporarily unreachable", {
        code: "BROKER_UNAVAILABLE",
        retryable: true,
      });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data?.code || data?.error?.code || "NOTION_OAUTH_ERROR";
      const message =
        data?.error?.message || data?.error || data?.message || "Notion connection failed";
      throw new NotionOAuthError(message, {
        code,
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return data?.data || data;
  }

  async start() {
    for (const [flowId, pending] of this.pendingFlows) {
      if (Date.now() - pending.createdAt > FLOW_TTL_MS) this.pendingFlows.delete(flowId);
    }
    const verifier = crypto.randomBytes(32).toString("base64url");
    const verifierHash = crypto.createHash("sha256").update(verifier).digest("base64url");
    const callbackUrl = `${this.oauthProtocol}://integrations/notion/callback`;
    const result = await this._brokerRequest("/api/integrations/notion/oauth/start", {
      verifier_hash: verifierHash,
      desktop_redirect_uri: callbackUrl,
    });
    const flowId = result.flow_id;
    const authorizationUrl = result.authorization_url || result.url;
    if (!flowId || !authorizationUrl) throw new NotionOAuthError("Invalid OAuth broker response");

    this.pendingFlows.set(flowId, { verifier, createdAt: Date.now() });
    await this.openExternal(authorizationUrl);
    return { success: true, flowId, expiresAt: result.expires_at || Date.now() + FLOW_TTL_MS };
  }

  async handleDeepLink(url) {
    const parsed = new URL(url);
    const isNotionCallback =
      (parsed.hostname === "integrations" &&
        parsed.pathname.replace(/\/+$/, "") === "/notion/callback") ||
      (parsed.hostname === "notion" && parsed.pathname.replace(/\/+$/, "") === "/callback");
    if (!isNotionCallback) return false;

    const flowId = parsed.searchParams.get("flow_id");
    const error = parsed.searchParams.get("error");
    if (error) {
      if (flowId) this.pendingFlows.delete(flowId);
      this.onConnectionChanged({ connected: false, error, code: "OAUTH_CANCELLED" });
      return true;
    }
    if (!flowId) {
      this.onConnectionChanged({ connected: false, error: "Missing OAuth flow ID" });
      return true;
    }

    try {
      const connection = await this.redeem(flowId);
      this.onConnectionChanged({ connected: true, connection });
    } catch (redeemError) {
      debugLogger.error(
        "Notion OAuth redemption failed",
        { error: redeemError.message, code: redeemError.code },
        "notion"
      );
      this.onConnectionChanged({
        connected: false,
        error: redeemError.message,
        code: redeemError.code,
      });
    }
    return true;
  }

  async redeem(flowId) {
    const pending = this.pendingFlows.get(flowId);
    this.pendingFlows.delete(flowId);
    if (!pending || Date.now() - pending.createdAt > FLOW_TTL_MS) {
      throw new NotionOAuthError("The Notion connection request expired. Try again.", {
        code: "FLOW_EXPIRED",
      });
    }

    const payload = await this._brokerRequest("/api/integrations/notion/oauth/redeem", {
      flow_id: flowId,
      verifier: pending.verifier,
    });
    return this.databaseManager.saveNotionConnection({
      botId: payload.bot_id,
      workspaceId: payload.workspace_id,
      workspaceName: payload.workspace_name,
      workspaceIcon: payload.workspace_icon,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessTokenExpiresAt: expiresAtFromPayload(payload),
    });
  }

  getConnection() {
    return this.databaseManager.getNotionConnection();
  }

  getStatus() {
    const connection = this.databaseManager.getNotionConnection();
    const destination = connection
      ? this.databaseManager.getNotionDestination(connection.id)
      : null;
    return { connected: Boolean(connection), connection, destination };
  }

  async refresh(connectionId, { force = false } = {}) {
    const credentials = this.databaseManager.getNotionConnectionCredentials(connectionId);
    if (!credentials) {
      throw new NotionOAuthError("Notion is not connected", { code: "NOT_CONNECTED" });
    }
    if (
      !force &&
      (!credentials.accessTokenExpiresAt || credentials.accessTokenExpiresAt > Date.now() + 60000)
    ) {
      return credentials.accessToken;
    }
    if (!credentials.refreshToken) {
      if (!force) return credentials.accessToken;
      throw new NotionOAuthError("Reconnect Notion to continue", { code: "INVALID_GRANT" });
    }

    // Notion rotates refresh tokens, so concurrent refreshes would invalidate
    // each other's tokens; all callers share a single in-flight exchange.
    let inFlight = this.refreshPromises.get(credentials.id);
    if (!inFlight) {
      inFlight = this._exchangeRefreshToken(credentials).finally(() => {
        this.refreshPromises.delete(credentials.id);
      });
      this.refreshPromises.set(credentials.id, inFlight);
    }
    return inFlight;
  }

  async _exchangeRefreshToken(credentials) {
    const payload = await this._brokerRequest("/api/integrations/notion/oauth/refresh", {
      refresh_token: credentials.refreshToken,
      bot_id: credentials.botId,
    });
    if (!payload.access_token || !payload.refresh_token) {
      throw new NotionOAuthError("Invalid token refresh response", { code: "INVALID_REFRESH" });
    }
    this.databaseManager.rotateNotionTokens(credentials.id, {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessTokenExpiresAt: expiresAtFromPayload(payload),
    });
    return payload.access_token;
  }

  async disconnect() {
    const credentials = this.databaseManager.getNotionConnectionCredentials();
    if (!credentials) return { success: true };
    try {
      await this._brokerRequest("/api/integrations/notion/oauth/revoke", {
        access_token: credentials.accessToken,
        bot_id: credentials.botId,
      });
    } catch (error) {
      if (!error.retryable && error.status !== 401 && error.status !== 404) throw error;
      debugLogger.warn(
        "Notion token revoke could not be confirmed; removing local credentials",
        { error: error.message, code: error.code },
        "notion"
      );
    }
    this.databaseManager.deleteNotionConnection(credentials.id);
    this.onConnectionChanged({ connected: false });
    return { success: true };
  }
}

module.exports = { NotionOAuth, NotionOAuthError, expiresAtFromPayload, resolveApiUrl };
