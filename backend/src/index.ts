import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import contactsRouter from './routes/contacts';
import dealsRouter from './routes/deals';
import dashboardRouter from './routes/dashboard';
import segmentsRouter from './routes/segments';
import companiesRouter from './routes/companies';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 4000;
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Request timing header (useful for frontend skeleton state decisions)
app.use((_req, res, next) => {
  res.setHeader('X-Response-Time-Start', Date.now().toString());
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/dashboard', dashboardRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/segments', segmentsRouter);
app.use('/api/companies', companiesRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Boot (local dev only — Vercel handles the server in production) ─────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`EasyCRM API running on http://localhost:${PORT}`);
  });
}

export default app;
