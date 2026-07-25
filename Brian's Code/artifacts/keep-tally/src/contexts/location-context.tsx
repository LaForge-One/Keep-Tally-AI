import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type LocationRecord = { id: number; name: string; slug: string };

// Keep LOCATIONS export as empty fallback so existing imports don't break at compile time
export const LOCATIONS: readonly string[] = [];
export type LocationName = string;

interface LocationContextValue {
  selectedLocation: string | null;
  setSelectedLocation: (loc: string | null) => void;
  locations: LocationRecord[];
  locationsLoading: boolean;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/locations`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: LocationRecord[]) => {
        if (!cancelled) setLocations(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLocationsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <LocationContext.Provider value={{ selectedLocation, setSelectedLocation, locations, locationsLoading }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useSelectedLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useSelectedLocation must be used inside LocationProvider");
  return ctx;
}
