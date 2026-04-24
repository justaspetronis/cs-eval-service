require('dotenv').config();
const fetch = require('node-fetch');

async function chatCompletion({ system, messages, temperature = 0.7, maxTokens = 2048 }) {
  const res = await fetch(`${process.env.VINTED_PROXY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VINTED_API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      system,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Proxy error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

module.exports = { chatCompletion };
