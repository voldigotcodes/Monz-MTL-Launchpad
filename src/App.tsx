import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchPreview, pickFolder, runLaunch } from "./lib/api";
import { loadHistory, loadPresets, saveHistory, savePresets } from "./lib/storage";
import type {
  HistoryEntry,
  LaunchFormState,
  LaunchResult,
  Preset,
  PreviewData,
} from "./types";

const defaultForm: LaunchFormState = {
  folderPath: "",
  productName: "",
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
  const [form, setForm] = useState<LaunchFormState>(defaultForm);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusState>({ state: "idle" });
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  const [presets, setPresets] = useState<Preset[]>(loadPresets());
  const [presetName, setPresetName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

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

  async function handleLaunch() {
    if (!canLaunch) {
      captureError("Folder, product name, and product URL are required.");
      return;
    }
    setStatus({ state: "running", message: "Launching via Python backend..." });
    setLogs([]);

    const scheduledIso = form.scheduleMode === "later" ? toIsoWithOffset(form.scheduleTime) : undefined;
    try {
      const result: LaunchResult = await runLaunch({
        folderPath: form.folderPath,
        productName: form.productName,
        productUrl: form.productUrl,
        country: form.country,
        dailyBudget: form.dailyBudget,
        campaignActive: form.campaignActive,
        scheduleMode: form.scheduleMode,
        scheduleTime: scheduledIso,
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
    setForm({ ...preset.config });
    setStatus({ state: "idle", message: `Preset loaded: ${preset.name}` });
  }

  function useHistoryConfig(entry: HistoryEntry) {
    setForm({ ...entry.config });
    setStatus({ state: "idle", message: "Config loaded from history" });
  }

  return (
    <main>
      <div className="toolbar">
        <h1>Monz MTL Launchpad</h1>
        <span className="badge pill">Internal • Meta Ads CBO</span>
        <span className="badge">{scheduleLabel}</span>
      </div>
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
    </main>
  );
}
