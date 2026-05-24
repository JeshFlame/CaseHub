require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'change-me-in-env';
const ADMIN_JWT_TTL = process.env.ADMIN_JWT_TTL || '12h';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const viewWindowMs = 24 * 60 * 60 * 1000;
const caseViews = new Map();

app.use(cors({
    origin(origin, callback) {
        if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin is not allowed by CORS'));
    },
}));
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

const authLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const writeLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

function createRateLimiter({ windowMs, max }) {
    const buckets = new Map();
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const entry = buckets.get(key);
        if (!entry || (now - entry.startedAt) > windowMs) {
            buckets.set(key, { count: 1, startedAt: now });
            next();
            return;
        }
        entry.count += 1;
        if (entry.count > max) {
            res.status(429).json({ error: 'Too many requests. Please try later.' });
            return;
        }
        next();
    };
}

function normalizeTags(tags) {
    const src = Array.isArray(tags) ? tags : String(tags || '').split(',');
    const normalized = src
        .map((t) => String(t || '').trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((t) => t.slice(0, 40));
    return [...new Set(normalized)];
}

function normalizeCasePayload(body) {
    const title = String(body.title || '').trim();
    const author = String(body.author || '').trim();
    const category = String(body.category || '').trim();
    const short = String(body.short || '').trim();
    const full = String(body.full || '').trim();
    const tags = normalizeTags(body.tags);

    if (title.length < 4 || title.length > 160) {
        throw new Error('Title length must be between 4 and 160 characters.');
    }
    if (!author || author.length > 80) {
        throw new Error('Author is required and must be <= 80 characters.');
    }
    if (!category || category.length > 80) {
        throw new Error('Category is required and must be <= 80 characters.');
    }
    if (short.length < 20 || short.length > 1200) {
        throw new Error('Short description length must be between 20 and 1200 characters.');
    }
    if (full.length < 40 || full.length > 30000) {
        throw new Error('Full description length must be between 40 and 30000 characters.');
    }

    return { title, author, category, short, full, tags };
}

function createAdminToken() {
    return jwt.sign({ role: 'admin', username: ADMIN_USERNAME }, ADMIN_JWT_SECRET, {
        expiresIn: ADMIN_JWT_TTL,
        issuer: 'casehub',
    });
}

function getBearerToken(req) {
    const raw = String(req.headers.authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) return '';
    return raw.slice(7).trim();
}

function requireAdmin(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        res.status(401).json({ error: 'Admin token is required.' });
        return;
    }
    try {
        const payload = jwt.verify(token, ADMIN_JWT_SECRET, { issuer: 'casehub' });
        if (payload.role !== 'admin') {
            res.status(403).json({ error: 'Forbidden.' });
            return;
        }
        req.admin = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

function cleanupOldViews() {
    const now = Date.now();
    for (const [key, value] of caseViews) {
        if ((now - value) > viewWindowMs) {
            caseViews.delete(key);
        }
    }
}

async function ensureAuthor(author) {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [author]);
    if (existing.rows.length > 0) {
        return existing.rows[0].id;
    }

    const emailSafe = author.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'author';
    const email = `${emailSafe}.${Date.now()}@casehub.local`;
    const created = await pool.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [author, email, 'external_submission']
    );
    return created.rows[0].id;
}

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

app.post('/api/admin/login', authLimiter, async (req, res) => {
    const password = String(req.body.password || '');
    const username = String(req.body.username || '');

    if (!ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
        res.status(500).json({ error: 'Admin auth is not configured on server.' });
        return;
    }
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
    }

    res.json({ token: createAdminToken(), tokenType: 'Bearer' });
});

app.get('/api/admin/me', requireAdmin, async (req, res) => {
    res.json({ ok: true, username: req.admin.username });
});

app.get('/api/cases', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.description AS short, c.type AS category, c.tags,
                   c.views_count, c.created_at, c.published_at, u.username AS author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.is_published = true
            ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load cases.' });
    }
});

app.get('/api/cases/:id', async (req, res) => {
    try {
        const caseId = Number(req.params.id);
        if (!Number.isInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ error: 'Invalid case ID.' });
        }

        const result = await pool.query(`
            SELECT c.*, u.username AS author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.id = $1 AND c.is_published = true
        `, [caseId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Case not found.' });
        }

        const visitorId = String(req.headers['x-visitor-id'] || '').trim();
        if (/^[a-zA-Z0-9_-]{16,80}$/.test(visitorId)) {
            const key = `${caseId}:${visitorId}`;
            cleanupOldViews();
            if (!caseViews.has(key)) {
                await pool.query('UPDATE cases SET views_count = views_count + 1 WHERE id = $1', [caseId]);
                caseViews.set(key, Date.now());
            }
        }

        const caseData = result.rows[0];
        caseData.category = caseData.type;
        res.json(caseData);
    } catch {
        res.status(500).json({ error: 'Unable to load case.' });
    }
});

app.post('/api/cases', writeLimiter, async (req, res) => {
    try {
        const { title, author, category, short, full, tags } = normalizeCasePayload(req.body || {});
        const authorId = await ensureAuthor(author);

        const result = await pool.query(`
            INSERT INTO cases (title, description, content, type, tags, author_id, is_published)
            VALUES ($1, $2, $3, $4, $5, $6, false)
            RETURNING id, title, description AS short, type AS category, tags, created_at, is_published
        `, [title, short, full, category, tags, authorId]);

        res.status(201).json({
            ...result.rows[0],
            moderation_status: 'pending',
            message: 'Case sent for moderation.',
        });
    } catch (err) {
        res.status(400).json({ error: err.message || 'Invalid payload.' });
    }
});

app.get('/api/admin/cases/pending', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.description AS short, c.content AS full, c.type AS category,
                   c.tags, c.views_count, c.created_at, u.username AS author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.is_published = false
            ORDER BY c.created_at ASC
        `);
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Unable to load pending cases.' });
    }
});

app.get('/api/admin/cases/published', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.description AS short, c.type AS category, c.tags,
                   c.views_count, c.created_at, c.published_at, u.username AS author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.is_published = true
            ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC
            LIMIT 200
        `);
        res.json(result.rows);
    } catch {
        res.status(500).json({ error: 'Unable to load published cases.' });
    }
});

app.post('/api/admin/cases/:id/approve', requireAdmin, writeLimiter, async (req, res) => {
    try {
        const caseId = Number(req.params.id);
        if (!Number.isInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ error: 'Invalid case ID.' });
        }

        const result = await pool.query(
            'UPDATE cases SET is_published = true, published_at = NOW() WHERE id = $1 RETURNING id',
            [caseId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Case not found.' });
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Unable to approve case.' });
    }
});

app.delete('/api/admin/cases/:id', requireAdmin, writeLimiter, async (req, res) => {
    try {
        const caseId = Number(req.params.id);
        if (!Number.isInteger(caseId) || caseId <= 0) {
            return res.status(400).json({ error: 'Invalid case ID.' });
        }

        const result = await pool.query('DELETE FROM cases WHERE id = $1 RETURNING id', [caseId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Case not found.' });
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Unable to delete case.' });
    }
});

app.use((err, req, res, next) => {
    if (err && err.message && err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS blocked this request.' });
    }
    res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
    console.log(`CaseHub backend running on port ${PORT}`);
});
