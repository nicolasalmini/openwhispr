const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/dictationRouting.js");

test("voice agent hotkey routes to the agent without a wake word", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("voice agent hotkey never triggers cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  // Even with cleanup enabled and reachable, a voice agent recording with an
  // unreachable agent returns the raw transcript instead of falling back.
  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "skip"
  );
});

test("voice agent hotkey ignores the wake word state", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("normal dictation with wake word routes to the agent", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "agent"
  );
});

test("normal dictation without wake word routes to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("wake word with unreachable agent falls back to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("skips reasoning when nothing is reachable", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "skip"
  );
});

test("agent is reachable in cloud mode without an explicit model", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "",
      isCloudAgent: true,
      isSelfHostedAgent: false,
    }),
    true
  );
});

test("agent is reachable in self-hosted mode without an explicit model", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "",
      isCloudAgent: false,
      isSelfHostedAgent: true,
    }),
    true
  );
});

test("agent is unreachable with an empty model on a model-required provider", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "   ",
      isCloudAgent: false,
      isSelfHostedAgent: false,
    }),
    false
  );
});

test("agent is reachable with an explicit model (BYOK/local/enterprise)", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "gpt-5.5",
      isCloudAgent: false,
      isSelfHostedAgent: false,
    }),
    true
  );
});

test("disabling the dictation agent overrides cloud reachability", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: false,
      dictationAgentModel: "",
      isCloudAgent: true,
      isSelfHostedAgent: true,
    }),
    false
  );
});

test("translation hotkey routes to translation when reachable", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: false,
      translationRequested: true,
      translationReachable: true,
    }),
    "translation"
  );
});

test("translation hotkey ignores the wake word state", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: false,
      translationRequested: true,
      translationReachable: true,
    }),
    "translation"
  );
});

test("unreachable translation degrades to cleanup, not to the agent", async () => {
  const { resolveDictationRouteKind } = await load();

  // Deliberately different from the voice agent's hard skip: a dictation meant
  // for translation is still a useful dictation, so keep the cleanup.
  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: false,
      translationRequested: true,
      translationReachable: false,
    }),
    "cleanup"
  );
});

test("unreachable translation with unreachable cleanup skips reasoning", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: false,
      translationRequested: true,
      translationReachable: false,
    }),
    "skip"
  );
});

test("Agent CLI cleanup is reachable with its default model and keeps provider explicit", async () => {
  const {
    resolveCleanupReachability,
    resolveEffectiveCleanupModel,
    buildCleanupReasoningConfig,
  } = await load();
  const settings = {
    useCleanupModel: true,
    cleanupMode: "agent-cli",
    cleanupProvider: "claude-cli",
    cleanupModel: "",
    cleanupAgentCliExecutablePath: "/opt/claude",
    cleanupDisableThinking: true,
  };

  assert.equal(resolveCleanupReachability(settings, false), true);
  assert.equal(resolveEffectiveCleanupModel(settings, false), "haiku");
  assert.equal(
    resolveEffectiveCleanupModel({ ...settings, cleanupProvider: "devin-cli" }, false),
    "swe"
  );
  assert.deepEqual(buildCleanupReasoningConfig(settings, false), {
    provider: "claude-cli",
    executablePath: "/opt/claude",
    disableThinking: true,
  });
});

test("cleanup config is provider-explicit for BYOK, local, and self-hosted routes", async () => {
  const { buildCleanupReasoningConfig } = await load();
  assert.equal(
    buildCleanupReasoningConfig({ cleanupMode: "providers", cleanupProvider: "anthropic" }, false)
      .provider,
    "anthropic"
  );
  assert.equal(
    buildCleanupReasoningConfig({ cleanupMode: "local", cleanupProvider: "qwen" }, false).provider,
    "local"
  );
  assert.deepEqual(
    buildCleanupReasoningConfig(
      {
        cleanupMode: "self-hosted",
        cleanupProvider: "custom",
        cleanupRemoteUrl: "http://localhost:11434/v1",
      },
      false
    ),
    {
      provider: "lan",
      lanUrl: "http://localhost:11434/v1",
      disableThinking: undefined,
    }
  );
});

test("reasoning availability cache key changes with selected adapter and executable", async () => {
  const { buildReasoningAvailabilityKey } = await load();
  const base = {
    useCleanupModel: true,
    cleanupMode: "agent-cli",
    cleanupProvider: "claude-cli",
    cleanupModel: "haiku",
    cleanupAgentCliExecutablePath: "/opt/claude",
    useDictationAgent: false,
    useDictationTranslation: false,
  };
  const first = buildReasoningAvailabilityKey(base);
  assert.notEqual(first, buildReasoningAvailabilityKey({ ...base, cleanupProvider: "devin-cli" }));
  assert.notEqual(
    first,
    buildReasoningAvailabilityKey({ ...base, cleanupAgentCliExecutablePath: "/other/claude" })
  );
});

