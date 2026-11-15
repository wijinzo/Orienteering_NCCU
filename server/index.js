import { readConfig } from './config.js';
import { createRepository } from './repository.js';
import { createApp } from './app.js';

try {
  const config = readConfig();
  const app = createApp({ config, repository: createRepository(config) });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Orienteering NCCU listening on port ${config.port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
