"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

export type LatLng = { lat: number; lng: number };

function ClickToPin({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }) });
  return null;
}

function FlyTo({ to }: { to: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo([to.lat, to.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [to, map]);
  return null;
}

/** Client-only map (Leaflet touches `window`); loaded with dynamic(..., { ssr: false }). */
export default function LocationMap({ value, onPick, flyTo }: { value: LatLng | null; onPick: (p: LatLng) => void; flyTo: LatLng | null }) {
  return (
    <MapContainer
      center={value ? [value.lat, value.lng] : [37.7936, -122.4836]}
      zoom={value ? 14 : 12}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPin onPick={onPick} />
      <FlyTo to={flyTo} />
      {value && (
        <CircleMarker
          center={[value.lat, value.lng]}
          radius={9}
          pathOptions={{ color: "#161d36", weight: 3, fillColor: "#f4b84a", fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  );
}
