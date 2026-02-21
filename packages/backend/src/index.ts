import express from "express";
import cors from "cors";
import { simulateHandler } from "./simulate";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.post("/simulate", simulateHandler);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`  POST /simulate  { "attack": "reentrancy" }`);
});
