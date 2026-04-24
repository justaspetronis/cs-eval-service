const { Router } = require('express');
const { pool } = require('../db');
const { chatCompletion } = require('../services/proxy');
const { INFERENCE_SYSTEM, buildInferencePrompt } = require('../prompts/inference');
const { extractJson } = require('../lib/parseJson');

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { name, category, body_raw } = req.body;
  if (!name || !body_raw) return res.status(400).json({ error: 'name and body_raw required' });

  let inferred_context = null;
  try {
    const raw = await chatCompletion({
      system: INFERENCE_SYSTEM,
      messages: [{ role: 'user', content: buildInferencePrompt(body_raw) }],
      temperature: 0.2,
    });
    inferred_context = extractJson(raw);
  } catch (e) {
    console.warn('Inference failed, continuing without context:', e.message);
  }

  const resolvedCategory = category || inferred_context?.category || null;

  const { rows } = await pool.query(
    `INSERT INTO templates (name, category, body_raw, inferred_context)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, resolvedCategory, body_raw, JSON.stringify(inferred_context)]
  );

  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { name, category, body_raw } = req.body;
  const { rows: [existing] } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  let inferred_context = existing.inferred_context;
  const newBody = body_raw || existing.body_raw;

  if (body_raw && body_raw !== existing.body_raw) {
    try {
      const raw = await chatCompletion({
        system: INFERENCE_SYSTEM,
        messages: [{ role: 'user', content: buildInferencePrompt(body_raw) }],
        temperature: 0.2,
      });
      const match = raw.match(/\{[\s\S]*\}/);
      inferred_context = extractJson(raw);
    } catch (e) {
      console.warn('Inference failed on update:', e.message);
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO templates (name, category, body_raw, inferred_context, version, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      name || existing.name,
      category || existing.category,
      newBody,
      JSON.stringify(inferred_context),
      existing.version + 1,
      existing.parent_id || existing.id,
    ]
  );

  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Soft-check: warn if runs exist, but allow delete
  const { rows: runs } = await pool.query('SELECT id FROM runs WHERE template_id = $1 LIMIT 1', [req.params.id]);
  if (runs.length > 0) {
    // Nullify template reference rather than cascade-delete run history
    await pool.query('UPDATE runs SET template_id = NULL WHERE template_id = $1', [req.params.id]);
  }

  await pool.query('DELETE FROM templates WHERE id = $1', [req.params.id]);
  res.json({ deleted: true, id: parseInt(req.params.id) });
});

module.exports = router;
