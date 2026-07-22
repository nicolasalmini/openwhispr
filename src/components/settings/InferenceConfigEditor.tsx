import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { Cloud, Key, Cpu, Network, Building2, Terminal } from "lucide-react";
import {
  useSettingsStore,
  selectResolvedLLMConfig,
  setResolvedLLMConfig,
} from "../../stores/settingsStore";
import { InferenceModeSelector } from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import ReasoningModelSelector from "../ReasoningModelSelector";
import EnterpriseSection from "../EnterpriseSection";
import OpenAICompatiblePanel from "../OpenAICompatiblePanel";
import { Toggle } from "../ui/toggle";
import type { InferenceMode } from "../../types/electron";
import type { InferenceScope } from "../../config/inferenceScopes";
import {
  modelRegistry,
  isEnterpriseProvider,
  getCloudModel,
  getLocalModel,
} from "../../models/ModelRegistry";
import { createLatestRequestGuard } from "../../helpers/latestRequestGuard";

function isProviderValidForMode(provider: string, mode: InferenceMode): boolean {
  switch (mode) {
    case "providers":
      return (
        provider === "custom" ||
        provider === "openrouter" ||
        modelRegistry.getCloudProviders().some((p) => p.id === provider)
      );
    case "local":
      return modelRegistry.getAllProviders().some((p) => p.id === provider);
    case "enterprise":
      return isEnterpriseProvider(provider);
    case "agent-cli":
      return provider === "claude-cli" || provider === "devin-cli";
    default:
      return true;
  }
}

const MODE_LABEL_PREFIX: Record<InferenceScope, string> = {
  dictationCleanup: "settingsPage.aiModels.modes",
  noteFormatting: "settingsPage.aiModels.modes",
  dictationAgent: "dictationAgent.modes",
  chatIntelligence: "agentMode.settings.modes",
  dictationTranslation: "settingsPage.aiModels.modes",
};

function startCloudOnboarding() {
  localStorage.setItem("pendingCloudMigration", "true");
  localStorage.setItem("onboardingCurrentStep", "0");
  localStorage.removeItem("onboardingCompleted");
  window.location.reload();
}

interface InferenceConfigEditorProps {
  scope: InferenceScope;
  onModeChange?: (mode: InferenceMode) => void;
}

