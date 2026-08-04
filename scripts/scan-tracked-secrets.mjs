import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const patterns = [
  ["private key", new RegExp(["-----BEGIN", "PRIVATE KEY-----"].join(" "))],
  ["OpenAI API key", new RegExp(`s${"k-"}(?:(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})`, "g")],
  ["Supabase secret key", new RegExp(`sb_${"secret_"}[A-Za-z0-9_-]{20,}`, "g")],
  ["GitHub token", new RegExp(`gh${"[pousr]_"}[A-Za-z0-9]{30,}`, "g")],
  ["AWS access key", new RegExp(`AK${"IA"}[A-Z0-9]{16}`, "g")],
];

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const findings = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const bytes = readFileSync(file);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) continue;
  const contents = bytes.toString("utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(contents);
    if (!match) continue;
    const before = contents.slice(0, match.index);
    const line = before.split("\n").length;
    findings.push(`${file}:${line} (${label})`);
  }
}

if (findings.length > 0) {
  console.error("Potential committed secrets detected; values are intentionally hidden:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed (${files.length} tracked or unignored files).`);
}
