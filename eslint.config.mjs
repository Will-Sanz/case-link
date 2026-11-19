import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "tmp/**",
    "output/**",
    "next-env.d.ts",
    // Unmodified PDF.js codec; the viewer test checks installed-package byte equality.
    "public/pdfjs/6.5.438/jbig2_nowasm_fallback.js",
    // Project-local design tooling and generated visual artifacts.
    ".agents/**",
    ".impeccable/**",
    "supabase/.branches/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
