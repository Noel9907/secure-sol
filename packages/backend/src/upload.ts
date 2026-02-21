import { Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const HARDHAT_DIR = path.resolve(__dirname, "../../hardhat");
const UPLOADED_DIR = path.join(HARDHAT_DIR, "contracts", "uploaded");

// All upload attack scripts — every uploaded contract is tested against all of them.
// Each script handles its own applicability check and returns success:true or false.
const UPLOAD_SCRIPTS = [
  "scripts/simulate/runReentrancyUpload.ts",
  "scripts/simulate/runInputValidationUpload.ts",
  "scripts/simulate/runOverflowUpload.ts",
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

  const fileName = path.basename(originalName, ".sol"); // e.g. "vul" from "vul.sol"
  const destPath = path.join(UPLOADED_DIR, originalName);

  fs.copyFileSync(req.file.path, destPath);
  fs.unlinkSync(req.file.path);
  console.log(`[upload] ${originalName} → ${destPath}`);

  // Compile first to get the real contract name from inside the file
  compile(fileName)
    .then(({ abi: _abi, contractName }) => {
      console.log(`[upload] "${contractName}" compiled. Running all attack scripts...`);

      // Run all 3 attack scripts sequentially — each returns a result regardless of outcome
      runSequential(UPLOAD_SCRIPTS.map(script => () => runScript(script, contractName, fileName)))
        .then(simulations => {
          // A vulnerability is flagged if ETH was stolen (success) OR the pattern was confirmed (patternDetected).
          // patternDetected covers cases like reentrancy where the code is wrong but ETH theft was blocked in this run.
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
        .catch(err => {
          res.status(500).json({ error: "Simulation failed", details: err.message });
        });
    })
    .catch(err => {
      res.status(400).json({ error: "Compilation failed", details: err.message });
    });
}

function compile(fileName: string): Promise<{ abi: any[]; contractName: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "compile"], {
      cwd: HARDHAT_DIR,
      shell: true,
    });

    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.stdout.on("data", () => {});

    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1500)));

      // Hardhat names the artifact after the contract name, not the filename
      const artifactDir = path.join(HARDHAT_DIR, "artifacts", "contracts", "uploaded", `${fileName}.sol`);
      try {
        const files = fs.readdirSync(artifactDir).filter(f => f.endsWith(".json") && !f.endsWith(".dbg.json"));
        if (files.length === 0) return reject(new Error(`No artifact found in ${artifactDir}`));

        const artifact = JSON.parse(fs.readFileSync(path.join(artifactDir, files[0]), "utf-8"));
        const contractName = path.basename(files[0], ".json");
        console.log(`[upload] Contract name inside file: "${contractName}"`);
        resolve({ abi: artifact.abi, contractName });
      } catch (e: any) {
        reject(new Error(`Could not read artifact: ${e.message}`));
      }
    });
  });
}

function runScript(script: string, contractName: string, fileName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "run", script, "--network", "localhost"], {
      cwd: HARDHAT_DIR,
      shell: true,
      env: {
        ...process.env,
        UPLOADED_CONTRACT_NAME: contractName,
        UPLOADED_FILE_NAME: fileName,
      },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    proc.on("close", code => {
      if (code !== 0) return reject(new Error(stderr.slice(-1000)));

      const resultLine = stdout.split("\n").find(l => l.startsWith("SIMULATION_RESULT:"));
      if (!resultLine) return reject(new Error("No SIMULATION_RESULT in output:\n" + stdout.slice(-400)));

      try {
        resolve(JSON.parse(resultLine.replace("SIMULATION_RESULT:", "")));
      } catch {
        reject(new Error("Failed to parse result JSON: " + resultLine));
      }
    });
  });
}

function runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return tasks.reduce(
    (chain, task) => chain.then(results => task().then(r => [...results, r])),
    Promise.resolve([] as T[]),
  );
}
