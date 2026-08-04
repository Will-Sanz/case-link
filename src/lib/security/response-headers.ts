export const PRODUCTION_HSTS = "max-age=63072000; includeSubDomains; preload";

export function applyRuntimeHsts(
  headers: Pick<Headers, "set">,
  options: { productionDeployment: boolean; enableHsts: boolean },
): void {
  if (options.productionDeployment && options.enableHsts) {
    headers.set("Strict-Transport-Security", PRODUCTION_HSTS);
  }
}

export function buildSecurityHeaders(options: {
  production: boolean;
  enableHsts: boolean;
  supabaseUrl?: string;
}): Array<{ key: string; value: string }> {
  let supabaseOrigin = "https://*.supabase.co";
  let supabaseWebSocket = "wss://*.supabase.co";
  if (options.supabaseUrl) {
    try {
      const url = new URL(options.supabaseUrl);
      supabaseOrigin = url.origin;
      supabaseWebSocket = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    } catch {
      // Environment validation reports the malformed URL; keep a restrictive fallback here.
    }
  }

  const scriptSrc = options.production
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseWebSocket}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ...(options.production && options.enableHsts
      ? [{ key: "Strict-Transport-Security", value: PRODUCTION_HSTS }]
      : []),
  ];
}
