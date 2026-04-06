require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

let anthropic = null;
let gemini = null;

if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('✅ Claude (Anthropic) configurado');
}

if (process.env.GEMINI_API_KEY) {
  gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log('✅ Gemini (Google) configurado');
}

const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/ai-status', (_req, res) => {
  const provider = gemini ? 'gemini' : (anthropic ? 'claude' : 'none');
  res.json({
    success: true,
    data: {
      gemini: { available: !!gemini, status: gemini ? 'Ativo (Gratuito)' : 'Não configurado' },
      claude: { available: !!anthropic, status: anthropic ? 'Ativo' : 'Não configurado' },
      recommended: provider
    }
  });
});

function isSize(val) {
  return /^\d{2,3}$|^[pPmMgG]{1,3}$|^PP$|^GG$|^XG$|^XXG$|^XS$|^XL$|^XXL$/.test(val.trim());
}

async function tryShopifyApi(url) {
  try {
    const parsed = new URL(url);
    const apiUrl = `${parsed.protocol}//${parsed.hostname}/products.json?limit=250`;
    const resp = await axios.get(apiUrl, { headers: AXIOS_HEADERS, timeout: 15000 });
    if (!resp.data?.products?.length) return null;

    return resp.data.products.map(p => {
      const variants = p.variants || [];
      const prices = variants.map(v => parseFloat(v.price)).filter(Boolean);
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;
      const priceStr = !minP ? '' : minP === maxP
        ? `R$ ${minP.toFixed(2).replace('.', ',')}`
        : `R$ ${minP.toFixed(2).replace('.', ',')} – R$ ${maxP.toFixed(2).replace('.', ',')}`;

      const colorOpt = (p.options || []).find(o => /cor|color/i.test(o.name));
      const sizeOpt = (p.options || []).find(o => /tamanho|size|tam\b/i.test(o.name));
      const allOpts = [...new Set(variants.map(v => v.option1 || '').filter(Boolean))];

      return {
        title: p.title || '',
        price: priceStr,
        originalPrice: null,
        discount: null,
        colors: colorOpt ? colorOpt.values : allOpts.filter(v => !isSize(v)),
        sizes: sizeOpt ? sizeOpt.values : allOpts.filter(v => isSize(v)),
        image: p.images?.[0]?.src || null,
        link: `${parsed.protocol}//${parsed.hostname}/products/${p.handle}`,
        description: (p.body_html || '').replace(/<[^>]*>/g, '').trim().substring(0, 150),
        available: variants.some(v => v.available),
        category: p.product_type || null
      };
    }).filter(p => p.title);
  } catch {
    return null;
  }
}

function extractJsonLd($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      items.forEach(item => {
        if (item['@type'] === 'Product') {
          const offers = Array.isArray(item.offers) ? item.offers : [item.offers || {}];
          const prices = offers.map(o => parseFloat(o.price)).filter(Boolean);
          const minP = prices.length ? Math.min(...prices) : 0;
          products.push({
            title: item.name || '',
            price: minP ? `R$ ${minP.toFixed(2).replace('.', ',')}` : '',
            originalPrice: null, discount: null, colors: [], sizes: [],
            image: typeof item.image === 'string' ? item.image : (item.image?.[0] || null),
            link: item.url || null,
            description: (item.description || '').replace(/<[^>]*>/g, '').substring(0, 150),
            available: offers.some(o => (o.availability || '').includes('InStock')),
            category: item.category || null
          });
        }
      });
    } catch {}
  });
  return products;
}

function buildCleanText($) {
  $('script, style, nav, footer, iframe, noscript, svg, header, aside').remove();
  $('[class*="cookie"],[class*="popup"],[class*="chat"],[class*="banner"],[id*="cookie"]').remove();
  let text = $('body').text().replace(/\s+/g, ' ').trim();
  if (text.length > 45000) text = text.substring(0, 45000);
  return text;
}

async function callAI(prompt) {
  // Prefer Gemini (free), fallback to Claude
  if (gemini) {
    const model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }
  if (anthropic) {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    return resp.content[0].text;
  }
  throw new Error('Nenhuma IA configurada. Adicione GEMINI_API_KEY no arquivo .env');
}

async function callAIAnalysis(prompt) {
  if (gemini) {
    const model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }
  if (anthropic) {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });
    return resp.content[0].text;
  }
  throw new Error('Nenhuma IA configurada');
}

