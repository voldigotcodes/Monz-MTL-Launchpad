"use client";

import { useCallback, useEffect, useState } from "react";
import { AssetSelect } from "../../components/AssetSelect";
import { fetchMetaAssets, fetchMetaSettings, health, saveMetaAssets, testMetaConnection } from "../../lib/backend";
import type { MetaAssetKind } from "../../lib/backend";
import type { MetaAssetList, MetaAssetSelection, MetaSettings } from "../../lib/types";

const emptySelection: MetaAssetSelection = { businessId: "", adAccountId: "", pageId: "", instagramUserId: "", pixelId: "" };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function selectionOf(settings: MetaSettings): MetaAssetSelection {
  return { businessId: settings.businessId || "", adAccountId: settings.adAccountId ? `act_${settings.adAccountId.replace(/^act_/, "")}` : "",
    pageId: settings.pageId, instagramUserId: settings.instagramUserId, pixelId: settings.pixelId };
}

function useAssetList(kind: MetaAssetKind, params: Partial<MetaAssetSelection>, enabled: boolean, revision: number) {
  const key = JSON.stringify(params);
  const [state, setState] = useState<{ data: MetaAssetList; loading: boolean; error: string | null }>({ data: { items: [], warnings: [] }, loading: false, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ data: { items: [], warnings: [] }, loading: enabled, error: null });
    if (!enabled) return;
    fetchMetaAssets(kind, JSON.parse(key))
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState({ data: { items: [], warnings: [] }, loading: false, error: message(error) }); });
    return () => { cancelled = true; };
  }, [kind, key, enabled, revision]);
  return state;
}

