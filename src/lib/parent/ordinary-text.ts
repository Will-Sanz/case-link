/** Only validated SNAP phone fields may contain a supported long international number. */
export function isOrdinaryText(value: string, snapPhone = false): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  const phone = snapPhone && /^\+?[\d ().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15;
  const identifier = phone
    ? /(^|[^A-Za-z0-9_])\d{3}[-.\/\s‐‑‒–—―]*\d{2}[-.\/\s‐‑‒–—―]*\d{4}($|[^A-Za-z0-9_])/
    : /\d{3}[-.\/\s‐‑‒–—―]*\d{2}[-.\/\s‐‑‒–—―]*\d{4}/;
  return !/[\u0000-\u001f\u007f-\u009f<>]/.test(value) && !identifier.test(normalized) &&
    (phone || !/\d{12,19}/.test(normalized)) &&
    !/\b(?:password|passcode|pin|ssn(?:[\s./_‐‑‒–—―-]+number)?|social[\s./_‐‑‒–—―-]+security(?:[\s./_‐‑‒–—―-]+number)?|signature|passport(?:[\s./_‐‑‒–—―-]+number)?|driver.?s?[\s./_‐‑‒–—―-]+licen[cs]e(?:[\s./_‐‑‒–—―-]+number)?|student[\s./_‐‑‒–—―-]+id(?:[\s./_‐‑‒–—―-]+number)?|visa(?:[\s./_‐‑‒–—―-]+number)?|itin(?:[\s./_‐‑‒–—―-]+number)?|identification(?:[\s./_‐‑‒–—―-]+number)?|id[\s./_‐‑‒–—―-]+number|ebt[\s./_‐‑‒–—―-]+pin|access[\s./_‐‑‒–—―-]+code|application[\s./_‐‑‒–—―-]+id|account[\s./_‐‑‒–—―-]+(?:number|no))\s*(?:is\s+|[:=#]\s*)\S+/i.test(normalized);
}
