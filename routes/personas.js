const { Router } = require('express');
const { pool } = require('../db');

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM personas ORDER BY created_at');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM personas WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const {
    id, name, archetype_label, role, market, experience_level, item_stakes,
    primary_need, emotional_state_start, escalation_triggers, deescalation_triggers,
    red_flags, green_flags, communication_style, system_prompt, opening_message_prompt,
    research_grounding
  } = req.body;

  const { rows } = await pool.query(
    `INSERT INTO personas (id, name, archetype_label, role, market, experience_level, item_stakes,
      primary_need, emotional_state_start, escalation_triggers, deescalation_triggers,
      red_flags, green_flags, communication_style, system_prompt, opening_message_prompt, research_grounding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, system_prompt = EXCLUDED.system_prompt,
       opening_message_prompt = EXCLUDED.opening_message_prompt,
       red_flags = EXCLUDED.red_flags, green_flags = EXCLUDED.green_flags
     RETURNING *`,
    [id, name, archetype_label, role, market, experience_level, item_stakes,
     primary_need, emotional_state_start,
     JSON.stringify(escalation_triggers || []),
     JSON.stringify(deescalation_triggers || []),
     JSON.stringify(red_flags || []),
     JSON.stringify(green_flags || []),
     communication_style, system_prompt, opening_message_prompt,
     JSON.stringify(research_grounding || {})]
  );

  res.status(201).json(rows[0]);
});

module.exports = router;
