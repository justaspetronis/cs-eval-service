require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archetype_label TEXT NOT NULL,
      role TEXT NOT NULL,
      market TEXT,
      experience_level TEXT,
      item_stakes TEXT,
      primary_need TEXT NOT NULL,
      emotional_state_start TEXT NOT NULL,
      escalation_triggers JSONB NOT NULL DEFAULT '[]',
      deescalation_triggers JSONB NOT NULL DEFAULT '[]',
      red_flags JSONB NOT NULL DEFAULT '[]',
      green_flags JSONB NOT NULL DEFAULT '[]',
      communication_style TEXT,
      system_prompt TEXT NOT NULL,
      opening_message_prompt TEXT NOT NULL,
      research_grounding JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      body_raw TEXT NOT NULL,
      inferred_context JSONB,
      version INTEGER NOT NULL DEFAULT 1,
      parent_id INTEGER REFERENCES templates(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runs (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
      template_version INTEGER NOT NULL,
      persona_id TEXT NOT NULL REFERENCES personas(id),
      intensity TEXT NOT NULL DEFAULT 'aggrieved',
      mode TEXT NOT NULL DEFAULT 'single',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS turns (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      turn_number INTEGER NOT NULL,
      template_text_resolved TEXT NOT NULL,
      persona_reaction TEXT,
      raw_response JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id) UNIQUE,
      reply_classification JSONB,
      dimensions JSONB,
      anti_patterns JSONB NOT NULL DEFAULT '[]',
      overall_score INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL,
      summary TEXT,
      suggested_fix TEXT,
      notes TEXT,
      baseline_results JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS human_reviews (
      id SERIAL PRIMARY KEY,
      evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
      reviewer TEXT,
      decision TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS baseline_checks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      check_prompt TEXT NOT NULL,
      category TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Idempotent migrations
  await pool.query(`
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS reply_classification JSONB;
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS dimensions JSONB;
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS anti_patterns JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS summary TEXT;
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS suggested_fix TEXT;
    ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE runs ALTER COLUMN template_id DROP NOT NULL;
  `);

  console.log('DB schema ready');
}

module.exports = { pool, initDb };
