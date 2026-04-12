import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { z } from 'zod';
import {
  FilterParams,
  buildContactWhere,
  buildContactOrderBy,
  parsePagination,
} from '../services/filter-builder';
import { streamExport, ExportFormat } from '../services/export-service';

const ContactSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(50).nullable().optional(),
  title: z.string().max(150).nullable().optional(),
  role: z.enum(['executive', 'manager', 'associate', 'stakeholder']),
  region: z.string().max(100).nullable().optional(),
  health: z.enum(['healthy', 'at_risk', 'critical']).default('healthy'),
  company_id: z.string().uuid().nullable().optional(),
});

const router = Router();

function parseFilters(query: Request['query']): FilterParams {
  return {
    search: query.search as string | undefined,
    region: query.region ? String(query.region).split(',') : undefined,
    health: query.health ? String(query.health).split(',') : undefined,
    role: query.role ? String(query.role).split(',') : undefined,
    industry: query.industry ? String(query.industry).split(',') : undefined,
    size: query.size ? String(query.size).split(',') : undefined,
    dateRange: query.dateRange as string | undefined,
    dateFrom: query.dateFrom as string | undefined,
    dateTo: query.dateTo as string | undefined,
    sortBy: query.sortBy as string | undefined,
    sortDir: query.sortDir as 'asc' | 'desc' | undefined,
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

// GET /api/contacts — paginated, filtered list
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const { sql: where, values } = buildContactWhere(filters);
    const orderBy = buildContactOrderBy(filters);
    const { limit, offset } = parsePagination(filters);

    const countValues = [...values];
    const rowValues = [...values, limit, offset];

    const [countResult, rowsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
         WHERE ${where}`,
        countValues
      ),
      pool.query(
        `SELECT
           c.id, c.first_name, c.last_name, c.email, c.phone,
           c.title, c.role, c.region, c.health,
           c.last_activity_at, c.created_at,
           co.id AS company_id, co.name AS company_name,
           co.industry, co.size AS company_size
         FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
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
    console.error('GET /contacts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/:id — single contact with recent activities
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [contactRes, activitiesRes, dealsRes] = await Promise.all([
      pool.query(
        `SELECT c.*, co.name AS company_name, co.industry, co.arr, co.size AS company_size
         FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
         WHERE c.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT * FROM activities WHERE contact_id = $1
         ORDER BY occurred_at DESC LIMIT 20`,
        [id]
      ),
      pool.query(
        `SELECT d.id, d.title, d.stage, d.value, d.close_date, d.probability
         FROM deals d WHERE d.contact_id = $1 ORDER BY d.updated_at DESC`,
        [id]
      ),
    ]);

    if (!contactRes.rows[0]) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({
      ...contactRes.rows[0],
      recent_activities: activitiesRes.rows,
      deals: dealsRes.rows,
    });
  } catch (err) {
    console.error('GET /contacts/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/export?format=csv|excel — export current filtered view
router.get('/export', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const format = (req.query.format as ExportFormat) ?? 'csv';
    const { sql: where, values } = buildContactWhere(filters);
    const orderBy = buildContactOrderBy(filters);

    const result = await pool.query(
      `SELECT
         c.first_name, c.last_name, c.email, c.phone,
         c.title, c.role, c.region, c.health,
         c.last_activity_at, c.created_at,
         co.name AS company_name, co.industry
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT 10000`,
      values
    );

    await streamExport({
      format,
      filename: `contacts-export-${new Date().toISOString().split('T')[0]}`,
      columns: [
        { key: 'first_name', header: 'First Name' },
        { key: 'last_name', header: 'Last Name' },
        { key: 'email', header: 'Email' },
        { key: 'phone', header: 'Phone' },
        { key: 'title', header: 'Title' },
        { key: 'role', header: 'Role' },
        { key: 'company_name', header: 'Company' },
        { key: 'industry', header: 'Industry' },
        { key: 'region', header: 'Region' },
        { key: 'health', header: 'Health' },
        { key: 'last_activity_at', header: 'Last Activity' },
        { key: 'created_at', header: 'Created At' },
      ],
      rows: result.rows,
      res,
    });
  } catch (err) {
    console.error('GET /contacts/export error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
  }
});

// POST /api/contacts — create contact
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = ContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid contact data', details: parsed.error.flatten() });
      return;
    }

    const { first_name, last_name, email, phone, title, role, region, health, company_id } = parsed.data;

    const result = await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, phone, title, role, region, health, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [first_name, last_name, email, phone ?? null, title ?? null, role, region ?? null, health, company_id ?? null]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'A contact with this email already exists' });
      return;
    }
    console.error('POST /contacts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/contacts/:id — full update
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = ContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid contact data', details: parsed.error.flatten() });
      return;
    }

    const { first_name, last_name, email, phone, title, role, region, health, company_id } = parsed.data;

    const result = await pool.query(
      `UPDATE contacts SET
         first_name = $1, last_name = $2, email = $3, phone = $4,
         title = $5, role = $6, region = $7, health = $8, company_id = $9,
         updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [first_name, last_name, email, phone ?? null, title ?? null, role, region ?? null, health, company_id ?? null, id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'A contact with this email already exists' });
      return;
    }
    console.error('PUT /contacts/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM contacts WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /contacts/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
