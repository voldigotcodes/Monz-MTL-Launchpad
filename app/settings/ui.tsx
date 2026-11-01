"use client";

import { useCallback, useEffect, useState } from "react";
import { checkIgStatus, fetchMetaSettings, health, testMetaConnection } from "../../lib/backend";
import type { MetaSettings } from "../../lib/types";

export function SettingsClient() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [igStatus, setIgStatus] = useState<string>("—");
  const [settings, setSettings] = useState<MetaSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setApiError(null);
    const [api, configuration, instagram] = await Promise.allSettled([
      health(), fetchMetaSettings(), checkIgStatus(),
    ]);
    if (signal?.aborted) return;
    setApiOk(api.status === "fulfilled" && Boolean(api.value.ok));
    if (configuration.status === "fulfilled") {
      setSettings(configuration.value);
    } else {
      setSettings(null);
      setApiError(configuration.reason instanceof Error ? configuration.reason.message : String(configuration.reason));
    }
    if (api.status === "rejected") {
      setApiError(api.reason instanceof Error ? api.reason.message : String(api.reason));
    }
    setIgStatus(instagram.status === "fulfilled"
      ? instagram.value.ok ? `OK (${instagram.value.username || instagram.value.id || "connected"})` : "Not OK"
      : `Unavailable (${instagram.reason instanceof Error ? instagram.reason.message : String(instagram.reason)})`);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function handleTest() {
    setTesting(true);
    setConnectionStatus("Testing with Meta Graph…");
    try {
      await refresh();
      const result = await testMetaConnection();
      setConnectionStatus(`OK: ${result.user.name || result.user.id || "Meta user"} • ${result.adAccount.id} status ${result.adAccount.status ?? "unknown"}`);
    } catch (error) {
      setConnectionStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Status checks only. Credentials live in the backend environment.</p>
        </div>
      </header>
      <section className="panel">
        <div className="panel-head"><strong>Backend connectivity</strong></div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`status ${apiOk ? "ok" : apiOk === false ? "bad" : ""}`}>
              API: {loading ? "Checking…" : apiOk ? "OK" : "Error"}
            </span>
            <span className="status">IG: {igStatus}</span>
          </div>
          {apiError && <p className="hint" role="alert" style={{ color: "var(--danger)" }}>{apiError}</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><strong>Meta configuration</strong></div>
        <div className="panel-body">
          <p className="hint">Connectivity tests and launches use the same backend configuration. Edit the backend .env to change credentials; file changes are loaded on the next request. Restart the backend when changing its process environment.</p>
          {loading && <p className="hint">Loading backend configuration…</p>}
          {!loading && settings && (
            <>
              <p>Access token: {settings.tokenConfigured ? "Token configured" : "Token missing"}</p>
              <div className="grid">
                {([
                  ["Ad Account ID", settings.adAccountId],
                  ["Page ID", settings.pageId],
                  ["Instagram User ID (optional)", settings.instagramUserId],
                  ["Pixel ID", settings.pixelId],
                ] as const).map(([label, value]) => (
                  <label className="field" key={label}>
                    <span>{label}</span>
                    <input value={value} readOnly placeholder="Not configured" />
                  </label>
                ))}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn" type="button" disabled={loading || testing} onClick={() => { setConnectionStatus(null); void refresh(); }}>
              Refresh configuration
            </button>
            <button className="btn primary" type="button" disabled={loading || testing} onClick={handleTest}>
              {testing ? "Testing…" : "Test connectivity"}
            </button>
          </div>
          {connectionStatus && <p className="hint" role="status">{connectionStatus}</p>}
        </div>
      </section>
    </div>
  );
}
