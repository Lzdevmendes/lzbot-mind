let allProducts = [];
let activeFilters = { search: '', colors: new Set(), sizes: new Set(), minPrice: null, maxPrice: null };

const $ = id => document.getElementById(id);

async function api(endpoint, data) {
  const opts = data
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    : {};
  const res = await fetch('/api' + endpoint, opts);
  return res.json();
}

async function loadAiStatus() {
  try {
    const result = await api('/ai-status');
    if (!result.success) return;
    const badge = $('aiStatusBadge');
    const { claude, openai } = result.data;
    if (claude.available) {
      badge.textContent = 'Claude ativo';
      badge.className = 'ai-badge active';
    } else if (openai.available) {
      badge.textContent = 'OpenAI ativo';
      badge.className = 'ai-badge active';
      $('aiProvider').value = 'openai';
    } else {
      badge.textContent = 'IA não configurada';
      badge.className = 'ai-badge inactive';
    }
  } catch {}
}

async function extractProducts() {
  const url = $('urlInput').value.trim();
  if (!url) { showToast('Cole uma URL para extrair', 'error'); return; }

  try { new URL(url); } catch {
    showToast('URL inválida', 'error');
    return;
  }

  const provider = $('aiProvider').value;
  setLoading(true, 'Buscando produtos com IA...');

  try {
    const result = await api('/extract', { url, aiProvider: provider });

    if (!result.success) {
      showToast(result.error || 'Erro na extração', 'error');
      return;
    }

    allProducts = result.data || [];

    if (allProducts.length === 0) {
      $('emptyState').classList.remove('hidden');
      $('resultsSection').classList.add('hidden');
      showToast('Nenhum produto encontrado nessa página', 'info');
      return;
    }

    $('emptyState').classList.add('hidden');
    $('resultsSection').classList.remove('hidden');
    $('resultsCount').textContent = `${allProducts.length} produto${allProducts.length !== 1 ? 's' : ''} encontrado${allProducts.length !== 1 ? 's' : ''}`;
    $('pageTitle').textContent = result.pageTitle || url;

    buildFilters(allProducts);
    resetFilters();
    applyFilters();

    const providerLabel = provider === 'claude' ? 'Claude' : 'OpenAI';
    showToast(`${allProducts.length} produtos extraídos via ${providerLabel}`, 'success');

  } catch (err) {
    showToast('Erro de conexão. Tente novamente.', 'error');
  } finally {
    setLoading(false);
  }
}

function buildFilters(products) {
  const colors = new Set();
  const sizes = new Set();

  products.forEach(p => {
    (p.colors || []).forEach(c => colors.add(c));
    (p.sizes || []).forEach(s => sizes.add(s));
  });

  const colorGroup = $('colorFilterGroup');
  const colorContainer = $('colorFilters');
  colorContainer.innerHTML = '';

  if (colors.size > 0) {
    colorGroup.style.display = '';
    [...colors].slice(0, 12).forEach(color => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.value = color;
      chip.textContent = color;
      chip.onclick = () => toggleFilter('colors', color, chip);
      colorContainer.appendChild(chip);
    });
  } else {
    colorGroup.style.display = 'none';
  }

  const sizeGroup = $('sizeFilterGroup');
  const sizeContainer = $('sizeFilters');
  sizeContainer.innerHTML = '';

  if (sizes.size > 0) {
    sizeGroup.style.display = '';
    [...sizes].slice(0, 16).forEach(size => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.value = size;
      chip.textContent = size;
      chip.onclick = () => toggleFilter('sizes', size, chip);
      sizeContainer.appendChild(chip);
    });
  } else {
    sizeGroup.style.display = 'none';
  }

  const hasPrices = products.some(p => extractPrice(p.price) > 0);
  $('priceFilterGroup').style.display = hasPrices ? '' : 'none';
}

function toggleFilter(type, value, chipEl) {
  if (activeFilters[type].has(value)) {
    activeFilters[type].delete(value);
    chipEl.classList.remove('active');
  } else {
    activeFilters[type].add(value);
    chipEl.classList.add('active');
  }
  updateClearButton();
  applyFilters();
}

