'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const die = m => { console.error('\n[ERRO] ' + m + '\n'); process.exit(1); };

// ===== Segredos (nunca no código) =====
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || (PROD ? '' : crypto.randomBytes(32).toString('hex'));
if (APP_PASSWORD.length < (PROD ? 12 : 8)) die(`Defina APP_PASSWORD (mínimo ${PROD ? 12 : 8} caracteres).`);
if (SESSION_SECRET.length < 32) die('Defina SESSION_SECRET (mínimo 32 caracteres aleatórios).');

const MES = /^\d{4}-\d{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9]{1,40}$/;

// ===== Banco: Firestore via Admin SDK (as regras do Firestore podem ficar 100% bloqueadas) =====
function carregarCredencial() {
  try {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
      raw = raw.trim();
      if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
      return JSON.parse(raw);
    }
    const p = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json'));
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch (e) { return die('Credencial do Firebase inválida (JSON/base64 malformado).'); }
}

let db;
if (process.env.DB_DRIVER === 'memory' && !PROD) {
  // Somente para testes locais; é bloqueado em produção.
  const mem = new Map(); let seq = 0;
  db = {
    modo: 'memória (apenas testes)',
    list: async mes => [...mem.values()].filter(g => !mes || g.data.startsWith(mes)).sort((a, b) => b.data.localeCompare(a.data)),
    add: async o => { const id = 'm' + (++seq); mem.set(id, { id, ...o }); return id; },
    exists: async id => mem.has(id),
    update: async (id, o) => { mem.set(id, { id, ...o }); },
    remove: async id => { mem.delete(id); }
  };
} else {
  const cred = carregarCredencial();
  if (!cred) die('Credencial do Firebase não encontrada.\nDefina FIREBASE_SERVICE_ACCOUNT (JSON ou base64) ou coloque serviceAccountKey.json na raiz (só local).');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(cred), projectId: process.env.FIREBASE_PROJECT_ID || cred.project_id });
  const col = admin.firestore().collection('gastos');
  const limpa = d => { const { criadoEm, ...r } = d; return r; };
  db = {
    modo: 'Firestore (Admin SDK)',
    async list(mes) {
      let q = col;
      if (mes) q = q.where('data', '>=', `${mes}-01`).where('data', '<=', `${mes}-31`);
      return (await q.orderBy('data', 'desc').get()).docs.map(d => ({ id: d.id, ...limpa(d.data()) }));
    },
    add: async o => (await col.add({ ...o, criadoEm: admin.firestore.FieldValue.serverTimestamp() })).id,
    exists: async id => (await col.doc(id).get()).exists,
    update: (id, o) => col.doc(id).update(o),
    remove: id => col.doc(id).delete()
  };
}

// ===== App + cabeçalhos de segurança =====
const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY || (PROD ? 1 : 0)));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': PROD ? [] : null
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

if (PROD) { // força HTTPS
  app.use((req, res, next) => req.secure ? next() : res.redirect(301, 'https://' + req.get('host') + req.originalUrl));
}

app.use(express.json({ limit: '10kb' }));

// CSRF: cookie SameSite=Strict + checagem de Origin + exigência de JSON nas escritas
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const o = req.get('origin');
    if (o) {
      try { if (new URL(o).host !== req.get('host')) throw 0; }
      catch { return res.status(403).json({ erro: 'Origem não permitida.' }); }
    }
    if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ erro: 'Use application/json.' });
  }
  next();
});
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ===== Autenticação (sessão assinada em cookie httpOnly) =====
const COOKIE = PROD ? '__Host-sess' : 'sess';
const DIAS = 7;
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const iguais = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const assinar = exp => crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: PROD, path: '/' };

function autenticado(req) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m.slice(COOKIE.length + 1)).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const esperado = assinar(exp);
  return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } });
const limiteApi = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas requisições. Tente mais tarde.' } });

