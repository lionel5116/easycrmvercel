/**
 * Seed script — generates realistic demo data for the EasyCRM MVP.
 * Run: npm run db:seed
 */
import { pool } from './pool';

const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'West', 'Southwest', 'Pacific'];
const INDUSTRIES = ['SaaS', 'Healthcare', 'Finance', 'Retail', 'Manufacturing', 'Education'];
const SIZES = ['small', 'mid', 'enterprise'] as const;
const HEALTH = ['healthy', 'healthy', 'healthy', 'at_risk', 'critical'] as const;
const STAGES = ['prospecting', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const;
const ROLES = ['executive', 'manager', 'associate', 'stakeholder'] as const;
const ACT_TYPES = ['call', 'email', 'meeting', 'note', 'task'] as const;

const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const FIRST_NAMES = ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Drew', 'Quinn',
  'Avery', 'Blake', 'Cameron', 'Dakota', 'Emery', 'Finley', 'Harper', 'Indigo'];
const LAST_NAMES = ['Chen', 'Patel', 'Kim', 'Rivera', 'Johnson', 'Williams', 'Smith', 'Garcia',
  'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris'];
const COMPANY_PREFIXES = ['Apex', 'Vertex', 'Nova', 'Pulse', 'Summit', 'Core', 'Prime', 'Nexus',
  'Orbit', 'Zinc', 'Velo', 'Helix', 'Forge', 'Atlas', 'Arch', 'Spark'];
const COMPANY_SUFFIXES = ['Systems', 'Solutions', 'Tech', 'Group', 'Partners', 'Labs', 'Works', 'Cloud'];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing data
    await client.query('TRUNCATE activities, deals, contacts, companies, segments CASCADE');

    // ── Companies ─────────────────────────────────────────────────────────────
    const companyIds: string[] = [];
    for (let i = 0; i < 40; i++) {
      const name = `${rand(COMPANY_PREFIXES)} ${rand(COMPANY_SUFFIXES)}`;
      const res = await client.query(
        `INSERT INTO companies (name, industry, region, size, health, arr)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, rand(INDUSTRIES), rand(REGIONS), rand(SIZES), rand(HEALTH),
          randInt(10_000, 2_000_000)]
      );
      companyIds.push(res.rows[0].id);
    }

    // ── Contacts ──────────────────────────────────────────────────────────────
    const contactIds: string[] = [];
    for (let i = 0; i < 120; i++) {
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      const companyId = rand(companyIds);
      const role = rand(ROLES);
      const res = await client.query(
        `INSERT INTO contacts (company_id, first_name, last_name, email, title, role, region, health, last_activity_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          companyId,
          firstName,
          lastName,
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
          `${role.charAt(0).toUpperCase() + role.slice(1)}, Sales`,
          role,
          rand(REGIONS),
          rand(HEALTH),
          daysAgo(randInt(0, 60)),
        ]
      );
      contactIds.push(res.rows[0].id);
    }

    // ── Deals ─────────────────────────────────────────────────────────────────
    const dealIds: string[] = [];
    for (let i = 0; i < 80; i++) {
      const companyId = rand(companyIds);
      const stage = rand(STAGES);
      const probability: Record<string, number> = {
        prospecting: 10, qualified: 25, proposal: 50,
        negotiation: 75, closed_won: 100, closed_lost: 0,
      };
      const res = await client.query(
        `INSERT INTO deals (company_id, contact_id, title, stage, value, close_date, probability, region, owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          companyId,
          rand(contactIds),
          `Deal ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`,
          stage,
          randInt(5_000, 500_000),
          new Date(Date.now() + randInt(-30, 90) * 86_400_000).toISOString().split('T')[0],
          probability[stage],
          rand(REGIONS),
          `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
        ]
      );
      dealIds.push(res.rows[0].id);
    }

    // ── Activities ────────────────────────────────────────────────────────────
    for (let i = 0; i < 300; i++) {
      const type = rand(ACT_TYPES);
      await client.query(
        `INSERT INTO activities (contact_id, deal_id, type, subject, body, occurred_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          rand(contactIds),
          Math.random() > 0.4 ? rand(dealIds) : null,
          type,
          `${type.charAt(0).toUpperCase() + type.slice(1)} with contact`,
          `Follow-up ${type} regarding current engagement and next steps.`,
          daysAgo(randInt(0, 90)),
          rand(FIRST_NAMES),
        ]
      );
    }

    // ── Segments ──────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO segments (name, description, filters, created_by, is_shared) VALUES
       ('At-Risk Accounts', 'Companies with health = at_risk in the last 30 days',
        '{"health":["at_risk"],"dateRange":"last_30_days"}', 'system', true),
       ('West Region Pipeline', 'All open deals in the West region',
        '{"region":["West"],"stage":["prospecting","qualified","proposal","negotiation"]}', 'system', true),
       ('Enterprise Critical', 'Enterprise accounts with critical health status',
        '{"size":["enterprise"],"health":["critical"]}', 'system', true),
       ('High-Value Deals', 'Deals above $100k in negotiation or proposal',
        '{"stage":["proposal","negotiation"],"minValue":100000}', 'system', true)`
    );

    await client.query('COMMIT');
    console.log('✓ Seed complete: 40 companies, 120 contacts, 80 deals, 300 activities, 4 segments');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
