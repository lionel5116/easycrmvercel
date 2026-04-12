/**
 * Dashboard route — returns all KPI aggregations in a single response
 * so the executive overview can load with one network request.
 */
import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { FilterParams, buildContactWhere, buildDealWhere } from '../services/filter-builder';

const router = Router();

function parseFilters(query: Request['query']): FilterParams {
  return {
    region: query.region ? String(query.region).split(',') : undefined,
    health: query.health ? String(query.health).split(',') : undefined,
    dateRange: query.dateRange as string | undefined,
    dateFrom: query.dateFrom as string | undefined,
    dateTo: query.dateTo as string | undefined,
  };
}

// GET /api/dashboard — all KPIs in one shot
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const contactFilter = buildContactWhere(filters);
    const dealFilter = buildDealWhere(filters);

    const [
      contactSummary,
      dealSummary,
      healthBreakdown,
      activityTrend,
      regionBreakdown,
    ] = await Promise.all([
      // Contact counts by health
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           SUM(CASE WHEN c.health = 'healthy' THEN 1 ELSE 0 END)::int AS healthy,
           SUM(CASE WHEN c.health = 'at_risk' THEN 1 ELSE 0 END)::int AS at_risk,
           SUM(CASE WHEN c.health = 'critical' THEN 1 ELSE 0 END)::int AS critical
         FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
         WHERE ${contactFilter.sql}`,
        contactFilter.values
      ),

      // Deal pipeline summary
      pool.query(
        `SELECT
           COUNT(*)::int AS total_deals,
           COALESCE(SUM(d.value), 0)::numeric AS total_pipeline,
           COALESCE(SUM(CASE WHEN d.stage = 'closed_won' THEN d.value ELSE 0 END), 0)::numeric AS won_value,
           COALESCE(SUM(CASE WHEN d.stage NOT IN ('closed_won','closed_lost')
             THEN d.value * d.probability / 100 ELSE 0 END), 0)::numeric AS weighted_pipeline,
           COALESCE(AVG(CASE WHEN d.stage NOT IN ('closed_won','closed_lost')
             THEN d.value END), 0)::numeric AS avg_deal_size
         FROM deals d
         WHERE ${dealFilter.sql}`,
        dealFilter.values
      ),

      // Health breakdown for ring chart
      pool.query(
        `SELECT c.health, COUNT(*)::int AS count
         FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
         WHERE ${contactFilter.sql}
         GROUP BY c.health`,
        contactFilter.values
      ),

      // Activity trend — last 30 days by day
      pool.query(
        `SELECT
           DATE_TRUNC('day', occurred_at)::date AS date,
           COUNT(*)::int AS count,
           type
         FROM activities
         WHERE occurred_at >= NOW() - INTERVAL '30 days'
         GROUP BY date, type
         ORDER BY date ASC`
      ),

      // Pipeline by region
      pool.query(
        `SELECT
           d.region,
           COUNT(*)::int AS deal_count,
           COALESCE(SUM(d.value), 0)::numeric AS total_value
         FROM deals d
         WHERE ${dealFilter.sql}
           AND d.stage NOT IN ('closed_lost')
         GROUP BY d.region
         ORDER BY total_value DESC`,
        dealFilter.values
      ),
    ]);

    res.json({
      contacts: contactSummary.rows[0],
      deals: dealSummary.rows[0],
      health_breakdown: healthBreakdown.rows,
      activity_trend: activityTrend.rows,
      region_breakdown: regionBreakdown.rows,
    });
  } catch (err) {
    console.error('GET /dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
