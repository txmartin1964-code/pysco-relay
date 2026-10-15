// Pysco voice-loop rendezvous relay (hosted on Render).
// Dumb pipe: phone POSTs questions, VM poller claims them, VM uploads MP3 replies, phone polls for them.
// All endpoints except /health require X-Relay-Token header (or ?token=).
const express = require('express');
const multer = require('multer');

const app = express();
const TOKEN = process.env.RELAY_TOKEN || '';
const questions = new Map(); // id -> {id, text, ts, claimed}
const audio = new Map();     // id -> Buffer

app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function auth(req, res, next) {
  const t = req.get('X-Relay-Token') || req.query.token;
  if (!TOKEN || t !== TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/inbox', auth, (req, res) => {
  const { id, text, ts } = req.body || {};
  if (!id || !text || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ ok: false });
  questions.set(id, { id, text: String(text).slice(0, 2000), ts: ts || Date.now(), claimed: false });
  if (questions.size > 200) questions.delete(questions.keys().next().value);
  res.json({ ok: true, id });
});

app.get('/inbox/pending', auth, (req, res) => {
  res.json({ questions: [...questions.values()].filter((x) => !x.claimed) });
});

app.post('/inbox/ack', auth, (req, res) => {
  const { ids } = req.body || {};
  (ids || []).forEach((id) => {
    const q = questions.get(id);
    if (q) q.claimed = true;
  });
  res.json({ ok: true });
});

app.post('/outbox/:id', auth, upload.single('audio'), (req, res) => {
  const { id } = req.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !req.file) return res.status(400).json({ ok: false });
  audio.set(id, req.file.buffer);
  if (audio.size > 200) audio.delete(audio.keys().next().value);
  res.json({ ok: true, id });
});

app.get('/outbox/:id.mp3', auth, (req, res) => {
  const buf = audio.get(req.params.id);
  if (!buf) return res.status(404).json({ ok: false });
  res.set('Content-Type', 'audio/mpeg');
  res.send(buf);
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`pysco relay listening on ${port}`));
