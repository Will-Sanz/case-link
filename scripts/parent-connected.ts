import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { parentConnectedEnvironment } from "./parent-connected-environment";
import { parentAppBind } from "./parent-app-bind.mjs";

const command = process.argv[2];
if (command !== "build" && command !== "serve")
  throw new Error("Choose the connected parent build or serve command.");
const bind = command === "serve" ? parentAppBind() : null;

const source: Record<string, string> = {};
for (const file of [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
])
  if (existsSync(file))
    for (const [key, value] of Object.entries(parse(readFileSync(file))))
      if (!(key in source)) source[key] = value;

const env = parentConnectedEnvironment(source, process.env);
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(env).filter(
          ([key]) => !["PATH", "HOME", "TMPDIR", "CI"].includes(key),
        ),
      ),
    ),
  )
  .digest("hex");
const marker = "tmp/parent-connected-build.json";
if (command === "serve") {
  const built = JSON.parse(readFileSync(marker, "utf8"));
  if (
    built.fingerprint !== fingerprint ||
    built.buildId !== readFileSync(".next/BUILD_ID", "utf8").trim()
  )
    throw new Error(
      "Build the approved connected parent profile before starting it.",
    );
}
process.stdout.write(
  command === "build"
    ? "Building the approved existing-account parent connection.\n"
    : `Starting the approved existing-account parent connection on ${bind!.origin}.\n`,
);
const child = spawn(
  command === "build" ? "npm" : process.execPath,
  command === "build"
    ? ["run", "build"]
    : [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        bind!.hostname,
        "--port",
        bind!.port,
      ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => child.kill(signal));
child.once("exit", (code) => {
  if (command === "build" && code === 0) {
    mkdirSync("tmp", { recursive: true });
    writeFileSync(
      marker,
      JSON.stringify({
        fingerprint,
        buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
      }),
      { mode: 0o600 },
    );
  }
  process.exitCode = code ?? 1;
});
child.once("error", () => {
  process.stderr.write("The connected parent runtime could not start.\n");
  process.exitCode = 1;
});
