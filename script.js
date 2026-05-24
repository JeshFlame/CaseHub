const API_BASE = '/api';
const ADMIN_TOKEN_KEY = 'casehub_admin_token';
const VISITOR_ID_KEY = 'casehub_visitor_id';

function getVisitorId() {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
        id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
        localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
}

function getAdminToken() {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function setAdminToken(token) {
    if (token) {
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
}

async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getAdminToken();
    if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const message = data?.error || `Request failed: ${response.status}`;
        throw new Error(message);
    }

    return data;
}

async function loadCases() {
    try {
        return await apiFetch('/cases');
    } catch (error) {
        console.error('API error:', error);
        return [];
    }
}

function escapeHtml(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setTextById(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatDate(value) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('ru-RU');
    } catch {
        return String(value);
    }
}

async function loadCase() {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get('id'));
    const div = document.getElementById('content');
    if (!div) return;

    div.innerHTML = '<div class="loading-card"><div class="skeleton skeleton-line skeleton-line-xl"></div></div>';

    if (!id) {
        div.innerHTML = "<p class='no-results'>Не указан ID кейса.</p>";
        return;
    }

    try {
        const c = await apiFetch(`/cases/${id}`, {
            headers: { 'X-Visitor-Id': getVisitorId() },
        });

        const tags = Array.isArray(c.tags) && c.tags.length
            ? c.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')
            : '<span>Без тегов</span>';

        div.innerHTML = `
            <h1>${escapeHtml(c.title)}</h1>
            <div class='case-meta'>
                <span>Автор: ${escapeHtml(c.author || 'Не указан')}</span>
                <span>Категория: ${escapeHtml(c.category || c.type || 'Без категории')}</span>
                <span>Просмотров: ${Number(c.views_count || 0)}</span>
                <span>Опубликовано: ${escapeHtml(formatDate(c.published_at || c.created_at))}</span>
            </div>
            <div class='preview-tags'>${tags}</div>
            <section class='case-section'>
                <h2>Кратко</h2>
                <p>${escapeHtml(c.short || c.description)}</p>
            </section>
            <section class='case-section'>
                <h2>Подробно</h2>
                <p>${escapeHtml(c.full || c.content)}</p>
            </section>
        `;
    } catch {
        div.innerHTML = "<p class='no-results'>Ошибка загрузки кейса.</p>";
    }
}

function renderLandingMetrics(cases) {
    const categorySet = {};
    const authorSet = {};
    const tagSet = {};
    for (const c of cases) {
        if (c.category) categorySet[c.category] = true;
        if (c.author) authorSet[c.author] = true;
        if (c.tags) {
            for (const t of c.tags) {
                tagSet[String(t).toLowerCase()] = true;
            }
        }
    }
    setTextById('metric-cases', cases.length);
    setTextById('metric-categories', Object.keys(categorySet).length);
    setTextById('metric-authors', Object.keys(authorSet).length);
    setTextById('metric-tags', Object.keys(tagSet).length);
}

function renderFeaturedCase(cases) {
    if (!cases.length) return;
    const featured = cases[Math.floor(Math.random() * cases.length)];
    setTextById('featured-title', featured.title);
    setTextById('featured-short', featured.short || featured.description);
    const link = document.getElementById('featured-link');
    if (link) link.href = `case.html?id=${featured.id}`;
}

function renderSampleGrid(cases) {
    const grid = document.getElementById('sample-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const maxItems = Math.min(cases.length, 6);
    for (let i = 0; i < maxItems; i += 1) {
        const c = cases[i];
        const card = document.createElement('a');
        card.className = 'sample-card fade-in';
        card.href = `case.html?id=${c.id}`;
        card.innerHTML = `<h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.short || c.description)}</p>`;
        grid.appendChild(card);
    }
}

async function initLandingPage() {
    if (document.body?.getAttribute('data-page') !== 'index') return;
    const cases = await loadCases();
    renderLandingMetrics(cases);
    renderFeaturedCase(cases);
    renderSampleGrid(cases);
}

function initAddPage() {
    if (document.body?.getAttribute('data-page') !== 'add') return;
    const form = document.getElementById('addForm');
    const status = document.getElementById('add-status');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (status) status.textContent = 'Отправка на модерацию...';

        const formData = {
            title: document.getElementById('title')?.value || '',
            author: document.getElementById('author')?.value || '',
            category: document.getElementById('category')?.value || '',
            tags: (document.getElementById('tags')?.value || '').split(',').map((t) => t.trim()).filter(Boolean),
            short: document.getElementById('short')?.value || '',
            full: document.getElementById('full')?.value || '',
        };

        try {
            await apiFetch('/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (status) status.textContent = 'Кейс отправлен на модерацию. После одобрения появится в каталоге.';
            form.reset();
        } catch (err) {
            if (status) status.textContent = `Ошибка: ${err.message}`;
        }
    });
}

