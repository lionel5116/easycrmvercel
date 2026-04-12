import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';

const router = Router();

// GET /api/companies — lightweight list for dropdowns
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, industry, region, size FROM companies ORDER BY name ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /companies error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
