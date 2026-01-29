"use client";

import { useEffect, useState } from "react";
import { checkIgStatus, health } from "../../lib/backend";

export function SettingsClient() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [igStatus, setIgStatus] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    health()
      .then((r) => {
        if (!cancelled) {
          setApiOk(Boolean(r.ok));
          setApiError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setApiOk(false);
          setApiError(String(e?.message || e));
        }
      });
    checkIgStatus()
      .then((r) => {
        if (!cancelled) setIgStatus(r.ok ? `OK (${r.username || r.id || "connected"})` : "Not OK");
      })
      .catch((e) => {
        if (!cancelled) setIgStatus(`Unavailable (${String(e?.message || e)})`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Status checks only. Credentials live in the backend environment.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <strong>Backend connectivity</strong>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`status ${apiOk ? "ok" : apiOk === false ? "bad" : ""}`}>
              API: {apiOk === null ? "Checking…" : apiOk ? "OK" : "Error"}
            </span>
            <span className="status">IG: {igStatus}</span>
          </div>
          {apiError && (
            <div className="hint" style={{ color: "var(--danger)", marginTop: 10 }}>
              {apiError}
            </div>
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            Configure the backend with env vars like <code>META_ACCESS_TOKEN</code>, <code>META_AD_ACCOUNT_ID</code>, and{" "}
            <code>META_ALLOWED_ORIGINS</code>.
          </div>
        </div>
      </section>
    </div>
  );
}

