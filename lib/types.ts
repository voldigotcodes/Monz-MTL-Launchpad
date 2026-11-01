export type ScheduleMode = "now" | "later";

export type LaunchType = "new_campaign" | "existing_campaign";
export type AddMode = "creatives_only" | "adsets_and_creatives";

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
  creatives?: { type: string; name: string; items?: string[] }[];
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

export type LaunchJobStatus = "pending" | "running" | "success" | "error";

export type LaunchJobPollResponse = {
  job_id: string;
  status: LaunchJobStatus;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  logs: string[];
  next_after: number;
  result: LaunchResult | null;
  error: string | null;
};

export type CampaignSummary = {
  id: string;
  name: string;
  status?: string;
  daily_budget?: number;
};

export type AdsetSummary = {
  id: string;
  name: string;
  status?: string;
};

export type MetaSettings = {
  businessId: string;
  tokenConfigured: boolean;
  adAccountId: string;
  pageId: string;
  instagramUserId: string;
  pixelId: string;
};

export type MetaConnection = {
  ok: boolean;
  user: { id: string | null; name: string | null };
  adAccount: { id: string; name: string | null; status: number | null };
};

export type MetaAssetSelection = {
  businessId: string;
  adAccountId: string;
  pageId: string;
  instagramUserId: string;
  pixelId: string;
};

export type MetaAsset = {
  id: string;
  name: string;
  imageUrl?: string;
  currency?: string;
  status?: number;
  businessName?: string;
  username?: string;
  linkedPage?: boolean;
};

export type MetaAssetList = {
  items: MetaAsset[];
  warnings: string[];
  granted?: string[];
  missingSuggested?: string[];
};
