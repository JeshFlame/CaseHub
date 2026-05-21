const API_BASE = '/api';

async function loadCases() {
    try {
        const response = await fetch(`${API_BASE}/cases`);
        if (!response.ok) throw new Error('Ошибка загрузки');
        return await response.json();
    } catch (error) {
        console.error('Ошибка API:', error);
        return [];
    }
}

function escapeHtml(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function setTextById(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function loadCase() {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get("id"));
    const div = document.getElementById("content");
    if (!div) return;
    
    div.innerHTML = '<div class="loading-card"><div class="skeleton skeleton-line skeleton-line-xl"></div></div>';
    
    if (!id) {
        div.innerHTML = "<p class='no-results'>Не указан ID кейса.</p>";
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/cases/${id}`);
        if (!response.ok) throw new Error('Кейс не найден');
        const c = await response.json();
        
        div.innerHTML = `
            <h1>${escapeHtml(c.title)}</h1>
            <div class='case-meta'>
                <span>Автор: ${escapeHtml(c.author || 'Не указан')}</span>
                <span>Категория: ${escapeHtml(c.category || c.type)}</span>
                <span>👁️ ${c.views_count || 0} просмотров</span>
            </div>
            <section class='case-section'>
                <h2>Описание</h2>
                <p>${escapeHtml(c.short || c.description)}</p>
            </section>
            <section class='case-section'>
                <h2>Подробности</h2>
                <p>${escapeHtml(c.full || c.content)}</p>
            </section>
            <div class='delete-button-container'>
                <button class='delete-btn' onclick='deleteCase(${c.id})'>🗑 Удалить кейс (админ)</button>
                <p class='admin-note'>Удаление требует ввода административного пароля</p>
            </div>
        `;
    } catch (err) {
        div.innerHTML = "<p class='no-results'>Ошибка загрузки кейса.</p>";
    }
}

async function deleteCase(caseId) {
    const password = prompt("Введите пароль администратора для удаления кейса:");
    if (!password) return;
    
    try {
        const response = await fetch(`${API_BASE}/cases/${caseId}/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: password })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            alert("✅ Кейс успешно удалён!");
            window.location.href = "/index.html";
        } else {
            alert("❌ Ошибка: " + (result.error || "Неверный пароль"));
        }
    } catch (err) {
        alert("❌ Ошибка сети: " + err.message);
    }
}

function renderLandingMetrics(cases) {
    const categorySet = {}, authorSet = {}, tagSet = {};
    for (const c of cases) {
        if (c.category) categorySet[c.category] = true;
        if (c.author) authorSet[c.author] = true;
        if (c.tags) for (const t of c.tags) tagSet[t.toLowerCase()] = true;
    }
    setTextById("metric-cases", cases.length);
    setTextById("metric-categories", Object.keys(categorySet).length);
    setTextById("metric-authors", Object.keys(authorSet).length);
    setTextById("metric-tags", Object.keys(tagSet).length);
}

function renderFeaturedCase(cases) {
    if (!cases.length) return;
    const featured = cases[Math.floor(Math.random() * cases.length)];
    setTextById("featured-title", featured.title);
    setTextById("featured-short", featured.short || featured.description);
    const link = document.getElementById("featured-link");
    if (link) link.href = "case.html?id=" + featured.id;
}

function renderSampleGrid(cases) {
    const grid = document.getElementById("sample-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const maxItems = Math.min(cases.length, 6);
    for (let i = 0; i < maxItems; i++) {
        const c = cases[i];
        const card = document.createElement("a");
        card.className = "sample-card fade-in";
        card.href = "case.html?id=" + c.id;
        card.innerHTML = `<h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.short || c.description)}</p>`;
        grid.appendChild(card);
    }
}

async function initLandingPage() {
    if (document.body?.getAttribute("data-page") !== "index") return;
    const cases = await loadCases();
    renderLandingMetrics(cases);
    renderFeaturedCase(cases);
    renderSampleGrid(cases);
}

function initAddPage() {
    if (document.body?.getAttribute("data-page") !== "add") return;
    const form = document.getElementById("addForm");
    const status = document.getElementById("add-status");
    if (!form) return;
    
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (status) status.textContent = "Отправка...";
        
        const formData = {
            title: document.getElementById("title").value,
            author: document.getElementById("author").value,
            category: document.getElementById("category").value,
            tags: document.getElementById("tags").value.split(",").map(t => t.trim()),
            short: document.getElementById("short").value,
            full: document.getElementById("full").value
        };
        
        try {
            const response = await fetch(`${API_BASE}/cases`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });
            
            if (response.ok) {
                const result = await response.json();
                if (status) status.innerHTML = "✅ Кейс успешно добавлен! <a href='case.html?id=" + result.id + "'>Посмотреть</a>";
                form.reset();
            } else {
                const error = await response.json();
                if (status) status.textContent = "❌ Ошибка: " + (error.error || "неизвестная");
            }
        } catch (err) {
            if (status) status.textContent = "❌ Ошибка сети: " + err.message;
        }
    });
}

async function searchCases(event) {
    if (event) event.preventDefault();
    const input = document.getElementById("query");
    const res = document.getElementById("results");
    if (!input || !res) return;
    
    const q = input.value.toLowerCase().trim();
    const cases = await loadCases();
    const filtered = cases.filter(c => 
        c.title?.toLowerCase().includes(q) ||
        c.short?.toLowerCase().includes(q) ||
        c.author?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
    );
    
    if (!filtered.length) {
        res.innerHTML = "<p class='no-results'>Ничего не найдено</p>";
        return;
    }
    
    res.innerHTML = filtered.map(c => `
        <a class='case' href='case.html?id=${c.id}'>
            <h3>${escapeHtml(c.title)}</h3>
            <p>${escapeHtml(c.short || c.description)}</p>
        </a>
    `).join('');
}

function initSearchPage() {
    if (document.body?.getAttribute("data-page") !== "search") return;
    const form = document.getElementById("search-form");
    if (form) form.addEventListener("submit", searchCases);
    searchCases();
}

function initCasePage() {
    if (document.body?.getAttribute("data-page") !== "case") return;
    loadCase();
}

function initByPage() {
    initLandingPage();
    initSearchPage();
    initCasePage();
    initAddPage();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initByPage);
} else {
    initByPage();
}

window.deleteCase = deleteCase;
window.searchCases = searchCases;
window.loadCase = loadCase;
