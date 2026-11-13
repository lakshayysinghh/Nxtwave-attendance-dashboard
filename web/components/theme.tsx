"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Day and night mode. With no saved choice the device setting is followed;
 * clicking the switch saves the choice in this browser. The class is set on
 * <html> before the first paint by themeScript (see app/layout.tsx), so the
 * page never flashes the wrong colours.
 */

const KEY = "theme";

/** Runs in <head> before React: applies the saved or device theme. */
export const themeScript = `try{var t=localStorage.getItem("${KEY}");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`;

function setDark(dark: boolean) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  root.classList.toggle("dark", dark);
  window.setTimeout(() => root.classList.remove("theme-transition"), 250);
}

function saved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Watches the dark class on <html>, which the switch and the device setting change. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // Follow the device setting until a choice is saved.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onDevice = (e: MediaQueryListEvent) => {
    if (!saved()) setDark(e.matches);
  };
  mq.addEventListener("change", onDevice);
  return () => {
    observer.disconnect();
    mq.removeEventListener("change", onDevice);
  };
}
const isDark = () => document.documentElement.classList.contains("dark");

export function ThemeToggle({ className = "" }: { className?: string }) {
  // null on the server, so server and client markup match before hydration.
  const dark = useSyncExternalStore(subscribe, isDark, () => null);

  const toggle = () => {
    const next = !isDark();
    setDark(next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };

  const label = dark ? "Switch to day mode" : "Switch to night mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white ${className}`}
    >
      {dark === null ? <span className="size-4" /> : dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