export default function InferenceConfigEditor({ scope, onModeChange }: InferenceConfigEditorProps) {
  const { t } = useTranslation();
  const config = useSettingsStore(useShallow((s) => selectResolvedLLMConfig(s, scope)));
  const isSignedIn = useSettingsStore((s) => s.isSignedIn);
  const [agentCliStatus, setAgentCliStatus] = useState<"idle" | "checking" | "ready" | "missing">(
    "idle"
  );
  const agentCliCheckGuard = useRef(createLatestRequestGuard());
  useEffect(() => () => agentCliCheckGuard.current.invalidate(), []);

  const prefix = MODE_LABEL_PREFIX[scope];
  const modes: InferenceModeOption[] = [
    {
      id: "openwhispr",
      label: t(`${prefix}.openwhispr`),
      description: t(`${prefix}.openwhisprDesc`),
      icon: <Cloud className="w-4 h-4" />,
      disabled: !isSignedIn,
      badge: !isSignedIn ? t("common.freeAccountRequired") : undefined,
    },
    {
      id: "providers",
      label: t(`${prefix}.providers`),
      description: t(`${prefix}.providersDesc`),
      icon: <Key className="w-4 h-4" />,
    },
    {
      id: "local",
      label: t(`${prefix}.local`),
      description: t(`${prefix}.localDesc`),
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "self-hosted",
      label: t(`${prefix}.selfHosted`),
      description: t(`${prefix}.selfHostedDesc`),
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: "enterprise",
      label: t(`${prefix}.enterprise`),
      description: t(`${prefix}.enterpriseDesc`),
      icon: <Building2 className="w-4 h-4" />,
    },
    ...(scope === "dictationCleanup"
      ? [
          {
            id: "agent-cli" as const,
            label: t(`${prefix}.agentCli`),
            description: t(`${prefix}.agentCliDesc`),
            icon: <Terminal className="w-4 h-4" />,
          },
        ]
      : []),
  ];

  const setField = useCallback(
    <K extends keyof Omit<typeof config, "scope">>(field: K) =>
      (value: NonNullable<(typeof config)[K]>) => {
        setResolvedLLMConfig(scope, { [field]: value });
      },
    [scope]
  );

  const handleModeSelect = useCallback(
    (mode: InferenceMode) => {
      if (mode === "openwhispr" && !isSignedIn) {
        startCloudOnboarding();
        return;
      }
      if (mode === config.mode) return;
      agentCliCheckGuard.current.invalidate();

      const patch: Parameters<typeof setResolvedLLMConfig>[1] = {
        mode,
        cloudMode: mode === "openwhispr" ? "openwhispr" : "byok",
      };
      if (mode === "agent-cli") {
        const existingCliProvider =
          config.provider === "claude-cli" || config.provider === "devin-cli";
        patch.provider = existingCliProvider ? config.provider : "claude-cli";
        patch.model = existingCliProvider
          ? config.model.trim() || (config.provider === "devin-cli" ? "swe" : "haiku")
          : "haiku";
      }
      if (mode !== "agent-cli" && !isProviderValidForMode(config.provider, mode)) {
        patch.provider = "";
        patch.model = "";
      }
      setResolvedLLMConfig(scope, patch);

      if (
        mode === "openwhispr" ||
        mode === "self-hosted" ||
        mode === "enterprise" ||
        mode === "agent-cli"
      ) {
        window.electronAPI?.llamaServerStop?.();
      }

      onModeChange?.(mode);
    },
    [scope, config.mode, config.provider, config.model, isSignedIn, onModeChange]
  );

  const setMode = setField("mode");
  const setProvider = setField("provider");
  const setModel = setField("model");

  const renderModelSelector = (mode?: "cloud" | "local") => (
    <ReasoningModelSelector
      reasoningModel={config.model}
      setReasoningModel={setModel}
      localReasoningProvider={config.provider}
      setLocalReasoningProvider={setProvider}
      cloudReasoningBaseUrl={config.cloudBaseUrl ?? ""}
      setCloudReasoningBaseUrl={setField("cloudBaseUrl")}
      customReasoningApiKey={config.customApiKey ?? ""}
      setCustomReasoningApiKey={setField("customApiKey")}
      setReasoningMode={setMode}
      mode={mode}
    />
  );

  const showThinkingToggle =
    config.mode === "self-hosted" ||
    (config.mode === "providers" &&
      (config.provider === "custom" ||
        config.provider === "openrouter" ||
        !!getCloudModel(config.model)?.supportsThinking)) ||
    (config.mode === "local" && !!getLocalModel(config.model)?.supportsThinking);

  return (
    <div className="space-y-3">
      <InferenceModeSelector modes={modes} activeMode={config.mode} onSelect={handleModeSelect} />

      {config.mode === "providers" && renderModelSelector("cloud")}
      {config.mode === "local" && renderModelSelector("local")}

      {config.mode === "agent-cli" && scope === "dictationCleanup" && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t("settingsPage.aiModels.agentCli.adapter")}
            </span>
            <select
              value={config.provider}
              onChange={(event) => {
                const provider = event.target.value;
                agentCliCheckGuard.current.invalidate();
                setProvider(provider);
                setModel(provider === "devin-cli" ? "swe" : "haiku");
                setAgentCliStatus("idle");
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="claude-cli">Claude CLI</option>
              <option value="devin-cli">Devin CLI</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t("settingsPage.aiModels.agentCli.model")}
            </span>
            <input
              value={config.model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={config.provider === "devin-cli" ? "swe" : "haiku"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t("settingsPage.aiModels.agentCli.executablePath")}
            </span>
            <input
              value={config.executablePath ?? ""}
              onChange={(event) => {
                agentCliCheckGuard.current.invalidate();
                setField("executablePath")(event.target.value);
                setAgentCliStatus("idle");
              }}
              placeholder={
                config.provider === "devin-cli" ? "/usr/local/bin/devin" : "/usr/local/bin/claude"
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={agentCliStatus === "checking"}
              onClick={async () => {
                const checkGeneration = agentCliCheckGuard.current.begin();
                setAgentCliStatus("checking");
                try {
                  const result = await window.electronAPI.checkAgentCliAvailability({
                    adapter: config.provider === "devin-cli" ? "devin-cli" : "claude-cli",
                    executablePath: config.executablePath?.trim() || undefined,
                  });
                  if (agentCliCheckGuard.current.isCurrent(checkGeneration)) {
                    setAgentCliStatus(result.available ? "ready" : "missing");
                  }
                } catch {
                  if (agentCliCheckGuard.current.isCurrent(checkGeneration)) {
                    setAgentCliStatus("missing");
                  }
                }
              }}
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              {agentCliStatus === "checking"
                ? t("settingsPage.aiModels.agentCli.testing")
                : t("settingsPage.aiModels.agentCli.test")}
            </button>
            {agentCliStatus === "ready" && (
              <span className="text-xs text-green-600">
                {t("settingsPage.aiModels.agentCli.ready")}
              </span>
            )}
            {agentCliStatus === "missing" && (
              <span className="text-xs text-destructive">
                {t("settingsPage.aiModels.agentCli.unavailable")}
              </span>
            )}
          </div>
        </div>
      )}

      {config.mode === "self-hosted" && (
        <OpenAICompatiblePanel
          baseUrl={config.remoteUrl ?? ""}
          setBaseUrl={setField("remoteUrl")}
          apiKey={config.customApiKey ?? ""}
          setApiKey={setField("customApiKey")}
          model={config.model}
          setModel={setModel}
          baseUrlPlaceholder="http://192.168.1.126:11434/v1"
          helpExamples={
            <p className="text-xs text-muted-foreground">
              {t("reasoning.selfHosted.endpointHelp")}
            </p>
          }
        />
      )}

      {showThinkingToggle && (
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              {t("reasoning.disableThinking.label")}
            </h4>
            <p className="text-xs text-muted-foreground">{t("reasoning.disableThinking.help")}</p>
          </div>
          <Toggle checked={config.disableThinking} onChange={setField("disableThinking")} />
        </div>
      )}

      {config.mode === "enterprise" && (
        <EnterpriseSection
          currentProvider={config.provider}
          reasoningModel={config.model}
          setReasoningModel={setModel}
          setLocalReasoningProvider={setProvider}
        />
      )}
    </div>
  );
}
