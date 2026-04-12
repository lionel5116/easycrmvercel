/**
 * Filter Builder — converts a flat filter object from the UI into
 * parameterized SQL WHERE clauses and ORDER BY fragments.
 *
 * Every filter key maps to an explicit column condition so there is
 * no dynamic SQL injection risk. Unknown keys are ignored.
 */

export interface FilterParams {
  search?: string;
  region?: string[];
  health?: string[];
  stage?: string[];
  size?: string[];
  industry?: string[];
  role?: string[];
  dateRange?: string;        // 'last_7_days' | 'last_30_days' | 'last_90_days' | 'this_year'
  dateFrom?: string;         // ISO date
  dateTo?: string;           // ISO date
  minValue?: number;
  maxValue?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface WhereResult {
  sql: string;
  values: unknown[];
}

const DATE_INTERVALS: Record<string, string> = {
  last_7_days: "NOW() - INTERVAL '7 days'",
  last_30_days: "NOW() - INTERVAL '30 days'",
  last_90_days: "NOW() - INTERVAL '90 days'",
  this_year: "DATE_TRUNC('year', NOW())",
};

/**
 * Builds WHERE clause fragments for the contacts table.
 * Joins against companies when company-level filters are requested.
 */
export function buildContactWhere(filters: FilterParams): WhereResult {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let i = values.length + 1;

  if (filters.search) {
    conditions.push(
      `(c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.email ILIKE $${i} OR c.title ILIKE $${i})`
    );
    values.push(`%${filters.search}%`);
    i++;
  }

  if (filters.region?.length) {
    conditions.push(`c.region = ANY($${i}::text[])`);
    values.push(filters.region);
    i++;
  }

  if (filters.health?.length) {
    conditions.push(`c.health = ANY($${i}::health_status[])`);
    values.push(filters.health);
    i++;
  }

  if (filters.role?.length) {
    conditions.push(`c.role = ANY($${i}::contact_role[])`);
    values.push(filters.role);
    i++;
  }

  if (filters.dateRange && DATE_INTERVALS[filters.dateRange]) {
    conditions.push(`c.last_activity_at >= ${DATE_INTERVALS[filters.dateRange]}`);
  } else {
    if (filters.dateFrom) {
      conditions.push(`c.last_activity_at >= $${i}::timestamptz`);
      values.push(filters.dateFrom);
      i++;
    }
    if (filters.dateTo) {
      conditions.push(`c.last_activity_at <= $${i}::timestamptz`);
      values.push(filters.dateTo);
      i++;
    }
  }

  // Company-level filters (require LEFT JOIN co ON co.id = c.company_id)
  if (filters.industry?.length) {
    conditions.push(`co.industry = ANY($${i}::text[])`);
    values.push(filters.industry);
    i++;
  }

  if (filters.size?.length) {
    conditions.push(`co.size = ANY($${i}::text[])`);
    values.push(filters.size);
    i++;
  }

  return { sql: conditions.join(' AND '), values };
}

/**
 * Builds WHERE clause fragments for the deals table.
 */
export function buildDealWhere(filters: FilterParams): WhereResult {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let i = values.length + 1;

  if (filters.search) {
    conditions.push(`(d.title ILIKE $${i} OR d.owner ILIKE $${i})`);
    values.push(`%${filters.search}%`);
    i++;
  }

  if (filters.region?.length) {
    conditions.push(`d.region = ANY($${i}::text[])`);
    values.push(filters.region);
    i++;
  }

  if (filters.stage?.length) {
    conditions.push(`d.stage = ANY($${i}::deal_stage[])`);
    values.push(filters.stage);
    i++;
  }

  if (filters.minValue !== undefined) {
    conditions.push(`d.value >= $${i}`);
    values.push(filters.minValue);
    i++;
  }

  if (filters.maxValue !== undefined) {
    conditions.push(`d.value <= $${i}`);
    values.push(filters.maxValue);
    i++;
  }

  if (filters.dateRange && DATE_INTERVALS[filters.dateRange]) {
    conditions.push(`d.close_date >= (${DATE_INTERVALS[filters.dateRange]})::date`);
  } else {
    if (filters.dateFrom) {
      conditions.push(`d.close_date >= $${i}::date`);
      values.push(filters.dateFrom);
      i++;
    }
    if (filters.dateTo) {
      conditions.push(`d.close_date <= $${i}::date`);
      values.push(filters.dateTo);
      i++;
    }
  }

  return { sql: conditions.join(' AND '), values };
}

/** Whitelisted sort columns per entity to prevent SQL injection. */
const CONTACT_SORT_COLUMNS: Record<string, string> = {
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  email: 'c.email',
  health: 'c.health',
  region: 'c.region',
  last_activity_at: 'c.last_activity_at',
  created_at: 'c.created_at',
  company: 'co.name',
};

const DEAL_SORT_COLUMNS: Record<string, string> = {
  title: 'd.title',
  value: 'd.value',
  stage: 'd.stage',
  close_date: 'd.close_date',
  probability: 'd.probability',
  owner: 'd.owner',
  region: 'd.region',
  created_at: 'd.created_at',
};

export function buildContactOrderBy(filters: FilterParams): string {
  const col = CONTACT_SORT_COLUMNS[filters.sortBy ?? ''] ?? 'c.last_activity_at';
  const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir} NULLS LAST`;
}

export function buildDealOrderBy(filters: FilterParams): string {
  const col = DEAL_SORT_COLUMNS[filters.sortBy ?? ''] ?? 'd.updated_at';
  const dir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir} NULLS LAST`;
}

export function parsePagination(filters: FilterParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const page = Math.max(filters.page ?? 1, 1);
  return { limit, offset: (page - 1) * limit };
}
