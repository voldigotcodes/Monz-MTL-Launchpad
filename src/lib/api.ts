import { open } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import type { LaunchResult, PreviewData, ScheduleMode } from "../types";

export async function pickFolder(): Promise<string> {
  const selection = await open({
    directory: true,
    multiple: false,
    title: "Select campaign folder",
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
  productUrl: string;
  country: string;
  dailyBudget: number;
  campaignActive: boolean;
  scheduleMode: ScheduleMode;
  scheduleTime?: string;
};

export async function runLaunch(payload: LaunchRunPayload): Promise<LaunchResult> {
  const args = {
    payload: {
      folderPath: payload.folderPath,
      productName: payload.productName,
      productUrl: payload.productUrl,
      country: payload.country,
      dailyBudget: payload.dailyBudget,
      campaignActive: payload.campaignActive,
      launchImmediately: payload.scheduleMode === "now",
      scheduleTime: payload.scheduleMode === "later" ? payload.scheduleTime || null : null,
    },
  };

  return invoke<LaunchResult>("run_launcher", args);
}
