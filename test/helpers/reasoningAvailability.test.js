const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/reasoningAvailability.js");

test("does not report selected Anthropic available because OpenAI has a key", async () => {
  const { checkSelectedCleanupAvailability } = await load();
  const api = {
    getOpenAIKey: async () => "openai-key",
    getAnthropicKey: async () => "",
  };
  assert.equal(
    await checkSelectedCleanupAvailability(
      { cleanupMode: "providers", cleanupProvider: "anthropic" },
      api,
      { cloud: false, lan: false }
    ),
    false
  );
});

test("checks xAI and Mistral credentials for their selected provider routes", async () => {
  const { checkSelectedCleanupAvailability } = await load();
  const api = {
    getXaiKey: async () => "xai-key",
    getMistralKey: async () => "mistral-key",
  };
  for (const cleanupProvider of ["xai", "mistral"]) {
    assert.equal(
      await checkSelectedCleanupAvailability(
        { cleanupMode: "providers", cleanupProvider },
        api,
        { cloud: false, lan: false }
      ),
      true
    );
  }
});

test("checks only the selected Agent CLI adapter and executable path", async () => {
  const { checkSelectedCleanupAvailability } = await load();
  const calls = [];
  const api = {
    async checkAgentCliAvailability(payload) {
      calls.push(payload);
      return { available: payload.adapter === "devin-cli" };
    },
  };
  const available = await checkSelectedCleanupAvailability(
    {
      cleanupMode: "agent-cli",
      cleanupProvider: "devin-cli",
      cleanupAgentCliExecutablePath: "/opt/devin",
    },
    api,
    { cloud: false, lan: false }
  );
  assert.equal(available, true);
  assert.deepEqual(calls, [{ adapter: "devin-cli", executablePath: "/opt/devin" }]);
});

test("does not report cleanup available when its provider requires a missing model", async () => {
  const { checkActiveReasoningAvailability } = await load();
  const available = await checkActiveReasoningAvailability(
    {
      useCleanupModel: true,
      cleanupMode: "providers",
      cleanupProvider: "anthropic",
      cleanupModel: "",
      useDictationAgent: false,
      useDictationTranslation: false,
    },
    { getAnthropicKey: async () => "anthropic-key" },
    {
      cleanup: { cloud: false, lan: false },
      agent: { cloud: false },
      translation: { cloud: false },
    }
  );
  assert.equal(available, false);
});

test("an unavailable cleanup CLI does not block an available dictation-agent provider", async () => {
  const { checkActiveReasoningAvailability } = await load();
  const available = await checkActiveReasoningAvailability(
    {
      useCleanupModel: true,
      cleanupMode: "agent-cli",
      cleanupProvider: "claude-cli",
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: "anthropic",
      dictationAgentModel: "claude-sonnet",
      useDictationTranslation: false,
    },
    {
      checkAgentCliAvailability: async () => ({ available: false }),
      getAnthropicKey: async () => "anthropic-key",
    },
    {
      cleanup: { cloud: false, lan: false },
      agent: { cloud: false },
      translation: { cloud: false },
    }
  );
  assert.equal(available, true);
});

test("an available cleanup CLI does not mask an unavailable translation when cleanup is disabled", async () => {
  const { checkActiveReasoningAvailability } = await load();
  let cliChecks = 0;
  const available = await checkActiveReasoningAvailability(
    {
      useCleanupModel: false,
      cleanupMode: "agent-cli",
      cleanupProvider: "claude-cli",
      useDictationAgent: false,
      useDictationTranslation: true,
      translationTargetLanguage: "es",
      translationMode: "providers",
      translationProvider: "anthropic",
      translationModel: "claude-sonnet",
    },
    {
      checkAgentCliAvailability: async () => {
        cliChecks += 1;
        return { available: true };
      },
      getAnthropicKey: async () => "",
    },
    {
      cleanup: { cloud: false, lan: false },
      agent: { cloud: false },
      translation: { cloud: false },
    }
  );
  assert.equal(available, false);
  assert.equal(cliChecks, 0);
});
