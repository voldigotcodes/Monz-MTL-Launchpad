import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchPreview, pickFolder, runLaunch } from "./lib/api";
import { loadHistory, loadPresets, loadMetaSettings, saveCopyPresets, saveHistory, saveMetaSettings, savePresets } from "./lib/storage";
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
  Preset,
  PreviewData,
} from "./types";

const defaultForm: LaunchFormState = {
  folderPath: "",
  productName: "",
  brandName: "",
  productUrl: "",
  country: "CA",
  dailyBudget: 80,
  campaignActive: false,
  scheduleMode: "now",
  scheduleTime: "",
};

type StatusState = {
  state: "idle" | "running" | "success" | "error";
  message?: string;
};

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

type SettingsTabProps = {
  settings: MetaSettings | null;
  onSave: (settings: MetaSettings) => Promise<void>;
};

function SettingsTab({ settings, onSave }: SettingsTabProps) {
  const [form, setForm] = useState<MetaSettings>(
    settings || { accessToken: "", adAccountId: "", pageId: "", instagramUserId: "", pixelId: "" },
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const allFilled =
    form.accessToken.trim() &&
    form.adAccountId.trim() &&
    form.pageId.trim() &&
    form.instagramUserId.trim() &&
    form.pixelId.trim();

  async function handleSave() {
    if (!allFilled) {
      setStatus("All fields are required.");
      return;
    }
    setSaving(true);
    setStatus(null);
    await onSave({ ...form });
    setStatus("Saved locally.");
    setSaving(false);
  }

  async function testConnection() {
    if (!form.accessToken.trim()) {
      setStatus("Access token required to test.");
      return;
    }
    setTesting(true);
    setStatus("Testing connection…");
    try {
      const token = form.accessToken.trim();
      const accountId = form.adAccountId.replace(/^act_/, "");
      const meResp = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`);
      if (!meResp.ok) {
        throw new Error(`Token invalid (${meResp.status})`);
      }
      const actResp = await fetch(`https://graph.facebook.com/v19.0/act_${accountId}?access_token=${token}`);
      if (!actResp.ok) {
        throw new Error(`Cannot access ad account act_${accountId} (${actResp.status})`);
      }
      setStatus("Connection OK: token valid and ad account accessible.");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 16 }}>
      <section className="card">
        <h2>Meta account settings</h2>
        <p className="subdued">Stored locally via Tauri. Required before launching campaigns.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <label>
            Meta Access Token
            <input
              value={form.accessToken}
              onChange={(e) => setForm((prev) => ({ ...prev, accessToken: e.target.value }))}
              placeholder="EAAC..."
            />
          </label>
          <label>
            Ad Account ID
            <input
              value={form.adAccountId}
              onChange={(e) => setForm((prev) => ({ ...prev, adAccountId: e.target.value }))}
              placeholder="act_1234567890"
            />
          </label>
          <label>
            Page ID
            <input
              value={form.pageId}
              onChange={(e) => setForm((prev) => ({ ...prev, pageId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label>
            Instagram User ID
            <input
              value={form.instagramUserId}
              onChange={(e) => setForm((prev) => ({ ...prev, instagramUserId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label>
            Pixel ID
            <input
              value={form.pixelId}
              onChange={(e) => setForm((prev) => ({ ...prev, pixelId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
        </div>
        <div className="inline" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={testConnection} disabled={testing || !form.accessToken}>
            {testing ? "Testing..." : "Test connection"}
          </button>
          {status && <span className="mini">{status}</span>}
        </div>
      </section>
    </div>
  );
}

function AppShell() {
  console.log("[AppShell] render start");
  const [form, setForm] = useState<LaunchFormState>(defaultForm);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusState>({ state: "idle" });
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  const [presets, setPresets] = useState<Preset[]>(loadPresets());
  const [presetName, setPresetName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"launch" | "copy-presets" | "bulk" | "settings">("launch");
  const copyCtx = useCopyPresets();
  const [settings, setSettings] = useState<MetaSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const [confirmModal, setConfirmModal] = useState<
    | {
        mode: "single" | "bulk";
        entries: { id?: string; campaignName: string; preset: string; productUrl: string; folderPath: string; status: string }[];
        onConfirm: () => Promise<void> | void;
      }
    | null
  >(null);
  const [successModal, setSuccessModal] = useState<
    | {
        title: string;
        entries: { name: string; adsets: number; ads: number }[];
        durationSec: number;
        timeSavedMin: number;
      }
    | null
  >(null);

  useEffect(() => {
    console.log("[AppShell] Active tab:", activeTab);
  }, [activeTab]);

  useEffect(() => {
    console.log("[AppShell] Bulk presets length:", copyCtx.presets.length, "bulkGlobal presetId:", bulkGlobal.presetId.value);
  }, [copyCtx.presets, bulkGlobal.presetId.value]);

  useEffect(() => {
    loadMetaSettings()
      .then((data) => {
        if (data) setSettings(data);
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!bulkGlobal.presetId.value && copyCtx.presets[0]) {
      setBulkGlobal((prev) => ({ ...prev, presetId: { ...prev.presetId, value: copyCtx.presets[0].id } }));
    }
  }, [copyCtx.presets]);

  useEffect(() => {
    const unlistenPromise = listen<string>("launch-log", (event) => {
      setLogs((prev) => [...prev, event.payload]);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!form.folderPath) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    fetchPreview(form.folderPath, form.country)
      .then(setPreview)
      .catch((err) => {
        setPreview(null);
        setStatus({ state: "error", message: String(err) });
      })
      .finally(() => setPreviewLoading(false));
  }, [form.folderPath, form.country]);

  const canLaunch = useMemo(
    () => !!form.folderPath && !!form.productName && !!form.productUrl,
    [form.folderPath, form.productName, form.productUrl],
  );

  const scheduleLabel = useMemo(() => {
    if (form.scheduleMode === "now") return "Launch immediately";
    if (form.scheduleTime) return `Scheduled for ${form.scheduleTime}`;
    return "Scheduled start";
  }, [form.scheduleMode, form.scheduleTime]);

  const missingSettings =
    settingsLoaded &&
    (!settings ||
      !settings.accessToken ||
      !settings.adAccountId ||
      !settings.pageId ||
      !settings.instagramUserId ||
      !settings.pixelId);

  async function handleFolderPick() {
    const folder = await pickFolder();
    if (folder) {
      setForm((prev) => ({ ...prev, folderPath: folder }));
    }
  }

  function persistHistory(next: HistoryEntry[]) {
    setHistory(next);
    saveHistory(next);
  }

  function persistPresets(next: Preset[]) {
    setPresets(next);
    savePresets(next);
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

  const activeCopyPreset: CopyPreset | null =
    copyCtx.presets.find((p) => p.id === copyCtx.activePresetId) || copyCtx.presets[0] || null;

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

  async function handleLaunch() {
    if (!canLaunch) {
      captureError("Folder, product name, and product URL are required.");
      return;
    }
    const presetError = validateCopyPreset(activeCopyPreset);
    if (presetError) {
      setActiveTab("copy-presets");
      captureError(presetError);
      return;
    }
    const scheduledIso = form.scheduleMode === "later" ? toIsoWithOffset(form.scheduleTime) : undefined;
    const runSingle = async () => {
      setConfirmModal(null);
      setSuccessModal(null);
      setStatus({ state: "running", message: "Launching via Python backend..." });
      setLogs([]);
      const started = performance.now();
      try {
        const result: LaunchResult = await runLaunch({
          folderPath: form.folderPath,
          productName: form.productName,
          brandName: form.brandName,
          productUrl: form.productUrl,
          country: form.country,
          dailyBudget: form.dailyBudget,
          campaignActive: form.campaignActive,
          scheduleMode: form.scheduleMode,
          scheduleTime: scheduledIso,
          preset: activeCopyPreset!,
        });
        const durationSec = Math.max(1, Math.round((performance.now() - started) / 1000));
        const totalAds = result.ads_created || 0;
        const timeSavedMin = Math.max(1, Math.round((totalAds || 1) * 2));
        setSuccessModal({
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
      }
    };

    setConfirmModal({
      mode: "single",
      entries: [
        {
          campaignName: form.productName || "Campaign",
          preset: activeCopyPreset?.name || "Unknown",
          productUrl: form.productUrl,
          folderPath: form.folderPath,
          status: form.campaignActive ? "Active" : "Paused",
        },
      ],
      onConfirm: runSingle,
    });
  }

  function handleSavePreset() {
    if (!presetName.trim()) {
      setStatus({ state: "error", message: "Preset name is required." });
      return;
    }
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: presetName.trim(),
      createdAt: new Date().toISOString(),
      config: { ...form },
    };
    persistPresets([preset, ...presets].slice(0, 20));
    setPresetName("");
  }

  function applyPreset(preset: Preset) {
    setForm({ ...preset.config, brandName: preset.config.brandName || "" });
    setStatus({ state: "idle", message: `Preset loaded: ${preset.name}` });
  }

  function useHistoryConfig(entry: HistoryEntry) {
    setForm({ ...entry.config, brandName: entry.config.brandName || "" });
    setStatus({ state: "idle", message: "Config loaded from history" });
  }

  return (
    <main>
      <div className="toolbar">
        <h1>Monz MTL Launchpad</h1>
        <span className="badge pill">Internal • Meta Ads CBO</span>
        <span className="badge">{scheduleLabel}</span>
      </div>
      <div className="tabs">
        <button className={`tab ${activeTab === "launch" ? "active" : ""}`} onClick={() => setActiveTab("launch")}>
          Launch
        </button>
        <button
          className={`tab ${activeTab === "copy-presets" ? "active" : ""}`}
          onClick={() => setActiveTab("copy-presets")}
        >
          Presets
        </button>
        <button
          className={`tab ${activeTab === "bulk" ? "active" : ""}`}
          onClick={() => setActiveTab("bulk")}
        >
          Bulk Launch
        </button>
        <button
          className={`tab ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </div>
      {activeTab === "launch" ? (
        <>
          <p className="lede">
            Operator-first desktop launcher. Picks a local campaign folder, streams Python logs, and pushes directly to
            Meta via the existing backend.
          </p>

          <div className="grid">
            <section className="card">
              <h2>Launch configuration</h2>
              <p className="subdued">Provide launch inputs. Folder scanning is done by the Python parser.</p>
              <div className="form-grid">
                <label>
                  Campaign folder
                  <div className="inline">
                    <input
                      value={form.folderPath}
                      placeholder="Select a folder"
                      readOnly
                      style={{ flex: 1 }}
                    />
                    <button onClick={handleFolderPick}>Pick</button>
                  </div>
                </label>
                <label>
                  Daily budget (currency)
                  <input
                    type="number"
                    min={1}
                    value={form.dailyBudget}
                    onChange={(e) => setForm((prev) => ({ ...prev, dailyBudget: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Product name
                  <input
                    value={form.productName}
                    onChange={(e) => setForm((prev) => ({ ...prev, productName: e.target.value }))}
                    placeholder="Comfort Collection"
                  />
                </label>
                <label>
                  Brand name
                  <input
                    value={form.brandName}
                    onChange={(e) => setForm((prev) => ({ ...prev, brandName: e.target.value }))}
                    placeholder="Monz Montréal"
                  />
                </label>
                <label>
                  Product URL
                  <input
                    type="url"
                    value={form.productUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, productUrl: e.target.value }))}
                    placeholder="https://example.com/product"
                  />
                </label>
                <label>
                  Country
                  <select
                    value={form.country}
                    onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  >
                    <option value="CA">Canada (CA)</option>
                    <option value="US">United States (US)</option>
                    <option value="GB">United Kingdom (GB)</option>
                  </select>
                  <div className="inline" style={{ justifyContent: "flex-start", gap: 10 }}>
                    <button
                      type="button"
                      className={`toggle ${form.campaignActive ? "on" : "off"}`}
                      role="switch"
                      aria-checked={form.campaignActive}
                      onClick={() => setForm((prev) => ({ ...prev, campaignActive: !prev.campaignActive }))}
                      title={form.campaignActive ? "Active on create" : "Paused on create"}
                    />
                    <span className="mini">Campaign status</span>
                    <button
                      type="button"
                      className="mini"
                      style={{ background: "transparent", border: "none", color: "inherit", padding: 0 }}
                      onClick={() => setForm((prev) => ({ ...prev, campaignActive: !prev.campaignActive }))}
                    >
                      {form.campaignActive ? "Active on create" : "Paused on create"}
                    </button>
                  </div>
                </label>
                <label>
                  Launch timing
                  <div className="inline" style={{ gap: 12 }}>
                    <button
                      className={form.scheduleMode === "now" ? "primary" : ""}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, scheduleMode: "now" }))}
                    >
                      Launch now
                    </button>
                    <button
                      className={form.scheduleMode === "later" ? "primary" : ""}
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
                </label>
              </div>
              <div className="divider" />
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <div className="inline" style={{ gap: 8 }}>
                  <button className="primary" onClick={handleLaunch} disabled={!canLaunch || status.state === "running"}>
                    {status.state === "running" ? "Launching..." : "Launch"}
                  </button>
                  <button onClick={() => setLogs([])} disabled={status.state === "running"}>
                    Clear logs
                  </button>
                </div>
                <label style={{ maxWidth: 260 }}>
                  Save preset
                  <div className="inline">
                    <input
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name"
                    />
                    <button type="button" onClick={handleSavePreset}>
                      Save
                    </button>
                  </div>
                </label>
              </div>
              {status.state !== "idle" && (
                <div className={`status ${status.state}`}>
                  <span>{status.state.toUpperCase()}</span>
                  <span>{status.message}</span>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Preview & assets</h2>
              <p className="subdued">
                Campaign and ad set names use backend formatting. Media counts come directly from the Python folder parser.
              </p>
              {previewLoading && <div className="status running">Scanning folder…</div>}
              {!preview && !previewLoading && <div className="status">Select a folder to preview assets.</div>}
              {preview && (
                <div className="preview-list">
                  {preview.campaigns.map((campaign) => (
                    <div key={campaign.name} className="preview-row">
                      <h4>{campaign.name}</h4>
                      <div className="chips">
                        <span className="chip">Ad sets: {campaign.adsets.length}</span>
                        <span className="chip">
                          Ads: {campaign.adsets.reduce((acc, a) => acc + a.ads, 0)}
                        </span>
                      </div>
                      {campaign.adsets.map((adset) => (
                        <div key={adset.name} className="mini">
                          {adset.name} — {adset.ads} ads • {adset.images} images • {adset.videos} videos
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="chips">
                    <span className="chip">Launch date: {preview.launch_date}</span>
                    <span className="chip">Images: {preview.media_summary.images}</span>
                    <span className="chip">Videos: {preview.media_summary.videos}</span>
                    <span className="chip">Total ads: {preview.total_ads}</span>
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Live execution</h2>
              <p className="subdued">Logs stream directly from Python stdout/stderr.</p>
              <div className="logs">
                <div className="log-actions">
                  <button onClick={() => navigator.clipboard?.writeText(logs.join("\n"))} disabled={logs.length === 0}>
                    Copy logs
                  </button>
                </div>
                {logs.length === 0 && <div className="mini">No logs yet.</div>}
                {logs.map((line, idx) => (
                  <div key={`${line}-${idx}`}>{line}</div>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Presets</h2>
              <p className="subdued">Load saved launch profiles to prefill the form.</p>
              {presets.length === 0 && <div className="mini">No presets yet.</div>}
              <ul className="list">
                {presets.map((preset) => (
                  <li key={preset.id} className="list-item">
                    <div className="item-meta">
                      <strong>{preset.name}</strong>
                      <span className="mini">{new Date(preset.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="inline">
                      <button onClick={() => applyPreset(preset)}>Load</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>History (last 10)</h2>
              <p className="subdued">Re-launch instantly with the same configuration.</p>
              {history.length === 0 && <div className="mini">No runs yet.</div>}
              <ul className="list">
                {history.map((entry) => (
                  <li key={entry.id} className="list-item">
                    <div className="item-meta">
                      <strong>
                        {entry.status === "success" ? "Success" : "Error"} —{" "}
                        {entry.result?.ads_created ?? 0} ads
                      </strong>
                      <span className="mini">{new Date(entry.timestamp).toLocaleString()}</span>
                      <span className="mini">
                        {entry.config.productName} • {entry.config.country} • ${entry.config.dailyBudget}
                      </span>
                      {entry.error && <span className="mini" style={{ color: "#fecdd3" }}>{entry.error}</span>}
                    </div>
                    <div className="inline">
                      <button onClick={() => useHistoryConfig(entry)} disabled={status.state === "running"}>
                        Load config
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : activeTab === "copy-presets" ? (
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
      ) : activeTab === "bulk" ? (
        <BulkLaunchTab
          bulkGlobal={bulkGlobal}
          setBulkGlobal={setBulkGlobal}
          campaigns={bulkCampaigns}
          setCampaigns={setBulkCampaigns}
          presets={copyCtx.presets}
          logs={logs}
          accountId={settings?.adAccountId}
          setConfirmModal={setConfirmModal}
          setSuccessModal={setSuccessModal}
        />
      ) : (
        <SettingsTab
          settings={settings}
          onSave={async (next) => {
            setSettings(next);
            await saveMetaSettings(next);
          }}
        />
      )}
      {missingSettings && activeTab !== "settings" && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Connect your Meta account</h2>
          <p className="subdued">Before launching campaigns, connect your Meta account.</p>
          <button className="primary" onClick={() => setActiveTab("settings")}>
            Open Settings
          </button>
        </section>
      )}
      {confirmModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Confirm launch</h3>
            <p className="subdued">
              You are about to create {confirmModal.entries.length} campaign{confirmModal.entries.length === 1 ? "" : "s"} in account{" "}
              {settings?.adAccountId || "unknown"}.
            </p>
            <div className="list" style={{ maxHeight: 300, overflow: "auto" }}>
              {confirmModal.entries.map((e, idx) => (
                <div key={e.id || idx} className="list-item">
                  <div className="item-meta">
                    <strong>{e.campaignName}</strong>
                    <span className="mini">Preset: {e.preset}</span>
                    <span className="mini">URL: {e.productUrl}</span>
                    <span className="mini">Folder: {e.folderPath}</span>
                    <span className="mini">Status: {e.status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="inline" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setConfirmModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal(null);
                  action?.();
                }}
              >
                Launch now
              </button>
            </div>
          </div>
        </div>
      )}
      {successModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Launch summary</h3>
            <p className="subdued">
              {successModal.entries.length} campaign{successModal.entries.length === 1 ? "" : "s"} launched in{" "}
              {successModal.durationSec}s. Est. time saved: {successModal.timeSavedMin} min.
            </p>
            <div className="preview-list">
              {successModal.entries.map((c, idx) => (
                <div key={`${c.name}-${idx}`} className="preview-row">
                  <h4>{c.name}</h4>
                  <div className="chips">
                    <span className="chip">Ad sets: {c.adsets}</span>
                    <span className="chip">Ads: {c.ads}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="inline" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="primary" onClick={() => setSuccessModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="mini" style={{ marginTop: 16, textAlign: "center", opacity: 0.7 }}>
        Monz Launchpad v1 • Presets schema v1 • Bulk launcher v1
      </footer>
    </main>
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
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    setRenameValue(activePreset?.name ?? "");
    setRenaming(false);
  }, [activePresetId, activePreset?.name]);

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
      | "carouselPrimaryTexts"
      | "carouselHeadlines"
      | "carouselDescriptions",
    index: number,
    value: string,
  ) {
    if (!activePreset) return;
    const next = [...activePreset[field]];
    next[index] = value;
    updatePresetField(activePreset.id, field, next);
  }

  function removeField(
    field:
      | "headlines"
      | "primaryTexts"
      | "descriptions"
      | "carouselPrimaryTexts"
      | "carouselHeadlines"
      | "carouselDescriptions",
    index: number,
  ) {
    if (!activePreset) return;
    const next = activePreset[field].filter((_, i) => i !== index);
    updatePresetField(activePreset.id, field, next);
  }

  function addField(
    field:
      | "headlines"
      | "primaryTexts"
      | "descriptions"
      | "carouselPrimaryTexts"
      | "carouselHeadlines"
      | "carouselDescriptions",
  ) {
    if (!activePreset) return;
    if (activePreset[field].length >= 5) return;
    updatePresetField(activePreset.id, field, [...activePreset[field], ""]);
  }

  function renderSection(
    title: string,
    field: "headlines" | "primaryTexts" | "descriptions" | "carouselHeadlines" | "carouselDescriptions",
    items: string[],
    opts?: { multiline?: boolean },
  ) {
    return (
      <div className="card">
        <h3>{title}</h3>
        <p className="subdued">Max 5. Allowed vars: {allowedVariables().map((v) => `{{${v}}}`).join(', ')}</p>
        <div className="list">
          {items.map((text, idx) => {
            const unknowns = findUnknownVariables(text);
            return (
              <div key={`${field}-${idx}`} className="list-item" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  {opts?.multiline ? (
                    <textarea
                      className="multiline"
                      rows={3}
                      value={text}
                      onChange={(e) => updateField(field, idx, e.target.value)}
                      placeholder={`Enter ${title.toLowerCase().slice(0, -1)}`}
                    />
                  ) : (
                    <input
                      value={text}
                      onChange={(e) => updateField(field, idx, e.target.value)}
                      placeholder={`Enter ${title.toLowerCase().slice(0, -1)}`}
                    />
                  )}
                  <div className="mini">
                    {text.length} chars {unknowns.length ? `• Unknown: ${unknowns.join(', ')}` : ''}
                  </div>
                </div>
                <button
                  className="danger"
                  onClick={() => removeField(field, idx)}
                  disabled={items.length === 0}
                  style={{ height: 38 }}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={() => addField(field)} disabled={items.length >= 5}>
          Add {title.slice(0, -1)}
        </button>
      </div>
    );
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
    <div className="presets-layout gap-lg">
      <section className="card">
        <h2>Presets</h2>
        <p className="subdued">Manage copy presets for headlines, primary texts, and descriptions.</p>
        {activePresetUsedInBulk && (
          <div className="status" style={{ marginBottom: 8 }}>
            Warning: This preset is referenced by Bulk Launch. Edits apply immediately.
          </div>
        )}
        <div className="list preset-list">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="list-item"
              style={{
                borderColor: preset.id === activePresetId ? "var(--accent)" : undefined,
                cursor: "pointer",
                minWidth: 180,
                maxWidth: 220,
                flex: "0 0 auto",
              }}
              onClick={() => setActivePreset(preset.id)}
            >
              <div className="item-meta">
                <strong>{preset.name}</strong>
              </div>
            </div>
          ))}
        </div>
        <div className="inline" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={() => addPreset()}>Add preset</button>
          {!renaming && (
            <button onClick={() => setRenaming(true)} disabled={!activePreset}>
              Rename
            </button>
          )}
          {renaming && (
            <>
              <button
                className="primary"
                onClick={() => {
                  renamePreset(activePresetId, renameValue || "Untitled");
                  setRenaming(false);
                }}
                disabled={!activePreset}
              >
                Save
              </button>
              <button className="danger" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <input
                style={{ marginTop: 0, maxWidth: 220 }}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Preset name"
              />
            </>
          )}
          <button onClick={() => deletePreset(activePresetId)} disabled={presets.length === 1}>
            Delete
          </button>
        </div>
      </section>

      <div className="grid gap-lg" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <section className="card">
          <h2>Copy blocks</h2>
          {!activePreset && <div className="mini">No preset selected.</div>}
          {activePreset && (
            <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
              {renderSection("Headlines", "headlines", activePreset.headlines)}
              {renderSection("Primary Texts", "primaryTexts", activePreset.primaryTexts, { multiline: true })}
              {renderSection("Descriptions", "descriptions", activePreset.descriptions)}
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {renderSection("Carousel Card Headlines", "carouselHeadlines", activePreset.carouselHeadlines || [])}
                {renderSection(
                  "Carousel Card Descriptions",
                  "carouselDescriptions",
                  activePreset.carouselDescriptions || [],
                )}
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Live preview</h2>
          <p className="subdued">Variables resolve from Launch tab values.</p>
          {!activePreset && <div className="mini">Select a preset to preview.</div>}
          {activePreset && (
            <div className="preview-list">
              <div className="preview-row">
                <h4>Headlines</h4>
                {resolvedPreview(activePreset.headlines).map((h, idx) => (
                  <div key={`h-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ''}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Primary Texts</h4>
                {resolvedPreview(activePreset.primaryTexts).map((h, idx) => (
                  <div
                    key={`p-${idx}`}
                    className="mini block-line"
                    style={{ color: h.error ? "#f97316" : undefined, whiteSpace: "pre-wrap" }}
                  >
                    {h.text} {h.error ? `(${h.error})` : ''}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Descriptions</h4>
                {resolvedPreview(activePreset.descriptions).map((h, idx) => (
                  <div key={`d-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ''}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Carousel Cards</h4>
                <div className="mini">Headlines</div>
                {resolvedPreview(activePreset.carouselHeadlines || []).map((h, idx) => (
                  <div key={`ch-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ''}
                  </div>
                ))}
                <div className="mini" style={{ marginTop: 6 }}>Descriptions</div>
                {resolvedPreview(activePreset.carouselDescriptions || []).map((h, idx) => (
                  <div key={`cd-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <button className="floating-save" onClick={() => saveCopyPresets(presets)}>
        Save Presets
      </button>
    </div>
  );
}

type BulkLaunchTabProps = {
  bulkGlobal: BulkGlobalConfig;
  setBulkGlobal: React.Dispatch<React.SetStateAction<BulkGlobalConfig>>;
  campaigns: BulkCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<BulkCampaign[]>>;
  presets: CopyPreset[];
  logs: string[];
  accountId?: string;
  setConfirmModal: React.Dispatch<
    | {
        mode: "single" | "bulk";
        entries: { id?: string; campaignName: string; preset: string; productUrl: string; folderPath: string; status: string }[];
        onConfirm: () => Promise<void> | void;
      }
    | null
  >;
  setSuccessModal: React.Dispatch<
    | {
        title: string;
        entries: { name: string; adsets: number; ads: number }[];
        durationSec: number;
        timeSavedMin: number;
      }
    | null
  >;
};

function BulkLaunchTab({
  bulkGlobal,
  setBulkGlobal,
  campaigns,
  setCampaigns,
  presets,
  logs,
  accountId,
  setConfirmModal,
  setSuccessModal,
}: BulkLaunchTabProps) {
  const defaultPresetId = presets[0]?.id ?? "";

  useEffect(() => {
    if (!bulkGlobal.presetId.value && defaultPresetId) {
      setBulkGlobal((prev) => ({ ...prev, presetId: { ...prev.presetId, value: defaultPresetId } }));
    }
  }, [defaultPresetId, bulkGlobal.presetId.value, setBulkGlobal]);

  const unlockedFields = useMemo(
    () => Object.entries(bulkGlobal).filter(([, v]) => v && v.locked === false).map(([k]) => k),
    [bulkGlobal],
  );

  const resolveField = (campaign: BulkCampaign, field: keyof BulkGlobalConfig) =>
    bulkGlobal[field].locked ? bulkGlobal[field].value : campaign.overrides[field] ?? "";

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


type SettingsTabProps = {
  settings: MetaSettings | null;
  onSave: (settings: MetaSettings) => Promise<void>;
};

function SettingsTab({ settings, onSave }: SettingsTabProps) {
  const [form, setForm] = useState<MetaSettings>(
    settings || { accessToken: "", adAccountId: "", pageId: "", instagramUserId: "", pixelId: "" },
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const allFilled =
    form.accessToken.trim() &&
    form.adAccountId.trim() &&
    form.pageId.trim() &&
    form.instagramUserId.trim() &&
    form.pixelId.trim();

  async function handleSave() {
    if (!allFilled) {
      setStatus("All fields are required.");
      return;
    }
    setSaving(true);
    setStatus(null);
    await onSave({ ...form });
    setStatus("Saved locally.");
    setSaving(false);
  }

  async function testConnection() {
    if (!form.accessToken.trim()) {
      setStatus("Access token required to test.");
      return;
    }
    setTesting(true);
    setStatus("Testing connection…");
    try {
      const token = form.accessToken.trim();
      const accountId = form.adAccountId.replace(/^act_/, "");
      const meResp = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`);
      if (!meResp.ok) {
        throw new Error(`Token invalid (${meResp.status})`);
      }
      const actResp = await fetch(`https://graph.facebook.com/v19.0/act_${accountId}?access_token=${token}`);
      if (!actResp.ok) {
        throw new Error(`Cannot access ad account act_${accountId} (${actResp.status})`);
      }
      setStatus("Connection OK: token valid and ad account accessible.");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 16 }}>
      <section className="card">
        <h2>Meta account settings</h2>
        <p className="subdued">Stored locally via Tauri. Required before launching campaigns.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <label>
            Meta Access Token
            <input
              value={form.accessToken}
              onChange={(e) => setForm((prev) => ({ ...prev, accessToken: e.target.value }))}
              placeholder="EAAC..."
            />
          </label>
          <label>
            Ad Account ID
            <input
              value={form.adAccountId}
              onChange={(e) => setForm((prev) => ({ ...prev, adAccountId: e.target.value }))}
              placeholder="act_1234567890"
            />
          </label>
          <label>
            Page ID
            <input
              value={form.pageId}
              onChange={(e) => setForm((prev) => ({ ...prev, pageId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label>
            Instagram User ID
            <input
              value={form.instagramUserId}
              onChange={(e) => setForm((prev) => ({ ...prev, instagramUserId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
          <label>
            Pixel ID
            <input
              value={form.pixelId}
              onChange={(e) => setForm((prev) => ({ ...prev, pixelId: e.target.value }))}
              placeholder="1234567890"
            />
          </label>
        </div>
        <div className="inline" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={testConnection} disabled={testing || !form.accessToken}>
            {testing ? "Testing..." : "Test connection"}
          </button>
          {status && <span className="mini">{status}</span>}
        </div>
      </section>
    </div>
  );
}

  async function pickGlobalFolder() {
    const folder = await pickFolder();
    if (folder) {
      updateGlobal("folderPath", folder);
    }
  }

  async function pickCampaignFolder(id: string) {
    const folder = await pickFolder();
    if (folder) {
      updateCampaign(id, "folderPath", folder);
    }
  }

  function addCampaign() {
    setCampaigns((prev) => [...prev, { id: crypto.randomUUID(), overrides: {}, status: "pending" }]);
  }

  function removeCampaign(id: string) {
    setCampaigns((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  }

  async function launchAll() {
    if (!presets.length) return;
    const presetMap = Object.fromEntries(presets.map((p) => [p.id, p]));
    const errors: Record<string, string> = {};

    const started = performance.now();

    const payloads = campaigns.map((c) => {
      const folderPath = resolveField(c, "folderPath");
      const productUrl = resolveField(c, "productUrl");
      const productName = resolveField(c, "productName") || "";
      const brandName = resolveField(c, "brandName") || "";
      const country = resolveField(c, "country") || "CA";
      const presetId = resolveField(c, "presetId") || defaultPresetId;
      const dailyBudget = Number(resolveField(c, "dailyBudget") || 0);
      const scheduleTime = resolveField(c, "scheduleTime") || "";
      const campaignActive = resolveField(c, "campaignActive");

      if (!folderPath || !productUrl) {
        errors[c.id] = "Folder path and product URL are required.";
      }
      const preset = presetMap[presetId];
      if (!preset) {
        errors[c.id] = "Preset not found.";
      } else if (preset.headlines.length === 0 && preset.primaryTexts.length === 0) {
        errors[c.id] = "Preset missing headline/primary text.";
      }

      return {
        id: c.id,
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
      };
    });

    if (Object.keys(errors).length) {
      setCampaigns((prev) =>
        prev.map((c) => (errors[c.id] ? { ...c, status: "error", error: errors[c.id] } : c)),
      );
      return;
    }

    const bulkRunning = campaigns.some((c) => c.status === "running");
    if (bulkRunning) return;

    setConfirmModal({
      mode: "bulk",
      entries: payloads.map((p, idx) => ({
        id: p.id,
        campaignName: p.payload.productName || `Campaign ${idx + 1}`,
        preset: (p.payload.preset as CopyPreset)?.name || "Unknown",
        productUrl: p.payload.productUrl,
        folderPath: p.payload.folderPath,
        status: p.payload.campaignActive ? "Active" : "Paused",
      })),
      onConfirm: async () => {
        const summaries: { name: string; adsets: number; ads: number }[] = [];
        for (const item of payloads) {
          setCampaigns((prev) => prev.map((c) => (c.id === item.id ? { ...c, status: "running", error: undefined } : c)));
          try {
            const result = await runLaunch(item.payload as any);
            if ((result as any)?.campaigns) {
              summaries.push(
                ...(result as any).campaigns.map((c: any) => ({
                  name: c.campaign_name,
                  adsets: c.adsets.length,
                  ads: c.adsets.reduce((acc: number, a: any) => acc + a.ads_created, 0),
                })),
              );
            } else {
              summaries.push({ name: item.payload.productName || "Campaign", adsets: 1, ads: 1 });
            }
            setCampaigns((prev) => prev.map((c) => (c.id === item.id ? { ...c, status: "success" } : c)));
          } catch (err) {
            setCampaigns((prev) =>
              prev.map((c) => (c.id === item.id ? { ...c, status: "error", error: String(err) } : c)),
            );
          }
        }
        const durationSec = Math.max(1, Math.round((performance.now() - started) / 1000));
        const totalAds = summaries.reduce((acc, s) => acc + s.ads, 0);
        const timeSavedMin = Math.max(1, Math.round((totalAds || 1) * 2));
        setSuccessModal({
          title: "Bulk launch completed",
          entries: summaries,
          durationSec,
          timeSavedMin,
        });
        setConfirmModal(null);
      },
    });
  }

  if (!presets || presets.length === 0) {
    return (
      <section className="card">
        <h2>Bulk Launch</h2>
        <div className="mini">No presets loaded. Add one in the Presets tab first.</div>
      </section>
    );
  }

  return (
    <div className="grid gap-lg" style={{ gridTemplateColumns: "1fr", rowGap: 16 }}>
      <section className="card" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="mini">Bulk Launch</div>
            <strong>
              {presets.length} preset{presets.length === 1 ? "" : "s"} • {campaigns.length} campaign
              {campaigns.length === 1 ? "" : "s"}
            </strong>
          </div>
          <div className="mini">Default preset: {defaultPresetId || "none"}</div>
        </div>
      </section>

      <section className="card">
        <h2>Global Settings</h2>
        <p className="subdued">Locked fields apply to every campaign; unlock to override per row.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          {(Object.keys(bulkGlobal) as (keyof BulkGlobalConfig)[]).map((field) => (
            <label key={field} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span style={{ textTransform: "capitalize" }}>{field}</span>
                <button type="button" onClick={() => toggleLock(field)}>
                  {bulkGlobal[field].locked ? "🔒" : "🔓"}
                </button>
              </div>
              {field === "presetId" ? (
                <select
                  value={bulkGlobal.presetId.value || defaultPresetId}
                  onChange={(e) => updateGlobal("presetId", e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : field === "country" ? (
                <select value={bulkGlobal.country.value} onChange={(e) => updateGlobal("country", e.target.value)}>
                  <option value="CA">Canada (CA)</option>
                  <option value="US">United States (US)</option>
                  <option value="GB">United Kingdom (GB)</option>
                </select>
              ) : field === "campaignActive" ? (
                <div className="inline" style={{ gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className={`toggle ${bulkGlobal.campaignActive.value ? "on" : "off"}`}
                    onClick={() => updateGlobal("campaignActive", !bulkGlobal.campaignActive.value)}
                    aria-pressed={bulkGlobal.campaignActive.value}
                  />
                  <span className="mini">
                    {bulkGlobal.campaignActive.value ? "Active on create" : "Paused on create"}
                  </span>
                </div>
              ) : field === "scheduleTime" ? (
                <input
                  type="datetime-local"
                  value={bulkGlobal.scheduleTime.value}
                  onChange={(e) => updateGlobal("scheduleTime", e.target.value)}
                />
              ) : field === "dailyBudget" ? (
                <input
                  type="number"
                  value={bulkGlobal.dailyBudget.value}
                  onChange={(e) => updateGlobal("dailyBudget", Number(e.target.value))}
                />
              ) : (
                <div className="inline" style={{ gap: 8 }}>
                  <input
                    value={bulkGlobal[field].value}
                    onChange={(e) => updateGlobal(field, e.target.value)}
                    readOnly={field === "folderPath"}
                    placeholder={field === "folderPath" ? "Pick a folder" : ""}
                  />
                  {field === "folderPath" && (
                    <button type="button" onClick={pickGlobalFolder}>
                      Pick
                    </button>
                  )}
                </div>
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="inline" style={{ justifyContent: "space-between" }}>
          <h2>Campaigns</h2>
          <button onClick={addCampaign}>+ Add Campaign</button>
        </div>
        <div className="list" style={{ gap: 14 }}>
          {campaigns.map((c, idx) => (
            <div key={c.id} className="card" style={{ borderColor: c.status === "error" ? "#f43f5e" : undefined }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <strong>Campaign {idx + 1}</strong>
                <div className="inline" style={{ gap: 8 }}>
                  <span className={`status ${c.status !== "pending" ? c.status : ""}`}>
                    {c.status.toUpperCase()}
                    {c.error ? ` — ${c.error}` : ''}
                  </span>
                  {campaigns.length > 1 && (
                    <button className="danger" onClick={() => removeCampaign(c.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {unlockedFields.includes("country") && (
                  <label>
                    Country
                    <select
                      value={c.overrides.country || ""}
                      onChange={(e) => updateCampaign(c.id, "country", e.target.value)}
                    >
                      <option value="">Select country</option>
                      <option value="CA">Canada (CA)</option>
                      <option value="US">United States (US)</option>
                      <option value="GB">United Kingdom (GB)</option>
                    </select>
                  </label>
                )}
                {unlockedFields.includes("productName") && (
                  <label>
                    Product name
                    <input
                      value={c.overrides.productName || ""}
                      onChange={(e) => updateCampaign(c.id, "productName", e.target.value)}
                    />
                  </label>
                )}
                {unlockedFields.includes("brandName") && (
                  <label>
                    Brand name
                    <input
                      value={c.overrides.brandName || ""}
                      onChange={(e) => updateCampaign(c.id, "brandName", e.target.value)}
                    />
                  </label>
                )}
                {unlockedFields.includes("productUrl") && (
                  <label>
                    Product URL
                    <input
                      value={c.overrides.productUrl || ""}
                      onChange={(e) => updateCampaign(c.id, "productUrl", e.target.value)}
                    />
                  </label>
                )}
                {unlockedFields.includes("folderPath") && (
                  <label>
                    Media folder
                    <div className="inline" style={{ gap: 8 }}>
                      <input
                        value={c.overrides.folderPath || ""}
                        readOnly
                        placeholder="Pick campaign folder"
                      />
                      <button type="button" onClick={() => pickCampaignFolder(c.id)}>
                        Pick
                      </button>
                    </div>
                  </label>
                )}
                {unlockedFields.includes("presetId") && (
                  <label>
                    Preset
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
                  </label>
                )}
                {unlockedFields.includes("campaignActive") && (
                  <label>
                    Campaign status
                    <div className="inline" style={{ gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className={`toggle ${c.overrides.campaignActive ?? bulkGlobal.campaignActive.value ? "on" : "off"}`}
                        onClick={() =>
                          updateCampaign(
                            c.id,
                            "campaignActive",
                            !(c.overrides.campaignActive ?? bulkGlobal.campaignActive.value),
                          )
                        }
                        aria-pressed={c.overrides.campaignActive ?? bulkGlobal.campaignActive.value}
                      />
                      <span className="mini">
                        {(c.overrides.campaignActive ?? bulkGlobal.campaignActive.value)
                          ? "Active on create"
                          : "Paused on create"}
                      </span>
                    </div>
                  </label>
                )}
                {unlockedFields.includes("scheduleTime") && (
                  <label>
                    Schedule
                    <input
                      type="datetime-local"
                      value={c.overrides.scheduleTime || ""}
                      onChange={(e) => updateCampaign(c.id, "scheduleTime", e.target.value)}
                    />
                  </label>
                )}
                {unlockedFields.includes("dailyBudget") && (
                  <label>
                    Budget
                    <input
                      type="number"
                      value={c.overrides.dailyBudget ?? ""}
                      onChange={(e) => updateCampaign(c.id, "dailyBudget", Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="inline" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="primary" onClick={launchAll} disabled={campaigns.length === 0}>
            Launch All
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Live execution (Bulk)</h2>
        <p className="subdued">Streaming stdout/stderr from the Python backend.</p>
        <div className="logs">
          {logs.length === 0 && <div className="mini">No logs yet.</div>}
          <div className="inline" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              onClick={() => navigator.clipboard?.writeText(logs.join("\n"))}
              disabled={logs.length === 0}
            >
              Copy logs
            </button>
          </div>
          {logs.map((line, idx) => (
            <div key={`bulk-log-${idx}`}>{line}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
