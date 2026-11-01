"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MetaAsset } from "../lib/types";

function detail(asset: MetaAsset) {
  return [asset.username ? `@${asset.username}` : null, asset.currency, asset.businessName,
    asset.status != null ? asset.status === 1 ? "Active" : `Unavailable (status ${asset.status})` : null,
    asset.linkedPage ? "Linked to selected Page" : null, asset.id].filter(Boolean).join(" · ");
}

export function AssetSelect({ label, value, items, onChange, disabled, loading, error, emptyLabel, placeholder }: {
  label: string; value: string; items: MetaAsset[]; onChange: (value: string) => void;
  disabled?: boolean; loading?: boolean; error?: string | null; emptyLabel?: string; placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = items.find((item) => item.id === value);
  const options = (emptyLabel ? [{ id: "", name: emptyLabel }, ...items] : items)
    .filter((item) => `${item.name} ${detail(item)}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => { setOpen(false); setQuery(""); setActive(0); }, [disabled]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function choose(asset: MetaAsset) {
    if (asset.status != null && asset.status !== 1) return;
    if (asset.id !== value) onChange(asset.id);
    setOpen(false); setQuery("");
  }

  return (
    <div className="field asset-select" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <label htmlFor={id}>{label}</label>
      <div className="asset-select-input">
        {selected?.imageUrl && <img src={selected.imageUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
          aria-autocomplete="list" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
          disabled={disabled || loading} autoComplete="off"
          placeholder={loading ? "Loading…" : placeholder || "Search by name or ID…"}
          value={open ? query : selected ? selected.username ? `@${selected.username}` : selected.name : value ? `Saved ID: ${value}` : emptyLabel || ""}
          onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); event.preventDefault(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((previous) => Math.max(0, Math.min(options.length - 1, open ? previous + step : 0)));
            }
            if (event.key === "Enter" && open) { event.preventDefault(); if (options[active]) choose(options[active]); }
          }} />
        <span aria-hidden="true">⌄</span>
      </div>
      {open && !disabled && !loading && (
        <div className="asset-select-menu" id={`${id}-list`} role="listbox" aria-label={label}>
          {options.map((asset, index) => (
            <div id={`${id}-option-${index}`} role="option" key={asset.id} aria-selected={value === asset.id}
              aria-disabled={asset.status != null && asset.status !== 1}
              className={`asset-option ${active === index ? "highlighted" : ""}`}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(asset)}>
              {asset.imageUrl ? <img src={asset.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                : <span className="asset-avatar" aria-hidden="true">{asset.name.slice(0, 1).toUpperCase()}</span>}
              <span><strong>{asset.name}</strong><small>{detail(asset)}</small></span>
              {asset.id === value && <span aria-hidden="true">✓</span>}
            </div>
          ))}
          {!options.length && <p className="hint">{items.length ? "No matching assets." : "No accessible assets found."}</p>}
        </div>
      )}
      {selected && <small className="hint">{detail(selected)}</small>}
      {error && <p className="hint" id={`${id}-error`} role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
