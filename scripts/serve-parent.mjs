import { spawn } from "node:child_process";
import { parentTestEnvironment } from "./parent-test-environment.mjs";

const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3200",
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
