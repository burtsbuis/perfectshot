"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { LatLng } from "./LocationMap";

const LocationMap = dynamic(() => import("./LocationMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-haze">Loading map…</div>,
});

type Place = { name: string; lat: number; lng: number };
type NominatimResult = { display_name: string; lat: string; lon: string };

export type PickedLocation = LatLng & { name?: string };

/** Search (OpenStreetMap Nominatim) or tap the map to drop a pin. */
export function LocationPicker({ value, onChange }: { value: PickedLocation | null; onChange: (v: PickedLocation) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "empty" | "error">("idle");
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus("searching");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      const data = (await res.json()) as NominatimResult[];
      const places = data.map((d) => ({ name: d.display_name, lat: +(+d.lat).toFixed(5), lng: +(+d.lon).toFixed(5) }));
      setResults(places);
      setStatus(places.length ? "idle" : "empty");
    } catch {
      setStatus("error");
    }
  }

  function choose(p: Place) {
    const short = p.name.split(",").slice(0, 2).join(",").trim();
    onChange({ lat: p.lat, lng: p.lng, name: short });
    setFlyTo({ lat: p.lat, lng: p.lng });
    setResults([]);
    setQuery(short);
  }

  return (
    <div>
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="place" className="sr-only">Search for a place</label>
        <input
          id="place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a park, beach, or address"
          className="min-w-0 flex-1 rounded-lg border border-dusk-3 bg-dusk px-3 py-2.5 text-paper placeholder:text-haze/70"
        />
        <button type="submit" className="rounded-lg border border-dusk-3 px-4 text-sm font-medium hover:border-haze">
          {status === "searching" ? "Searching…" : "Search"}
        </button>
      </form>

      {results.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-dusk-3 bg-dusk" role="listbox" aria-label="Search results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" onClick={() => choose(r)} className="w-full px-3 py-2 text-left text-sm hover:bg-dusk-2 focus:bg-dusk-2">
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === "empty" && <p className="mt-2 text-sm text-haze">No places found. Try a nearby landmark, or tap the map.</p>}
      {status === "error" && <p className="mt-2 text-sm text-rose">Search isn&apos;t responding. Tap the map to drop a pin instead.</p>}

      <div className="mt-3 h-64 overflow-hidden rounded-xl border border-dusk-3 sm:h-72">
        <LocationMap
          value={value}
          flyTo={flyTo}
          onPick={(p) => onChange({ ...p, name: value && value.lat === p.lat && value.lng === p.lng ? value.name : undefined })}
        />
      </div>
      <p className="mt-2 text-sm text-haze">
        {value ? (
          <>Pinned: <span className="text-paper">{value.name ?? `${value.lat}, ${value.lng}`}</span>. Tap the map to move the pin.</>
        ) : (
          "Tap the map to drop a pin where you'll shoot."
        )}
      </p>
    </div>
  );
}
