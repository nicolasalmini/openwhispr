// Whether the dictation agent can actually run. Mirrors ReasoningService.processText,
// which accepts an empty model only for the cloud ("openwhispr") and self-hosted ("lan")
// providers; every other mode (BYOK, local, enterprise) requires an explicit model.
export function resolveDictationAgentReachability({
  useDictationAgent,
  dictationAgentModel,
  isCloudAgent,
  isSelfHostedAgent,
}) {
  if (!useDictationAgent) return false;
  if (isCloudAgent || isSelfHostedAgent) return true;
  return (dictationAgentModel?.trim()?.length ?? 0) > 0;
}

// Whether the translation step can run: cloud/self-hosted accept an empty model,
// every other mode requires one; a target language is always required.
export function resolveDictationTranslationReachability({
  useDictationTranslation,
  translationTargetLanguage,
  translationModel,
  isCloudTranslation,
  isSelfHostedTranslation,
}) {
  if (!useDictationTranslation) return false;
  if (!translationTargetLanguage?.trim()) return false;
  if (isCloudTranslation || isSelfHostedTranslation) return true;
  return (translationModel?.trim()?.length ?? 0) > 0;
}

export function resolveCleanupReachability(settings, isCloudCleanup) {
  if (!settings.useCleanupModel) return false;
  if (isCloudCleanup) return true;
  if (settings.cleanupMode === "agent-cli") {
    return settings.cleanupProvider === "claude-cli" || settings.cleanupProvider === "devin-cli";
  }
  return (settings.cleanupModel?.trim()?.length ?? 0) > 0;
}

export function resolveEffectiveCleanupModel(settings, isCloudCleanup) {
  if (isCloudCleanup) return "";
  const configuredModel = settings.cleanupModel?.trim() || "";
  if (configuredModel) return configuredModel;
  if (settings.cleanupMode === "agent-cli") {
    return settings.cleanupProvider === "devin-cli" ? "swe" : "haiku";
  }
  return "";
}

export function cancelProcessingState({ isProcessing, cancelActiveCleanup, clearProcessingState }) {
  if (!isProcessing) return false;
  cancelActiveCleanup();
  clearProcessingState();
  return true;
}

export function buildCleanupReasoningConfig(settings, isCloudCleanup) {
  let provider = settings.cleanupProvider?.trim() || undefined;
  if (isCloudCleanup) provider = "openwhispr";
  else if (settings.cleanupMode === "local") provider = "local";
  else if (settings.cleanupMode === "self-hosted") provider = "lan";

  return {
    provider,
    ...(settings.cleanupMode === "self-hosted" && settings.cleanupRemoteUrl
      ? { lanUrl: settings.cleanupRemoteUrl }
      : {}),
    ...(settings.cleanupMode === "providers" && provider === "custom"
      ? {
          baseUrl: settings.cleanupCloudBaseUrl || undefined,
          customApiKey: settings.cleanupCustomApiKey || undefined,
        }
      : {}),
    ...(settings.cleanupMode === "agent-cli" && settings.cleanupAgentCliExecutablePath?.trim()
      ? { executablePath: settings.cleanupAgentCliExecutablePath.trim() }
      : {}),
    disableThinking: settings.cleanupDisableThinking,
  };
}

export function buildReasoningAvailabilityKey(settings) {
  return JSON.stringify([
    settings.useCleanupModel,
    settings.cleanupMode,
    settings.cleanupCloudMode,
    settings.isSignedIn,
    settings.cleanupProvider,
    settings.cleanupModel,
    settings.cleanupRemoteUrl,
    settings.cleanupCloudBaseUrl,
    settings.cleanupAgentCliExecutablePath,
    settings.useDictationAgent,
    settings.dictationAgentMode,
    settings.dictationAgentProvider,
    settings.dictationAgentModel,
    settings.dictationAgentRemoteUrl,
    settings.useDictationTranslation,
    settings.translationMode,
    settings.translationProvider,
    settings.translationModel,
    settings.translationRemoteUrl,
    settings.translationTargetLanguage,
    !!settings.openaiApiKey,
    !!settings.anthropicApiKey,
    !!settings.geminiApiKey,
    !!settings.groqApiKey,
    !!settings.xaiApiKey,
    !!settings.mistralApiKey,
    !!settings.openrouterApiKey,
    !!settings.tinfoilApiKey,
    !!settings.cortiApiKey,
    settings.bedrockProfile,
    !!settings.bedrockAccessKeyId,
    !!settings.bedrockSecretAccessKey,
    settings.azureEndpoint,
    !!settings.azureApiKey,
    settings.vertexProject,
    !!settings.vertexApiKey,
  ]);
}

// Decides which reasoning path ("translation" | "agent" | "cleanup" | "skip")
// a finished dictation takes. A recording started via the voice agent hotkey
// always takes the agent path — no wake word needed — and never falls back to
// cleanup. A translation recording degrades to cleanup instead: the transcript
// is still a useful dictation without the translation step.
export function resolveDictationRouteKind({
  cleanupReachable,
  agentReachable,
  agentInvoked,
  voiceAgentRequested,
  translationRequested,
  translationReachable,
}) {
  if (translationRequested) {
    if (translationReachable) return "translation";
    return cleanupReachable ? "cleanup" : "skip";
  }
  if (voiceAgentRequested) {
    return agentReachable ? "agent" : "skip";
  }
  if (agentReachable && agentInvoked) {
    return "agent";
  }
  if (cleanupReachable) {
    return "cleanup";
  }
  return "skip";
}
