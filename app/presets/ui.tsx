"use client";

import { useMemo, useState } from "react";
import { useCopyPresets } from "../../components/copy-presets/CopyPresetsContext";
import { allowedVariables, findUnknownVariables } from "../../lib/vars";
import type { CopyPreset } from "../../lib/types";

function updateList(list: string[], idx: number, value: string): string[] {
  return list.map((v, i) => (i === idx ? value : v));
}

function removeFromList(list: string[], idx: number): string[] {
  return list.filter((_, i) => i !== idx);
}

function PresetListEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {value.length === 0 && <div className="hint">Empty</div>}
      {value.map((item, idx) => (
        <div key={`${label}-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 10 }}>
          <textarea
            rows={3}
            value={item}
            onChange={(e) => onChange(updateList(value, idx, e.target.value))}
          />
          <button className="btn" type="button" onClick={() => onChange(removeFromList(value, idx))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn" type="button" onClick={() => onChange([...value, ""])}>
        Add
      </button>
    </div>
  );
}

export function PresetsClient() {
  const ctx = useCopyPresets();
  const [renameValue, setRenameValue] = useState("");

  const activePreset: CopyPreset | undefined = ctx.presets.find((p) => p.id === ctx.activePresetId) || ctx.presets[0];

  const unknownVars = useMemo(() => {
    if (!activePreset) return [];
    const fields = [
      ...activePreset.headlines,
      ...activePreset.primaryTexts,
      ...activePreset.descriptions,
      ...(activePreset.carouselHeadlines || []),
      ...(activePreset.carouselDescriptions || []),
    ];
    const out = new Set<string>();
    for (const t of fields) findUnknownVariables(t).forEach((v) => out.add(v));
    return [...out];
  }, [activePreset]);

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <h2>Presets</h2>
          <p>Copy presets are stored locally (safe to delete/recreate).</p>
        </div>
        <div className="status">
          Vars: {allowedVariables()
            .map((v) => `{{${v}}}`)
            .join(", ")}
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <strong>Preset library</strong>
        </div>
        <div className="panel-body">
          <div className="row2">
            <div>
              <div className="field">
                <label>Presets</label>
                <select value={ctx.activePresetId} onChange={(e) => ctx.setActivePreset(e.target.value)}>
                  {ctx.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={() => ctx.addPreset()}>
                  New preset
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => activePreset && ctx.deletePreset(activePreset.id)}
                  disabled={!activePreset || ctx.presets.length <= 1}
                >
                  Delete
                </button>
              </div>
            </div>

            <div>
              <div className="field">
                <label>Rename</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder={activePreset?.name || "Preset name"}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      if (!activePreset) return;
                      const next = renameValue.trim();
                      if (!next) return;
                      ctx.renamePreset(activePreset.id, next);
                      setRenameValue("");
                    }}
                    disabled={!activePreset}
                  >
                    Save
                  </button>
                </div>
                <div className="hint">Keep names short and recognizable.</div>
              </div>

              {unknownVars.length > 0 && (
                <div className="hint" style={{ color: "var(--danger)" }}>
                  Unknown variables: {unknownVars.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {activePreset && (
        <section className="panel">
          <div className="panel-head">
            <strong>Edit: {activePreset.name}</strong>
          </div>
          <div className="panel-body">
            <PresetListEditor
              label="Headlines"
              value={activePreset.headlines}
              onChange={(v) => ctx.updatePresetField(activePreset.id, "headlines", v)}
            />
            <PresetListEditor
              label="Primary texts"
              value={activePreset.primaryTexts}
              onChange={(v) => ctx.updatePresetField(activePreset.id, "primaryTexts", v)}
            />
            <PresetListEditor
              label="Descriptions"
              value={activePreset.descriptions}
              onChange={(v) => ctx.updatePresetField(activePreset.id, "descriptions", v)}
            />
            <PresetListEditor
              label="Carousel headlines (optional)"
              value={activePreset.carouselHeadlines || []}
              onChange={(v) => ctx.updatePresetField(activePreset.id, "carouselHeadlines", v)}
            />
            <PresetListEditor
              label="Carousel descriptions (optional)"
              value={activePreset.carouselDescriptions || []}
              onChange={(v) => ctx.updatePresetField(activePreset.id, "carouselDescriptions", v)}
            />
            <div className="hint">Tip: keep each list ≤ 5 items to match Meta limits.</div>
          </div>
        </section>
      )}
    </div>
  );
}

