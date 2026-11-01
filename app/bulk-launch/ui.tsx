"use client";

import { useMemo, useRef, useState } from "react";
import { useCopyPresets } from "../../components/copy-presets/CopyPresetsContext";
import { createLaunchJob, createUpload, pollLaunchJob } from "../../lib/backend";
import type { CopyPreset } from "../../lib/types";
import { allowedVariables } from "../../lib/vars";

type UploadMode = "folder" | "zip";

type GlobalField<T> = { value: T; locked: boolean };

type BulkGlobals = {
  country: GlobalField<string>;
  productUrl: GlobalField<string>;
  productName: GlobalField<string>;
  brandName: GlobalField<string>;
  dailyBudget: GlobalField<number>;
  campaignActive: GlobalField<boolean>;
  scheduleTime: GlobalField<string>;
  presetId: GlobalField<string>;
};

type BulkCard = {
  id: string;
  uploadId: string;
  overrides: Partial<{
    country: string;
    productUrl: string;
    productName: string;
    brandName: string;
    dailyBudget: number;
    campaignActive: boolean;
    scheduleTime: string;
    presetId: string;
  }>;
  status: "pending" | "running" | "success" | "error";
  error?: string;
};

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

function newCard(): BulkCard {
  return { id: crypto.randomUUID(), uploadId: "", overrides: {}, status: "pending" };
}

