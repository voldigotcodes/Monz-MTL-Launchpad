export type ScheduleMode = "now" | "later";

export type LaunchFormState = {
  folderPath: string;
  productName: string;
  brandName: string;
  productUrl: string;
  country: string;
  dailyBudget: number;
  campaignActive: boolean;
  scheduleMode: ScheduleMode;
  scheduleTime?: string;
};

export type CopyPreset = {
  id: string;
  name: string;
  headlines: string[];
  primaryTexts: string[];
  descriptions: string[];
};

export type PreviewAdset = {
  name: string;
  ads: number;
  images: number;
  videos: number;
};

export type PreviewCampaign = {
  name: string;
  adsets: PreviewAdset[];
};

export type PreviewData = {
  campaigns: PreviewCampaign[];
  total_ads: number;
  media_summary: {
    images: number;
    videos: number;
  };
  launch_date: string;
};

export type LaunchResultCampaign = {
  campaign_name: string;
  campaign_id: string;
  adsets: {
    adset_name: string;
    adset_id: string;
    ads_created: number;
  }[];
};

export type LaunchResult = {
  campaign_id: string;
  adset_id: string;
  ads_created: number;
  logs: string[];
  campaigns: LaunchResultCampaign[];
};

export type Preset = {
  id: string;
  name: string;
  createdAt: string;
  config: LaunchFormState;
};

export type HistoryEntry = {
  id: string;
  timestamp: string;
  status: "success" | "error";
  config: LaunchFormState;
  result?: LaunchResult;
  error?: string;
};
