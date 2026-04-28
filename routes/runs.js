const { Router } = require('express');
const { pool } = require('../db');
const { executeRun } = require('../services/eval');

const router = Router();

const EVAL_FIELDS = `e.overall_score, e.verdict, e.reply_classification, e.dimensions,
           e.anti_patterns, e.summary, e.suggested_fix, e.notes`;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, t.name as template_name, p.name as persona_name, p.archetype_label,
           ${EVAL_FIELDS},
           (SELECT decision FROM human_reviews WHERE evaluation_id = e.id ORDER BY created_at DESC LIMIT 1) as review_decision
    FROM runs r
    LEFT JOIN templates t ON t.id = r.template_id
    JOIN personas p ON p.id = r.persona_id
    LEFT JOIN evaluations e ON e.run_id = r.id
    ORDER BY r.created_at DESC
  `);
  res.json(rows);
});

// CSV export
router.get('/export.csv', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.id, t.name as template_name, p.name as persona_name, p.archetype_label,
           r.created_at, e.overall_score, e.verdict, e.summary, e.suggested_fix,
           e.anti_patterns, e.dimensions
    FROM runs r
    LEFT JOIN templates t ON t.id = r.template_id
    JOIN personas p ON p.id = r.persona_id
    LEFT JOIN evaluations e ON e.run_id = r.id
    WHERE r.status = 'completed' AND e.verdict IS NOT NULL
    ORDER BY r.created_at DESC
  `);

  const escape = (v) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;

  const header = 'id,template_name,persona,archetype,date,score,verdict,summary,suggested_fix,critical_flags,major_flags,minor_flags';
  const lines = rows.map(r => {
    const aps = r.anti_patterns || [];
    const critical = aps.filter(p => p.severity === 'critical').map(p => p.name).join('; ');
    const major = aps.filter(p => p.severity === 'major').map(p => p.name).join('; ');
    const minor = aps.filter(p => p.severity === 'minor').map(p => p.name).join('; ');
    return [
      r.id,
      escape(r.template_name),
      escape(r.persona_name),
      escape(r.archetype_label),
      r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
      r.overall_score ?? '',
      r.verdict ?? '',
      escape(r.summary),
      escape(r.suggested_fix),
      escape(critical),
      escape(major),
      escape(minor),
    ].join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="eval-runs.csv"');
  res.send([header, ...lines].join('\n'));
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
  // Accept either a single persona_id or an array of persona_ids
  const { template_id, persona_id, persona_ids } = req.body;
  const ids = persona_ids?.length ? persona_ids : persona_id ? [persona_id] : null;

  if (!template_id || !ids) {
    return res.status(400).json({ error: 'template_id and persona_id (or persona_ids) required' });
  }

  const { rows: [template] } = await pool.query('SELECT version FROM templates WHERE id = $1', [template_id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  // Validate all persona IDs exist
  const { rows: personas } = await pool.query(
    `SELECT id, default_intensity FROM personas WHERE id = ANY($1)`,
    [ids]
  );
  if (personas.length !== ids.length) {
    const found = personas.map(p => p.id);
    const missing = ids.filter(id => !found.includes(id));
    return res.status(404).json({ error: `Personas not found: ${missing.join(', ')}` });
  }

  try {
    // Create all runs up front
    const runRows = await Promise.all(ids.map(pid => {
      const persona = personas.find(p => p.id === pid);
      const intensity = persona.default_intensity || 'aggrieved';
      return pool.query(
        `INSERT INTO runs (template_id, template_version, persona_id, intensity, mode)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [template_id, template.version, pid, intensity, ids.length > 1 ? 'multi' : 'single']
      ).then(r => r.rows[0]);
    }));

    // Execute all runs in parallel
    await Promise.all(runRows.map(run => executeRun(run.id)));

    // Fetch completed results
    const results = await Promise.all(runRows.map(run =>
      pool.query(`
        SELECT r.*, t.name as template_name, p.name as persona_name, p.archetype_label,
               ${EVAL_FIELDS},
               trn.template_text_resolved, trn.persona_reaction
        FROM runs r
        LEFT JOIN templates t ON t.id = r.template_id
        JOIN personas p ON p.id = r.persona_id
        LEFT JOIN evaluations e ON e.run_id = r.id
        LEFT JOIN turns trn ON trn.run_id = r.id AND trn.turn_number = 1
        WHERE r.id = $1
      `, [run.id]).then(r => r.rows[0])
    ));

    // Return array for multi, single object for single (backwards compat)
    res.status(201).json(ids.length > 1 ? results : results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
