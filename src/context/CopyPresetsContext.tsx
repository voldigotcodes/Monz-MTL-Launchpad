import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadCopyPresets, saveCopyPresets } from "../lib/storage";
import type { CopyPreset } from "../types";

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

const defaultPreset: CopyPreset = {
  id: crypto.randomUUID(),
  name: "Default",
  headlines: ["{{product_name}}: 60% OFF"],
  primaryTexts: [
    "{{product_name}} — a reminder that you can feel beautiful, confident, and completely yourself.\n\n" +
      "For years, I chose what was practical — pieces that suited my day, but never truly felt like me. " +
      "Somewhere along the way, style became something I admired from a distance.\n" +
      "Then I discovered {{brand_name}}.\n\n" +
      "Now, every outfit feels like a reflection of me — soft fabrics that move with ease, shoes that carry me gracefully, " +
      "and layers that radiate elegance with every step.\n\n" +
      "These aren’t just clothes and footwear. They’re a gentle reminder that you can feel beautiful, confident, and completely yourself.\n\n" +
      "Today only — Post Holiday sales are open. Timeless style and comfort, available at exclusive prices for a limited time.\n\n" +
      "Shop now: {{product_url}}",
  ],
  descriptions: ["Free Shipping Today Only"],
  carouselHeadlines: [],
  carouselDescriptions: [],
};

export function CopyPresetProvider({ children }: { children: React.ReactNode }) {
  const [presets, setPresets] = useState<CopyPreset[]>([defaultPreset]);
  const [activePresetId, setActivePresetId] = useState<string>(defaultPreset.id);

  useEffect(() => {
    const stored = loadCopyPresets();
    if (stored && stored.length) {
      setPresets(stored);
      setActivePresetId(stored[0].id);
    } else {
      setPresets([defaultPreset]);
      setActivePresetId(defaultPreset.id);
    }
  }, []);

  useEffect(() => {
    saveCopyPresets(presets);
  }, [presets]);

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
        };
        setPresets((prev) => [...prev, preset]);
        setActivePresetId(preset.id);
      },
      renamePreset: (id, name) => {
        setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      },
      deletePreset: (id) => {
        if (presets.length === 1) return;
        setPresets((prev) => {
          const nextList = prev.filter((p) => p.id !== id);
          const nextActive = nextList[nextList.length - 1];
          setActivePresetId(nextActive ? nextActive.id : defaultPreset.id);
          return nextList;
        });
      },
      updatePresetField: (id, field, value) => {
        setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
      },
    }),
    [presets, activePresetId],
  );

  return <CopyPresetContext.Provider value={value}>{children}</CopyPresetContext.Provider>;
}

export function useCopyPresets(): CopyPresetContextValue {
  const ctx = useContext(CopyPresetContext);
  if (!ctx) {
    throw new Error("useCopyPresets must be used within CopyPresetProvider");
  }
  return ctx;
}
