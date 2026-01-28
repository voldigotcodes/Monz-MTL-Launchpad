import { open } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import type { CopyPreset, LaunchResult, PreviewData, ScheduleMode } from "../types";

const API_BASE = (import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8000";

type PickOptions = {
  allowFiles?: boolean;
  multiple?: boolean;
  title?: string;
};

export async function pickFolder(opts: PickOptions = {}): Promise<string> {
  const selection = await open({
    directory: true,
    multiple: opts.multiple ?? false,
    title: opts.title || "Select campaign folder",
    filters: opts.allowFiles ? undefined : [],
  });

  if (Array.isArray(selection)) {
    return selection[0] ?? "";
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
    },
  };

  return invoke<LaunchResult>("run_launcher", args);
}

export async function fetchCampaigns(): Promise<{ id: string; name: string; status?: string; daily_budget?: number }[]> {
  const resp = await fetch(`${API_BASE}/meta/campaigns`);
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Failed to load campaigns (${resp.status}): ${detail || "unknown error"}`);
  }
  const data = await resp.json();
  return data.map((c: any) => ({
    id: c.id,
    name: c.name,
    status: c.status || c.effective_status,
    daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
  }));
}

export async function fetchAdsets(campaignId: string): Promise<{ id: string; name: string; status?: string }[]> {
  const resp = await fetch(`${API_BASE}/meta/campaigns/${campaignId}/adsets`);
  if (!resp.ok) throw new Error(`Failed to load ad sets (${resp.status})`);
  return resp.json();
}

export async function checkIgStatus(): Promise<{ ok: boolean; id?: string; username?: string }> {
  const resp = await fetch(`${API_BASE}/meta/ig-status`);
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(detail || `IG status check failed (${resp.status})`);
  }
  return resp.json();
}