export function BulkLaunchClient() {
  const copy = useCopyPresets();
  const defaultPresetId = copy.presets[0]?.id || "";

  const [uploadMode, setUploadMode] = useState<UploadMode>("folder");
  const [globals, setGlobals] = useState<BulkGlobals>({
    country: { value: "CA", locked: true },
    productUrl: { value: "", locked: true },
    productName: { value: "", locked: true },
    brandName: { value: "", locked: true },
    dailyBudget: { value: 80, locked: true },
    campaignActive: { value: false, locked: true },
    scheduleTime: { value: "", locked: true },
    presetId: { value: defaultPresetId, locked: true },
  });
  const [cards, setCards] = useState<BulkCard[]>([newCard()]);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const folderInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const zipInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canRunAll = useMemo(() => {
    const presetOk = Boolean(globals.presetId.value || defaultPresetId);
    if (!presetOk) return false;
    return cards.every((c) => {
      const uploadOk = Boolean(c.uploadId);
      const url = globals.productUrl.locked ? globals.productUrl.value : c.overrides.productUrl || "";
      return uploadOk && Boolean(url.trim());
    });
  }, [cards, defaultPresetId, globals.productUrl.locked, globals.productUrl.value, globals.presetId.value]);

  function toggleLock(field: keyof BulkGlobals) {
    setGlobals((prev) => ({ ...prev, [field]: { ...prev[field], locked: !prev[field].locked } }));
  }

  function updateGlobal<K extends keyof BulkGlobals>(field: K, value: BulkGlobals[K]["value"]) {
    setGlobals((prev) => ({ ...prev, [field]: { ...prev[field], value } }));
  }

  function updateCard(id: string, patch: Partial<BulkCard>) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function updateOverride(id: string, key: keyof BulkCard["overrides"], value: any) {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, overrides: { ...c.overrides, [key]: value }, status: "pending", error: undefined } : c,
      ),
    );
  }

  async function handleUpload(id: string, mode: UploadMode, files: FileList | null) {
    if (!files || files.length === 0) return;
    updateCard(id, { error: undefined, status: "pending" });
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
      updateCard(id, { uploadId: upload_id });
    } catch (e: any) {
      updateCard(id, { uploadId: "", status: "error", error: String(e?.message || e) });
    }
  }

  function resolve<K extends keyof BulkGlobals>(field: K, card: BulkCard): BulkGlobals[K]["value"] {
    return globals[field].locked ? globals[field].value : ((card.overrides[field] as any) ?? globals[field].value);
  }

  async function runAll() {
    if (running) return;
    if (!canRunAll) return;
    setRunning(true);
    setLogs([]);

    const presetMap = Object.fromEntries(copy.presets.map((p) => [p.id, p])) as Record<string, CopyPreset>;
    const fallbackPreset = presetMap[globals.presetId.value] || presetMap[defaultPresetId];

    for (const card of cards) {
      updateCard(card.id, { status: "running", error: undefined });
      const scheduleLocal = resolve("scheduleTime", card);
      const scheduleTimeIso = scheduleLocal ? toIsoWithOffset(String(scheduleLocal)) : undefined;

      const presetId = String(resolve("presetId", card) || defaultPresetId);
      const preset = presetMap[presetId] || fallbackPreset;

      const payload = {
        uploadId: card.uploadId,
        productUrl: resolve("productUrl", card),
        productName: resolve("productName", card),
        brandName: resolve("brandName", card),
        country: resolve("country", card),
        dailyBudget: resolve("dailyBudget", card),
        campaignActive: resolve("campaignActive", card),
        scheduleMode: scheduleTimeIso ? "later" : "now",
        scheduleTime: scheduleTimeIso,
        preset,
        launchType: "new_campaign",
        addMode: "creatives_only",
      };

      try {
        const { job_id } = await createLaunchJob(payload);
        let after = 0;
        while (true) {
          const poll = await pollLaunchJob(job_id, after);
          after = poll.next_after;
          if (poll.logs.length) {
            setLogs((prev) => [...prev, ...poll.logs.map((l) => `[${card.id.slice(0, 4)}] ${l}`)]);
          }
          if (poll.status === "success") {
            updateCard(card.id, { status: "success" });
            break;
          }
          if (poll.status === "error") {
            updateCard(card.id, { status: "error", error: poll.error || "Launch failed" });
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (e: any) {
        updateCard(card.id, { status: "error", error: String(e?.message || e) });
      }
    }

    setRunning(false);
  }

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <h2>Bulk Launch</h2>
          <p>Queue multiple new-campaign launches. Runs sequentially (polling-only v1).</p>
        </div>
        <div className="status">Vars: {allowedVariables().map((v) => `{{${v}}}`).join(", ")}</div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <strong>Global defaults</strong>
          <div className="hint">Unlock a field to override per campaign card.</div>
        </div>
        <div className="panel-body">
          <div className="row2">
            <div className="field">
              <label>
                Country{" "}
                <button className="btn" type="button" onClick={() => toggleLock("country")}>
                  {globals.country.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <select value={globals.country.value} onChange={(e) => updateGlobal("country", e.target.value)}>
                <option value="CA">Canada (CA)</option>
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
              </select>
            </div>
            <div className="field">
              <label>
                Preset{" "}
                <button className="btn" type="button" onClick={() => toggleLock("presetId")}>
                  {globals.presetId.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <select value={globals.presetId.value} onChange={(e) => updateGlobal("presetId", e.target.value)}>
                {copy.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>
                Product URL{" "}
                <button className="btn" type="button" onClick={() => toggleLock("productUrl")}>
                  {globals.productUrl.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <input value={globals.productUrl.value} onChange={(e) => updateGlobal("productUrl", e.target.value)} />
            </div>
            <div className="field">
              <label>
                Product name{" "}
                <button className="btn" type="button" onClick={() => toggleLock("productName")}>
                  {globals.productName.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <input value={globals.productName.value} onChange={(e) => updateGlobal("productName", e.target.value)} />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>
                Brand name{" "}
                <button className="btn" type="button" onClick={() => toggleLock("brandName")}>
                  {globals.brandName.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <input value={globals.brandName.value} onChange={(e) => updateGlobal("brandName", e.target.value)} />
            </div>
            <div className="field">
              <label>
                Daily budget{" "}
                <button className="btn" type="button" onClick={() => toggleLock("dailyBudget")}>
                  {globals.dailyBudget.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <input
                type="number"
                min={1}
                value={globals.dailyBudget.value}
                onChange={(e) => updateGlobal("dailyBudget", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>
                Campaign status{" "}
                <button className="btn" type="button" onClick={() => toggleLock("campaignActive")}>
                  {globals.campaignActive.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <select
                value={globals.campaignActive.value ? "ACTIVE" : "PAUSED"}
                onChange={(e) => updateGlobal("campaignActive", e.target.value === "ACTIVE")}
              >
                <option value="PAUSED">Paused</option>
                <option value="ACTIVE">Active</option>
              </select>
            </div>
            <div className="field">
              <label>
                Schedule (optional){" "}
                <button className="btn" type="button" onClick={() => toggleLock("scheduleTime")}>
                  {globals.scheduleTime.locked ? "Locked" : "Unlocked"}
                </button>
              </label>
              <input value={globals.scheduleTime.value} onChange={(e) => updateGlobal("scheduleTime", e.target.value)} type="datetime-local" />
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Campaigns</strong>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={uploadMode} onChange={(e) => setUploadMode(e.target.value as UploadMode)}>
              <option value="folder">Folder upload</option>
              <option value="zip">ZIP upload</option>
            </select>
            <button className="btn" type="button" onClick={() => setCards((prev) => [...prev, newCard()])} disabled={running}>
              Add
            </button>
            <button className="btn primary" type="button" onClick={runAll} disabled={!canRunAll || running}>
              {running ? "Running…" : "Launch all"}
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="hint" style={{ marginBottom: 10 }}>
            Each card needs an upload + product URL. Fields can be locked globally above.
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {cards.map((c, idx) => (
              <div key={c.id} className="panel" style={{ boxShadow: "none" }}>
                <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Campaign {idx + 1}</strong>
                  <span className={`status ${c.status === "success" ? "ok" : c.status === "error" ? "bad" : ""}`}>{c.status}</span>
                </div>
                <div className="panel-body">
                  <input
                    ref={(el) => {
                      folderInputRefs.current[c.id] = el;
                    }}
                    type="file"
                    // @ts-expect-error webkitdirectory is non-standard but widely supported
                    webkitdirectory="true"
                    multiple
                    hidden
                    onChange={(e) => handleUpload(c.id, "folder", e.target.files)}
                  />
                  <input
                    ref={(el) => {
                      zipInputRefs.current[c.id] = el;
                    }}
                    type="file"
                    accept=".zip"
                    hidden
                    onChange={(e) => handleUpload(c.id, "zip", e.target.files)}
                  />

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        if (uploadMode === "folder") folderInputRefs.current[c.id]?.click();
                        if (uploadMode === "zip") zipInputRefs.current[c.id]?.click();
                      }}
                      disabled={running}
                    >
                      Select {uploadMode}
                    </button>
                    {c.uploadId && <span className="status ok">Upload: {c.uploadId.slice(0, 8)}…</span>}
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setCards((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== c.id) : prev))}
                      disabled={running || cards.length <= 1}
                    >
                      Remove
                    </button>
                  </div>

                  {c.error && (
                    <div className="hint" style={{ color: "var(--danger)", marginTop: 10 }}>
                      {c.error}
                    </div>
                  )}

                  {!globals.productUrl.locked && (
                    <div className="field" style={{ marginTop: 12 }}>
                      <label>Product URL *</label>
                      <input value={c.overrides.productUrl || ""} onChange={(e) => updateOverride(c.id, "productUrl", e.target.value)} />
                    </div>
                  )}

                  {!globals.productName.locked && (
                    <div className="field">
                      <label>Product name</label>
                      <input value={c.overrides.productName || ""} onChange={(e) => updateOverride(c.id, "productName", e.target.value)} />
                    </div>
                  )}

                  {!globals.brandName.locked && (
                    <div className="field">
                      <label>Brand name</label>
                      <input value={c.overrides.brandName || ""} onChange={(e) => updateOverride(c.id, "brandName", e.target.value)} />
                    </div>
                  )}

                  {!globals.country.locked && (
                    <div className="field">
                      <label>Country</label>
                      <select value={c.overrides.country || ""} onChange={(e) => updateOverride(c.id, "country", e.target.value)}>
                        <option value="">(inherit)</option>
                        <option value="CA">Canada (CA)</option>
                        <option value="US">United States (US)</option>
                        <option value="GB">United Kingdom (GB)</option>
                      </select>
                    </div>
                  )}

                  {!globals.dailyBudget.locked && (
                    <div className="field">
                      <label>Daily budget</label>
                      <input
                        type="number"
                        min={1}
                        value={c.overrides.dailyBudget ?? ""}
                        onChange={(e) => updateOverride(c.id, "dailyBudget", Number(e.target.value))}
                      />
                    </div>
                  )}

                  {!globals.campaignActive.locked && (
                    <div className="field">
                      <label>Campaign status</label>
                      <select
                        value={(c.overrides.campaignActive ?? globals.campaignActive.value) ? "ACTIVE" : "PAUSED"}
                        onChange={(e) => updateOverride(c.id, "campaignActive", e.target.value === "ACTIVE")}
                      >
                        <option value="PAUSED">Paused</option>
                        <option value="ACTIVE">Active</option>
                      </select>
                    </div>
                  )}

                  {!globals.scheduleTime.locked && (
                    <div className="field">
                      <label>Schedule (optional)</label>
                      <input type="datetime-local" value={c.overrides.scheduleTime || ""} onChange={(e) => updateOverride(c.id, "scheduleTime", e.target.value)} />
                    </div>
                  )}

                  {!globals.presetId.locked && (
                    <div className="field">
                      <label>Preset</label>
                      <select value={c.overrides.presetId || globals.presetId.value} onChange={(e) => updateOverride(c.id, "presetId", e.target.value)}>
                        {copy.presets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <strong>Logs</strong>
          <div className="hint">Prefixed per card (first 4 chars of id).</div>
        </div>
        <div className="panel-body">
          <div className="logbox">{logs.length ? logs.map((l, i) => <div key={`${i}-${l}`}>{l}</div>) : <div className="hint">No logs yet.</div>}</div>
        </div>
      </section>
    </div>
  );
}
