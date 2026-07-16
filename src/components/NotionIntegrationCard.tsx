import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Blocks, Database, Loader2, RefreshCw, Search, Unlink } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "./ui/SettingsSection";
import { Toggle } from "./ui/toggle";
import { useToast } from "./ui/useToast";
import type {
  NotionConnection,
  NotionDataSource,
  NotionDestination,
  NotionLayoutKey,
} from "../types/electron";

function WorkspaceIcon({ connection }: { connection: NotionConnection }) {
  const icon = connection.workspace_icon;
  if (icon?.startsWith("http")) {
    return <img src={icon} alt="" className="h-5 w-5 rounded object-cover" />;
  }
  if (icon) return <span className="text-base leading-none">{icon}</span>;
  return <Blocks className="h-4 w-4" />;
}

export default function NotionIntegrationCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [connection, setConnection] = useState<NotionConnection | null>(null);
  const [destination, setDestination] = useState<NotionDestination | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [fallback, setFallback] = useState("");
  const [dataSources, setDataSources] = useState<NotionDataSource[]>([]);

  const loadStatus = useCallback(async () => {
    const result = await window.electronAPI?.notionGetStatus?.();
    setConnection(result?.connected ? result.connection || null : null);
    setDestination(result?.connected ? result.destination || null : null);
    setLoading(false);
  }, []);

  const searchDataSources = useCallback(async () => {
    setSearching(true);
    try {
      const result = await window.electronAPI?.notionSearchDataSources?.(query);
      if (!result?.success) {
        throw new Error(result?.error || t("integrations.notion.searchFailedFallback"));
      }
      setDataSources(result.dataSources);
    } catch (error) {
      toast({
        title: t("integrations.notion.searchFailedTitle"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  }, [query, t, toast]);

  useEffect(() => {
    void loadStatus();
    return window.electronAPI?.onNotionConnectionChanged?.((result) => {
      if (result.connected) {
        setConnecting(false);
        void loadStatus().then(() => setDestinationOpen(true));
      } else if (result.error) {
        setConnecting(false);
        toast({
          title: t("integrations.notion.connectionFailedTitle"),
          description: result.error,
          variant: "destructive",
        });
      } else {
        setConnection(null);
        setDestination(null);
      }
    });
  }, [loadStatus, t, toast]);

  useEffect(() => {
    if (!destinationOpen || !connection) return;
    const timeout = window.setTimeout(() => void searchDataSources(), query ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [destinationOpen, connection, query, searchDataSources]);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await window.electronAPI?.notionStartOAuth?.();
      if (!result?.success) {
        throw new Error(result?.error || t("integrations.notion.connectFailedFallback"));
      }
      toast({
        title: t("integrations.notion.browserToastTitle"),
        description: t("integrations.notion.browserToastDescription"),
      });
    } catch (error) {
      setConnecting(false);
      toast({
        title: t("integrations.notion.connectFailedTitle"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const saveDestination = async (input: {
    dataSourceId?: string;
    dataSourceName?: string;
    databaseUrlOrId?: string;
  }) => {
    setSaving(true);
    try {
      const result = await window.electronAPI?.notionSaveDestination?.({
        ...input,
        layoutKey: destination?.layout_key || "general",
        includeTranscript: destination?.include_transcript === 1,
      });
      if (!result?.success || !result.destination) {
        throw new Error(result?.error || t("integrations.notion.saveFailedFallback"));
      }
      setDestination(result.destination);
      setDestinationOpen(false);
      setFallback("");
      toast({ title: t("integrations.notion.destinationSaved"), variant: "success" });
    } catch (error) {
      toast({
        title: t("integrations.notion.saveFailedTitle"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const refreshDestination = async () => {
    setRefreshing(true);
    try {
      const result = await window.electronAPI?.notionRefreshDestination?.();
      if (!result?.success || !result.destination) {
        throw new Error(result?.error || t("integrations.notion.refreshFailedTitle"));
      }
      setDestination(result.destination);
      toast({ title: t("integrations.notion.destinationRefreshed"), variant: "success" });
    } catch (error) {
      toast({
        title: t("integrations.notion.refreshFailedTitle"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const updateSettings = async (settings: {
    layoutKey: NotionLayoutKey;
    includeTranscript: boolean;
  }) => {
    const previous = destination;
    if (!previous) return;
    setDestination({
      ...previous,
      layout_key: settings.layoutKey,
      include_transcript: settings.includeTranscript ? 1 : 0,
    });
    const result = await window.electronAPI?.notionUpdateDestinationSettings?.(settings);
    if (!result?.success || !result.destination) {
      setDestination(previous);
      toast({
        title: t("integrations.notion.settingsUpdateFailedTitle"),
        description: result?.error,
        variant: "destructive",
      });
    } else {
      setDestination(result.destination);
    }
  };

  const disconnect = async () => {
    const result = await window.electronAPI?.notionDisconnect?.();
    if (!result?.success) {
      toast({
        title: t("integrations.notion.disconnectFailedTitle"),
        description: result?.error,
        variant: "destructive",
      });
      return;
    }
    setConnection(null);
    setDestination(null);
  };

  if (loading) {
    return (
      <SettingsPanel>
        <SettingsPanelRow>
          <div className="flex h-12 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    );
  }

  return (
    <>
      <SettingsPanel>
        <SettingsPanelRow>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-white text-black dark:bg-white">
              {connection ? (
                <WorkspaceIcon connection={connection} />
              ) : (
                <span className="text-lg font-bold">N</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-foreground">Notion</p>
                {connection && (
                  <Badge variant="success">{t("integrations.notion.connectedBadge")}</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs leading-relaxed text-muted-foreground/70">
                {connection
                  ? connection.workspace_name || t("integrations.notion.connectedWorkspaceFallback")
                  : t("integrations.notion.description")}
              </p>
            </div>
            {!connection ? (
              <Button size="sm" onClick={connect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  t("integrations.notion.connect")
                )}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => setDisconnectOpen(true)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={t("integrations.notion.disconnectAria")}
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </SettingsPanelRow>

        {connection && (
          <SettingsPanelRow>
            <SettingsRow
              label={t("integrations.notion.destinationLabel")}
              description={
                destination?.data_source_name || t("integrations.notion.destinationEmpty")
              }
            >
              <div className="flex items-center gap-1.5">
                {destination && (
                  <button
                    type="button"
                    onClick={() => void refreshDestination()}
                    disabled={refreshing}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    aria-label={t("integrations.notion.refreshAria")}
                    title={t("integrations.notion.refreshAria")}
                  >
                    <RefreshCw
                      className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                    />
                  </button>
                )}
                <Button variant="outline" size="sm" onClick={() => setDestinationOpen(true)}>
                  {destination
                    ? t("integrations.notion.destinationChange")
                    : t("integrations.notion.destinationChoose")}
                </Button>
              </div>
            </SettingsRow>
          </SettingsPanelRow>
        )}

        {destination && (
          <SettingsPanelRow>
            <SettingsRow
              label={t("integrations.notion.layoutLabel")}
              description={t("integrations.notion.layoutDescription")}
            >
              <Select
                value={destination.layout_key}
                onValueChange={(layoutKey: NotionLayoutKey) =>
                  void updateSettings({
                    layoutKey,
                    includeTranscript: destination.include_transcript === 1,
                  })
                }
              >
                <SelectTrigger className="h-8 w-36 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{t("integrations.notion.layoutGeneral")}</SelectItem>
                  <SelectItem value="meeting">{t("integrations.notion.layoutMeeting")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsPanelRow>
        )}

        {destination && (
          <SettingsPanelRow>
            <SettingsRow
              label={t("integrations.notion.transcriptLabel")}
              description={t("integrations.notion.transcriptDescription")}
            >
              <Toggle
                checked={destination.include_transcript === 1}
                onChange={(includeTranscript) =>
                  void updateSettings({ layoutKey: destination.layout_key, includeTranscript })
                }
              />
            </SettingsRow>
          </SettingsPanelRow>
        )}
      </SettingsPanel>

      <Dialog open={destinationOpen} onOpenChange={setDestinationOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("integrations.notion.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("integrations.notion.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchDataSources();
                }}
                placeholder={t("integrations.notion.searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={() => void searchDataSources()} disabled={searching}>
              <RefreshCw className={searching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-1">
            {searching && dataSources.length === 0 ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : dataSources.length ? (
              dataSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void saveDestination({ dataSourceId: source.id, dataSourceName: source.name })
                  }
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{source.name}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                {t("integrations.notion.searchEmpty")}
              </p>
            )}
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="mb-2 text-xs font-medium text-foreground">
              {t("integrations.notion.fallbackLabel")}
            </p>
            <div className="flex gap-2">
              <Input
                value={fallback}
                onChange={(event) => setFallback(event.target.value)}
                placeholder={t("integrations.notion.fallbackPlaceholder")}
              />
              <Button
                onClick={() => void saveDestination({ databaseUrlOrId: fallback })}
                disabled={!fallback.trim() || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("integrations.notion.fallbackSubmit")
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t("integrations.notion.disconnectTitle")}
        description={t("integrations.notion.disconnectDescription")}
        confirmText={t("integrations.notion.disconnectConfirm")}
        variant="destructive"
        onConfirm={() => void disconnect()}
      />
    </>
  );
}
