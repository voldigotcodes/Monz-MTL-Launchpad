"use client";

import { useEffect, useRef, useState } from "react";
import { useCopyPresets } from "../../components/copy-presets/CopyPresetsContext";
import { createLaunchJob, createUpload, fetchAdsets, fetchCampaigns, fetchPreview, pollLaunchJob } from "../../lib/backend";
import type { AddMode, CampaignSummary, LaunchJobPollResponse, LaunchType, PreviewData, ScheduleMode } from "../../lib/types";
import { allowedVariables } from "../../lib/vars";

function toIsoWithOffset(input: string): string {
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) throw new Error("Invalid datetime");
  const offset = -dt.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (v: number) => String(Math.abs(Math.trunc(v))).padStart(2, "0");
  const hours = pad(offset / 60);
  const minutes = pad(offset % 60);
  const datePart = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const timePart = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  return `${datePart}T${timePart}${sign}${hours}:${minutes}`;
}

type FormState = {
  launchType: LaunchType;
  addMode: AddMode;
  existingCampaignId: string;
  targetAdsetIds: string[];
  country: string;
  productUrl: string;
  productName: string;
  brandName: string;
  dailyBudget: number;
  campaignActive: boolean;
  scheduleMode: ScheduleMode;
  scheduleTime: string;
  multiAdvertiserAds: boolean;
};

const defaultForm: FormState = {
  launchType: "new_campaign",
  addMode: "creatives_only",
  existingCampaignId: "",
  targetAdsetIds: [],
  country: "CA",
  productUrl: "",
  productName: "",
  brandName: "",
  dailyBudget: 80,
  campaignActive: false,
  scheduleMode: "now",
  scheduleTime: "",
  multiAdvertiserAds: false,
};

type UploadMode = "folder" | "files" | "zip";

