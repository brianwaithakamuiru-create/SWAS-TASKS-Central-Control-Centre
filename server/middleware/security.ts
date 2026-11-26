import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { getAllowedOrigins } from '../config.ts';

export const securityHeadersMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  xFrameOptions: false,
});

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = getAllowedOrigins();
    if (allowed.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Correlation-Id',
    'Idempotency-Key',
    'X-Gmail-Access-Token',
  ],
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests. Please wait before retrying.' },
});

export const authAttemptRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});
