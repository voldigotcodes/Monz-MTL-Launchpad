import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchPreview, pickFolder, runLaunch, checkIgStatus } from "./lib/api";
import { fetchAdsets, fetchCampaigns } from "./lib/api";
import { loadHistory, loadMetaSettings, saveHistory, saveMetaSettings } from "./lib/storage";
import { CopyPresetProvider, useCopyPresets } from "./context/CopyPresetsContext";
import { allowedVariables, findUnknownVariables, resolveVariables } from "./lib/vars";
import type {
  BulkCampaign,
  BulkGlobalConfig,
  CopyPreset,
  HistoryEntry,
  LaunchFormState,
  LaunchResult,
  MetaSettings,
  PreviewData,
} from "./types";

type Tab = "launch" | "bulk" | "presets" | "settings";

type StatusState = {
  state: "idle" | "running" | "success" | "error";
  message?: string;
};

type ValidationItem = { label: string; ok: boolean; hint?: string };

type Summary = {
  title: string;
  entries: { name: string; adsets: number; ads: number }[];
  durationSec: number;
  timeSavedMin: number;
};

const defaultForm: LaunchFormState = {
  folderPath: "",
  productName: "",
  brandName: "",
  productUrl: "",
  country: "CA",
  dailyBudget: 80,
  campaignActive: true,
  scheduleMode: "now",
  scheduleTime: "",
  launchType: "new_campaign",
  addMode: "creatives_only",
  existingCampaignId: undefined,
  targetAdsetIds: [],
};

const countryOptions = [
  { value: "CA", label: "Canada (CA)" },
  { value: "US", label: "United States (US)" },
  { value: "GB", label: "United Kingdom (GB)" },
];

function toIsoWithOffset(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return undefined;
  const offset = -dt.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (v: number) => String(Math.abs(Math.trunc(v))).padStart(2, "0");
  const hours = pad(offset / 60);
  const minutes = pad(offset % 60);
  const datePart = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const timePart = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  return `${datePart}T${timePart}${sign}${hours}:${minutes}`;
}

export default function App() {
  return (
    <CopyPresetProvider>
      <AppShell />
    </CopyPresetProvider>
  );
}