export function LaunchClient() {
  const copy = useCopyPresets();
  const activePreset = copy.presets.find((p) => p.id === copy.activePresetId) || copy.presets[0] || null;

  const [form, setForm] = useState<FormState>(defaultForm);
  const [uploadMode, setUploadMode] = useState<UploadMode>("folder");
  const [dragActive, setDragActive] = useState(false);
  const [uploadId, setUploadId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [adsets, setAdsets] = useState<{ id: string; name: string; status?: string }[]>([]);
  const [adsetsLoading, setAdsetsLoading] = useState(false);

  const [jobId, setJobId] = useState<string>("");
  const [job, setJob] = useState<LaunchJobPollResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [after, setAfter] = useState(0);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const isExisting = form.launchType === "existing_campaign";
  const needsCampaign = isExisting;
  const needsAdsets = isExisting && form.addMode === "creatives_only";

  const canLaunch = Boolean(
    uploadId &&
      activePreset &&
      form.productUrl.trim() &&
      (!needsCampaign || form.existingCampaignId) &&
      (!needsAdsets || form.targetAdsetIds.length > 0),
  );

  useEffect(() => {
    if (!isExisting) return;
    setCampaignsLoading(true);
    fetchCampaigns()
      .then((data) => setCampaigns(data))
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false));
  }, [isExisting]);

  useEffect(() => {
    if (!isExisting || !form.existingCampaignId) {
      setAdsets([]);
      return;
    }
    setAdsetsLoading(true);
    fetchAdsets(form.existingCampaignId)
      .then((data) => setAdsets(data))
      .catch(() => setAdsets([]))
      .finally(() => setAdsetsLoading(false));
  }, [isExisting, form.existingCampaignId]);

  useEffect(() => {
    if (!jobId) return;
    if (job?.status === "success" || job?.status === "error") return;

    const t = window.setInterval(() => {
      pollLaunchJob(jobId, after)
        .then((next) => {
          if (next.logs.length) setLogs((prev) => [...prev, ...next.logs]);
          setAfter(next.next_after);
          setJob(next);
        })
        .catch((e) => {
          setJob((prev) => (prev ? { ...prev, status: "error", error: String(e?.message || e) } : prev));
        });
    }, 1000);
    return () => window.clearInterval(t);
  }, [after, job?.status, jobId]);

  async function refreshPreview(nextUploadId: string) {
    try {
      const p = await fetchPreview(nextUploadId, form.country);
      setPreview(p);
    } catch {
      setPreview(null);
    }
  }

  async function handleUpload(mode: UploadMode, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setPreview(null);

    const formData = new FormData();
    if (mode === "zip") {
      formData.append("zip", files[0]);
    } else {
      const list = Array.from(files);
      for (const f of list) {
        const withPath = f as File & { webkitRelativePath?: string };
        const filename = withPath.webkitRelativePath && withPath.webkitRelativePath.length ? withPath.webkitRelativePath : f.name;
        formData.append("files", f, filename);
      }
    }

    try {
      const { upload_id } = await createUpload(formData);
      setUploadId(upload_id);
      await refreshPreview(upload_id);
    } catch (e: any) {
      setUploadId("");
      setPreview(null);
      setUploadError(String(e?.message || e));
    }
  }

  async function onLaunch() {
    if (!activePreset) return;
    if (!canLaunch) return;
    const scheduledIso =
      form.scheduleMode === "later" ? toIsoWithOffset(form.scheduleTime) : undefined;

    const summary = [
      `Mode: ${form.launchType === "new_campaign" ? "New campaign" : "Existing campaign"}`,
      `Country: ${form.country}`,
      `Budget: ${form.dailyBudget}`,
      `Status: ${form.campaignActive ? "ACTIVE" : "PAUSED"}`,
      `Preset: ${activePreset.name}`,
    ].join("\n");
    // Minimal confirmation (v1). Replace with a modal once workflows stabilize.
    if (!window.confirm(summary)) return;

    setLogs([]);
    setAfter(0);
    setJob(null);
    const payload = {
      uploadId,
      productUrl: form.productUrl,
      productName: form.productName,
      brandName: form.brandName,
      country: form.country,
      dailyBudget: form.dailyBudget,
      campaignActive: form.campaignActive,
      scheduleMode: form.scheduleMode,
      scheduleTime: scheduledIso,
      preset: activePreset,
      launchType: form.launchType,
      addMode: form.addMode,
      campaignId: form.existingCampaignId || null,
      targetAdsetIds: form.targetAdsetIds,
      multiAdvertiserAds: form.multiAdvertiserAds,
    };
    const { job_id } = await createLaunchJob(payload);
    setJobId(job_id);
  }

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <h2>Launch</h2>
          <p>Upload media, review preview, launch via backend.</p>
        </div>
        <div className="status">Vars: {allowedVariables().map((v) => `{{${v}}}`).join(", ")}</div>
      </header>

      <div className="row2">
        <section className="panel">
          <div className="panel-head">
            <strong>Configuration</strong>
          </div>
          <div className="panel-body">
            <div className="field">
              <label>Launch type</label>
              <select
                value={form.launchType}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    launchType: e.target.value as LaunchType,
                    existingCampaignId: "",
                    targetAdsetIds: [],
                  }))
                }
              >
                <option value="new_campaign">New campaign(s) from folder</option>
                <option value="existing_campaign">Add to existing campaign</option>
              </select>
            </div>

            {isExisting && (
              <>
                <div className="field">
                  <label>Existing campaign</label>
                  <select
                    value={form.existingCampaignId}
                    onChange={(e) => setForm((p) => ({ ...p, existingCampaignId: e.target.value, targetAdsetIds: [] }))}
                    disabled={campaignsLoading}
                  >
                    <option value="">{campaignsLoading ? "Loading…" : "Select a campaign"}</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.status ? `(${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="hint">Loaded from backend (Meta token stays server-side).</div>
                </div>

                <div className="field">
                  <label>Add mode</label>
                  <select
                    value={form.addMode}
                    onChange={(e) => setForm((p) => ({ ...p, addMode: e.target.value as AddMode, targetAdsetIds: [] }))}
                  >
                    <option value="creatives_only">Creatives only</option>
                    <option value="adsets_and_creatives">Ad sets + creatives</option>
                  </select>
                </div>

                {form.addMode === "creatives_only" && (
                  <div className="field">
                    <label>Target ad sets (required)</label>
                    <select
                      multiple
                      size={Math.min(8, Math.max(4, adsets.length || 4))}
                      value={form.targetAdsetIds}
                      onChange={(e) => {
                        const options = Array.from(e.target.selectedOptions).map((o) => o.value).filter(Boolean);
                        setForm((p) => ({ ...p, targetAdsetIds: options }));
                      }}
                      disabled={!form.existingCampaignId || adsetsLoading}
                    >
                      {adsets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} {a.status ? `(${a.status})` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="hint">Pick at least one ad set.</div>
                  </div>
                )}
              </>
            )}

            <div className="field">
              <label>Product URL *</label>
              <input value={form.productUrl} onChange={(e) => setForm((p) => ({ ...p, productUrl: e.target.value }))} />
            </div>

            <div className="row2">
              <div className="field">
                <label>Product name</label>
                <input value={form.productName} onChange={(e) => setForm((p) => ({ ...p, productName: e.target.value }))} />
              </div>
              <div className="field">
                <label>Brand name</label>
                <input value={form.brandName} onChange={(e) => setForm((p) => ({ ...p, brandName: e.target.value }))} />
              </div>
            </div>

            <div className="row2">
              <div className="field">
                <label>Country</label>
                <select value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}>
                  <option value="CA">Canada (CA)</option>
                  <option value="US">United States (US)</option>
                  <option value="GB">United Kingdom (GB)</option>
                </select>
              </div>
              <div className="field">
                <label>Daily budget</label>
                <input
                  type="number"
                  min={1}
                  value={form.dailyBudget}
                  onChange={(e) => setForm((p) => ({ ...p, dailyBudget: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="row2">
              <div className="field">
                <label>Campaign status on create</label>
                <select
                  value={form.campaignActive ? "ACTIVE" : "PAUSED"}
                  onChange={(e) => setForm((p) => ({ ...p, campaignActive: e.target.value === "ACTIVE" }))}
                >
                  <option value="PAUSED">Paused</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </div>
              <div className="field">
                <label>Multi-advertiser ads</label>
                <select
                  value={form.multiAdvertiserAds ? "on" : "off"}
                  onChange={(e) => setForm((p) => ({ ...p, multiAdvertiserAds: e.target.value === "on" }))}
                >
                  <option value="off">Off</option>
                  <option value="on">On</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>Schedule</label>
              <div className="row2">
                <select
                  value={form.scheduleMode}
                  onChange={(e) => setForm((p) => ({ ...p, scheduleMode: e.target.value as ScheduleMode }))}
                >
                  <option value="now">Launch now</option>
                  <option value="later">Schedule</option>
                </select>
                <input
                  type="datetime-local"
                  value={form.scheduleTime}
                  onChange={(e) => setForm((p) => ({ ...p, scheduleTime: e.target.value }))}
                  disabled={form.scheduleMode !== "later"}
                />
              </div>
              <div className="hint">Scheduling uses your local timezone and is sent with offset.</div>
            </div>

            <div className="field">
              <label>Copy preset</label>
              <select value={copy.activePresetId} onChange={(e) => copy.setActivePreset(e.target.value)}>
                {copy.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="hint">Edit presets in the Presets tab.</div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <strong>Upload & preview</strong>
          </div>
          <div className="panel-body">
            <div className="field">
              <label>Upload mode</label>
              <select value={uploadMode} onChange={(e) => setUploadMode(e.target.value as UploadMode)}>
                <option value="folder">Folder</option>
                <option value="files">Files</option>
                <option value="zip">ZIP</option>
              </select>
              <div className="hint">
                Folder preserves structure (recommended). ZIP is useful for sharing. Files is OK for “creatives only”.
              </div>
            </div>

            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory="true"
              multiple
              hidden
              onChange={(e) => handleUpload("folder", e.target.files)}
            />
            <input
              ref={filesInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => handleUpload("files", e.target.files)}
            />
            <input ref={zipInputRef} type="file" accept=".zip" hidden onChange={(e) => handleUpload("zip", e.target.files)} />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setUploadError(null);
                  if (uploadMode === "folder") folderInputRef.current?.click();
                  if (uploadMode === "files") filesInputRef.current?.click();
                  if (uploadMode === "zip") zipInputRef.current?.click();
                }}
              >
                Select {uploadMode}
              </button>
              {uploadId && <span className="status ok">Upload: {uploadId.slice(0, 8)}…</span>}
              <button
                className="btn"
                type="button"
                disabled={!uploadId}
                onClick={() => uploadId && refreshPreview(uploadId)}
              >
                Refresh preview
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;
                const first = files[0];
                const isZip = files.length === 1 && first?.name?.toLowerCase().endsWith(".zip");
                handleUpload(isZip ? "zip" : "files", files);
              }}
              style={{
                marginTop: 12,
                padding: 14,
                borderRadius: 12,
                border: "1px dashed var(--line)",
                background: dragActive ? "rgba(96, 165, 250, 0.08)" : "rgba(3, 7, 18, 0.22)",
              }}
            >
              <div style={{ fontSize: 13 }}>Drag & drop files here</div>
              <div className="hint">Drop a single .zip, or one/more creative files. Folder structure requires Folder upload.</div>
            </div>

            {uploadError && (
              <div className="hint" style={{ color: "var(--danger)", marginTop: 10 }}>
                {uploadError}
              </div>
            )}

            {preview && (
              <div style={{ marginTop: 14 }}>
                <div className="hint">
                  {preview.campaigns.length} campaign(s) • {preview.total_ads} ad(s) • {preview.media_summary.images} images •{" "}
                  {preview.media_summary.videos} videos
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {preview.campaigns.slice(0, 6).map((c) => (
                    <div key={c.name} className="hint">
                      <strong style={{ color: "var(--text)" }}>{c.name}</strong>
                      <div>
                        {c.adsets.length} ad set(s) • {c.adsets.reduce((acc, a) => acc + a.ads, 0)} ad(s)
                      </div>
                    </div>
                  ))}
                  {preview.campaigns.length > 6 && <div className="hint">…and {preview.campaigns.length - 6} more.</div>}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Run</strong>
          <button
            className="btn primary"
            type="button"
            onClick={onLaunch}
            disabled={!canLaunch || (!!jobId && job?.status !== "error" && job?.status !== "success")}
          >
            Launch
          </button>
        </div>
        <div className="panel-body">
          <div className="hint">
            This UI uploads files and sends configs only. All Meta logic and tokens stay in the backend.
          </div>
          {!canLaunch && (
            <div className="hint" style={{ color: "var(--muted)", marginTop: 10 }}>
              Required: upload + product URL{needsCampaign ? " + campaign" : ""}{needsAdsets ? " + ad sets" : ""}.
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Logs</strong>
          <span className={`status ${job?.status === "success" ? "ok" : job?.status === "error" ? "bad" : ""}`}>
            {job?.status || (jobId ? "running" : "idle")}
          </span>
        </div>
        <div className="panel-body">
          {!jobId && <div className="hint">No job yet.</div>}
          {job?.error && (
            <div className="hint" style={{ color: "var(--danger)", marginBottom: 10 }}>
              {job.error}
            </div>
          )}
          <div className="logbox">{logs.length ? logs.map((l, i) => <div key={`${i}-${l}`}>{l}</div>) : <div className="hint">No logs yet.</div>}</div>
          {job?.result && (
            <div style={{ marginTop: 12 }}>
              <div className="hint">
                Result: {job.result.ads_created} ad(s) • {job.result.campaigns?.length || 0} campaign(s)
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
