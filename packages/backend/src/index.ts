import express from "express";
import cors from "cors";
import multer from "multer";
import os from "os";
import { simulateHandler } from "./simulate";
import { uploadHandler } from "./upload";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Store uploaded files in OS temp dir until we move them into Hardhat
const upload = multer({ dest: os.tmpdir() });

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.post("/simulate", simulateHandler);
app.post("/upload", upload.single("contract"), uploadHandler);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`  POST /simulate  { "attack": "reentrancy|accesscontrol|flashloan|inputvalidation|overflow" }`);
  console.log(`  POST /upload    form-data, field: contract (.sol file)`);
});
