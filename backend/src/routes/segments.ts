import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { z } from 'zod';

const router = Router();

const SegmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  filters: z.record(z.unknown()),
  is_shared: z.boolean().optional().default(false),
  created_by: z.string().optional(),
});

// GET /api/segments
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM segments ORDER BY is_shared DESC, created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /segments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/segments
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = SegmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid segment data', details: parsed.error.flatten() });
      return;
    }

    const { name, description, filters, is_shared, created_by } = parsed.data;
    const result = await pool.query(
      `INSERT INTO segments (name, description, filters, is_shared, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description ?? null, JSON.stringify(filters), is_shared, created_by ?? null]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('POST /segments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/segments/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = SegmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.flatten() });
      return;
    }

    const { name, description, filters, is_shared } = parsed.data;
    const result = await pool.query(
      `UPDATE segments SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         filters = COALESCE($3, filters),
         is_shared = COALESCE($4, is_shared),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name ?? null, description ?? null, filters ? JSON.stringify(filters) : null, is_shared ?? null, id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('PUT /segments/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/segments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM segments WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /segments/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