export function SettingsClient() {
  const [settings, setSettings] = useState<MetaSettings | null>(null);
  const [draft, setDraft] = useState<MetaAssetSelection>(emptySelection);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const enabled = Boolean(settings?.tokenConfigured) && !loading;
  const businesses = useAssetList("businesses", {}, enabled, revision);
  const permissions = useAssetList("permissions", {}, enabled, revision);
  const accounts = useAssetList("ad-accounts", { businessId: draft.businessId }, enabled, revision);
  const pages = useAssetList("pages", { adAccountId: draft.adAccountId }, enabled && Boolean(draft.adAccountId), revision);
  const pixels = useAssetList("pixels", { adAccountId: draft.adAccountId }, enabled && Boolean(draft.adAccountId), revision);
  const instagram = useAssetList("instagram", { adAccountId: draft.adAccountId, pageId: draft.pageId }, enabled && Boolean(draft.adAccountId && draft.pageId), revision);
  const lists = [businesses, accounts, pages, pixels, instagram];
  const warnings = Array.from(new Set(lists.flatMap((list) => list.data.warnings)));
  const linked = instagram.data.items.find((asset) => asset.linkedPage);
  const validSelection = accounts.data.items.some((item) => item.id === draft.adAccountId && item.status === 1)
    && pages.data.items.some((item) => item.id === draft.pageId)
    && pixels.data.items.some((item) => item.id === draft.pixelId)
    && (!draft.instagramUserId || instagram.data.items.some((item) => item.id === draft.instagramUserId));
  const dirty = settings && JSON.stringify(draft) !== JSON.stringify(selectionOf(settings));

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null); setStatus(null);
    try {
      const [api, configuration] = await Promise.all([health(), fetchMetaSettings()]);
      if (signal?.aborted) return;
      setApiOk(Boolean(api.ok)); setSettings(configuration); setDraft(selectionOf(configuration)); setRevision((value) => value + 1);
    } catch (failure) {
      if (signal?.aborted) return;
      setApiOk(false); setSettings(null); setError(message(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function save() {
    setBusy(true); setStatus("Validating asset access and saving…");
    try {
      const saved = await saveMetaAssets(draft);
      setSettings(saved); setDraft(selectionOf(saved)); setStatus("Selection saved. Connectivity tests and future launches will use these assets.");
    } catch (failure) { setStatus(`Could not save: ${message(failure)}`); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setStatus("Testing saved configuration…");
    try {
      const result = await testMetaConnection();
      setStatus(`OK: ${result.user.name || result.user.id || "Meta user"} · ${result.adAccount.id} · status ${result.adAccount.status ?? "unknown"}`);
    } catch (failure) { setStatus(`Error: ${message(failure)}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid">
      <header className="page-head"><div><h2>Settings</h2><p>Choose the business assets to use for your campaigns.</p></div></header>
      <section className="panel">
        <div className="panel-head"><strong>Meta connection</strong><span className={`status ${apiOk ? "ok" : apiOk === false ? "bad" : ""}`}>API: {loading ? "Checking…" : apiOk ? "OK" : "Unavailable"}</span></div>
        <div className="panel-body">
          <p>Access token: {loading ? "Checking…" : settings?.tokenConfigured ? "Configured" : "Missing"}</p>
          <p className="hint">The access token stays in the backend .env. Changing selections does not replace it.</p>
          {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
          {permissions.data.granted && <details><summary className="hint">Token permissions ({permissions.data.granted.length})</summary><p className="hint">{permissions.data.granted.join(", ")}</p></details>}
          {permissions.data.missingSuggested?.length ? <p className="hint">Additional access may require: {permissions.data.missingSuggested.join(", ")}. Available assets depend on the token’s assigned access.</p> : null}
          {permissions.error && <p className="hint">Permission details unavailable: {permissions.error}</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><strong>Campaign assets</strong>{dirty && <span className="status">Unsaved changes</span>}</div>
        <div className="panel-body">
          <AssetSelect label="Business portfolio" value={draft.businessId} items={businesses.data.items} loading={businesses.loading}
            error={businesses.error} disabled={!enabled || busy} emptyLabel="All accessible businesses"
            onChange={(businessId) => { setDraft({ ...emptySelection, businessId }); setStatus(null); }} />
          <AssetSelect label="Ad account" value={draft.adAccountId} items={accounts.data.items} loading={accounts.loading}
            error={accounts.error} disabled={!enabled || busy}
            onChange={(adAccountId) => { setDraft((previous) => ({ ...emptySelection, businessId: previous.businessId, adAccountId })); setStatus(null); }} />
          <div className="row2">
            <AssetSelect label="Facebook Page" value={draft.pageId} items={pages.data.items} loading={pages.loading}
              error={pages.error} disabled={!enabled || !draft.adAccountId || busy}
              onChange={(pageId) => { setDraft((previous) => ({ ...previous, pageId, instagramUserId: "" })); setStatus(null); }} />
            <AssetSelect label="Pixel" value={draft.pixelId} items={pixels.data.items} loading={pixels.loading}
              error={pixels.error} disabled={!enabled || !draft.adAccountId || busy}
              onChange={(pixelId) => { setDraft((previous) => ({ ...previous, pixelId })); setStatus(null); }} />
          </div>
          <AssetSelect label="Instagram account (optional)" value={draft.instagramUserId} items={instagram.data.items} loading={instagram.loading}
            error={instagram.error} disabled={!enabled || !draft.adAccountId || !draft.pageId || busy} emptyLabel="No Instagram account"
            onChange={(instagramUserId) => { setDraft((previous) => ({ ...previous, instagramUserId })); setStatus(null); }} />
          {linked && linked.id !== draft.instagramUserId && <button className="btn" type="button" disabled={busy} onClick={() => { setDraft((previous) => ({ ...previous, instagramUserId: linked.id })); setStatus(null); }}>Use Page-linked {linked.username ? `@${linked.username}` : "Instagram account"}</button>}
          {warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}
          <p className="hint">Pages and pixels are filtered by the selected ad account. Saving checks access again. Your current saved IDs stay in effect until Save succeeds.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn primary" type="button" onClick={save} disabled={busy || loading || !validSelection || !dirty || lists.some((list) => list.loading)}>Save asset selection</button>
            <button className="btn" type="button" onClick={() => void refresh()} disabled={busy || loading}>Refresh configuration</button>
            <button className="btn" type="button" onClick={test} disabled={busy || loading || !settings?.tokenConfigured}>Test connectivity</button>
          </div>
          {dirty && <p className="hint">Test connectivity checks the saved ad account. Save your selection to test a different account.</p>}
          {status && <p role="status">{status}</p>}
        </div>
      </section>
    </div>
  );
}
