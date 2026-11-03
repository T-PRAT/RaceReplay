import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { RoutePoint, Station } from './model';
import { km } from './model';
import { routePosition, type stateAt } from './race';
import type { Range } from './Charts';
import { useTheme } from './theme';

type LatLng = [number, number];
// Leaflet writes colours as SVG attributes, where CSS variables do not apply.
const PALETTE = {
  light: { casing: '#fff', route: '#244e40', zone: '#e47748', ink: '#3d5a46', paper: '#fff' },
  dark: { casing: '#0b100d', route: '#8fc39a', zone: '#f08a5d', ink: '#e3e9e1', paper: '#171d1a' },
};

// Frame the selected zone, or the whole course once the zone is cleared.
function FitView({ positions }: { positions: LatLng[] }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(L.latLngBounds(positions), { padding: [25, 25], maxZoom: 16 }); }, [positions, map]);
  useEffect(() => { const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(map.getContainer()); return () => observer.disconnect(); }, [map]);
  return null;
}

export default function RaceMap({ route, states, stations, selection, hover, meId }: { route: RoutePoint[]; states: ReturnType<typeof stateAt>[]; stations: Station[]; selection: Range | null; hover: number | null; meId?: string }) {
  const c = PALETTE[useTheme()];
  const positions = useMemo(() => route.map(p => [p.lat, p.lon] as LatLng), [route]);
  const zone = useMemo(() => {
    if (!selection) return null;
    const edge = (d: number) => { const p = routePosition(route, d); return [p.lat, p.lon] as LatLng; };
    return [edge(selection[0]), ...route.filter(p => p.distance > selection[0] && p.distance < selection[1]).map(p => [p.lat, p.lon] as LatLng), edge(selection[1])];
  }, [route, selection]);
  const hovered = hover === null ? null : routePosition(route, hover);
  return <MapContainer center={[route[0].lat, route[0].lon]} zoom={12} scrollWheelZoom className="race-map">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
    <FitView positions={zone ?? positions} />
    <Polyline positions={positions} pathOptions={{ color: c.casing, weight: 7, opacity: .85 }} />
    <Polyline positions={positions} pathOptions={{ color: c.route, weight: 3.5, opacity: zone ? .45 : .9 }} />
    {zone && <><Polyline positions={zone} pathOptions={{ color: c.casing, weight: 9, opacity: 1 }} /><Polyline positions={zone} pathOptions={{ color: c.zone, weight: 5, opacity: 1 }} /></>}
    {stations.map(s => { const p = routePosition(route, s.distance); return <CircleMarker key={s.id} center={[p.lat, p.lon]} radius={5} pathOptions={{ color: c.paper, weight: 2, fillColor: c.route, fillOpacity: 1 }}><Tooltip>{s.name} · {km(s.distance)} km</Tooltip></CircleMarker>; })}
    {hovered && <CircleMarker center={[hovered.lat, hovered.lon]} radius={6} pathOptions={{ color: c.ink, weight: 2.5, fillColor: c.paper, fillOpacity: 1 }} interactive={false} />}
    {/* Only my name stays on the map; the others show it on hover. */}
    {states.filter(s => !s.pending).sort((a, b) => Number(a.runner.id === meId) - Number(b.runner.id === meId)).map(s => <CircleMarker key={`${s.runner.id}-${s.runner.id === meId}`} center={[s.lat, s.lon]} radius={s.runner.id === meId ? 9 : 7} pathOptions={{ color: c.paper, weight: 2.5, fillColor: s.runner.color, fillOpacity: 1 }}><Tooltip permanent={s.runner.id === meId} direction="top" offset={[0, -6]} className="runner-label">{s.runner.name}</Tooltip></CircleMarker>)}
  </MapContainer>;
}
