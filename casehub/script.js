var CASES_URL = "cases.json";
var casesCachePromise = null;

function flattenCases(raw) {
  var items = [];
  var key;
  var i;

  if (Array.isArray(raw)) {
    return raw;
  }

  if (!raw || typeof raw !== "object") {
    return items;
  }

  for (key in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (!Array.isArray(raw[key])) continue;

    for (i = 0; i < raw[key].length; i++) {
      var item = raw[key][i] || {};
      items.push({
        id: item.id,
        title: item.title,
        author: item.author,
        category: item.category || key,
        tags: item.tags,
        short: item.short,
        full: item.full
      });
    }
  }

  return items;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeCases(raw) {
  var source = flattenCases(raw);
  var normalized = [];

  for (var i = 0; i < source.length; i++) {
    var c = source[i] || {};
    var tags = Array.isArray(c.tags) ? c.tags : [];
    var preparedTags = [];

    for (var t = 0; t < tags.length; t++) {
      preparedTags.push(String(tags[t]));
    }

    normalized.push({
      id: Number(c.id) || i + 1,
      title: String(c.title || "Без названия кейса"),
      author: String(c.author || "Не указан"),
      category: String(c.category || "Без категории"),
      tags: preparedTags,
      short: String(c.short || "Краткое описание пока не добавлено."),
      full: String(c.full || "Подробное описание пока не добавлено.")
    });
  }

  normalized.sort(function (a, b) {
    return a.id - b.id;
  });

  return normalized;
}

function loadCasesViaXhr() {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", CASES_URL, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error("Не удалось загрузить cases.json"));
      }
    };
    xhr.onerror = function () {
      reject(new Error("Ошибка сети при загрузке cases.json"));
    };
    xhr.send();
  });
}

async function loadCases() {
  if (!casesCachePromise) {
    casesCachePromise = (async function () {
      try {
        var response = await fetch(CASES_URL);
        var raw = await response.json();
        return normalizeCases(raw);
      } catch (fetchError) {
        var fallbackRaw = await loadCasesViaXhr();
        return normalizeCases(fallbackRaw);
      }
    })();
  }

  return casesCachePromise;
}

