require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const { seed: seedPersonas } = require('./seed/personas');
const { seed: seedTemplates } = require('./seed/templates');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/personas', require('./routes/personas'));
app.use('/templates', require('./routes/templates'));
app.use('/runs', require('./routes/runs'));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => seedPersonas())
  .then(() => seedTemplates())
  .then(() => app.listen(PORT, () => console.log(`cs-eval-service on :${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