function AppShell() {
  const copyCtx = useCopyPresets();
  const [activeTab, setActiveTab] = useState<Tab>("launch");
  const [form, setForm] = useState<LaunchFormState>(defaultForm);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusState>({ state: "idle" });
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  const [lastSummary, setLastSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<MetaSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status?: string; daily_budget?: number }[]>([]);
  const [adsets, setAdsets] = useState<{ id: string; name: string; status?: string }[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [adsetError, setAdsetError] = useState<string | null>(null);
  const [singleConfirm, setSingleConfirm] = useState<{
    entries: { id: string; name: string; folder: string; preset: string; status: string; details?: string[] }[];
    payload: any;
  } | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  const [bulkGlobal, setBulkGlobal] = useState<BulkGlobalConfig>({
    country: { value: "CA", locked: true },
    productName: { value: "", locked: true },
    brandName: { value: "", locked: true },
    productUrl: { value: "", locked: true },
    folderPath: { value: "", locked: true },
    presetId: { value: copyCtx.presets[0]?.id || "", locked: true },
    scheduleTime: { value: "", locked: true },
    dailyBudget: { value: 80, locked: true },
    campaignActive: { value: true, locked: true },
  });
  const [bulkCampaigns, setBulkCampaigns] = useState<BulkCampaign[]>([
    { id: crypto.randomUUID(), overrides: {}, status: "pending" },
  ]);
  const [bulkStatus, setBulkStatus] = useState<StatusState>({ state: "idle" });
  const [bulkSummary, setBulkSummary] = useState<Summary | null>(null);
  const [pendingBulkPayloads, setPendingBulkPayloads] = useState<
    { id: string; payload: any; summaryName: string; statusLabel: string }[]
  >([]);
  const [bulkConfirm, setBulkConfirm] = useState<{
    accountId?: string;
    entries: { id: string; name: string; folder: string; preset: string; status: string }[];
  } | null>(null);

  useEffect(() => {
    const unlistenPromise = listen<string>("launch-log", (event) => {
      setLogs((prev) => [...prev, event.payload]);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    loadMetaSettings()
      .then((data) => {
        if (data) setSettings(data);
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!form.folderPath) {
      setPreview(null);
      setPreviewNote(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewNote(null);
    fetchPreview(form.folderPath, form.country)
      .then((p) => {
        setPreview(p);
        setPreviewNote(null);
      })
      .catch((err) => {
        setPreview(null);
        const contextNote =
          form.launchType === "existing_campaign"
            ? form.addMode === "creatives_only"
              ? "Creatives will be added to the selected campaign/ad sets; preview isn't available for file-level selections."
              : "Using selected folder as ad set source; preview may not resolve without campaign root."
            : String(err);
        setPreviewNote(contextNote);
      })
      .finally(() => setPreviewLoading(false));
  }, [form.folderPath, form.country, form.launchType, form.addMode]);

  useEffect(() => {
    if (!bulkGlobal.presetId.value && copyCtx.presets[0]) {
      setBulkGlobal((prev) => ({ ...prev, presetId: { ...prev.presetId, value: copyCtx.presets[0].id } }));
    }
  }, [copyCtx.presets, bulkGlobal.presetId.value]);

  useEffect(() => {
    if (form.launchType === "existing_campaign" && settings && !loadingCampaigns) {
      setLoadingCampaigns(true);
      setCampaignError(null);
      fetchCampaigns()
        .then(setCampaigns)
        .catch((err) => {
          setCampaignError(String(err));
          setCampaigns([]);
        })
        .finally(() => setLoadingCampaigns(false));
    }
  }, [form.launchType, settings]);

  useEffect(() => {
    if (form.launchType === "existing_campaign" && form.existingCampaignId) {
      setLoadingAdsets(true);
      setAdsetError(null);
      fetchAdsets(form.existingCampaignId)
        .then(setAdsets)
        .catch((err) => {
          setAdsetError(String(err));
          setAdsets([]);
        })
        .finally(() => setLoadingAdsets(false));
    } else {
      setAdsets([]);
    }
  }, [form.launchType, form.existingCampaignId]);

  const activeCopyPreset: CopyPreset | null =
    copyCtx.presets.find((p) => p.id === copyCtx.activePresetId) || copyCtx.presets[0] || null;

  const missingSettings =
    settingsLoaded &&
    (!settings ||
      !settings.accessToken ||
      !settings.adAccountId ||
      !settings.pageId ||
      !settings.pixelId);

  const launchValidation = useMemo<ValidationItem[]>(() => {
    const presetError = validateCopyPreset(activeCopyPreset);
    const needsExisting = form.launchType === "existing_campaign";
    const hasCampaign = !!form.existingCampaignId;
    const adsetsOk =
      form.launchType === "new_campaign" ||
      form.addMode === "adsets_and_creatives" ||
      (form.targetAdsetIds && form.targetAdsetIds.length > 0);
    return [
      { label: "Folder selected", ok: !!form.folderPath, hint: "Pick a campaign folder to scan assets." },
      { label: "Product name", ok: !!form.productName.trim(), hint: "Used for naming campaigns and ads." },
      { label: "Product URL", ok: !!form.productUrl.trim(), hint: "Needed for ad links and variables." },
      {
        label: "Copy preset ready",
        ok: !presetError,
        hint: presetError || "Variables resolve from launch inputs.",
      },
      {
        label: "Meta account configured",
        ok: !missingSettings,
        hint: "Fill token, ad account, page, IG (optional), and pixel.",
      },
      {
        label: "Existing campaign selected",
        ok: needsExisting ? hasCampaign : true,
        hint: "Choose a campaign when using Add to existing.",
      },
      {
        label: "Ad sets chosen or will be created",
        ok: needsExisting ? adsetsOk : true,
        hint: "Select ad sets or choose ad sets + creatives.",
      },
    ];
  }, [
    activeCopyPreset,
    form.folderPath,
    form.productName,
    form.productUrl,
    missingSettings,
    form.launchType,
    form.existingCampaignId,
    form.addMode,
    form.targetAdsetIds,
  ]);

  const canLaunch = launchValidation.every((item) => item.ok) && status.state !== "running";

  function persistHistory(next: HistoryEntry[]) {
    setHistory(next);
    saveHistory(next);
  }

  function captureError(message: string) {
    setStatus({ state: "error", message });
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      status: "error",
      config: { ...form },
      error: message,
    };
    persistHistory([entry, ...history].slice(0, 10));
  }

  async function pickLaunchFolder() {
    const allowFiles = form.launchType === "existing_campaign" && form.addMode === "creatives_only";
    const selection = await pickFolder({
      allowFiles,
      multiple: allowFiles,
      title: allowFiles ? "Select ad set folder or creative files" : "Select campaign/ad set folder",
    });
    if (!selection) return;
    setForm((prev) => ({ ...prev, folderPath: selection }));
  }

  async function handleLaunch() {
    if (!canLaunch || !activeCopyPreset) {
      captureError("Resolve validation items before launching.");
      return;
    }
    try {
      await checkIgStatus();
    } catch (err: any) {
      setStatus({
        state: "error",
        message: "Instagram account not reachable. Verify IG ID and token before launching.",
      });
      return;
    }
    const targetAdsetIds =
      form.addMode === "creatives_only" && form.targetAdsetIds && form.targetAdsetIds.length > 0
        ? form.targetAdsetIds
        : [];
    const scheduledIso = form.scheduleMode === "later" ? toIsoWithOffset(form.scheduleTime) : undefined;
      const payload = {
        folderPath: form.folderPath,
        productName: form.productName,
        brandName: form.brandName,
        productUrl: form.productUrl,
        country: form.country,
        dailyBudget: form.dailyBudget,
        campaignActive: form.campaignActive,
        scheduleMode: form.scheduleMode,
        scheduleTime: scheduledIso,
        preset: activeCopyPreset,
        launchType: form.launchType,
      addMode: form.addMode,
      campaignId: form.existingCampaignId,
      targetAdsetIds,
    };
    const campaignName =
      form.launchType === "new_campaign"
        ? form.productName || "New campaign"
        : campaigns.find((c) => c.id === form.existingCampaignId)?.name || "Existing campaign";
    const detailLines: string[] = [];
    if (form.launchType === "existing_campaign") {
      detailLines.push(`Mode: ${form.addMode === "creatives_only" ? "Add creatives" : "Add ad sets + creatives"}`);
      if (form.addMode === "creatives_only") {
        const count = targetAdsetIds.length;
        detailLines.push(count ? `Targeting ${count} ad set(s)` : "Targeting all ad sets");
      }
    }
    setSingleConfirm({
      payload,
      entries: [
        {
          id: form.existingCampaignId || "new",
          name: campaignName,
          folder: form.folderPath || "Missing",
          preset: activeCopyPreset.name,
          status:
            form.launchType === "new_campaign"
              ? form.campaignActive
                ? "Active on create"
                : "Paused on create"
              : form.addMode === "creatives_only"
                ? "Add creatives"
                : "Add ad sets + creatives",
          details: detailLines,
        },
      ],
    });
  }

  async function executeSingleLaunch(payload: any) {
    setStatus({ state: "running", message: "Sending launch to Python backend..." });
    setLogs([]);
    const started = performance.now();
    try {
      const result: LaunchResult = await runLaunch(payload);
      const durationSec = Math.max(1, Math.round((performance.now() - started) / 1000));
      const totalAds = result.ads_created || 0;
      const timeSavedMin = Math.max(1, Math.round((totalAds || 1) * 2));
      setLastSummary({
        title: "Launch completed",
        durationSec,
        timeSavedMin,
        entries:
          result.campaigns?.map((c) => ({
            name: c.campaign_name,
            adsets: c.adsets.length,
            ads: c.adsets.reduce((acc, a) => acc + a.ads_created, 0),
          })) || [],
      });

      setStatus({
        state: "success",
        message: `Completed. ${result.ads_created} ad(s) created.`,
      });
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status: "success",
        config: { ...form },
        result,
      };
      persistHistory([entry, ...history].slice(0, 10));
    } catch (err) {
      captureError(String(err));
    } finally {
      /* modal already closed */
    }
  }

  async function handleBulkLaunch() {
    if (!copyCtx.presets.length) return;
    const presetMap = Object.fromEntries(copyCtx.presets.map((p) => [p.id, p]));
    const defaultPresetId = copyCtx.presets[0]?.id ?? "";
    const errors: Record<string, string> = {};
    const started = performance.now();

    const payloads = bulkCampaigns.map((campaign) => {
      const resolveField = <K extends keyof BulkGlobalConfig>(field: K) =>
        bulkGlobal[field].locked ? bulkGlobal[field].value : campaign.overrides[field];

      const folderPath = resolveField("folderPath") || "";
      const productUrl = resolveField("productUrl") || "";
      const productName = resolveField("productName") || "";
      const brandName = resolveField("brandName") || "";
      const country = resolveField("country") || "CA";
      const presetId = resolveField("presetId") || defaultPresetId;
      const dailyBudget = Number(resolveField("dailyBudget") || 0);
      const scheduleTime = resolveField("scheduleTime") || "";
      const campaignActive = resolveField("campaignActive");

      const preset = presetMap[presetId];
      if (!folderPath || !productUrl) {
        errors[campaign.id] = "Folder path and product URL are required.";
      } else if (!preset) {
        errors[campaign.id] = "Preset not found.";
      } else {
        const presetError = validateCopyPreset(preset);
        if (presetError) errors[campaign.id] = presetError;
      }

      return {
        id: campaign.id,
        payload: {
          folderPath,
          productName,
          brandName,
          productUrl,
          country,
          dailyBudget,
          campaignActive: campaignActive === undefined ? true : Boolean(campaignActive),
          scheduleMode: scheduleTime ? "later" : "now",
          scheduleTime: scheduleTime ? toIsoWithOffset(scheduleTime) : undefined,
          preset: preset || presetMap[defaultPresetId],
        },
        summaryName: productName || "Campaign",
        statusLabel: campaignActive ? "Active" : "Paused",
      };
    });

    if (Object.keys(errors).length) {
      setBulkStatus({ state: "error", message: "Fix the highlighted campaigns." });
      setBulkCampaigns((prev) =>
        prev.map((c) => (errors[c.id] ? { ...c, status: "error", error: errors[c.id] } : c)),
      );
      return;
    }

    setPendingBulkPayloads(payloads);
    setBulkConfirm({
      accountId: connection?.defaults.ad_account_id,
      entries: payloads.map((p, idx) => ({
        id: p.id,
        name: p.summaryName || `Campaign ${idx + 1}`,
        folder: p.payload.folderPath,
        preset: (p.payload.preset as CopyPreset)?.name || "Unknown",
        status: p.statusLabel,
      })),
    });
  }

  async function executeBulkLaunch() {
    if (!pendingBulkPayloads.length || bulkStatus.state === "running") return;
    const started = performance.now();
    setBulkStatus({ state: "running", message: "Launching campaigns sequentially..." });
    setLogs([]);
    const summaries: { name: string; adsets: number; ads: number }[] = [];

    for (const item of pendingBulkPayloads) {
      setBulkCampaigns((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, status: "running", error: undefined } : c)),
      );
      try {
        const result = await runLaunch(item.payload as any);
        if (result?.campaigns) {
          summaries.push(
            ...result.campaigns.map((c) => ({
              name: c.campaign_name,
              adsets: c.adsets.length,
              ads: c.adsets.reduce((acc, a) => acc + a.ads_created, 0),
            })),
          );
        } else {
          summaries.push({ name: item.payload.productName || "Campaign", adsets: 1, ads: 1 });
        }
        setBulkCampaigns((prev) => prev.map((c) => (c.id === item.id ? { ...c, status: "success" } : c)));
      } catch (err) {
        setBulkCampaigns((prev) =>
          prev.map((c) => (c.id === item.id ? { ...c, status: "error", error: String(err) } : c)),
        );
      }
    }

    const durationSec = Math.max(1, Math.round((performance.now() - started) / 1000));
    const totalAds = summaries.reduce((acc, s) => acc + s.ads, 0);
    const timeSavedMin = Math.max(1, Math.round((totalAds || 1) * 2));

    setBulkSummary({
      title: "Bulk launch completed",
      entries: summaries,
      durationSec,
      timeSavedMin,
    });
    setBulkStatus({ state: "success", message: "Bulk launch finished." });
    setBulkConfirm(null);
    setPendingBulkPayloads([]);
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        missingSettings={missingSettings}
      />
      <div className="content">
        {activeTab === "launch" && (
          <LaunchTab
            campaigns={campaigns}
            adsets={adsets}
            loadingCampaigns={loadingCampaigns}
            loadingAdsets={loadingAdsets}
            campaignError={campaignError}
            adsetError={adsetError}
            previewNote={previewNote}
            settings={settings}
            settingsLoaded={settingsLoaded}
            onSaveSettings={async (next) => {
              setSettings(next);
              await saveMetaSettings(next);
            }}
            form={form}
            setForm={setForm}
            preview={preview}
            previewLoading={previewLoading}
            validation={launchValidation}
            onPickFolder={pickLaunchFolder}
            onLaunch={handleLaunch}
            logs={logs}
            status={status}
            presets={copyCtx.presets}
            activePresetId={copyCtx.activePresetId}
            setActivePresetId={copyCtx.setActivePreset}
            lastSummary={lastSummary}
            history={history}
            missingSettings={missingSettings}
          />
        )}
        {activeTab === "bulk" && (
          <BulkLaunchTab
            bulkGlobal={bulkGlobal}
            setBulkGlobal={setBulkGlobal}
            campaigns={bulkCampaigns}
            setCampaigns={setBulkCampaigns}
            presets={copyCtx.presets}
            accountId={settings?.adAccountId}
            onPickGlobalFolder={async () => {
              const folder = await pickFolder();
              if (folder) {
                setBulkGlobal((prev) => ({ ...prev, folderPath: { ...prev.folderPath, value: folder } }));
              }
            }}
            onPickCampaignFolder={async (id: string) => {
              const folder = await pickFolder();
              if (folder) {
                setBulkCampaigns((prev) =>
                  prev.map((c) => (c.id === id ? { ...c, overrides: { ...c.overrides, folderPath: folder } } : c)),
                );
              }
            }}
            onLaunch={handleBulkLaunch}
            status={bulkStatus}
            summary={bulkSummary}
            logs={logs}
          />
        )}
        {activeTab === "presets" && (
          <PresetsTab
            activePreset={activeCopyPreset}
            launchVars={{
              product_name: form.productName,
              product_url: form.productUrl,
              brand_name: form.brandName,
              country: form.country,
            }}
            bulkGlobal={bulkGlobal}
            bulkCampaigns={bulkCampaigns}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            settings={settings}
            settingsLoaded={settingsLoaded}
            onSaveSettings={async (next) => {
              setSettings(next);
              await saveMetaSettings(next);
            }}
          />
        )}

        {bulkConfirm && (
          <ConfirmModal
            title="Confirm bulk launch"
            subtitle={`Account: ${bulkConfirm.accountId || "unknown"}`}
            entries={bulkConfirm.entries}
            onCancel={() => setBulkConfirm(null)}
            onConfirm={() => {
              setBulkConfirm(null);
              executeBulkLaunch();
            }}
          />
        )}
        {singleConfirm && (
          <ConfirmModal
            title="Confirm launch"
            subtitle="Single launch review"
            entries={singleConfirm.entries}
            onCancel={() => setSingleConfirm(null)}
            onConfirm={() => {
              const payload = singleConfirm.payload;
              setSingleConfirm(null);
              if (payload) executeSingleLaunch(payload);
            }}
          />
        )}
      </div>
    </div>
  );
}

type SidebarProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  missingSettings: boolean;
};

function Sidebar({ activeTab, onTabChange, missingSettings }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        <div>
          <div className="brand-name">Launchpad</div>
          <div className="brand-sub">Meta CBO desktop</div>
        </div>
      </div>
      <nav className="nav">
        <button className={`nav-btn ${activeTab === "launch" ? "active" : ""}`} onClick={() => onTabChange("launch")}>
          Launch
        </button>
        <button className={`nav-btn ${activeTab === "bulk" ? "active" : ""}`} onClick={() => onTabChange("bulk")}>
          Bulk Launch
        </button>
        <button
          className={`nav-btn ${activeTab === "presets" ? "active" : ""}`}
          onClick={() => onTabChange("presets")}
        >
          Presets
        </button>
      </nav>
      <div className="sidebar-footer">
        <div className={`pill ${missingSettings ? "pill-warn" : ""}`}>
          {missingSettings ? "Meta setup required" : "Meta connected locally"}
        </div>
        <button className={`nav-btn ${activeTab === "settings" ? "active" : ""}`} onClick={() => onTabChange("settings")}>
          Meta credentials
        </button>
      </div>
    </aside>
  );
}

