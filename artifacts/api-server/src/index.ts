import app from "./app";
import { initSchema } from "./lib/db";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    await initSchema();
    logger.info("Database schema ready");
  } catch (err) {
    logger.error({ err }, "Schema init failed at startup — check DATABASE_URL");
    process.exit(1);
  }

  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
  });
}

start();