async function searchCases(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('query');
    const res = document.getElementById('results');
    if (!input || !res) return;

    const q = input.value.toLowerCase().trim();
    const cases = await loadCases();
    const filtered = cases.filter((c) =>
        c.title?.toLowerCase().includes(q)
        || c.short?.toLowerCase().includes(q)
        || c.author?.toLowerCase().includes(q)
        || c.category?.toLowerCase().includes(q)
        || (Array.isArray(c.tags) && c.tags.some((t) => String(t).toLowerCase().includes(q)))
    );

    if (!filtered.length) {
        res.innerHTML = "<p class='no-results'>Ничего не найдено</p>";
        return;
    }

    res.innerHTML = filtered.map((c) => `
        <a class='case' href='case.html?id=${c.id}'>
            <h3>${escapeHtml(c.title)}</h3>
            <p>${escapeHtml(c.short || c.description)}</p>
        </a>
    `).join('');
}

function initSearchPage() {
    if (document.body?.getAttribute('data-page') !== 'search') return;
    const form = document.getElementById('search-form');
    if (form) form.addEventListener('submit', searchCases);
    searchCases();
}

function renderAdminCaseCard(caseItem, type) {
    const tags = (Array.isArray(caseItem.tags) ? caseItem.tags : []).map((t) => `#${escapeHtml(t)}`).join(' ');
    const actions = type === 'pending'
        ? `<button data-action="approve" data-id="${caseItem.id}">Одобрить</button>
           <button class="btn-secondary" data-action="reject" data-id="${caseItem.id}">Отклонить</button>`
        : `<button class="btn-secondary" data-action="delete" data-id="${caseItem.id}">Удалить</button>`;

    return `
        <article class="sample-card" data-case-id="${caseItem.id}">
            <h3>${escapeHtml(caseItem.title)}</h3>
            <p><strong>Автор:</strong> ${escapeHtml(caseItem.author || 'Не указан')}</p>
            <p><strong>Категория:</strong> ${escapeHtml(caseItem.category || 'Без категории')}</p>
            <p>${escapeHtml(caseItem.short || '')}</p>
            <p class="admin-note">${escapeHtml(tags || 'Без тегов')}</p>
            <div class="hero-actions" style="margin-top:12px;">${actions}</div>
        </article>
    `;
}

async function loadAdminData() {
    const pendingContainer = document.getElementById('admin-pending-list');
    const publishedContainer = document.getElementById('admin-published-list');

    if (!pendingContainer || !publishedContainer) return;

    pendingContainer.innerHTML = '<p>Загрузка...</p>';
    publishedContainer.innerHTML = '<p>Загрузка...</p>';

    const [pending, published] = await Promise.all([
        apiFetch('/admin/cases/pending'),
        apiFetch('/admin/cases/published'),
    ]);

    pendingContainer.innerHTML = pending.length
        ? pending.map((item) => renderAdminCaseCard(item, 'pending')).join('')
        : '<p class="no-results">Нет кейсов в очереди модерации.</p>';

    publishedContainer.innerHTML = published.length
        ? published.map((item) => renderAdminCaseCard(item, 'published')).join('')
        : '<p class="no-results">Нет опубликованных кейсов.</p>';
}

function initAdminPage() {
    if (document.body?.getAttribute('data-page') !== 'admin') return;

    const authBlock = document.getElementById('admin-auth');
    const contentBlock = document.getElementById('admin-content');
    const loginForm = document.getElementById('adminLoginForm');
    const loginStatus = document.getElementById('admin-login-status');
    const adminStatus = document.getElementById('admin-status');
    const logoutBtn = document.getElementById('adminLogoutBtn');

    const showPanel = async () => {
        if (authBlock) authBlock.style.display = 'none';
        if (contentBlock) contentBlock.style.display = 'block';
        await loadAdminData();
    };

    const showLogin = () => {
        if (authBlock) authBlock.style.display = 'block';
        if (contentBlock) contentBlock.style.display = 'none';
    };

    const token = getAdminToken();
    if (token) {
        apiFetch('/admin/me').then(showPanel).catch(() => {
            setAdminToken('');
            showLogin();
        });
    } else {
        showLogin();
    }

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (loginStatus) loginStatus.textContent = 'Вход...';

        const username = document.getElementById('admin-username')?.value || '';
        const password = document.getElementById('admin-password')?.value || '';

        try {
            const result = await apiFetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            setAdminToken(result.token);
            if (loginStatus) loginStatus.textContent = '';
            await showPanel();
        } catch (err) {
            if (loginStatus) loginStatus.textContent = `Ошибка входа: ${err.message}`;
        }
    });

    contentBlock?.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const action = button.getAttribute('data-action');
        const caseId = Number(button.getAttribute('data-id'));
        if (!Number.isInteger(caseId) || caseId <= 0) return;

        try {
            if (action === 'approve') {
                await apiFetch(`/admin/cases/${caseId}/approve`, { method: 'POST' });
            } else if (action === 'reject' || action === 'delete') {
                await apiFetch(`/admin/cases/${caseId}`, { method: 'DELETE' });
            }
            if (adminStatus) adminStatus.textContent = 'Изменения сохранены.';
            await loadAdminData();
        } catch (err) {
            if (adminStatus) adminStatus.textContent = `Ошибка: ${err.message}`;
        }
    });

    logoutBtn?.addEventListener('click', () => {
        setAdminToken('');
        showLogin();
    });
}

function initCasePage() {
    if (document.body?.getAttribute('data-page') !== 'case') return;
    loadCase();
}

function initByPage() {
    initLandingPage();
    initSearchPage();
    initCasePage();
    initAddPage();
    initAdminPage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initByPage);
} else {
    initByPage();
}

window.searchCases = searchCases;
window.loadCase = loadCase;