function extractPrice(priceStr) {
  if (!priceStr) return 0;
  const num = parseFloat(priceStr.replace(/[^\d,\.]/g, '').replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

function applyFilters() {
  let filtered = allProducts;

  if (activeFilters.search) {
    const q = activeFilters.search.toLowerCase();
    filtered = filtered.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }

  if (activeFilters.colors.size > 0) {
    filtered = filtered.filter(p =>
      (p.colors || []).some(c => activeFilters.colors.has(c))
    );
  }

  if (activeFilters.sizes.size > 0) {
    filtered = filtered.filter(p =>
      (p.sizes || []).some(s => activeFilters.sizes.has(s))
    );
  }

  if (activeFilters.minPrice !== null) {
    filtered = filtered.filter(p => extractPrice(p.price) >= activeFilters.minPrice);
  }

  if (activeFilters.maxPrice !== null) {
    filtered = filtered.filter(p => {
      const price = extractPrice(p.price);
      return price === 0 || price <= activeFilters.maxPrice;
    });
  }

  renderProducts(filtered);
}

function resetFilters() {
  activeFilters = { search: '', colors: new Set(), sizes: new Set(), minPrice: null, maxPrice: null };
  $('searchFilter').value = '';
  $('minPrice').value = '';
  $('maxPrice').value = '';
  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  updateClearButton();
}

function updateClearButton() {
  const hasFilters = activeFilters.search ||
    activeFilters.colors.size > 0 ||
    activeFilters.sizes.size > 0 ||
    activeFilters.minPrice !== null ||
    activeFilters.maxPrice !== null;
  $('clearFilters').classList.toggle('hidden', !hasFilters);
}

function renderProducts(products) {
  const grid = $('productsGrid');

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="no-results" style="grid-column:1/-1">
        <i class="fas fa-filter"></i>
        <p>Nenhum produto nos filtros atuais</p>
      </div>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const colors = (p.colors || []).slice(0, 6);
    const sizes = (p.sizes || []).slice(0, 5);
    const moreColors = (p.colors || []).length > 6 ? `+${(p.colors || []).length - 6}` : '';
    const moreSizes = (p.sizes || []).length > 5 ? `+${(p.sizes || []).length - 5}` : '';

    const colorDots = colors.map(c =>
      `<span class="color-dot" title="${esc(c)}" style="background:${colorToHex(c)}"></span>`
    ).join('');

    const sizeTags = sizes.map(s =>
      `<span class="size-tag">${esc(s)}</span>`
    ).join('');

    return `
      <div class="product-card">
        <div class="product-img-wrap">
          ${p.image
            ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=product-img-placeholder><i class=\\"fas fa-image\\"></i></div>'">`
            : '<div class="product-img-placeholder"><i class="fas fa-image"></i></div>'
          }
          ${p.discount ? `<span class="discount-badge">-${p.discount}%</span>` : ''}
          ${p.available === false ? '<span class="unavailable-badge">Esgotado</span>' : ''}
        </div>
        <div class="product-body">
          <h3 class="product-title">${esc(p.title)}</h3>
          <div class="product-prices">
            ${p.price ? `<span class="product-price">${esc(p.price)}</span>` : ''}
            ${p.originalPrice ? `<span class="product-original-price">${esc(p.originalPrice)}</span>` : ''}
          </div>
          ${colors.length || sizes.length ? `
          <div class="product-meta">
            ${colors.length ? `
            <div class="meta-row">
              <span class="meta-label">Cor</span>
              ${colorDots}
              ${moreColors ? `<span class="more-tag">${moreColors}</span>` : ''}
            </div>` : ''}
            ${sizes.length ? `
            <div class="meta-row">
              <span class="meta-label">Tam</span>
              ${sizeTags}
              ${moreSizes ? `<span class="more-tag">${moreSizes}</span>` : ''}
            </div>` : ''}
          </div>` : ''}
          ${p.description ? `<p class="product-description">${esc(p.description)}</p>` : ''}
          <div class="product-actions">
            <button class="btn-analyze" onclick='analyzeProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
              <i class="fas fa-brain"></i>
              <span>Analisar</span>
            </button>
            ${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="btn-link" title="Ver produto"><i class="fas fa-external-link-alt"></i></a>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function colorToHex(name) {
  const map = {
    preto: '#1a1a1a', branco: '#f5f5f5', vermelho: '#ef4444', azul: '#3b82f6',
    verde: '#22c55e', amarelo: '#eab308', rosa: '#ec4899', roxo: '#a855f7',
    laranja: '#f97316', cinza: '#6b7280', marrom: '#92400e', bege: '#d4b896',
    dourado: '#d97706', prata: '#9ca3af', navy: '#1e3a5f', nude: '#d4a792',
    black: '#1a1a1a', white: '#f5f5f5', red: '#ef4444', blue: '#3b82f6',
    green: '#22c55e', yellow: '#eab308', pink: '#ec4899', purple: '#a855f7',
    orange: '#f97316', gray: '#6b7280', grey: '#6b7280', brown: '#92400e',
    gold: '#d97706', silver: '#9ca3af', caramelo: '#c2783a', vinho: '#7f1d1d'
  };
  return map[name.toLowerCase().trim()] || '#cbd5e1';
}

async function analyzeProduct(product) {
  openModal();
  $('analysisContent').innerHTML = `
    <div class="analysis-loading">
      <div class="spinner"></div>
      <p>Analisando produto com IA...</p>
    </div>`;

  try {
    const provider = $('aiProvider').value;
    const result = await api('/analyze', { productData: product, aiProvider: provider });

    if (result.success) {
      $('analysisContent').innerHTML = `
        <div class="analysis-product-info">
          <h4>${esc(product.title)}</h4>
          ${product.price ? `<div class="price">${esc(product.price)}</div>` : ''}
        </div>
        <div class="analysis-text">${esc(result.data.analysis)}</div>
        <div class="analysis-disclaimer">
          <i class="fas fa-info-circle"></i>
          Análise gerada por IA. Use como referência.
        </div>`;
    } else {
      $('analysisContent').innerHTML = `
        <div class="analysis-error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>${esc(result.error || 'Erro na análise')}</p>
        </div>`;
    }
  } catch {
    $('analysisContent').innerHTML = `
      <div class="analysis-error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Erro de conexão com a IA</p>
      </div>`;
  }
}

function openModal() {
  $('analysisModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('analysisModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function setLoading(on, text = 'Processando...') {
  $('loadingText').textContent = text;
  $('loadingOverlay').classList.toggle('hidden', !on);
  $('extractBtn').disabled = on;
}

function showToast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function newSearch() {
  $('resultsSection').classList.add('hidden');
  $('emptyState').classList.add('hidden');
  allProducts = [];
  resetFilters();
  $('urlInput').value = '';
  $('clearUrl').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
  loadAiStatus();

  $('extractBtn').onclick = extractProducts;
  $('newSearchBtn').onclick = newSearch;

  $('urlInput').oninput = function () {
    $('clearUrl').classList.toggle('hidden', !this.value);
  };

  $('urlInput').onkeydown = e => {
    if (e.key === 'Enter') extractProducts();
  };

  $('clearUrl').onclick = () => {
    $('urlInput').value = '';
    $('clearUrl').classList.add('hidden');
    $('urlInput').focus();
  };

  $('searchFilter').oninput = function () {
    activeFilters.search = this.value.trim();
    updateClearButton();
    applyFilters();
  };

  $('minPrice').oninput = function () {
    activeFilters.minPrice = this.value ? parseFloat(this.value) : null;
    updateClearButton();
    applyFilters();
  };

  $('maxPrice').oninput = function () {
    activeFilters.maxPrice = this.value ? parseFloat(this.value) : null;
    updateClearButton();
    applyFilters();
  };

  $('clearFilters').onclick = () => {
    resetFilters();
    applyFilters();
  };

  document.querySelector('.modal-close').onclick = closeModal;
  document.querySelector('.modal-backdrop').onclick = closeModal;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
});
