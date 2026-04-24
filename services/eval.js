const { chatCompletion } = require('./proxy');
const { JUDGE_SYSTEM, buildJudgePrompt } = require('../prompts/judge');
const { extractJson } = require('../lib/parseJson');
const { pool } = require('../db');

const INTENSITY_MODIFIERS = {
  mild: 'You are frustrated but still cooperative. You want this resolved and are giving the agent a fair chance.',
  aggrieved: 'You are defensive and clipped. You have already been dismissed once and are watching for any sign of being fobbed off again.',
  threatening_to_leave: 'You are hostile and considering leaving the platform. You are actively looking for reasons to escalate or post publicly about your experience.'
};

async function resolveVariables(templateBody, persona) {
  if (!templateBody.includes('{{')) return templateBody;

  return chatCompletion({
    system: 'You are a CS template variable resolver. Given a template with {{placeholders}} and a member persona, replace each placeholder with a realistic value that fits the persona\'s context. Return ONLY the resolved template text, nothing else.',
    messages: [{
      role: 'user',
      content: `PERSONA CONTEXT:\n${persona.system_prompt}\n\nTEMPLATE:\n${templateBody}\n\nResolve all {{placeholders}} with realistic values.`
    }],
    temperature: 0.3,
  });
}

async function generateOpeningMessage(persona, intensity) {
  return chatCompletion({
    system: persona.system_prompt,
    messages: [{
      role: 'user',
      content: `${persona.opening_message_prompt}\n\nIntensity: ${INTENSITY_MODIFIERS[intensity]}\n\nWrite the opening message now (2–4 sentences, first person, as ${persona.name}).`
    }],
    temperature: 0.8,
  });
}

async function simulatePersonaReaction(persona, intensity, openingMessage, resolvedTemplate) {
  return chatCompletion({
    system: `${persona.system_prompt}\n\nCurrent intensity: ${INTENSITY_MODIFIERS[intensity]}`,
    messages: [{
      role: 'user',
      content: `You just sent this message to Vinted CS support:\n\n"${openingMessage}"\n\nThey replied:\n\n---\n${resolvedTemplate}\n---\n\nReact to it naturally as ${persona.name}. Stay in character.`
    }],
    temperature: 0.8,
  });
}

async function judgeEvaluation({ persona, openingMessage, resolvedTemplate }) {
  const raw = await chatCompletion({
    system: JUDGE_SYSTEM,
    messages: [{
      role: 'user',
      content: buildJudgePrompt({ persona, openingMessage, resolvedTemplate })
    }],
    temperature: 0.1,
  });

  return extractJson(raw);
}

// Compute a 0–100 overall score from the 3 dimensions (each 1–5, max 15 total)
// Deduct for anti-patterns: critical = -20, major = -10, minor = -3
function computeOverallScore(verdict) {
  const { dimensions, anti_patterns = [] } = verdict;
  const dimSum = (dimensions.structure?.score || 0)
    + (dimensions.tone?.score || 0)
    + (dimensions.case_specificity_and_accuracy?.score || 0);

  let base = Math.round((dimSum / 15) * 100);

  const deductions = anti_patterns.reduce((acc, ap) => {
    if (ap.severity === 'critical') return acc - 20;
    if (ap.severity === 'major') return acc - 10;
    if (ap.severity === 'minor') return acc - 3;
    return acc;
  }, 0);

  return Math.max(0, Math.min(100, base + deductions));
}

async function executeRun(runId) {
  const { rows: [run] } = await pool.query('SELECT * FROM runs WHERE id = $1', [runId]);
  const { rows: [persona] } = await pool.query('SELECT * FROM personas WHERE id = $1', [run.persona_id]);
  const { rows: [template] } = await pool.query('SELECT * FROM templates WHERE id = $1', [run.template_id]);

  await pool.query('UPDATE runs SET status = $1 WHERE id = $2', ['running', runId]);

  try {
    const resolvedTemplate = await resolveVariables(template.body_raw, persona);
    const openingMessage = await generateOpeningMessage(persona, run.intensity);
    const personaReaction = await simulatePersonaReaction(persona, run.intensity, openingMessage, resolvedTemplate);

    await pool.query(
      `INSERT INTO turns (run_id, turn_number, template_text_resolved, persona_reaction)
       VALUES ($1, 1, $2, $3)`,
      [runId, resolvedTemplate, personaReaction]
    );

    // Judge evaluates the TEMPLATE in isolation — not influenced by persona reaction
    const verdict = await judgeEvaluation({ persona, openingMessage, resolvedTemplate });
    const overallScore = computeOverallScore(verdict);

    await pool.query(
      `INSERT INTO evaluations
         (run_id, reply_classification, dimensions, anti_patterns, verdict,
          overall_score, summary, suggested_fix, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        runId,
        JSON.stringify(verdict.reply_classification),
        JSON.stringify(verdict.dimensions),
        JSON.stringify(verdict.anti_patterns || []),
        verdict.verdict,
        overallScore,
        verdict.summary,
        verdict.suggested_fix || null,
        verdict.notes || null,
      ]
    );

    await pool.query(
      'UPDATE runs SET status = $1, completed_at = NOW() WHERE id = $2',
      ['completed', runId]
    );

    return { ...verdict, overall_score: overallScore };
  } catch (err) {
    await pool.query(
      'UPDATE runs SET status = $1, error = $2 WHERE id = $3',
      ['failed', err.message, runId]
    );
    throw err;
  }
}

module.exports = { executeRun };
