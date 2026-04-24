// Extracts the first valid top-level JSON object from a string that may contain
// surrounding text or template variables with {{ }} that confuse simple regex.
function extractJson(text) {
  // Strip markdown code fences
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Try direct parse first
  try { return JSON.parse(stripped); } catch {}

  // Walk the string counting braces to find the first complete JSON object
  let start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(stripped.slice(start, i + 1));
      }
    }
  }

  throw new Error('Unterminated JSON object in response');
}

module.exports = { extractJson };