test("normal dictation never takes the translation route", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: false,
      translationRequested: false,
      translationReachable: true,
    }),
    "cleanup"
  );
});

test("translation is unreachable when disabled", async () => {
  const { resolveDictationTranslationReachability } = await load();

  assert.equal(
    resolveDictationTranslationReachability({
      useDictationTranslation: false,
      translationTargetLanguage: "it",
      translationModel: "gpt-5-mini",
      isCloudTranslation: true,
      isSelfHostedTranslation: false,
    }),
    false
  );
});

test("translation is unreachable without a target language", async () => {
  const { resolveDictationTranslationReachability } = await load();

  assert.equal(
    resolveDictationTranslationReachability({
      useDictationTranslation: true,
      translationTargetLanguage: "   ",
      translationModel: "gpt-5-mini",
      isCloudTranslation: true,
      isSelfHostedTranslation: false,
    }),
    false
  );
});

test("translation is reachable in cloud mode without an explicit model", async () => {
  const { resolveDictationTranslationReachability } = await load();

  assert.equal(
    resolveDictationTranslationReachability({
      useDictationTranslation: true,
      translationTargetLanguage: "it",
      translationModel: "",
      isCloudTranslation: true,
      isSelfHostedTranslation: false,
    }),
    true
  );
});

test("translation is reachable in self-hosted mode without an explicit model", async () => {
  const { resolveDictationTranslationReachability } = await load();

  assert.equal(
    resolveDictationTranslationReachability({
      useDictationTranslation: true,
      translationTargetLanguage: "it",
      translationModel: "",
      isCloudTranslation: false,
      isSelfHostedTranslation: true,
    }),
    true
  );
});

test("translation needs a model on model-required providers", async () => {
  const { resolveDictationTranslationReachability } = await load();

  assert.equal(
    resolveDictationTranslationReachability({
      useDictationTranslation: true,
      translationTargetLanguage: "it",
      translationModel: "  ",
      isCloudTranslation: false,
      isSelfHostedTranslation: false,
    }),
    false
  );

  const { resolveDictationTranslationReachability: reach } = await load();
  assert.equal(
    reach({
      useDictationTranslation: true,
      translationTargetLanguage: "it",
      translationModel: "qwen3:8b",
      isCloudTranslation: false,
      isSelfHostedTranslation: false,
    }),
    true
  );
});

test("reasoning availability cache key changes when translation becomes reachable", async () => {
  const { buildReasoningAvailabilityKey } = await load();
  const base = {
    useCleanupModel: false,
    useDictationAgent: false,
    useDictationTranslation: true,
    translationMode: "providers",
    translationProvider: "anthropic",
    translationModel: "claude-sonnet",
    translationTargetLanguage: "",
  };
  assert.notEqual(
    buildReasoningAvailabilityKey(base),
    buildReasoningAvailabilityKey({ ...base, translationTargetLanguage: "ja" })
  );
});

test("reasoning availability cache key includes xAI and Mistral credentials", async () => {
  const { buildReasoningAvailabilityKey } = await load();
  const base = { useCleanupModel: true, cleanupMode: "providers", cleanupProvider: "xai" };
  const first = buildReasoningAvailabilityKey(base);
  assert.notEqual(first, buildReasoningAvailabilityKey({ ...base, xaiApiKey: "configured" }));
  assert.notEqual(first, buildReasoningAvailabilityKey({ ...base, mistralApiKey: "configured" }));
});

test("cleanup config trims an Agent CLI executable path before processing", async () => {
  const { buildCleanupReasoningConfig } = await load();
  assert.equal(
    buildCleanupReasoningConfig(
      {
        cleanupMode: "agent-cli",
        cleanupProvider: "claude-cli",
        cleanupAgentCliExecutablePath: "  /opt/claude  ",
      },
      false
    ).executablePath,
    "/opt/claude"
  );
});

test("cancelling processing kills active cleanup before clearing UI state", async () => {
  const { cancelProcessingState } = await load();
  const calls = [];
  assert.equal(
    cancelProcessingState({
      isProcessing: true,
      cancelActiveCleanup: () => calls.push("cancel"),
      clearProcessingState: () => calls.push("clear"),
    }),
    true
  );
  assert.deepEqual(calls, ["cancel", "clear"]);
});
