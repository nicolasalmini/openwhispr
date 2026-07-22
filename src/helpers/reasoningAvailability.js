export async function checkProviderAvailability(config, electronAPI, settings, isCloud) {
  if (isCloud) return true;

  if (config.mode === "agent-cli") {
    if (config.provider !== "claude-cli" && config.provider !== "devin-cli") return false;
    const result = await electronAPI?.checkAgentCliAvailability?.({
      adapter: config.provider,
      executablePath: config.executablePath?.trim() || undefined,
    });
    return result?.available === true;
  }
  if (config.mode === "local") {
    return (await electronAPI?.checkLocalReasoningAvailable?.()) === true;
  }
  if (config.mode === "self-hosted") return !!config.remoteUrl?.trim();
  if (config.mode === "openwhispr") return false;

  if (config.provider === "custom") return !!config.cloudBaseUrl?.trim();
  if (config.provider === "bedrock") {
    return (
      !!settings.bedrockProfile?.trim() ||
      (!!settings.bedrockAccessKeyId?.trim() && !!settings.bedrockSecretAccessKey?.trim())
    );
  }
  if (config.provider === "azure") {
    return !!settings.azureApiKey?.trim() && !!settings.azureEndpoint?.trim();
  }
  if (config.provider === "vertex") {
    return !!settings.vertexApiKey?.trim() || !!settings.vertexProject?.trim();
  }

  const getters = {
    openai: () => electronAPI?.getOpenAIKey?.(),
    anthropic: () => electronAPI?.getAnthropicKey?.(),
    gemini: () => electronAPI?.getGeminiKey?.(),
    groq: () => electronAPI?.getGroqKey?.(),
    xai: () => electronAPI?.getXaiKey?.(),
    mistral: () => electronAPI?.getMistralKey?.(),
    openrouter: () => electronAPI?.getOpenrouterKey?.(),
    tinfoil: () => electronAPI?.getTinfoilKey?.(),
    corti: () => electronAPI?.getCortiKey?.(),
  };
  const getter = getters[config.provider];
  return getter ? !!(await getter()) : false;
}

export async function checkSelectedCleanupAvailability(settings, electronAPI, route) {
  return checkProviderAvailability(
    {
      mode: settings.cleanupMode,
      provider: settings.cleanupProvider,
      remoteUrl: settings.cleanupRemoteUrl,
      cloudBaseUrl: settings.cleanupCloudBaseUrl,
      executablePath: settings.cleanupAgentCliExecutablePath,
    },
    electronAPI,
    settings,
    route.cloud || route.lan
  );
}

export async function checkActiveReasoningAvailability(settings, electronAPI, routes) {
  const checks = [];

  const cleanupReachable =
    settings.useCleanupModel &&
    (routes.cleanup.cloud ||
      routes.cleanup.lan ||
      (settings.cleanupMode === "agent-cli" &&
        (settings.cleanupProvider === "claude-cli" || settings.cleanupProvider === "devin-cli")) ||
      !!settings.cleanupModel?.trim());
  if (cleanupReachable) {
    checks.push(checkSelectedCleanupAvailability(settings, electronAPI, routes.cleanup));
  }

  const agentReachable =
    settings.useDictationAgent &&
    (routes.agent.cloud ||
      (settings.dictationAgentMode === "self-hosted" &&
        !!settings.dictationAgentRemoteUrl?.trim()) ||
      !!settings.dictationAgentModel?.trim());
  if (agentReachable) {
    checks.push(
      checkProviderAvailability(
        {
          mode: settings.dictationAgentMode,
          provider: settings.dictationAgentProvider,
          remoteUrl: settings.dictationAgentRemoteUrl,
          cloudBaseUrl: settings.dictationAgentCloudBaseUrl,
        },
        electronAPI,
        settings,
        routes.agent.cloud
      )
    );
  }

  const translationReachable =
    settings.useDictationTranslation &&
    !!settings.translationTargetLanguage?.trim() &&
    (routes.translation.cloud ||
      (settings.translationMode === "self-hosted" && !!settings.translationRemoteUrl?.trim()) ||
      !!settings.translationModel?.trim());
  if (translationReachable) {
    checks.push(
      checkProviderAvailability(
        {
          mode: settings.translationMode,
          provider: settings.translationProvider,
          remoteUrl: settings.translationRemoteUrl,
          cloudBaseUrl: settings.translationCloudBaseUrl,
        },
        electronAPI,
        settings,
        routes.translation.cloud
      )
    );
  }

  if (checks.length === 0) return false;
  const results = await Promise.all(checks);
  return results.some(Boolean);
}
