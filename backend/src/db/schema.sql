-- EasyCRM Database Schema
-- Run: psql -d easycrm -f src/db/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUMS ────────────────────────────────────────────────────────────────────
CREATE TYPE deal_stage AS ENUM (
  'prospecting', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
);

CREATE TYPE health_status AS ENUM ('healthy', 'at_risk', 'critical');

CREATE TYPE contact_role AS ENUM ('executive', 'manager', 'associate', 'stakeholder');

CREATE TYPE activity_type AS ENUM ('call', 'email', 'meeting', 'note', 'task');

-- ─── COMPANIES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  industry    TEXT,
  region      TEXT,
  size        TEXT CHECK (size IN ('small', 'mid', 'enterprise')),
  health      health_status NOT NULL DEFAULT 'healthy',
  arr         NUMERIC(14, 2) DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CONTACTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  title       TEXT,
  role        contact_role NOT NULL DEFAULT 'associate',
  region      TEXT,
  health      health_status NOT NULL DEFAULT 'healthy',
  last_activity_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DEALS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  stage        deal_stage NOT NULL DEFAULT 'prospecting',
  value        NUMERIC(14, 2) DEFAULT 0,
  close_date   DATE,
  probability  INT CHECK (probability BETWEEN 0 AND 100) DEFAULT 20,
  region       TEXT,
  owner        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ACTIVITIES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id     UUID REFERENCES deals(id) ON DELETE SET NULL,
  type        activity_type NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SMART SEGMENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS segments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  filters     JSONB NOT NULL DEFAULT '{}',
  created_by  TEXT,
  is_shared   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contacts_company    ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_health     ON contacts(health);
CREATE INDEX IF NOT EXISTS idx_contacts_region     ON contacts(region);
CREATE INDEX IF NOT EXISTS idx_contacts_role       ON contacts(role);
CREATE INDEX IF NOT EXISTS idx_contacts_last_act   ON contacts(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_stage         ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_company       ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_close_date    ON deals(close_date);
CREATE INDEX IF NOT EXISTS idx_activities_contact  ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_health    ON companies(health);
CREATE INDEX IF NOT EXISTS idx_companies_region    ON companies(region);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER trg_segments_updated_at BEFORE UPDATE ON segments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
