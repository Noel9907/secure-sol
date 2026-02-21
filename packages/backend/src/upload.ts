import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { analyzeContract } from "./analyzeContract";

const HARDHAT_DIR   = path.resolve(__dirname, "../../hardhat");
const UPLOADED_DIR  = path.join(HARDHAT_DIR, "contracts", "uploaded");

const ATTACK_SCRIPTS = [
  "scripts/simulate/runReentrancyUpload.ts",
  "scripts/simulate/runInputValidationUpload.ts",
  "scripts/simulate/runOverflowUpload.ts",
  "scripts/simulate/runAccessControlUpload.ts",
];

export function uploadHandler(req: Request, res: Response) {
  if (!req.file)
    return res.status(400).json({ error: "No file uploaded. Use field name 'contract'." });

  const originalName = req.file.originalname;
  if (!originalName.endsWith(".sol")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Only .sol files are accepted." });
  }

  const fileName = path.basename(originalName, ".sol");
  const destPath = path.join(UPLOADED_DIR, originalName);
  fs.copyFileSync(req.file.path, destPath);
  fs.unlinkSync(req.file.path);
  console.log(`[upload] ${originalName} → ${destPath}`);

  compile(fileName)
    .then(({ contractName }) => {
      console.log(`[upload] "${contractName}" compiled. Running AI analysis...`);

      analyzeContract(destPath).then(analysis => {
        const analysisJson = JSON.stringify(analysis);
        console.log(`[upload] Analysis done. Running attack scripts...`);

        runSequential(
          ATTACK_SCRIPTS.map(script => () => runScript(script, contractName, fileName, analysisJson))
        )
          .then(simulations => {
            const vulnerable = simulations.filter(
              s => s.attack?.success === true || s.attack?.patternDetected === true,
            );
            res.json({
              contractName,
              fileName: originalName,
              vulnerabilitiesFound: vulnerable.map(s => s.attack?.type),
              simulations,
            });
          })
          .catch(err => res.status(500).json({ error: "Simulation failed", details: err.message }));
      });
    })
    .catch(err => res.status(400).json({ error: "Compilation failed", details: err.message }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compile(fileName: string): Promise<{ abi: any[]; contractName: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "compile"], { cwd: HARDHAT_DIR, shell: true });
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.stdout.on("data", () => {});
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1500)));
      const artifactDir = path.join(HARDHAT_DIR, "artifacts", "contracts", "uploaded", `${fileName}.sol`);
      try {
        const files = fs.readdirSync(artifactDir).filter(f => f.endsWith(".json") && !f.endsWith(".dbg.json"));
        if (!files.length) return reject(new Error(`No artifact in ${artifactDir}`));
        const artifact = JSON.parse(fs.readFileSync(path.join(artifactDir, files[0]), "utf-8"));
        const contractName = path.basename(files[0], ".json");
        console.log(`[upload] contractName="${contractName}"`);
        resolve({ abi: artifact.abi, contractName });
      } catch (e: any) { reject(new Error(`Artifact read failed: ${e.message}`)); }
    });
  });
}

function runScript(script: string, contractName: string, fileName: string, analysisJson: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "run", script, "--network", "localhost"], {
      cwd: HARDHAT_DIR,
      shell: true,
      env: { ...process.env, UPLOADED_CONTRACT_NAME: contractName, UPLOADED_FILE_NAME: fileName, ANALYSIS_JSON: analysisJson },
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1500)));
      const line = stdout.split("\n").find(l => l.startsWith("SIMULATION_RESULT:"));
      if (!line) return reject(new Error("No SIMULATION_RESULT:\n" + stdout.slice(-500)));
      try { resolve(JSON.parse(line.replace("SIMULATION_RESULT:", ""))); }
      catch { reject(new Error("Bad result JSON: " + line)); }
    });
  });
}

function runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return tasks.reduce(
    (chain, task) => chain.then(results => task().then(r => [...results, r])),
    Promise.resolve([] as T[]),
  );
}
