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
  launchType: "new_campaign" | "existing_campaign";
  addMode: "creatives_only" | "adsets_and_creatives";
  existingCampaignId?: string;
  targetAdsetIds?: string[];
};

export type GlobalField<T> = {
  value: T;
  locked: boolean;
};

export type BulkGlobalConfig = {
  country: GlobalField<string>;
  productName: GlobalField<string>;
  brandName: GlobalField<string>;
  productUrl: GlobalField<string>;
  folderPath: GlobalField<string>;
  presetId: GlobalField<string>;
  scheduleTime: GlobalField<string>;
  dailyBudget: GlobalField<number>;
  campaignActive: GlobalField<boolean>;
};


export type BulkCampaign = {
  id: string;
  overrides: Partial<{
    country: string;
    productName: string;
    brandName: string;
    productUrl: string;
    folderPath: string;
    presetId: string;
    scheduleTime: string;
    dailyBudget: number;
    campaignActive: boolean;
  }>;
  status: "pending" | "running" | "success" | "error";
  error?: string;
};

export type MetaSettings = {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  instagramUserId: string;
  pixelId: string;
};

export type CopyPreset = {
  id: string;
  name: string;
  headlines: string[];
  primaryTexts: string[];
  descriptions: string[];
  carouselHeadlines?: string[];
  carouselDescriptions?: string[];
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
