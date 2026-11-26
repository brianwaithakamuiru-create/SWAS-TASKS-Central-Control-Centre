import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { serverConfig } from './server/config.ts';
import {
  apiRateLimiter,
  corsMiddleware,
  securityHeadersMiddleware,
} from './server/middleware/security.ts';
import { renderSwaggerHtml } from './server/openapi.ts';
import { v1Router } from './server/routes/v1.ts';
import { startEmailSchedulerLoop } from './server/services/messaging.ts';

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/docs', (_req: Request, res: Response) => {
    res.type('html').send(renderSwaggerHtml());
  });

  app.use('/api/v1', apiRateLimiter, v1Router);

  // Centralized API Error Handler
  app.use('/api', (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API Error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  if (serverConfig.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(serverConfig.port, '0.0.0.0', () => {
    startEmailSchedulerLoop(30_000);
    console.log(`SWAS TASKS Central Control Centre listening on http://0.0.0.0:${serverConfig.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Central Control Centre server:', err);
  process.exit(1);
});