app.post('/api/login', limiteLogin, (req, res) => {
  if (typeof req.body.senha !== 'string' || !iguais(req.body.senha, APP_PASSWORD)) return res.status(401).json({ erro: 'Senha incorreta.' });
  const exp = Date.now() + DIAS * 86400000;
  res.cookie(COOKIE, `${exp}.${assinar(exp)}`, { ...cookieOpts, maxAge: DIAS * 86400000 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE, cookieOpts); res.json({ ok: true }); });

app.use((req, res, next) => {
  if (req.path.startsWith('/login/') || autenticado(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Não autenticado.' });
  res.redirect('/login/');
});
app.use('/api', limiteApi);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));

// ===== Validação =====
function dataReal(s) {
  if (!DATA.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function validar(b) {
  b = b || {};
  const descricao = typeof b.descricao === 'string' ? b.descricao.trim() : '';
  const categoria = typeof b.categoria === 'string' ? b.categoria.trim() : '';
  const valor = Math.round(Number(b.valor) * 100) / 100;
  const data = typeof b.data === 'string' ? b.data : '';
  if (!descricao || descricao.length > 100) return { erro: 'Descrição obrigatória (máx. 100 caracteres).' };
  if (!categoria || categoria.length > 40) return { erro: 'Categoria obrigatória (máx. 40 caracteres).' };
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1e9) return { erro: 'Valor inválido.' };
  if (!dataReal(data)) return { erro: 'Data inválida.' };
  return { ok: { descricao, categoria, valor, data } };
}
const mesDe = req => (typeof req.query.mes === 'string' && MES.test(req.query.mes)) ? req.query.mes : null;
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ erro: 'Erro interno no servidor.' }); });
app.param('id', (req, res, next, id) => ID.test(id) ? next() : res.status(400).json({ erro: 'ID inválido.' }));

// ===== Rotas =====
app.get('/api/gastos', wrap(async (req, res) => res.json(await db.list(mesDe(req)))));

app.post('/api/gastos', wrap(async (req, res) => {
  const v = validar(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  res.status(201).json({ id: await db.add(v.ok), ...v.ok });
}));

app.put('/api/gastos/:id', wrap(async (req, res) => {
  const v = validar(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  if (!(await db.exists(req.params.id))) return res.status(404).json({ erro: 'Gasto não encontrado.' });
  await db.update(req.params.id, v.ok);
  res.json({ id: req.params.id, ...v.ok });
}));

app.delete('/api/gastos/:id', wrap(async (req, res) => {
  if (!(await db.exists(req.params.id))) return res.status(404).json({ erro: 'Gasto não encontrado.' });
  await db.remove(req.params.id);
  res.status(204).end();
}));

app.get('/api/resumo', wrap(async (req, res) => {
  const mapa = {};
  for (const g of await db.list(mesDe(req))) {
    const c = mapa[g.categoria] || (mapa[g.categoria] = { categoria: g.categoria, total: 0, qtd: 0 });
    c.total += g.valor; c.qtd += 1;
  }
  const porCategoria = Object.values(mapa).map(c => ({ ...c, total: Math.round(c.total * 100) / 100 })).sort((a, b) => b.total - a.total);
  res.json({ total: Math.round(porCategoria.reduce((s, c) => s + c.total, 0) * 100) / 100, porCategoria });
}));

// CSV com proteção contra injeção de fórmula (=, +, -, @)
const cel = s => { let t = String(s); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
app.get('/api/export.csv', wrap(async (req, res) => {
  const mes = mesDe(req);
  const rows = (await db.list(mes)).reverse();
  const csv = ['data;descricao;categoria;valor'].concat(rows.map(r => [r.data, cel(r.descricao), cel(r.categoria), String(r.valor).replace('.', ',')].join(';'))).join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="gastos${mes ? '-' + mes : ''}.csv"`);
  res.send('\uFEFF' + csv);
}));

// ===== Erros =====
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisição grande demais.' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT} | banco: ${db.modo} | ${PROD ? 'PRODUÇÃO' : 'desenvolvimento'}`));
