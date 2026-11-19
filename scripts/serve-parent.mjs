import { spawn } from "node:child_process";
import { parentTestEnvironment } from "./parent-test-environment.mjs";
import { parentAppBind } from "./parent-app-bind.mjs";

const bind = parentAppBind();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    bind.hostname,
    "--port",
    bind.port,
  ],
  {
    env: parentTestEnvironment(process.argv.includes("--local-services")),
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.once("error", () => {
  process.stderr.write("The local parent preview could not start.\n");
  process.exitCode = 1;
});
