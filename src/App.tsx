import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchPreview, pickFolder, runLaunch } from "./lib/api";
import { loadHistory, loadPresets, saveHistory, savePresets } from "./lib/storage";
import { CopyPresetProvider, useCopyPresets } from "./context/CopyPresetsContext";
import { allowedVariables, findUnknownVariables, resolveVariables } from "./lib/vars";
import type {
  CopyPreset,
  HistoryEntry,
  LaunchFormState,
  LaunchResult,
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

function AppShell() {
  const [form, setForm] = useState<LaunchFormState>(defaultForm);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusState>({ state: "idle" });
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  const [presets, setPresets] = useState<Preset[]>(loadPresets());
  const [presetName, setPresetName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"launch" | "copy-presets">("launch");
  const copyCtx = useCopyPresets();

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
    setStatus({ state: "running", message: "Launching via Python backend..." });
    setLogs([]);

    const scheduledIso = form.scheduleMode === "later" ? toIsoWithOffset(form.scheduleTime) : undefined;
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
      ) : (
        <PresetsTab
          activePreset={activeCopyPreset}
          launchVars={{
            product_name: form.productName,
            product_url: form.productUrl,
            brand_name: form.brandName,
            country: form.country,
          }}
        />
      )}
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
};

function PresetsTab({ activePreset, launchVars }: PresetsTabProps) {
  const { presets, activePresetId, setActivePreset, addPreset, renamePreset, deletePreset, updatePresetField } =
    useCopyPresets();

  const [renameValue, setRenameValue] = useState(activePreset?.name ?? "");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    setRenameValue(activePreset?.name ?? "");
    setRenaming(false);
  }, [activePresetId]);

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
      <p className="subdued">Max 5. Allowed vars: {allowedVariables().map((v) => `{{${v}}}`).join(", ")}</p>
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
                {text.length} chars {unknowns.length ? `• Unknown: ${unknowns.join(", ")}` : ""}
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
                    {h.text} {h.error ? `(${h.error})` : ""}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Primary Texts</h4>
                {resolvedPreview(activePreset.primaryTexts).map((h, idx) => (
                  <div key={`p-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined, whiteSpace: "pre-wrap" }}>
                    {h.text} {h.error ? `(${h.error})` : ""}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Descriptions</h4>
                {resolvedPreview(activePreset.descriptions).map((h, idx) => (
                  <div key={`d-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ""}
                  </div>
                ))}
              </div>
              <div className="preview-row">
                <h4>Carousel Cards</h4>
                <div className="mini">Headlines</div>
                {resolvedPreview(activePreset.carouselHeadlines || []).map((h, idx) => (
                  <div key={`ch-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ""}
                  </div>
                ))}
                <div className="mini" style={{ marginTop: 6 }}>Descriptions</div>
                {resolvedPreview(activePreset.carouselDescriptions || []).map((h, idx) => (
                  <div key={`cd-${idx}`} className="mini block-line" style={{ color: h.error ? "#f97316" : undefined }}>
                    {h.text} {h.error ? `(${h.error})` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <button className="floating-save" onClick={() => saveCopyPresets(copyCtx.presets)}>
        Save Presets
      </button>
    </div>
  );
}
