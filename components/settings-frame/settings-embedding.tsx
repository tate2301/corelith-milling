"use client";

import { createContext, useContext, type ReactNode } from "react";

const EmbeddedSettingsContext = createContext(false);

/** Reuse the original forms inside another settings surface without duplicate app chrome or viewport offsets. */
export function EmbeddedSettings({ children }: { children: ReactNode }) {
  return <EmbeddedSettingsContext.Provider value>{children}</EmbeddedSettingsContext.Provider>;
}

export function useEmbeddedSettings() {
  return useContext(EmbeddedSettingsContext);
}
