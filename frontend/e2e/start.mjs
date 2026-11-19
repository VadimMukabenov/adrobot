import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const python =
  process.env.ADROBOT_E2E_PYTHON || path.join(root, "backend/.venv/bin/python");
const child = spawn(python, [path.join(root, "frontend/e2e/serve.py")], {
  cwd: path.join(root, "backend"),
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
