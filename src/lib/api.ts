import { open } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import type { CopyPreset, LaunchResult, MetaConnection, MetaSettings, PreviewData, ScheduleMode } from "../types";

const API_BASE = (import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8000";

async function metaRequest<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(25000) });
  } catch {
    throw new Error("The local Meta backend is unreachable or timed out. Start it and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(
      (typeof detail === "string" ? detail : detail?.message) || `Backend request failed (${response.status}).`,
    );
  }
  if (!data) throw new Error("The local Meta backend returned an invalid response.");
  return data as T;
}

export function fetchMetaSettings(): Promise<MetaSettings> {
  return metaRequest<MetaSettings>("/meta/config");
}

export function testMetaConnection(): Promise<MetaConnection> {
  return metaRequest<MetaConnection>("/meta/connection");
}

type PickOptions = {
  allowFiles?: boolean;
  multiple?: boolean;
  title?: string;
};

export async function pickFolder(opts: PickOptions = {}): Promise<string> {
  const selection = await open({
    directory: opts.allowFiles ? false : true,
    multiple: opts.multiple ?? false,
    title: opts.title || "Select campaign folder",
    filters: opts.allowFiles ? undefined : [],
  });

  if (Array.isArray(selection)) {
    return selection.filter(Boolean).map(String).join("|");
  }
  return selection ? String(selection) : "";
}

export async function fetchPreview(folderPath: string, country: string): Promise<PreviewData> {
  return invoke<PreviewData>("scan_launch_folder", {
    params: { folderPath, country },
  });
}

type LaunchRunPayload = {
  folderPath: string;
  productName: string;
  brandName: string;
  productUrl: string;
  country: string;
  dailyBudget: number;
  campaignActive: boolean;
  scheduleMode: ScheduleMode;
  scheduleTime?: string;
  preset: CopyPreset;
  launchType?: "new_campaign" | "existing_campaign";
  addMode?: "creatives_only" | "adsets_and_creatives";
  campaignId?: string;
  targetAdsetIds?: string[];
  multiAdvertiserAds?: boolean;
};

export async function runLaunch(payload: LaunchRunPayload): Promise<LaunchResult> {
  const args = {
    payload: {
      folderPath: payload.folderPath,
      productName: payload.productName,
      brandName: payload.brandName,
      productUrl: payload.productUrl,
      country: payload.country,
      dailyBudget: payload.dailyBudget,
      campaignActive: payload.campaignActive,
      launchImmediately: payload.scheduleMode === "now",
      scheduleTime: payload.scheduleMode === "later" ? payload.scheduleTime || null : null,
      preset: payload.preset,
      launchType: payload.launchType || "new_campaign",
      addMode: payload.addMode || "creatives_only",
      campaignId: payload.campaignId || null,
      targetAdsetIds: payload.targetAdsetIds || [],
      multiAdvertiserAds: payload.multiAdvertiserAds ?? false,
    },
  };

  return invoke<LaunchResult>("run_launcher", args);
}

export async function fetchCampaigns(): Promise<{ id: string; name: string; status?: string; daily_budget?: number }[]> {
  const data = await metaRequest<any[]>("/meta/campaigns");
  return data.map((c: any) => ({
    id: c.id,
    name: c.name,
    status: c.status || c.effective_status,
    daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
  }));
}

export async function fetchAdsets(campaignId: string): Promise<{ id: string; name: string; status?: string }[]> {
  return metaRequest(`/meta/campaigns/${encodeURIComponent(campaignId)}/adsets`);
}

export async function checkIgStatus(): Promise<{ ok: boolean; id?: string; username?: string }> {
  return metaRequest("/meta/ig-status");
}
