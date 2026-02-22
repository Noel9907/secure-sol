import { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";

const HARDHAT_DIR = path.resolve(__dirname, "../../hardhat");

const SCRIPTS: Record<string, string> = {
  inputvalidation: "scripts/simulate/runInputValidation.ts",
  overflow: "scripts/simulate/runOverflow.ts",
  reentrancy: "scripts/simulate/runReentrancy.ts",
  accesscontrol: "scripts/simulate/runAccessControl.ts",
  flashloan: "scripts/simulate/runFlashLoan.ts",
};

export function simulateHandler(req: Request, res: Response) {
  const { attack } = req.body as { attack: string };
  const script = SCRIPTS[attack];

  if (!script) {
    return res.status(400).json({ error: `Unknown attack type: "${attack}". Valid: ${Object.keys(SCRIPTS).join(", ")}` });
  }

  console.log(`[simulate] Running attack="${attack}" script="${script}"`);

  const proc = spawn("npx", ["hardhat", "run", script, "--network", "localhost"], {
    cwd: HARDHAT_DIR,
    shell: true,
  });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on("close", (code: number) => {
    if (code !== 0) {
      console.error(`[simulate] Script exited with code ${code}\n${stderr}`);
      return res.status(500).json({ error: "Simulation script failed", details: stderr.slice(-1000) });
    }

    // Find the line with our sentinel prefix
    const resultLine = stdout
      .split("\n")
      .find(line => line.startsWith("SIMULATION_RESULT:"));

    if (!resultLine) {
      console.error("[simulate] No SIMULATION_RESULT line found in stdout:\n", stdout);
      return res.status(500).json({ error: "No result output from script", raw: stdout.slice(-500) });
    }

    try {
      const result = JSON.parse(resultLine.replace("SIMULATION_RESULT:", ""));
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: "Failed to parse result JSON", raw: resultLine });
    }
  });
}
