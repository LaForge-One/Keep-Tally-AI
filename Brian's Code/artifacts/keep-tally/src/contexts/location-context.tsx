import { createContext, useContext, useState, type ReactNode } from "react";

export const LOCATIONS = ["Carvana North", "Carvana South", "Carvana 1305"] as const;
export type LocationName = (typeof LOCATIONS)[number];

interface LocationContextValue {
  selectedLocation: LocationName | null;
  setSelectedLocation: (loc: LocationName | null) => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [selectedLocation, setSelectedLocation] = useState<LocationName | null>(null);
  return (
    <LocationContext.Provider value={{ selectedLocation, setSelectedLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useSelectedLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useSelectedLocation must be used inside LocationProvider");
  return ctx;
}
