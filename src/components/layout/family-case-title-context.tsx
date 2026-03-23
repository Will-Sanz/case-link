"use client";

import { createContext, useContext } from "react";

export const SetFamilyCaseTitleContext = createContext<
  ((name: string | null) => void) | null
>(null);

/** Registers the current case name for the unified sidebar (family detail pages only). */
export function useRegisterFamilyCaseTitle() {
  const set = useContext(SetFamilyCaseTitleContext);
  if (!set) {
    throw new Error(
      "useRegisterFamilyCaseTitle must be used under FamilyCaseChrome",
    );
  }
  return set;
}
