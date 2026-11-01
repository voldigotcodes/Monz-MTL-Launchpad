"use client";

import { CopyPresetProvider } from "../components/copy-presets/CopyPresetsContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return <CopyPresetProvider>{children}</CopyPresetProvider>;
}

