"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

type Theme = "light" | "dark";
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "hb-avalia-theme";

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme precisa ser usado dentro do ThemeProvider.");
  return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    function syncTheme() {
      const nextTheme: Theme = window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY || event.key === null) syncTheme();
    }

    syncTheme();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const context = useTheme();

  const isDark = context.theme === "dark";
  const label = isDark ? "Modo claro" : "Modo noturno";
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      className="button button-outline button-small theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      onClick={context.toggleTheme}
    >
      <Icon size={17} weight="regular" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
