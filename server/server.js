require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const A = require('./lib/auth');
const E = require('./lib/exam');
const { ApiError } = require('./lib/util');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"]
    } },
    crossOriginEmbedderPolicy: false
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => { if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', A.csrfGuard, A.loadUser);

  app.use('/api/auth', require('./routes/auth').router);
  app.use('/api', require('./routes/admin').router);
  app.use('/api', require('./routes/teaching').router);
  app.use('/api', require('./routes/student').router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
    if (err && /UNIQUE constraint|duplicate key|unique constraint/i.test(err.message)) return res.status(409).json({ error: 'That record already exists.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const { db } = require('./db');
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
    console.log('No users yet. Create the first administrator with:  node server/create-admin.js');
    if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === '1') require('./seed').run();
  }
  // Background sweep: abandoned papers are graded on time with no browser involved.
  setInterval(() => { try { E.reapExpired(); } catch (e) { console.error(e); } }, 30 * 1000).unref();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log('Exam system running on http://localhost:' + port));
}