function setTextById(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setSearchStatus(message) {
  var status = document.getElementById("search-status");
  if (!status) return;
  status.textContent = message;
}

function setSearchCountStatus(count) {
  var status = document.getElementById("search-status");
  if (!status) return;
  status.innerHTML =
    "<strong>Найдено кейсов:</strong> " +
    "<span class='search-count'>" + count + "</span>";
}

function setSearchLoading(isLoading) {
  var button = document.getElementById("search-button");
  if (!button) return;

  button.classList.toggle("is-loading", isLoading);
  button.disabled = !!isLoading;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function highlightText(text, query) {
  var source = String(text || "");
  var cleanQuery = String(query || "").trim();
  if (!cleanQuery) return escapeHtml(source);

  var tokens = cleanQuery
    .split(/\s+/)
    .filter(Boolean)
    .sort(function (a, b) {
      return b.length - a.length;
    })
    .slice(0, 8);

  if (!tokens.length) return escapeHtml(source);

  var regex = new RegExp(tokens.map(escapeRegExp).join("|"), "gi");
  var result = "";
  var lastIndex = 0;
  var match;

  while ((match = regex.exec(source)) !== null) {
    result += escapeHtml(source.slice(lastIndex, match.index));
    result += "<mark class='search-highlight'>" + escapeHtml(match[0]) + "</mark>";
    lastIndex = match.index + match[0].length;
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }

  result += escapeHtml(source.slice(lastIndex));
  return result;
}

function renderRandomSearchExample(cases) {
  var exampleEl = document.getElementById("search-example");
  if (!exampleEl) return;

  var examples = [
    "мобильное приложение",
    "дизайн",
    "аналитика",
    "backend",
    "учебный проект",
    "робототехника",
    "экология",
    "SMM"
  ];

  if (cases && cases.length) {
    var randomCase = cases[Math.floor(Math.random() * cases.length)];
    if (randomCase && randomCase.title) {
      examples.push(randomCase.title);
    }
    if (randomCase && randomCase.tags && randomCase.tags.length) {
      examples.push(randomCase.tags[Math.floor(Math.random() * randomCase.tags.length)]);
    }
  }

  var example = examples[Math.floor(Math.random() * examples.length)];
  exampleEl.textContent = "[" + example + "]";
}

function renderSearchSkeleton(count) {
  var res = document.getElementById("results");
  if (!res) return;

  var cards = [];
  for (var i = 0; i < count; i++) {
    cards.push(
      "<article class='case loading-card' aria-hidden='true'>" +
        "<div class='skeleton skeleton-line skeleton-line-lg'></div>" +
        "<div class='skeleton skeleton-line'></div>" +
        "<div class='skeleton skeleton-line skeleton-line-short'></div>" +
      "</article>"
    );
  }

  res.innerHTML = cards.join("");
  res.setAttribute("aria-busy", "true");
}

function renderSearchResults(items, query) {
  var res = document.getElementById("results");
  if (!res) return;

  if (!items.length) {
    res.innerHTML = "<p class='no-results'>Ничего не найдено</p>";
    res.setAttribute("aria-busy", "false");
    return;
  }

  var html = "";

  for (var i = 0; i < items.length; i++) {
    var c = items[i];
    html +=
      "<a class='case fade-in' href='case.html?id=" + c.id + "' aria-label='Открыть кейс " + escapeHtml(c.title) + "'>" +
        "<h3>" + highlightText(c.title, query) + "</h3>" +
        "<p>" + highlightText(c.short, query) + "</p>" +
      "</a>";
  }

  res.innerHTML = html;
  res.setAttribute("aria-busy", "false");
}

async function searchCases(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  var input = document.getElementById("query");
  var res = document.getElementById("results");
  if (!input || !res) return;

  var q = String(input.value || "").toLowerCase().trim();
  var startTime = Date.now();
  setSearchLoading(true);
  renderSearchSkeleton(6);

  try {
    var data = await loadCases();
    var filtered = data.filter(function (c) {
      return (
        c.title.toLowerCase().includes(q) ||
        c.short.toLowerCase().includes(q) ||
        c.full.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.tags.join(" ").toLowerCase().includes(q)
      );
    });

    renderSearchResults(filtered, q);
    setSearchCountStatus(filtered.length);
  } catch (err) {
    res.innerHTML = "<p class='no-results'>Ошибка загрузки кейсов</p>";
    res.setAttribute("aria-busy", "false");
    setSearchStatus("Не удалось загрузить кейсы.");
  } finally {
    var elapsed = Date.now() - startTime;
    if (elapsed < 260) {
      await wait(260 - elapsed);
    }
    setSearchLoading(false);
  }
}

function buildCaseStory(c) {
  var intro = "Кейс \"" + c.title + "\" стартовал как проект в направлении \"" + c.category + "\" с чёткой практической задачей и ограниченными сроками.";
  var middle = "Команда проверила гипотезу, собрала рабочий прототип и несколько раз уточнила архитектуру, чтобы добиться устойчивого результата в реальных условиях.";
  var ending = "После финальной итерации проект был оформлен как повторяемый сценарий: с понятными шагами, зафиксированными решениями и рекомендациями для следующей команды.";
  return [intro, middle, ending];
}

function buildCaseSteps(c) {
  var tagsText = c.tags.length ? c.tags.join(", ") : "ключевые направления проекта";
  return [
    "Определили цель проекта, ограничения и формат результата, согласовали критерии качества и сроки выполнения.",
    "Собрали рабочий план, распределили роли в команде и подготовили техническую базу под задачи направления \"" + c.category + "\".",
    "Реализовали решение с фокусом на " + tagsText + ", провели серию проверок и уточнили спорные части до стабильной версии.",
    "Оформили итоговые материалы: описание подхода, ключевые артефакты и краткий план дальнейшего развития."
  ];
}

function buildCaseOutcome(c) {
  return [
    "В результате кейса получено рабочее решение, которое можно повторить в схожем проекте с минимальной адаптацией.",
    "Основной эффект проекта \"" + c.title + "\" — сокращение времени на старт за счёт заранее оформленного процесса и проверенных шагов."
  ];
}

function buildCaseContacts() {
  return {
    telegram: "@example_case_contact",
    vk: "vk.com/example_case_contact",
    phone: "+7 (900) 000-00-00"
  };
}

async function loadCase() {
  var params = new URLSearchParams(location.search);
  var id = Number(params.get("id"));
  var div = document.getElementById("content");
  if (!div) return;

  div.setAttribute("aria-busy", "true");

  if (!id) {
    div.innerHTML = "<p class='no-results'>Не указан ID кейса. Вернитесь в поиск и откройте нужный кейс.</p>";
    div.setAttribute("aria-busy", "false");
    return;
  }

  try {
    var data = await loadCases();
    var c = data.find(function (x) {
      return x.id === id;
    });

    if (!c) {
      div.innerHTML = "<p class='no-results'>Кейс не найден.</p>";
      div.setAttribute("aria-busy", "false");
      return;
    }

    var story = buildCaseStory(c);
    var steps = buildCaseSteps(c);
    var outcome = buildCaseOutcome(c);
    var contacts = buildCaseContacts(c);

    div.innerHTML =
      "<h1>" + escapeHtml(c.title) + "</h1>" +
      "<div class='case-meta'>" +
        "<span>Автор: " + escapeHtml(c.author) + "</span>" +
      "</div>" +
      "<section class='case-section'>" +
        "<h2>О проекте</h2>" +
        "<p>" + escapeHtml(c.short) + "</p>" +
      "</section>" +
      "<section class='case-section'>" +
        "<h2>Подробное описание</h2>" +
        "<p>" + escapeHtml(c.full) + "</p>" +
      "</section>" +
      "<section class='case-section'>" +
        "<h2>История проекта</h2>" +
        "<p>" + escapeHtml(story[0]) + "</p>" +
        "<p>" + escapeHtml(story[1]) + "</p>" +
        "<p>" + escapeHtml(story[2]) + "</p>" +
      "</section>" +
      "<section class='case-section'>" +
        "<h2>Как реализовывался кейс</h2>" +
        "<ol class='case-list'>" +
          "<li>" + escapeHtml(steps[0]) + "</li>" +
          "<li>" + escapeHtml(steps[1]) + "</li>" +
          "<li>" + escapeHtml(steps[2]) + "</li>" +
          "<li>" + escapeHtml(steps[3]) + "</li>" +
        "</ol>" +
      "</section>" +
      "<section class='case-section'>" +
        "<h2>Результат и выводы</h2>" +
        "<p>" + escapeHtml(outcome[0]) + "</p>" +
        "<p>" + escapeHtml(outcome[1]) + "</p>" +
      "</section>" +
      "<section class='contact-card'>" +
        "<p class='contact-title'>Контакт разработчика кейса</p>" +
        "<div class='contact-list'>" +
          "<p class='contact-item'>Telegram: " + escapeHtml(contacts.telegram) + "</p>" +
          "<p class='contact-item'>VK: " + escapeHtml(contacts.vk) + "</p>" +
          "<p class='contact-item'>Телефон: " + escapeHtml(contacts.phone) + "</p>" +
        "</div>" +
      "</section>";

    div.setAttribute("aria-busy", "false");
  } catch (err) {
    div.innerHTML = "<p class='no-results'>Ошибка загрузки кейса.</p>";
    div.setAttribute("aria-busy", "false");
  }
}

function renderLandingMetrics(cases) {
  var categorySet = {};
  var authorSet = {};
  var tagSet = {};

  for (var i = 0; i < cases.length; i++) {
    var c = cases[i];
    categorySet[c.category] = true;
    authorSet[c.author] = true;

    for (var t = 0; t < c.tags.length; t++) {
      tagSet[String(c.tags[t]).toLowerCase()] = true;
    }
  }

  setTextById("metric-cases", String(cases.length));
  setTextById("metric-categories", String(Object.keys(categorySet).length));
  setTextById("metric-authors", String(Object.keys(authorSet).length));
  setTextById("metric-tags", String(Object.keys(tagSet).length));
}

function renderFeaturedCase(cases) {
  if (!cases.length) return;

  var randomIndex = Math.floor(Math.random() * cases.length);
  var featured = cases[randomIndex];

  setTextById("featured-title", featured.title);
  setTextById("featured-short", featured.short);

  var link = document.getElementById("featured-link");
  if (link) {
    link.href = "case.html?id=" + featured.id;
  }
}

function renderSampleGrid(cases) {
  var grid = document.getElementById("sample-grid");
  if (!grid) return;

  grid.innerHTML = "";
  var maxItems = Math.min(cases.length, 6);

  for (var i = 0; i < maxItems; i++) {
    var c = cases[i];
    var card = document.createElement("a");
    card.className = "sample-card fade-in";
    card.href = "case.html?id=" + c.id;
    card.setAttribute("aria-label", "Открыть кейс " + c.title);
    card.innerHTML =
      "<h3>" + escapeHtml(c.title) + "</h3>" +
      "<p>" + escapeHtml(c.short) + "</p>";
    grid.appendChild(card);
  }

  grid.setAttribute("aria-busy", "false");
}

async function initLandingPage() {
  if (!document.body || document.body.getAttribute("data-page") !== "index") return;

  try {
    var cases = await loadCases();
    renderLandingMetrics(cases);
    renderFeaturedCase(cases);
    renderSampleGrid(cases);
  } catch (err) {
    setTextById("metric-cases", "0");
    setTextById("metric-categories", "0");
    setTextById("metric-authors", "0");
    setTextById("metric-tags", "0");
  }
}

function initSearchPage() {
  if (!document.body || document.body.getAttribute("data-page") !== "search") return;

  var form = document.getElementById("search-form");
  if (form) {
    form.addEventListener("submit", searchCases);
  }

  renderRandomSearchExample([]);
  loadCases().then(function (cases) {
    renderRandomSearchExample(cases);
  }).catch(function () {
    renderRandomSearchExample([]);
  });

  searchCases();
}

function initAddPage() {
  if (!document.body || document.body.getAttribute("data-page") !== "add") return;

  var form = document.getElementById("addForm");
  var status = document.getElementById("add-status");
  if (!form) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (status) {
      status.textContent = "Черновик кейса подготовлен. В MVP сохранение в базу пока отключено.";
    }
  });
}

function initCasePage() {
  if (!document.body || document.body.getAttribute("data-page") !== "case") return;
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

window.searchCases = searchCases;
window.loadCase = loadCase;
