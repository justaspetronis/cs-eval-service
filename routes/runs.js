const { Router } = require('express');
const { pool } = require('../db');
const { executeRun } = require('../services/eval');

const router = Router();

const EVAL_FIELDS = `e.overall_score, e.verdict, e.reply_classification, e.dimensions,
           e.anti_patterns, e.summary, e.suggested_fix, e.notes`;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, t.name as template_name, p.name as persona_name, p.archetype_label,
           ${EVAL_FIELDS}
    FROM runs r
    JOIN templates t ON t.id = r.template_id
    JOIN personas p ON p.id = r.persona_id
    LEFT JOIN evaluations e ON e.run_id = r.id
    ORDER BY r.created_at DESC
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, t.name as template_name, t.body_raw, p.name as persona_name, p.archetype_label,
           ${EVAL_FIELDS}, e.id as evaluation_id,
           trn.template_text_resolved, trn.persona_reaction
    FROM runs r
    JOIN templates t ON t.id = r.template_id
    JOIN personas p ON p.id = r.persona_id
    LEFT JOIN evaluations e ON e.run_id = r.id
    LEFT JOIN turns trn ON trn.run_id = r.id AND trn.turn_number = 1
    WHERE r.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { template_id, persona_id, intensity = 'aggrieved', mode = 'single' } = req.body;
  if (!template_id || !persona_id) return res.status(400).json({ error: 'template_id and persona_id required' });
  if (!['mild', 'aggrieved', 'threatening_to_leave'].includes(intensity)) {
    return res.status(400).json({ error: 'intensity must be mild | aggrieved | threatening_to_leave' });
  }

  const { rows: [template] } = await pool.query('SELECT version FROM templates WHERE id = $1', [template_id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const { rows: [run] } = await pool.query(
    `INSERT INTO runs (template_id, template_version, persona_id, intensity, mode)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [template_id, template.version, persona_id, intensity, mode]
  );

  // Execute synchronously for Phase 0 — returns when done
  try {
    await executeRun(run.id);
    const { rows: [result] } = await pool.query(`
      SELECT r.*, ${EVAL_FIELDS},
             trn.template_text_resolved, trn.persona_reaction
      FROM runs r
      LEFT JOIN evaluations e ON e.run_id = r.id
      LEFT JOIN turns trn ON trn.run_id = r.id AND trn.turn_number = 1
      WHERE r.id = $1
    `, [run.id]);
    res.status(201).json(result);
  } catch (err) {
    const { rows: [failed] } = await pool.query('SELECT * FROM runs WHERE id = $1', [run.id]);
    res.status(500).json({ error: err.message, run: failed });
  }
});

router.post('/:id/review', async (req, res) => {
  const { reviewer, decision, notes } = req.body;
  if (!['agree', 'disagree', 'escalate'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be agree | disagree | escalate' });
  }

  const { rows: [evaluation] } = await pool.query(
    'SELECT id FROM evaluations WHERE run_id = $1', [req.params.id]
  );
  if (!evaluation) return res.status(404).json({ error: 'No evaluation for this run' });

  const { rows: [review] } = await pool.query(
    `INSERT INTO human_reviews (evaluation_id, reviewer, decision, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [evaluation.id, reviewer, decision, notes]
  );

  res.status(201).json(review);
});

module.exports = router;
