import app from "./app";
import { initSchema } from "./lib/db";

let schemaReady = false;
const schemaPromise = initSchema()
  .then(() => { schemaReady = true; })
  .catch((err) => { console.error("[DB] Schema init failed:", err); });

export async function getApp() {
  if (!schemaReady) await schemaPromise;
  return app;
}

export default app;
