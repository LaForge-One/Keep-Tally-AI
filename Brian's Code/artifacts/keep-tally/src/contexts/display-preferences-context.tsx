import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ProfileTheme = "system" | "light" | "dark";
export type DateFormatPreference = "mdy" | "iso" | "long";
export type TimeFormatPreference = "12h" | "24h";

type DisplayPreferences = {
  profileTheme: ProfileTheme;
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
};

type DisplayPreferencesContextValue = DisplayPreferences & {
  setProfileTheme: (theme: ProfileTheme) => void;
  setDateFormat: (format: DateFormatPreference) => void;
  setTimeFormat: (format: TimeFormatPreference) => void;
};

const STORAGE_KEY = "keeptally.displayPreferences.v1";
const DEFAULT_PREFERENCES: DisplayPreferences = {
  profileTheme: "system",
  dateFormat: "mdy",
  timeFormat: "12h",
};

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

function isProfileTheme(value: unknown): value is ProfileTheme {
  return value === "system" || value === "light" || value === "dark";
}

function isDateFormat(value: unknown): value is DateFormatPreference {
  return value === "mdy" || value === "iso" || value === "long";
}

function isTimeFormat(value: unknown): value is TimeFormatPreference {
  return value === "12h" || value === "24h";
}

function readPreferences(): DisplayPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DisplayPreferences>;
    return {
      profileTheme: isProfileTheme(parsed.profileTheme) ? parsed.profileTheme : DEFAULT_PREFERENCES.profileTheme,
      dateFormat: isDateFormat(parsed.dateFormat) ? parsed.dateFormat : DEFAULT_PREFERENCES.dateFormat,
      timeFormat: isTimeFormat(parsed.timeFormat) ? parsed.timeFormat : DEFAULT_PREFERENCES.timeFormat,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function applyTheme(theme: ProfileTheme) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", useDark);
  root.dataset.theme = theme;
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<DisplayPreferences>(() => readPreferences());

  useEffect(() => {
    applyTheme(preferences.profileTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are non-critical; private browser modes may block local storage.
    }
  }, [preferences]);

  useEffect(() => {
    if (preferences.profileTheme !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences.profileTheme]);

  const setProfileTheme = useCallback((profileTheme: ProfileTheme) => {
    setPreferences((current) => ({ ...current, profileTheme }));
  }, []);

  const setDateFormat = useCallback((dateFormat: DateFormatPreference) => {
    setPreferences((current) => ({ ...current, dateFormat }));
  }, []);

  const setTimeFormat = useCallback((timeFormat: TimeFormatPreference) => {
    setPreferences((current) => ({ ...current, timeFormat }));
  }, []);

  const value = useMemo<DisplayPreferencesContextValue>(() => ({
    ...preferences,
    setProfileTheme,
    setDateFormat,
    setTimeFormat,
  }), [preferences, setDateFormat, setProfileTheme, setTimeFormat]);

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences() {
  const context = useContext(DisplayPreferencesContext);
  if (!context) throw new Error("useDisplayPreferences must be used inside DisplayPreferencesProvider");
  return context;
}

export function formatDisplayDate(date: Date, format: DateFormatPreference) {
  if (format === "iso") return date.toISOString().slice(0, 10);
  if (format === "long") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDisplayTime(date: Date, format: TimeFormatPreference) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  }).format(date);
}

export function formatDisplayDateTime(
  date: Date,
  dateFormat: DateFormatPreference,
  timeFormat: TimeFormatPreference,
) {
  return `${formatDisplayDate(date, dateFormat)}, ${formatDisplayTime(date, timeFormat)}`;
}