type LaunchTabProps = {
  campaigns: { id: string; name: string; status?: string; daily_budget?: number }[];
  adsets: { id: string; name: string; status?: string }[];
  loadingCampaigns: boolean;
  loadingAdsets: boolean;
  campaignError: string | null;
  adsetError: string | null;
  previewNote: string | null;
  settings: MetaSettings | null;
  settingsLoaded: boolean;
  onSaveSettings: (settings: MetaSettings) => Promise<void>;
  form: LaunchFormState;
  setForm: React.Dispatch<React.SetStateAction<LaunchFormState>>;
  preview: PreviewData | null;
  previewLoading: boolean;
  validation: ValidationItem[];
  onPickFolder: () => Promise<void>;
  onLaunch: () => Promise<void>;
  logs: string[];
  status: StatusState;
  presets: CopyPreset[];
  activePresetId: string | null;
  setActivePresetId: (id: string) => void;
  lastSummary: Summary | null;
  history: HistoryEntry[];
  missingSettings: boolean;
};

function LaunchTab({
  campaigns,
  adsets,
  loadingCampaigns,
  loadingAdsets,
  campaignError,
  adsetError,
  previewNote,
  form,
  setForm,
  preview,
  previewLoading,
  validation,
  onPickFolder,
  onLaunch,
  logs,
  status,
  presets,
  activePresetId,
  setActivePresetId,
  lastSummary,
  history,
  missingSettings,
  settings,
  settingsLoaded,
  onSaveSettings,
}: LaunchTabProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const inferredCampaign = form.productName ? `${form.productName} - ${form.country}` : "Campaign name inferred";
  const inferredAd = form.productName ? `${form.productName} | Preset copy` : "Ad names inferred";
  const filteredCampaigns = useMemo(() => {
    const term = campaignSearch.toLowerCase().trim();
    if (!term) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(term));
  }, [campaigns, campaignSearch]);
  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === form.existingCampaignId),
    [campaigns, form.existingCampaignId],
  );
  const budgetLocked = form.launchType === "existing_campaign" && selectedCampaign?.daily_budget !== undefined;

  return (
    <div className="two-column">
      <div className="stack">
        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Launch</p>
              <h1>Single campaign</h1>
            </div>
            <div className="chip">{form.scheduleMode === "now" ? "Launch now" : "Scheduled"}</div>
          </header>
          <div className="field">
            <span className="field-label">What are you doing?</span>
            <div className="inline-field">
              <button
                className={`secondary ${form.launchType === "new_campaign" ? "active" : ""}`}
                onClick={() => setForm((prev) => ({ ...prev, launchType: "new_campaign" }))}
                type="button"
              >
                Create new campaign
              </button>
              <button
                className={`secondary ${form.launchType === "existing_campaign" ? "active" : ""}`}
                onClick={() => setForm((prev) => ({ ...prev, launchType: "existing_campaign" }))}
                type="button"
              >
                Add to existing campaign
              </button>
            </div>
          </div>

          {form.launchType === "existing_campaign" && (
            <div className="panel" style={{ border: "1px solid var(--border)" }}>
              <div className="stack">
                <div className="field">
                  <span className="field-label">Existing campaign</span>
                  <div className="inline-field">
                    <input
                      value={campaignSearch}
                      onChange={(e) => setCampaignSearch(e.target.value)}
                      placeholder="Search campaigns by name"
                      disabled={loadingCampaigns || missingSettings}
                    />
                  </div>
                  <select
                    disabled={loadingCampaigns || missingSettings}
                value={form.existingCampaignId || ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    existingCampaignId: e.target.value || undefined,
                    targetAdsetIds: [],
                    dailyBudget:
                      e.target.value && campaigns.find((c) => c.id === e.target.value)?.daily_budget !== undefined
                        ? campaigns.find((c) => c.id === e.target.value)!.daily_budget!
                        : prev.dailyBudget,
                  }))
                }
              >
                    <option value="">{loadingCampaigns ? "Loading campaigns..." : "Select a campaign"}</option>
                    {filteredCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.status ? `(${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                {missingSettings && <div className="hint">Connect credentials to load campaigns.</div>}
                {campaignError && <div className="hint error">{campaignError}</div>}
              </div>

                <div className="field">
                  <span className="field-label">What do you want to add?</span>
                  <div className="inline-field">
                    <button
                      className={`secondary ${form.addMode === "creatives_only" ? "active" : ""}`}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, addMode: "creatives_only" }))}
                    >
                      Add creatives
                    </button>
                    <button
                      className={`secondary ${form.addMode === "adsets_and_creatives" ? "active" : ""}`}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({ ...prev, addMode: "adsets_and_creatives", targetAdsetIds: [] }))
                      }
                    >
                      Add ad sets + creatives
                    </button>
                  </div>
                </div>

                {form.addMode === "creatives_only" && (
                  <div className="field">
                    <span className="field-label">Target ad sets</span>
                    <select
                      multiple
                      size={Math.min(6, adsets.length || 6)}
                      disabled={loadingAdsets || !form.existingCampaignId}
                      value={form.targetAdsetIds || []}
                      onChange={(e) => {
                        const options = Array.from(e.target.selectedOptions).map((o) => o.value);
                        setForm((prev) => ({ ...prev, targetAdsetIds: options }));
                      }}
                    >
                      <option value="">All ad sets</option>
                      {adsets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} {a.status ? `(${a.status})` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="hint">Leave blank for All ad sets.</div>
                    {adsetError && <div className="hint error">{adsetError}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <div className="field-label">
              <span>
                {form.launchType === "existing_campaign"
                  ? form.addMode === "creatives_only"
                    ? "Ad set / creatives location"
                    : "Ad set folder"
                  : "Campaign folder"}
              </span>
              <span className="hint">
                {form.launchType === "existing_campaign"
                  ? form.addMode === "creatives_only"
                    ? "Pick an ad set folder or creatives to add."
                    : "Pick folder containing ad sets to attach."
                  : "Inputs stay on the left"}
              </span>
            </div>
            <div className="inline-field">
              <input value={form.folderPath} placeholder="Select a folder or files" readOnly />
              <button onClick={onPickFolder}>Pick</button>
            </div>
            {!form.folderPath && (
              <div className="hint">
                {form.launchType === "existing_campaign"
                  ? "Select where the ad sets/creatives live."
                  : "Select a folder to auto-generate campaign structure."}
              </div>
            )}
          </div>

          <div className="grid-two">
            <div className="field">
              <span className="field-label">Product URL</span>
              <input
                type="url"
                value={form.productUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, productUrl: e.target.value }))}
                placeholder="https://example.com/product"
              />
            </div>
          </div>

          <div className="grid-two">
            <div className="field">
              <span className="field-label">Folder preset</span>
              <select value={activePresetId || ""} onChange={(e) => setActivePresetId(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="hint">Variables: {allowedVariables().map((v) => `{${v}}`).join(", ")}</div>
            </div>
            <div className="field">
              <span className="field-label">Daily budget</span>
              <input
                type="number"
                min={1}
                value={budgetLocked && selectedCampaign?.daily_budget !== undefined ? selectedCampaign.daily_budget : form.dailyBudget}
                onChange={(e) => setForm((prev) => ({ ...prev, dailyBudget: Number(e.target.value) }))}
                disabled={budgetLocked}
              />
              {budgetLocked && <div className="hint">Locked to selected campaign budget</div>}
            </div>
          </div>

          <button className="link" onClick={() => setAdvancedOpen((v) => !v)}>
            {advancedOpen ? "Hide advanced" : "Show advanced defaults"}
          </button>
          {advancedOpen && (
            <div className="grid-two">
              <div className="field">
                <span className="field-label">Product name</span>
                <input
                  value={form.productName}
                  onChange={(e) => setForm((prev) => ({ ...prev, productName: e.target.value }))}
                  placeholder="Comfort Collection"
                />
              </div>
              <div className="field">
                <span className="field-label">Brand name</span>
                <input
                  value={form.brandName}
                  onChange={(e) => setForm((prev) => ({ ...prev, brandName: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <span className="field-label">Country</span>
                <select value={form.country} onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}>
                  {countryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span className="field-label">Campaign status</span>
                <div className="inline-field">
                  <button
                    className={`toggle ${form.campaignActive ? "on" : "off"}`}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, campaignActive: !prev.campaignActive }))}
                  >
                    {form.campaignActive ? "Active on create" : "Paused on create"}
                  </button>
                </div>
              </div>
              <div className="field">
                <span className="field-label">Launch timing</span>
                <div className="inline-field">
                  <button
                    className={form.scheduleMode === "now" ? "secondary active" : "secondary"}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, scheduleMode: "now", scheduleTime: "" }))}
                  >
                    Launch now
                  </button>
                  <button
                    className={form.scheduleMode === "later" ? "secondary active" : "secondary"}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, scheduleMode: "later" }))}
                  >
                    Schedule
                  </button>
                </div>
                {form.scheduleMode === "later" && (
                  <input
                    type="datetime-local"
                    value={form.scheduleTime}
                    onChange={(e) => setForm((prev) => ({ ...prev, scheduleTime: e.target.value }))}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Outputs</h2>
            </div>
            <div className="chip ghost">Read-only</div>
          </header>
          {previewLoading && <div className="status muted">Scanning folder...</div>}
          {!preview && !previewLoading && (
            <div className="empty">
              <strong>Nothing to preview.</strong>
              <p>
                {previewNote ||
                  (form.launchType === "existing_campaign"
                    ? "Content will be added to the selected campaign. Preview may be limited for ad set or file selections."
                    : "Select a folder to see inferred campaigns, ad sets, and ad counts.")}
              </p>
              <ul className="bullet">
                <li>Campaign: {inferredCampaign}</li>
                <li>Ad: {inferredAd}</li>
              </ul>
            </div>
          )}
          {preview && (
            <div className="preview">
              {preview.campaigns.map((campaign) => (
                <div key={campaign.name} className="preview-block">
                  <div className="preview-head">
                    <strong>{campaign.name}</strong>
                    <div className="chip-row">
                      <span className="chip">Ad sets: {campaign.adsets.length}</span>
                      <span className="chip">
                        Ads: {campaign.adsets.reduce((acc, a) => acc + a.ads, 0)}
                      </span>
                    </div>
                  </div>
                  {campaign.adsets.map((adset) => (
                    <div key={adset.name} className="preview-row">
                      <span>{adset.name}</span>
                      <span className="hint">
                        {adset.ads} ads - {adset.images} images - {adset.videos} videos
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="chip-row">
                <span className="chip ghost">Launch date: {preview.launch_date}</span>
                <span className="chip ghost">Images: {preview.media_summary.images}</span>
                <span className="chip ghost">Videos: {preview.media_summary.videos}</span>
                <span className="chip ghost">Total ads: {preview.total_ads}</span>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Readiness</p>
              <h2>Validation</h2>
            </div>
            <div className="chip ghost">{status.state.toUpperCase()}</div>
          </header>
          <ValidationList items={validation} />
          <div className="action-row">
            <button className="primary" onClick={onLaunch} disabled={!validation.every((v) => v.ok)}>
              {status.state === "running" ? "Launching..." : "Launch"}
            </button>
            <div className="status-text">
              {status.message || (missingSettings ? "Complete Meta setup before launch." : "Ready when checklist is green.")}
            </div>
          </div>
          {lastSummary && (
            <div className="summary">
              <div className="summary-head">
                <strong>{lastSummary.title}</strong>
                <span className="hint">
                  {lastSummary.durationSec}s - est. {lastSummary.timeSavedMin} min saved
                </span>
              </div>
              <div className="summary-grid">
                {lastSummary.entries.map((entry, idx) => (
                  <div key={`${entry.name}-${idx}`} className="summary-card">
                    <div className="summary-name">{entry.name}</div>
                    <div className="hint">
                      Ad sets: {entry.adsets} - Ads: {entry.ads}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Execution</p>
              <h2>Logs</h2>
            </div>
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(logs.join("\n"))} disabled={!logs.length}>
              Copy
            </button>
          </header>
          <div className="log-box">
            {logs.length === 0 && <div className="hint">No logs yet. They stream directly from Python during launch.</div>}
            {logs.map((line, idx) => (
              <div key={`${line}-${idx}`} className="log-line">
                {line}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">History</p>
              <h2>Recent runs</h2>
            </div>
          </header>
          {history.length === 0 && <div className="empty">No runs yet. Launch once to populate history.</div>}
          {history.length > 0 && (
            <div className="list">
              {history.map((entry) => (
                <div key={entry.id} className="list-row">
                  <div>
                    <div className="summary-name">
                      {entry.status === "success" ? "Success" : "Error"} - {entry.result?.ads_created ?? 0} ads
                    </div>
                    <div className="hint">
                      {new Date(entry.timestamp).toLocaleString()} - {entry.config.productName} - {entry.config.country} - $
                      {entry.config.dailyBudget}
                    </div>
                    {entry.error && <div className="hint error">{entry.error}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type MetaSettingsCardProps = {
  settings: MetaSettings | null;
  settingsLoaded: boolean;
  onSave: (settings: MetaSettings) => Promise<void>;
};

export function MetaSettingsCard({ settings, settingsLoaded, onSave }: MetaSettingsCardProps) {
  const [form, setForm] = useState<MetaSettings>({
    accessToken: settings?.accessToken || import.meta.env.VITE_META_ACCESS_TOKEN || "",
    adAccountId: settings?.adAccountId || import.meta.env.VITE_META_AD_ACCOUNT_ID || "",
    pageId: settings?.pageId || import.meta.env.VITE_META_PAGE_ID || "",
    instagramUserId: settings?.instagramUserId || import.meta.env.VITE_META_INSTAGRAM_USER_ID || "",
    pixelId: settings?.pixelId || import.meta.env.VITE_META_PIXEL_ID || "",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setForm((prev) => ({
        ...prev,
        accessToken: settings.accessToken || prev.accessToken,
        adAccountId: settings.adAccountId || prev.adAccountId,
        pageId: settings.pageId || prev.pageId,
        instagramUserId: settings.instagramUserId || prev.instagramUserId,
        pixelId: settings.pixelId || prev.pixelId,
      }));
    }
  }, [settings]);

  const allFilled =
    form.accessToken.trim() && form.adAccountId.trim() && form.pageId.trim() && form.pixelId.trim();

  async function handleSave() {
    setSaving(true);
    await onSave({ ...form });
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    setStatus("Testing with Meta Graph...");
    try {
      const token = form.accessToken.trim();
      if (!token) throw new Error("Access token required");
      const actId = form.adAccountId.replace(/^act_/, "");
      const meResp = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${encodeURIComponent(token)}`);
      if (!meResp.ok) throw new Error(`User check failed (${meResp.status})`);
      const me = await meResp.json();
      const actResp = await fetch(
        `https://graph.facebook.com/v18.0/act_${actId}?access_token=${encodeURIComponent(token)}&fields=id,account_status`
      );
      if (!actResp.ok) throw new Error(`Ad account check failed (${actResp.status})`);
      const act = await actResp.json();
      setStatus(`OK: ${me.name || me.id} • act_${actId} status ${act.account_status ?? "unknown"}`);
    } catch (err: any) {
      setStatus(`Error: ${err?.message || String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Meta credentials</p>
          <h2>Temporary setup (no OAuth)</h2>
        </div>
      </header>
      {!settingsLoaded && <div className="hint">Loading saved credentials…</div>}
      {settingsLoaded && (
        <div className="grid-two">
          <label className="field">
            <span className="field-label">Access Token</span>
            <input
              value={form.accessToken}
              onChange={(e) => setForm((prev) => ({ ...prev, accessToken: e.target.value }))}
              placeholder="EAAC..."
            />
          </label>
          <label className="field">
            <span className="field-label">Ad Account ID</span>
            <input
              value={form.adAccountId}
              onChange={(e) => setForm((prev) => ({ ...prev, adAccountId: e.target.value }))}
              placeholder="act_1234567890"
            />
          </label>
          <label className="field">
            <span className="field-label">Page ID</span>
            <input
              value={form.pageId}
              onChange={(e) => setForm((prev) => ({ ...prev, pageId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label className="field">
            <span className="field-label">Instagram User ID (optional)</span>
            <input
              value={form.instagramUserId}
              onChange={(e) => setForm((prev) => ({ ...prev, instagramUserId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label className="field">
            <span className="field-label">Pixel ID</span>
            <input
              value={form.pixelId}
              onChange={(e) => setForm((prev) => ({ ...prev, pixelId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
        </div>
      )}
      <div className="inline" style={{ marginTop: 10 }}>
        <button className="primary" onClick={handleSave} disabled={!allFilled || saving || !settingsLoaded}>
          {saving ? "Saving..." : "Save credentials"}
        </button>
        <button className="secondary" onClick={handleTest} disabled={testing || !settingsLoaded}>
          {testing ? "Testing..." : "Test connectivity"}
        </button>
        <div className="hint">Used only locally while OAuth is disabled.</div>
        {status && <div className="hint">{status}</div>}
      </div>
    </section>
  );
}

type SettingsTabProps = {
  settings: MetaSettings | null;
  settingsLoaded: boolean;
  onSaveSettings: (settings: MetaSettings) => Promise<void>;
};

function SettingsTab({ settings, settingsLoaded, onSaveSettings }: SettingsTabProps) {
  return (
    <div className="two-column">
      <div className="stack">
        <MetaSettingsCard settings={settings} settingsLoaded={settingsLoaded} onSave={onSaveSettings} />
      </div>
    </div>
  );
}

type BulkLaunchTabProps = {
  bulkGlobal: BulkGlobalConfig;
  setBulkGlobal: React.Dispatch<React.SetStateAction<BulkGlobalConfig>>;
  campaigns: BulkCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<BulkCampaign[]>>;
  presets: CopyPreset[];
  onPickGlobalFolder: () => Promise<void>;
  onPickCampaignFolder: (id: string) => Promise<void>;
  onLaunch: () => Promise<void>;
  status: StatusState;
  summary: Summary | null;
  logs: string[];
};

function BulkLaunchTab({
  bulkGlobal,
  setBulkGlobal,
  campaigns,
  setCampaigns,
  presets,
  onPickGlobalFolder,
  onPickCampaignFolder,
  onLaunch,
  status,
  summary,
  logs,
}: BulkLaunchTabProps) {
  const defaultPresetId = presets[0]?.id ?? "";
  const unlockedFields = useMemo(
    () => Object.entries(bulkGlobal).filter(([, v]) => v && v.locked === false).map(([k]) => k),
    [bulkGlobal],
  );

  function toggleLock(field: keyof BulkGlobalConfig) {
    setBulkGlobal((prev) => ({ ...prev, [field]: { ...prev[field], locked: !prev[field].locked } }));
  }

  function updateGlobal(field: keyof BulkGlobalConfig, value: any) {
    setBulkGlobal((prev) => ({ ...prev, [field]: { ...prev[field], value } }));
  }

  function updateCampaign(id: string, field: keyof BulkCampaign["overrides"], value: any) {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, overrides: { ...c.overrides, [field]: value }, status: "pending", error: undefined } : c,
      ),
    );
  }

  function addCampaign() {
    setCampaigns((prev) => [...prev, { id: crypto.randomUUID(), overrides: {}, status: "pending" }]);
  }

  function duplicateCampaign(id: string) {
    const source = campaigns.find((c) => c.id === id);
    if (!source) return;
    setCampaigns((prev) => [...prev, { id: crypto.randomUUID(), overrides: { ...source.overrides }, status: "pending" }]);
  }

  function removeCampaign(id: string) {
    setCampaigns((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  }

  const readiness: ValidationItem[] = [
    { label: `${campaigns.length} campaign(s) queued`, ok: campaigns.length > 0 },
    {
      label: "Folder + URL on each card",
      ok: campaigns.every((c) => {
        const folder = bulkGlobal.folderPath.locked ? bulkGlobal.folderPath.value : c.overrides.folderPath;
        const url = bulkGlobal.productUrl.locked ? bulkGlobal.productUrl.value : c.overrides.productUrl;
        return !!folder && !!url;
      }),
      hint: "Folder and URL are required per campaign.",
    },
    {
      label: "Preset selected",
      ok: Boolean(bulkGlobal.presetId.value || defaultPresetId),
      hint: "Lock preset globally or set per card.",
    },
  ];

  return (
    <div className="two-column">
      <div className="stack">
        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Bulk Launch</p>
              <h1>Global defaults</h1>
            </div>
            <div className="chip ghost">Locked fields apply everywhere</div>
          </header>
          <div className="grid-two">
            {(Object.keys(bulkGlobal) as (keyof BulkGlobalConfig)[]).map((field) => (
              <div
                key={field}
                className={`field ${bulkGlobal[field].locked ? "locked" : ""}`}
                style={{ background: bulkGlobal[field].locked ? "var(--surface)" : undefined }}
              >
                <div className="field-label inline">
                  <span>{labelForField(field)}</span>
                  <button className="lock" type="button" onClick={() => toggleLock(field)}>
                    {bulkGlobal[field].locked ? "[locked]" : "[unlocked]"}
                  </button>
                </div>
                {renderGlobalInput(field, bulkGlobal, presets, defaultPresetId, updateGlobal, onPickGlobalFolder)}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Campaigns</p>
              <h2>Stacked cards</h2>
            </div>
            <button className="secondary" onClick={addCampaign}>
              + Add campaign
            </button>
          </header>
          <div className="stack">
            {campaigns.map((c, idx) => (
              <div key={c.id} className={`card-row ${c.status === "error" ? "error" : ""}`}>
                <div className="inline spread">
                  <div className="chip-row">
                    <div className="chip ghost">Campaign {idx + 1}</div>
                    <div className={`status-pill ${c.status}`}>{c.status.toUpperCase()}</div>
                    {c.error && <span className="hint error">{c.error}</span>}
                  </div>
                  <div className="inline">
                    <button className="secondary" onClick={() => duplicateCampaign(c.id)}>
                      Duplicate
                    </button>
                    {campaigns.length > 1 && (
                      <button className="secondary danger" onClick={() => removeCampaign(c.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid-two">
                  {unlockedFields.includes("productName") && (
                    <div className="field">
                      <span className="field-label">Product name</span>
                      <input
                        value={c.overrides.productName || ""}
                        onChange={(e) => updateCampaign(c.id, "productName", e.target.value)}
                      />
                    </div>
                  )}
                  {unlockedFields.includes("productUrl") && (
                    <div className="field">
                      <span className="field-label">Product URL</span>
                      <input
                        value={c.overrides.productUrl || ""}
                        onChange={(e) => updateCampaign(c.id, "productUrl", e.target.value)}
                      />
                    </div>
                  )}
                  {unlockedFields.includes("brandName") && (
                    <div className="field">
                      <span className="field-label">Brand name</span>
                      <input
                        value={c.overrides.brandName || ""}
                        onChange={(e) => updateCampaign(c.id, "brandName", e.target.value)}
                      />
                    </div>
                  )}
                  {unlockedFields.includes("country") && (
                    <div className="field">
                      <span className="field-label">Country</span>
                      <select
                        value={c.overrides.country || ""}
                        onChange={(e) => updateCampaign(c.id, "country", e.target.value)}
                      >
                        <option value="">Select country</option>
                        {countryOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {unlockedFields.includes("folderPath") && (
                    <div className="field">
                      <span className="field-label">Media folder</span>
                      <div className="inline-field">
                        <input value={c.overrides.folderPath || ""} readOnly placeholder="Pick campaign folder" />
                        <button type="button" onClick={() => onPickCampaignFolder(c.id)}>
                          Pick
                        </button>
                      </div>
                    </div>
                  )}
                  {unlockedFields.includes("presetId") && (
                    <div className="field">
                      <span className="field-label">Preset</span>
                      <select
                        value={c.overrides.presetId || defaultPresetId}
                        onChange={(e) => updateCampaign(c.id, "presetId", e.target.value)}
                      >
                        {presets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {unlockedFields.includes("campaignActive") && (
                    <div className="field">
                      <span className="field-label">Status</span>
                      <button
                        className={`toggle ${c.overrides.campaignActive ?? bulkGlobal.campaignActive.value ? "on" : "off"}`}
                        type="button"
                        onClick={() =>
                          updateCampaign(
                            c.id,
                            "campaignActive",
                            !(c.overrides.campaignActive ?? bulkGlobal.campaignActive.value),
                          )
                        }
                      >
                        {(c.overrides.campaignActive ?? bulkGlobal.campaignActive.value) ? "Active" : "Paused"}
                      </button>
                    </div>
                  )}
                  {unlockedFields.includes("scheduleTime") && (
                    <div className="field">
                      <span className="field-label">Schedule</span>
                      <input
                        type="datetime-local"
                        value={c.overrides.scheduleTime || ""}
                        onChange={(e) => updateCampaign(c.id, "scheduleTime", e.target.value)}
                      />
                    </div>
                  )}
                  {unlockedFields.includes("dailyBudget") && (
                    <div className="field">
                      <span className="field-label">Budget</span>
                      <input
                        type="number"
                        value={c.overrides.dailyBudget ?? ""}
                        onChange={(e) => updateCampaign(c.id, "dailyBudget", Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
                {unlockedFields.length === 0 && (
                  <div className="hint">All fields are locked; this card inherits global defaults.</div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Readiness</p>
              <h2>Validation</h2>
            </div>
            <div className="chip ghost">{status.state.toUpperCase()}</div>
          </header>
          <ValidationList items={readiness} />
          <div className="action-row">
            <button className="primary" onClick={onLaunch} disabled={!readiness.every((r) => r.ok)}>
              {status.state === "running" ? "Launching..." : "Launch all"}
            </button>
            <div className="status-text">{status.message || "Locks keep repetitive fields consistent."}</div>
          </div>
          {summary && (
            <div className="summary">
              <div className="summary-head">
                <strong>{summary.title}</strong>
                <span className="hint">
                  {summary.durationSec}s - est. {summary.timeSavedMin} min saved
                </span>
              </div>
              <div className="summary-grid">
                {summary.entries.map((entry, idx) => (
                  <div key={`${entry.name}-${idx}`} className="summary-card">
                    <div className="summary-name">{entry.name}</div>
                    <div className="hint">
                      Ad sets: {entry.adsets} - Ads: {entry.ads}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Live execution</p>
              <h2>Logs</h2>
            </div>
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(logs.join("\n"))} disabled={!logs.length}>
              Copy
            </button>
          </header>
          <div className="log-box">
            {logs.length === 0 && <div className="hint">Bulk logs appear here during launch.</div>}
            {logs.map((line, idx) => (
              <div key={`bulk-log-${idx}`} className="log-line">
                {line}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function labelForField(field: keyof BulkGlobalConfig): string {
  const labels: Record<keyof BulkGlobalConfig, string> = {
    country: "Country",
    productName: "Product name",
    brandName: "Brand name",
    productUrl: "Product URL",
    folderPath: "Media folder",
    presetId: "Preset",
    scheduleTime: "Schedule",
    dailyBudget: "Daily budget",
    campaignActive: "Campaign status",
  };
  return labels[field];
}

function renderGlobalInput(
  field: keyof BulkGlobalConfig,
  bulkGlobal: BulkGlobalConfig,
  presets: CopyPreset[],
  defaultPresetId: string,
  updateGlobal: (field: keyof BulkGlobalConfig, value: any) => void,
  onPickFolder: () => Promise<void>,
) {
  if (field === "presetId") {
    return (
      <select value={bulkGlobal.presetId.value || defaultPresetId} onChange={(e) => updateGlobal("presetId", e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    );
  }
  if (field === "country") {
    return (
      <select value={bulkGlobal.country.value} onChange={(e) => updateGlobal("country", e.target.value)}>
        {countryOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (field === "campaignActive") {
    return (
      <button
        className={`toggle ${bulkGlobal.campaignActive.value ? "on" : "off"}`}
        type="button"
        onClick={() => updateGlobal("campaignActive", !bulkGlobal.campaignActive.value)}
      >
        {bulkGlobal.campaignActive.value ? "Active on create" : "Paused on create"}
      </button>
    );
  }
  if (field === "scheduleTime") {
    return (
      <input
        type="datetime-local"
        value={bulkGlobal.scheduleTime.value}
        onChange={(e) => updateGlobal("scheduleTime", e.target.value)}
      />
    );
  }
  if (field === "dailyBudget") {
    return (
      <input
        type="number"
        value={bulkGlobal.dailyBudget.value}
        onChange={(e) => updateGlobal("dailyBudget", Number(e.target.value))}
      />
    );
  }
  if (field === "folderPath") {
    return (
      <div className="inline-field">
        <input value={bulkGlobal.folderPath.value} readOnly placeholder="Pick a folder" />
        <button type="button" onClick={onPickFolder}>
          Pick
        </button>
      </div>
    );
  }
  return (
    <input
      value={(bulkGlobal as any)[field].value}
      onChange={(e) => updateGlobal(field, e.target.value)}
      placeholder={field === "brandName" ? "Optional" : ""}
    />
  );
}

type PresetsTabProps = {
  activePreset: CopyPreset | null;
  launchVars: {
    product_name: string;
    product_url: string;
    brand_name: string;
    country: string;
  };
  bulkGlobal: BulkGlobalConfig;
  bulkCampaigns: BulkCampaign[];
};

function PresetsTab({ activePreset, launchVars, bulkGlobal, bulkCampaigns }: PresetsTabProps) {
  const { presets, activePresetId, setActivePreset, addPreset, renamePreset, deletePreset, updatePresetField } =
    useCopyPresets();
  const [renameValue, setRenameValue] = useState(activePreset?.name ?? "");

  useEffect(() => {
    setRenameValue(activePreset?.name ?? "");
  }, [activePreset?.name]);

  function presetUsedInBulk(presetId: string) {
    if (bulkGlobal.presetId.value === presetId) return true;
    return bulkCampaigns.some(
      (c) =>
        c.overrides.presetId === presetId ||
        (!c.overrides.presetId && !bulkGlobal.presetId.locked && bulkGlobal.presetId.value === presetId),
    );
  }
  const activePresetUsedInBulk = activePreset ? presetUsedInBulk(activePreset.id) : false;

  function updateField(
    field:
      | "headlines"
      | "primaryTexts"
      | "descriptions"
      | "carouselHeadlines"
      | "carouselDescriptions",
    index: number,
    value: string,
  ) {
    if (!activePreset) return;
    const current = (activePreset[field] || []) as string[];
    const next = [...current];
    next[index] = value;
    updatePresetField(activePreset.id, field, next);
  }

  function removeField(
    field:
      | "headlines"
      | "primaryTexts"
      | "descriptions"
      | "carouselHeadlines"
      | "carouselDescriptions",
    index: number,
  ) {
    if (!activePreset) return;
    const current = (activePreset[field] || []) as string[];
    const next = current.filter((_, i) => i !== index);
    updatePresetField(activePreset.id, field, next);
  }

  function addField(
    field:
      | "headlines"
      | "primaryTexts"
      | "descriptions"
      | "carouselHeadlines"
      | "carouselDescriptions",
  ) {
    if (!activePreset) return;
    const current = (activePreset[field] || []) as string[];
    if (current.length >= 5) return;
    updatePresetField(activePreset.id, field, [...current, ""]);
  }

  function resolvedPreview(items: string[]): { text: string; error?: string }[] {
    return items.map((t) => {
      try {
        return { text: resolveVariables(t, launchVars) };
      } catch (err) {
        return { text: t, error: String(err) };
      }
    });
  }

  return (
    <div className="two-column presets">
      <section className="panel">
        <header className="panel-head">
          <div>
            <p className="eyebrow">Presets</p>
            <h1>Library</h1>
          </div>
        </header>
        <div className="list presets-list">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className={`preset-tile ${preset.id === activePresetId ? "active" : ""}`}
              onClick={() => setActivePreset(preset.id)}
            >
              <div className="summary-name">{preset.name}</div>
              <div className="hint">
                {preset.headlines.length} headlines - {preset.primaryTexts.length} primary texts - {preset.descriptions.length} descriptions
              </div>
              {presetUsedInBulk(preset.id) && <div className="pill subtle">Used in bulk</div>}
            </button>
          ))}
        </div>
        <div className="inline">
          <button className="secondary" onClick={() => addPreset()}>
            + Add preset
          </button>
          <button className="secondary" onClick={() => renamePreset(activePresetId, renameValue || "Untitled")} disabled={!activePreset}>
            Rename
          </button>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Preset name"
            className="compact-input"
          />
          <button className="secondary danger" onClick={() => deletePreset(activePresetId)} disabled={presets.length === 1}>
            Delete
          </button>
        </div>
      </section>

      <div className="stack">
        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Editor</p>
              <h2>Copy blocks</h2>
            </div>
            <div className="pill subtle">
              Variables: {allowedVariables().map((v) => `{${v}}`).join(", ")}
            </div>
          </header>
          {!activePreset && <div className="empty">Select or create a preset to edit.</div>}
          {activePreset && (
            <div className="grid-two">
              {renderPresetSection("Headlines", "headlines", activePreset.headlines, updateField, removeField, addField)}
              {renderPresetSection(
                "Primary texts",
                "primaryTexts",
                activePreset.primaryTexts,
                updateField,
                removeField,
                addField,
                true,
              )}
              {renderPresetSection(
                "Descriptions",
                "descriptions",
                activePreset.descriptions,
                updateField,
                removeField,
                addField,
              )}
              {renderPresetSection(
                "Carousel headlines",
                "carouselHeadlines",
                activePreset.carouselHeadlines || [],
                updateField,
                removeField,
                addField,
              )}
              {renderPresetSection(
                "Carousel descriptions",
                "carouselDescriptions",
                activePreset.carouselDescriptions || [],
                updateField,
                removeField,
                addField,
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Resolved copy</h2>
            </div>
            {activePresetUsedInBulk && <div className="pill subtle">Linked to Bulk Launch</div>}
          </header>
          {!activePreset && <div className="empty">No preset selected.</div>}
          {activePreset && (
            <div className="preview">
              <div className="preview-block">
                <strong>Headlines</strong>
                {resolvedPreview(activePreset.headlines).map((h, idx) => (
                  <div key={`h-${idx}`} className={`block ${h.error ? "error" : ""}`}>
                    {h.text}
                  </div>
                ))}
              </div>
              <div className="preview-block">
                <strong>Primary texts</strong>
                {resolvedPreview(activePreset.primaryTexts).map((h, idx) => (
                  <div key={`p-${idx}`} className={`block ${h.error ? "error" : ""}`}>
                    {h.text}
                  </div>
                ))}
              </div>
              <div className="preview-block">
                <strong>Descriptions</strong>
                {resolvedPreview(activePreset.descriptions).map((h, idx) => (
                  <div key={`d-${idx}`} className={`block ${h.error ? "error" : ""}`}>
                    {h.text}
                  </div>
                ))}
              </div>
              <div className="preview-block">
                <strong>Carousel</strong>
                {resolvedPreview(activePreset.carouselHeadlines || []).map((h, idx) => (
                  <div key={`ch-${idx}`} className={`block ${h.error ? "error" : ""}`}>
                    Headline: {h.text}
                  </div>
                ))}
                {resolvedPreview(activePreset.carouselDescriptions || []).map((h, idx) => (
                  <div key={`cd-${idx}`} className={`block ${h.error ? "error" : ""}`}>
                    Description: {h.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function renderPresetSection(
  title: string,
  field:
    | "headlines"
    | "primaryTexts"
    | "descriptions"
    | "carouselHeadlines"
    | "carouselDescriptions",
  items: string[],
  updateField: (field: any, index: number, value: string) => void,
  removeField: (field: any, index: number) => void,
  addField: (field: any) => void,
  multiline = false,
) {
  return (
    <div className="preset-section">
      <div className="inline spread">
        <strong>{title}</strong>
        <span className="hint">Max 5</span>
      </div>
      {items.length === 0 && <div className="empty">Add at least one entry.</div>}
      {items.map((text, idx) => {
        const unknowns = findUnknownVariables(text);
        return (
          <div key={`${field}-${idx}`} className="field">
            {multiline ? (
              <textarea value={text} rows={3} onChange={(e) => updateField(field, idx, e.target.value)} />
            ) : (
              <input value={text} onChange={(e) => updateField(field, idx, e.target.value)} />
            )}
            <div className="inline spread">
              <span className="hint">
                {text.length} chars {unknowns.length ? `- Unknown: ${unknowns.join(", ")}` : ""}
              </span>
              <button className="secondary danger" onClick={() => removeField(field, idx)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
      <button className="secondary" onClick={() => addField(field)} disabled={items.length >= 5}>
        Add
      </button>
    </div>
  );
}


function ValidationList({ items }: { items: ValidationItem[] }) {
  return (
    <ul className="checklist">
      {items.map((item) => (
        <li key={item.label} className={item.ok ? "ok" : "warn"}>
          <span className="check">{item.ok ? "[x]" : "[ ]"}</span>
          <div>
            <div>{item.label}</div>
            {!item.ok && item.hint && <div className="hint">{item.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function validateCopyPreset(preset: CopyPreset | null): string | null {
  if (!preset) return "No preset selected.";
  if (
    preset.headlines.length > 5 ||
    preset.primaryTexts.length > 5 ||
    preset.descriptions.length > 5 ||
    (preset.carouselHeadlines?.length || 0) > 5 ||
    (preset.carouselDescriptions?.length || 0) > 5
  ) {
    return "Preset exceeds copy limits (max 5 per section).";
  }
  const unknowns = [
    ...preset.headlines.flatMap(findUnknownVariables),
    ...preset.primaryTexts.flatMap(findUnknownVariables),
    ...preset.descriptions.flatMap(findUnknownVariables),
    ...(preset.carouselHeadlines || []).flatMap(findUnknownVariables),
    ...(preset.carouselDescriptions || []).flatMap(findUnknownVariables),
  ];
  if (unknowns.length) {
    return `Unknown variables: ${Array.from(new Set(unknowns)).join(", ")}`;
  }
  if (preset.headlines.length === 0 && preset.primaryTexts.length === 0) {
    return "Add at least one headline or primary text.";
  }
  return null;
}

type ConfirmModalProps = {
  title: string;
  subtitle?: string;
  entries: { id: string; name: string; folder: string; preset: string; status: string; details?: string[] }[];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

function ConfirmModal({ title, subtitle, entries, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{subtitle || "Review before launch"}</p>
            <h2>{title}</h2>
          </div>
          <button className="secondary" onClick={onCancel}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">Locks stay applied. Each card inherits locked fields unless overridden.</p>
          <div className="modal-list">
            {entries.map((e, idx) => (
              <div key={e.id || idx} className="modal-row">
                <div className="summary-name">{e.name}</div>
                <div className="hint">Folder: {e.folder || "Missing"}</div>
                <div className="hint">Preset: {e.preset}</div>
                <div className="hint">Status: {e.status}</div>
                {e.details?.map((d, i2) => (
                  <div key={i2} className="hint">
                    {d}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onConfirm}>
            Launch now
          </button>
        </div>
      </div>
    </div>
  );
}
