import type {
  AdsetSummary,
  CampaignSummary,
  LaunchJobPollResponse,
  PreviewData,
  MetaSettings,
  MetaConnection,
  MetaAssetList,
  MetaAssetSelection,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let resp: Response;
    try {
      resp = await fetch(joinUrl(API_BASE, path), { ...init, signal: controller.signal });
    } catch {
      throw new Error("The local Meta backend is unreachable or timed out. Start it and try again.");
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const detail = data?.detail;
      throw new Error(
        (typeof detail === "string" ? detail : detail?.message) || `Backend request failed (${resp.status}).`,
      );
    }
    if (!data) throw new Error("The local Meta backend returned an invalid response.");
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function health(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/health");
}

export async function checkIgStatus(): Promise<{ ok: boolean; id?: string; username?: string }> {
  return apiFetch<{ ok: boolean; id?: string; username?: string }>("/meta/ig-status");
}

export async function fetchCampaigns(): Promise<CampaignSummary[]> {
  const data = await apiFetch<any[]>("/meta/campaigns");
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status || c.effective_status,
    daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
  }));
}

export async function fetchAdsets(campaignId: string): Promise<AdsetSummary[]> {
  return apiFetch<AdsetSummary[]>(`/meta/campaigns/${encodeURIComponent(campaignId)}/adsets`);
}

export async function createUpload(formData: FormData): Promise<{ upload_id: string }> {
  const resp = await fetch(joinUrl(API_BASE, "/uploads"), {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(detail || `Upload failed (${resp.status})`);
  }
  return (await resp.json()) as { upload_id: string };
}

export async function fetchPreview(
  uploadId: string,
  opts?: { country?: string; launchType?: string; addMode?: string; campaignId?: string },
): Promise<PreviewData> {
  const params = new URLSearchParams();
  if (opts?.country) params.set("country", opts.country);
  if (opts?.launchType) params.set("launch_type", opts.launchType);
  if (opts?.addMode) params.set("add_mode", opts.addMode);
  if (opts?.campaignId) params.set("campaign_id", opts.campaignId);
  const qs = params.toString();
  return apiFetch<PreviewData>(`/uploads/${encodeURIComponent(uploadId)}/preview${qs ? `?${qs}` : ""}`);
}

export async function createLaunchJob(payload: any): Promise<{ job_id: string }> {
  return apiFetch<{ job_id: string }>("/launch/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function pollLaunchJob(jobId: string, after: number): Promise<LaunchJobPollResponse> {
  const qs = `?after=${encodeURIComponent(String(after || 0))}`;
  return apiFetch<LaunchJobPollResponse>(`/launch/jobs/${encodeURIComponent(jobId)}${qs}`);
}

export function fetchMetaSettings(): Promise<MetaSettings> {
  return apiFetch<MetaSettings>("/meta/config");
}

export function testMetaConnection(): Promise<MetaConnection> {
  return apiFetch<MetaConnection>("/meta/connection");
}

export type MetaAssetKind = "permissions" | "businesses" | "ad-accounts" | "pages" | "instagram" | "pixels";

export function fetchMetaAssets(kind: MetaAssetKind, selection: Partial<MetaAssetSelection> = {}): Promise<MetaAssetList> {
  const params = new URLSearchParams({ kind });
  for (const key of ["businessId", "adAccountId", "pageId"] as const) {
    if (selection[key]) params.set(key, selection[key]!);
  }
  return apiFetch<MetaAssetList>(`/meta/assets?${params}`);
}

export function saveMetaAssets(selection: MetaAssetSelection): Promise<MetaSettings> {
  return apiFetch<MetaSettings>("/meta/assets/selection", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
  });
}
