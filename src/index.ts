import { startServer } from './api/server.js';
import { logger } from './utils/logger.js';

startServer().catch((err) => {
  logger.error(`Start fehlgeschlagen: ${(err as Error).message}`, { stage: 'startup', success: false });
  process.exitCode = 1;
});
