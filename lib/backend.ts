import type {
  AdsetSummary,
  CampaignSummary,
  LaunchJobPollResponse,
  PreviewData,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(joinUrl(API_BASE, path), init);
  if (resp.ok) {
    return (await resp.json()) as T;
  }
  const detail = await resp.text().catch(() => "");
  throw new Error(detail || `Request failed (${resp.status})`);
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
