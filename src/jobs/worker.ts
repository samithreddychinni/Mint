import { tick } from "./tick";
import { connection } from "../db";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log(
  "MINT worker started. Durable expiry and payment reconciliation, 30-second cadence.",
);
while (!stopping) {
  const start = Date.now();
  try {
    await tick();
    console.log("Worker tick completed", new Date().toISOString());
  } catch {
    console.error("Worker tick failed; pending jobs remain durable.");
  }
  if (process.argv.includes("--once")) break;
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(1000, 30000 - (Date.now() - start))),
  );
}
await connection.end();