app.post('/api/extract', async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ success: false, error: 'URL é obrigatória' });

  try { new URL(url); } catch {
    return res.status(400).json({ success: false, error: 'URL inválida' });
  }

  if (!gemini && !anthropic) {
    return res.status(400).json({
      success: false,
      error: 'Nenhuma IA configurada. Adicione GEMINI_API_KEY (gratuito) no .env. Obtenha em aistudio.google.com',
      code: 'NO_AI'
    });
  }

  // 1. Shopify JSON API
  const shopifyProducts = await tryShopifyApi(url);
  if (shopifyProducts?.length) {
    return res.json({
      success: true, url, data: shopifyProducts,
      pageTitle: new URL(url).hostname,
      totalFound: shopifyProducts.length,
      provider: 'shopify-api',
      extractedAt: new Date().toISOString()
    });
  }

  // 2. Fetch HTML
  let $, pageTitle;
  try {
    const resp = await axios.get(url, { headers: AXIOS_HEADERS, timeout: 20000, maxRedirects: 5 });
    $ = cheerio.load(resp.data);
    pageTitle = $('title').text().trim() || new URL(url).hostname;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(400).json({ success: false, error: 'Não foi possível acessar o site. Verifique a URL.' });
    }
    if (err.response?.status === 403) {
      return res.status(400).json({ success: false, error: 'Site bloqueou o acesso (proteção anti-bot).' });
    }
    return res.status(400).json({ success: false, error: `Erro ao acessar: ${err.message}` });
  }

  // 3. JSON-LD structured data
  const ldProducts = extractJsonLd($);
  if (ldProducts.length) {
    return res.json({
      success: true, url, data: ldProducts, pageTitle,
      totalFound: ldProducts.length, provider: 'json-ld',
      extractedAt: new Date().toISOString()
    });
  }

  // 4. AI extraction
  const cleanText = buildCleanText($);

  const prompt = `Você é especialista em extração de dados de e-commerce de moda e calçados.

Analise o conteúdo da página "${url}" e extraia TODOS os produtos.

Para cada produto retorne:
- title: nome do produto
- price: preço atual em reais (ex: "R$ 89,90") ou string vazia
- originalPrice: preço antes do desconto ou null
- discount: % de desconto (número) ou null
- colors: cores disponíveis em português ["Preto","Branco","Rosa","Vermelho","Azul","Verde","Amarelo","Bege","Nude","Cinza","Roxo","Laranja","Marrom","Vinho"]
- sizes: tamanhos ["P","M","G","GG"] ou numeração ["36","37","38"] ou vazio
- image: URL da imagem ou null
- link: URL do produto ou null
- description: descrição curta (máx 120 chars)
- available: true/false
- category: "Vestido","Blusa","Calça","Tênis","Sandália","Bota","Acessório","Lingerie" ou null

Retorne SOMENTE JSON válido:
{"products":[...],"pageTitle":"...","totalFound":número}

CONTEÚDO:
${cleanText}`;

  try {
    const text = await callAI(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta inválida da IA');

    const extracted = JSON.parse(jsonMatch[0]);
    const products = extracted.products || [];

    res.json({
      success: true, url, data: products,
      pageTitle: extracted.pageTitle || pageTitle,
      totalFound: products.length, provider: gemini ? 'gemini' : 'claude',
      extractedAt: new Date().toISOString()
    });
  } catch (aiErr) {
    console.error('AI error:', aiErr.message);

    if (aiErr.message?.includes('credit') || aiErr.message?.includes('quota')) {
      return res.status(402).json({
        success: false,
        error: 'Cota/créditos esgotados. Use GEMINI_API_KEY (gratuito) em aistudio.google.com',
        code: 'QUOTA_EXCEEDED'
      });
    }

    res.status(500).json({ success: false, error: 'Erro na extração: ' + aiErr.message });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { productData } = req.body;
  if (!productData?.title) return res.status(400).json({ success: false, error: 'Dados do produto são obrigatórios' });
  if (!gemini && !anthropic) return res.status(400).json({ success: false, error: 'Nenhuma IA configurada' });

  const prompt = `Analise este produto para um consumidor brasileiro:

Produto: ${productData.title}
Preço: ${productData.price || 'N/A'}
${productData.originalPrice ? `Preço Original: ${productData.originalPrice}` : ''}
${productData.discount ? `Desconto: ${productData.discount}%` : ''}
${productData.colors?.length ? `Cores: ${productData.colors.join(', ')}` : ''}
${productData.sizes?.length ? `Tamanhos: ${productData.sizes.join(', ')}` : ''}
${productData.category ? `Categoria: ${productData.category}` : ''}
${productData.description ? `Descrição: ${productData.description}` : ''}

Forneça em português:
1. 💰 Análise de preço e custo-benefício
2. 🎯 Para quem é ideal
3. ✅ Pontos positivos
4. ⚠️ Atenção antes de comprar
5. 💡 Dica de compra
6. 🏆 Pontuação: X/10`;

  try {
    const analysis = await callAIAnalysis(prompt);
    res.json({
      success: true,
      data: { analysis, product: productData, provider: gemini ? 'gemini' : 'claude', timestamp: new Date().toISOString() }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
