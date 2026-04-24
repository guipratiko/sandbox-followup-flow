import express, { Router } from 'express';
import cors from 'cors';
import { env } from './config/env';
import healthRoutes from './routes/health';
import sequencesRoutes from './routes/sequences';
import { errorHandler } from './middleware/errorHandler';
import { startFollowupWorker, processDueFollowupSteps } from './worker';

const app = express();
app.use(express.json({ limit: '12mb' }));

function isAllowedOnlyflowOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname.endsWith('.onlyflow.com.br') ||
      u.hostname === 'onlyflow.com.br'
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (env.corsOrigins.length > 0) {
        cb(null, env.corsOrigins.includes(origin));
        return;
      }
      if (isAllowedOnlyflowOrigin(origin)) {
        cb(null, true);
        return;
      }
      if (env.NODE_ENV !== 'production') {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-effective-user-id', 'x-self-user-id'],
  })
);

const api = Router();
api.use('/followup-flow', sequencesRoutes);

app.use('/api', api);
app.use('/', healthRoutes);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[followup-flow] listening on port ${env.PORT} (${env.NODE_ENV})`);
  if (!env.postgresUri) {
    console.warn('[followup-flow] POSTGRES_URI ausente — API e worker não funcionarão.');
  }
  if (!env.evolutionBaseUrl) {
    console.warn('[followup-flow] EVOLUTION_API_BASE_URL ausente — envios falharão.');
  }
  setTimeout(() => void processDueFollowupSteps(), 5000);
  startFollowupWorker();
});
