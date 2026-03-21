export function emptyToNull(s: string | undefined | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export function normalizeEmail(s: string | null | undefined): string | null {
  const v = emptyToNull(s);
  return v ? v.toLowerCase() : null;
}

export function normalizePhoneDisplay(s: string | null | undefined): string | null {
  return emptyToNull(s);
}

export function phoneToNormalizedDigits(s: string | null | undefined): string | null {
  const v = emptyToNull(s);
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Yes/No, TRUE/FALSE, 1/0 → boolean | null */
export function parseOptionalBoolean(s: string | null | undefined): boolean | null {
  const v = emptyToNull(s);
  if (!v) return null;
  const u = v.toLowerCase();
  if (["yes", "y", "true", "1"].includes(u)) return true;
  if (["no", "n", "false", "0"].includes(u)) return false;
  return null;
}

/** CSV service columns use TRUE/FALSE */
export function parseServiceFlag(s: string | null | undefined): boolean {
  const v = emptyToNull(s);
  if (!v) return false;
  return v.toUpperCase() === "TRUE" || v.toLowerCase() === "true";
}

type ContactTriplet = {
  title: string | null;
  email: string | null;
  phone: string | null;
  phoneNorm: string | null;
};

function classifyFragment(s: string): "email" | "phone" | "title" | "empty" {
  const t = s.trim();
  if (!t) return "empty";
  if (t.includes("@")) return "email";
  if (/\d{3,}/.test(t) && /^[\d\s\-().+xext]+$/i.test(t.replace(/\s/g, ""))) {
    return "phone";
  }
  return "title";
}

/**
 * Primary contact columns in the export are sometimes misaligned (e.g. phone in "title").
 * Expects raw title, email, phone column values in spreadsheet order.
 */
export function orderPrimaryContactTriplet(
  colTitle: string | null | undefined,
  colEmail: string | null | undefined,
  colPhone: string | null | undefined,
): ContactTriplet {
  const a = colTitle ?? "";
  const b = colEmail ?? "";
  const c = colPhone ?? "";
  const ta = classifyFragment(a);
  const tb = classifyFragment(b);
  const tc = classifyFragment(c);

  if (tb === "email" && ta === "title" && (tc === "phone" || tc === "empty")) {
    return {
      title: emptyToNull(a),
      email: normalizeEmail(b),
      phone: normalizePhoneDisplay(c),
      phoneNorm: phoneToNormalizedDigits(c),
    };
  }

  if (ta === "phone" && tb === "email") {
    return {
      title: null,
      email: normalizeEmail(b),
      phone: normalizePhoneDisplay(a),
      phoneNorm: phoneToNormalizedDigits(a),
    };
  }

  if (ta === "title" && tb === "email" && tc === "phone") {
    return {
      title: emptyToNull(a),
      email: normalizeEmail(b),
      phone: normalizePhoneDisplay(c),
      phoneNorm: phoneToNormalizedDigits(c),
    };
  }

  return {
    title: emptyToNull(a),
    email: normalizeEmail(b),
    phone: normalizePhoneDisplay(c),
    phoneNorm: phoneToNormalizedDigits(c),
  };
}

export function secondaryContact(
  name: string | null | undefined,
  title: string | null | undefined,
  email: string | null | undefined,
  phone: string | null | undefined,
) {
  return {
    name: emptyToNull(name),
    title: emptyToNull(title),
    email: normalizeEmail(email),
    phone: normalizePhoneDisplay(phone),
    phoneNorm: phoneToNormalizedDigits(phone),
  };
}

export function slugifyPart(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}
