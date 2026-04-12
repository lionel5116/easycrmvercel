import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { z } from 'zod';
import {
  FilterParams,
  buildDealWhere,
  buildDealOrderBy,
  parsePagination,
} from '../services/filter-builder';
import { streamExport, ExportFormat } from '../services/export-service';

const DealSchema = z.object({
  title: z.string().min(1).max(200),
  stage: z.enum(['prospecting', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost']),
  value: z.number().min(0),
  close_date: z.string().nullable().optional(),
  probability: z.number().min(0).max(100).default(0),
  region: z.string().max(100).nullable().optional(),
  owner: z.string().max(150).nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
});

const router = Router();

function parseFilters(query: Request['query']): FilterParams {
  return {
    search: query.search as string | undefined,
    region: query.region ? String(query.region).split(',') : undefined,
    stage: query.stage ? String(query.stage).split(',') : undefined,
    dateRange: query.dateRange as string | undefined,
    dateFrom: query.dateFrom as string | undefined,
    dateTo: query.dateTo as string | undefined,
    minValue: query.minValue ? Number(query.minValue) : undefined,
    maxValue: query.maxValue ? Number(query.maxValue) : undefined,
    sortBy: query.sortBy as string | undefined,
    sortDir: query.sortDir as 'asc' | 'desc' | undefined,
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

// GET /api/deals — paginated, filtered list
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const { sql: where, values } = buildDealWhere(filters);
    const orderBy = buildDealOrderBy(filters);
    const { limit, offset } = parsePagination(filters);

    const countValues = [...values];
    const rowValues = [...values, limit, offset];

    const [countResult, rowsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM deals d WHERE ${where}`,
        countValues
      ),
      pool.query(
        `SELECT
           d.id, d.title, d.stage, d.value, d.close_date,
           d.probability, d.region, d.owner, d.created_at, d.updated_at,
           co.id AS company_id, co.name AS company_name,
           c.id AS contact_id,
           c.first_name || ' ' || c.last_name AS contact_name
         FROM deals d
         LEFT JOIN companies co ON co.id = d.company_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        rowValues
      ),
    ]);

    res.json({
      data: rowsResult.rows,
      total: Number(countResult.rows[0].count),
      page: filters.page ?? 1,
      limit,
    });
  } catch (err) {
    console.error('GET /deals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/deals/summary — pipeline aggregation by stage
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const { sql: where, values } = buildDealWhere(filters);

    const result = await pool.query(
      `SELECT
         d.stage,
         COUNT(*)::int AS count,
         COALESCE(SUM(d.value), 0)::numeric AS total_value,
         COALESCE(AVG(d.probability), 0)::numeric AS avg_probability,
         COALESCE(SUM(d.value * d.probability / 100), 0)::numeric AS weighted_value
       FROM deals d
       WHERE ${where}
       GROUP BY d.stage
       ORDER BY
         ARRAY_POSITION(
           ARRAY['prospecting','qualified','proposal','negotiation','closed_won','closed_lost'],
           d.stage::text
         )`,
      values
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /deals/summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/deals/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [dealRes, activitiesRes] = await Promise.all([
      pool.query(
        `SELECT d.*,
           co.name AS company_name, co.industry,
           c.first_name || ' ' || c.last_name AS contact_name,
           c.email AS contact_email
         FROM deals d
         LEFT JOIN companies co ON co.id = d.company_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         WHERE d.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT * FROM activities WHERE deal_id = $1
         ORDER BY occurred_at DESC LIMIT 20`,
        [id]
      ),
    ]);

    if (!dealRes.rows[0]) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    res.json({ ...dealRes.rows[0], activities: activitiesRes.rows });
  } catch (err) {
    console.error('GET /deals/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/deals/export?format=csv|excel
router.get('/export', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const format = (req.query.format as ExportFormat) ?? 'csv';
    const { sql: where, values } = buildDealWhere(filters);
    const orderBy = buildDealOrderBy(filters);

    const result = await pool.query(
      `SELECT
         d.title, d.stage, d.value, d.close_date, d.probability,
         d.region, d.owner, d.created_at,
         co.name AS company_name,
         c.first_name || ' ' || c.last_name AS contact_name
       FROM deals d
       LEFT JOIN companies co ON co.id = d.company_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT 10000`,
      values
    );

    await streamExport({
      format,
      filename: `deals-export-${new Date().toISOString().split('T')[0]}`,
      columns: [
        { key: 'title', header: 'Deal Name' },
        { key: 'stage', header: 'Stage' },
        { key: 'value', header: 'Value ($)' },
        { key: 'close_date', header: 'Close Date' },
        { key: 'probability', header: 'Probability (%)' },
        { key: 'owner', header: 'Owner' },
        { key: 'company_name', header: 'Company' },
        { key: 'contact_name', header: 'Primary Contact' },
        { key: 'region', header: 'Region' },
        { key: 'created_at', header: 'Created At' },
      ],
      rows: result.rows,
      res,
    });
  } catch (err) {
    console.error('GET /deals/export error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
  }
});

// POST /api/deals — create deal
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = DealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid deal data', details: parsed.error.flatten() });
      return;
    }

    const { title, stage, value, close_date, probability, region, owner, company_id, contact_id } = parsed.data;

    const result = await pool.query(
      `INSERT INTO deals (title, stage, value, close_date, probability, region, owner, company_id, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, stage, value, close_date ?? null, probability, region ?? null, owner ?? null, company_id ?? null, contact_id ?? null]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('POST /deals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/deals/:id — full update
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = DealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid deal data', details: parsed.error.flatten() });
      return;
    }

    const { title, stage, value, close_date, probability, region, owner, company_id, contact_id } = parsed.data;

    const result = await pool.query(
      `UPDATE deals SET
         title = $1, stage = $2, value = $3, close_date = $4, probability = $5,
         region = $6, owner = $7, company_id = $8, contact_id = $9,
         updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [title, stage, value, close_date ?? null, probability, region ?? null, owner ?? null, company_id ?? null, contact_id ?? null, id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('PUT /deals/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/deals/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM deals WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /deals/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
