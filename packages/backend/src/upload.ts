import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const HARDHAT_DIR = path.resolve(__dirname, "../../hardhat");
const UPLOADED_DIR = path.join(HARDHAT_DIR, "contracts", "uploaded");

// Detect vulnerability patterns from the compiled ABI
const DETECTORS = [
  {
    attack: "reentrancy",
    detect: (abi: any[]) =>
      abi.some(f => f.type === "function" && f.name === "withdraw" && f.inputs?.length === 0) &&
      abi.some(f => f.type === "function" && f.name === "deposit" && f.stateMutability === "payable"),
    script: "scripts/simulate/runReentrancyUpload.ts",
  },
  {
    attack: "inputvalidation",
    detect: (abi: any[]) =>
      abi.some(
        f => f.type === "function" && f.name === "withdraw" && f.inputs?.length === 1 && f.inputs[0].type === "uint256",
      ) && abi.some(f => f.type === "function" && f.name === "deposit"),
    script: "scripts/simulate/runInputValidationUpload.ts",
  },
  {
    attack: "overflow",
    detect: (abi: any[]) =>
      (abi.some(f => f.type === "function" && f.name === "sendTokens" && f.inputs?.length === 2) ||
        abi.some(f => f.type === "function" && f.name === "transfer" && f.inputs?.length === 2)) &&
      abi.some(f => f.type === "function" && f.name === "redeem"),
    script: "scripts/simulate/runOverflowUpload.ts",
  },
];

export function uploadHandler(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded. Use field name 'contract'." });
  }

  const originalName = req.file.originalname;
  if (!originalName.endsWith(".sol")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Only .sol files are accepted." });
  }

  const contractName = path.basename(originalName, ".sol");
  const destPath = path.join(UPLOADED_DIR, originalName);

  // Save the uploaded file into the Hardhat contracts directory
  fs.copyFileSync(req.file.path, destPath);
  fs.unlinkSync(req.file.path);

  console.log(`[upload] ${originalName} → ${destPath}`);

  compile(contractName)
    .then(({ abi, contractName: realContractName }) => {
      const matches = DETECTORS.filter(d => d.detect(abi));
      console.log(
        `[upload] "${realContractName}": detected [${matches.map(m => m.attack).join(", ") || "none"}]`,
      );

      if (matches.length === 0) {
        return res.json({
          contractName: realContractName,
          message: "Compiled successfully. No known vulnerability patterns detected in the ABI.",
          detectedPatterns: [],
          simulations: [],
        });
      }

      // Run each matching attack script in sequence (avoid port contention on the Hardhat node)
      runSequential(matches.map(m => () => runUploadScript(m.script, realContractName)))
        .then(results => {
          res.json({
            contractName: realContractName,
            detectedPatterns: matches.map(m => m.attack),
            simulations: results,
          });
        })
        .catch(err => {
          res.status(500).json({ error: "Simulation failed", details: err.message });
        });
    })
    .catch(err => {
      res.status(400).json({ error: "Compilation failed", details: err.message });
    });
}

// Returns { abi, contractName } — the contract name comes from inside the .sol file, not the filename
function compile(fileName: string): Promise<{ abi: any[]; contractName: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "compile"], {
      cwd: HARDHAT_DIR,
      shell: true,
    });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.stdout.on("data", () => {}); // drain stdout

    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1500)));

      // Hardhat names the artifact after the contract name inside the file, not the filename.
      // Scan the artifact folder and pick the first non-debug JSON.
      const artifactDir = path.join(
        HARDHAT_DIR,
        "artifacts",
        "contracts",
        "uploaded",
        `${fileName}.sol`,
      );

      try {
        const files = fs.readdirSync(artifactDir).filter(f => f.endsWith(".json") && !f.endsWith(".dbg.json"));
        if (files.length === 0) return reject(new Error(`No artifact found in ${artifactDir}`));

        const artifactPath = path.join(artifactDir, files[0]);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
        const contractName = path.basename(files[0], ".json");

        console.log(`[upload] Compiled contract name: "${contractName}" (file: ${fileName}.sol)`);
        resolve({ abi: artifact.abi, contractName });
      } catch (e: any) {
        reject(new Error(`Could not read artifact from ${artifactDir}: ${e.message}`));
      }
    });
  });
}

function runUploadScript(script: string, contractName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "run", script, "--network", "localhost"], {
      cwd: HARDHAT_DIR,
      shell: true,
      env: { ...process.env, UPLOADED_CONTRACT_NAME: contractName },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1000)));

      const resultLine = stdout.split("\n").find(l => l.startsWith("SIMULATION_RESULT:"));
      if (!resultLine)
        return reject(new Error("No SIMULATION_RESULT in output:\n" + stdout.slice(-500)));

      try {
        resolve(JSON.parse(resultLine.replace("SIMULATION_RESULT:", "")));
      } catch {
        reject(new Error("Failed to parse result JSON: " + resultLine));
      }
    });
  });
}

// Run an array of async tasks one at a time
function runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return tasks.reduce(
    (chain, task) => chain.then(results => task().then(r => [...results, r])),
    Promise.resolve([] as T[]),
  );
}
