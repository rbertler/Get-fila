import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

import authRoutes from './routes/auth.js';
import recordsRoutes from './routes/records.js';
import historyRoutes from './routes/history.js';
import appointmentsRoutes from './routes/appointments.js';
import labsRoutes from './routes/labs.js';
import insightsRoutes from './routes/insights.js';
import shareRoutes from './routes/share.js';
import googleRoutes from './routes/google.js';
import dashboardRoutes from './routes/dashboard.js';
import providersRoutes from './routes/providers.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  'http://localhost:5173',
  'https://get-fila.vercel.app',
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 200 : 2000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/labs', labsRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/providers', providersRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fila API running on http://localhost:${PORT}`);
});

export default app;
