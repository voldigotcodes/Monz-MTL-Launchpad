"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CopyPreset } from "../../lib/types";

const STORAGE_KEY = "monz_copy_presets";

type CopyPresetContextValue = {
  presets: CopyPreset[];
  activePresetId: string;
  setActivePreset: (id: string) => void;
  addPreset: (name?: string) => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  updatePresetField: (id: string, field: keyof Omit<CopyPreset, "id" | "name">, value: string[]) => void;
};

const CopyPresetContext = createContext<CopyPresetContextValue | undefined>(undefined);

function safeReadPresets(): CopyPreset[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CopyPreset[]) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeWritePresets(presets: CopyPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

const defaultPreset: CopyPreset = {
  id: crypto.randomUUID(),
  name: "Default",
  headlines: ["{{product_name}}: 60% OFF"],
  primaryTexts: [
    "{{product_name}} — a reminder that you can feel beautiful, confident, and completely yourself.\n\n" +
      "Shop now: {{product_url}}",
  ],
  descriptions: ["Free Shipping Today Only"],
  carouselHeadlines: [],
  carouselDescriptions: [],
};

export function CopyPresetProvider({ children }: { children: React.ReactNode }) {
  const [presets, setPresets] = useState<CopyPreset[]>([defaultPreset]);
  const [activePresetId, setActivePresetId] = useState<string>(defaultPreset.id);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = safeReadPresets();
    if (stored && stored.length) {
      setPresets(stored);
      setActivePresetId(stored[0].id);
    } else {
      setPresets([defaultPreset]);
      setActivePresetId(defaultPreset.id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) safeWritePresets(presets.slice(0, 50));
  }, [hydrated, presets]);

  const value: CopyPresetContextValue = useMemo(
    () => ({
      presets,
      activePresetId,
      setActivePreset: (id) => setActivePresetId(id),
      addPreset: (name) => {
        const preset: CopyPreset = {
          id: crypto.randomUUID(),
          name: name?.trim() || `Preset ${presets.length + 1}`,
          headlines: [],
          primaryTexts: [],
          descriptions: [],
          carouselHeadlines: [],
          carouselDescriptions: [],
        };
        setPresets((prev) => [...prev, preset]);
        setActivePresetId(preset.id);
      },
      renamePreset: (id, name) => {
        setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      },
      deletePreset: (id) => {
        setPresets((prev) => {
          const next = prev.filter((p) => p.id !== id);
          const fallback = next[0] || defaultPreset;
          setActivePresetId(fallback.id);
          return next.length ? next : [defaultPreset];
        });
      },
      updatePresetField: (id, field, value) => {
        setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
      },
    }),
    [activePresetId, presets],
  );

  return <CopyPresetContext.Provider value={value}>{children}</CopyPresetContext.Provider>;
}

export function useCopyPresets(): CopyPresetContextValue {
  const ctx = useContext(CopyPresetContext);
  if (!ctx) throw new Error("useCopyPresets must be used within CopyPresetProvider");
  return ctx;
}

