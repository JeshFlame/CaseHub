require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

// Получить все кейсы
app.get('/api/cases', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.description as short, c.type as category, c.tags, 
                   c.views_count, c.created_at, u.username as author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.is_published = true
            ORDER BY c.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Получить один кейс
app.get('/api/cases/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, u.username as author
            FROM cases c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.id = $1 AND c.is_published = true
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Кейс не найден' });
        }
        
        await pool.query('UPDATE cases SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);
        
        // Переименовываем type в category для фронта
        const caseData = result.rows[0];
        caseData.category = caseData.type;
        
        res.json(caseData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Добавить кейс
app.post('/api/cases', async (req, res) => {
    const { title, author, category, tags, short, full } = req.body;
    
    try {
        // Находим или создаём пользователя
        let authorId = null;
        if (author) {
            let userRes = await pool.query('SELECT id FROM users WHERE username = $1', [author]);
            if (userRes.rows.length > 0) {
                authorId = userRes.rows[0].id;
            } else {
                // Создаём нового пользователя
                const newUser = await pool.query(
                    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
                    [author, `${author}@casehub.local`, 'auto']
                );
                authorId = newUser.rows[0].id;
            }
        }
        
        const tagsArray = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []);
        
        const result = await pool.query(`
            INSERT INTO cases (title, description, content, type, tags, author_id, is_published, published_at) 
            VALUES ($1, $2, $3, $4, $5, $6, true, NOW()) 
            RETURNING id, title, description as short, type as category, tags
        `, [title, short || '', full || '', category || 'Без категории', tagsArray, authorId]);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить кейс (только для админа)
app.post('/api/cases/:id/delete', async (req, res) => {
    const { password } = req.body;
    const caseId = req.params.id;
    
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
    }
    
    try {
        await pool.query('DELETE FROM cases WHERE id = $1', [caseId]);
        res.json({ success: true, message: 'Кейс удалён' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при удалении' });
    }
});

app.listen(PORT, () => {
    console.log(`CaseHub backend running on port ${PORT}`);
});
