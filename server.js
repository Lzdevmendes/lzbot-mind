require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

let anthropic = null;
let openai = null;

if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('✅ Claude (Anthropic) configurado');
}

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('✅ OpenAI configurado');
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/ai-status', (_req, res) => {
  res.json({
    success: true,
    data: {
      claude: { available: !!anthropic, status: anthropic ? 'Ativo' : 'Não configurado' },
      openai: { available: !!openai, status: openai ? 'Ativo' : 'Não configurado' },
      recommended: anthropic ? 'claude' : (openai ? 'openai' : 'none')
    }
  });
});

app.post('/api/extract', async (req, res) => {
  const { url, aiProvider = 'claude' } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL é obrigatória' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'URL inválida. Verifique o formato.' });
  }

  const client = aiProvider === 'openai' ? openai : anthropic;
  if (!client) {
    return res.status(400).json({
      success: false,
      error: `${aiProvider === 'openai' ? 'OpenAI' : 'Claude'} não configurado. Adicione a chave no arquivo .env`
    });
  }

  let html;
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      timeout: 20000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, iframe, noscript, svg, header').remove();
    $('[class*="cookie"], [class*="popup"], [class*="modal"], [id*="cookie"]').remove();

    html = $('body').html() || response.data;
    if (html.length > 60000) html = html.substring(0, 60000);

  } catch (fetchError) {
    if (fetchError.code === 'ENOTFOUND' || fetchError.code === 'ECONNREFUSED') {
      return res.status(400).json({ success: false, error: 'Não foi possível acessar o site. Verifique a URL.' });
    }
    if (fetchError.response?.status === 403) {
      return res.status(400).json({ success: false, error: 'Acesso negado pelo site (proteção anti-bot).' });
    }
    return res.status(400).json({ success: false, error: `Erro ao acessar o site: ${fetchError.message}` });
  }

  const prompt = `Você é um especialista em extração de dados de e-commerce. Analise o HTML abaixo de "${url}" e extraia TODOS os produtos disponíveis na página.

Para cada produto extraia:
- title: nome completo do produto (string)
- price: preço atual formatado (string, ex: "R$ 99,90")
- originalPrice: preço original antes do desconto (string ou null)
- discount: percentual de desconto se existir (número ou null, ex: 20)
- colors: array de cores disponíveis (array de strings, ex: ["Preto", "Branco"])
- sizes: array de tamanhos disponíveis (array de strings, ex: ["P", "M", "G", "42", "43"])
- image: URL absoluta da imagem principal do produto (string ou null)
- link: URL absoluta do produto (string ou null)
- description: descrição resumida máximo 150 caracteres (string)
- available: se está disponível para compra (boolean)
- category: categoria do produto se identificável (string ou null)

REGRAS IMPORTANTES:
- Retorne SOMENTE JSON válido, sem markdown ou explicações
- Se não encontrar produtos, retorne {"products":[],"pageTitle":"","totalFound":0}
- Links e imagens devem ser URLs absolutas (use "${url}" como base se necessário)
- Não invente dados, só extraia o que está no HTML

Formato obrigatório:
{"products":[...],"pageTitle":"título da página","totalFound":número}

HTML:
${html}`;

  try {
    let extracted;

    if (aiProvider === 'openai' && openai) {
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });
      extracted = JSON.parse(aiResponse.choices[0].message.content);
    } else {
      const aiResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = aiResponse.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Resposta da IA não contém JSON válido');
      extracted = JSON.parse(jsonMatch[0]);
    }

    res.json({
      success: true,
      url,
      data: extracted.products || [],
      pageTitle: extracted.pageTitle || '',
      totalFound: extracted.totalFound || (extracted.products?.length ?? 0),
      provider: aiProvider === 'openai' ? 'openai' : 'claude',
      extractedAt: new Date().toISOString()
    });

  } catch (aiError) {
    if (aiError instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ success: false, error: 'Chave da API inválida. Verifique o arquivo .env' });
    }
    if (aiError instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ success: false, error: 'Limite de requisições atingido. Aguarde um momento.' });
    }
    console.error('AI extraction error:', aiError.message);
    res.status(500).json({ success: false, error: 'Erro na extração com IA: ' + aiError.message });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { productData, aiProvider = 'claude' } = req.body;

  if (!productData?.title) {
    return res.status(400).json({ success: false, error: 'Dados do produto são obrigatórios' });
  }

  const client = aiProvider === 'openai' ? openai : anthropic;
  if (!client) {
    return res.status(400).json({ success: false, error: `${aiProvider === 'openai' ? 'OpenAI' : 'Claude'} não configurado` });
  }

  const colorInfo = productData.colors?.length ? `Cores: ${productData.colors.join(', ')}` : '';
  const sizeInfo = productData.sizes?.length ? `Tamanhos: ${productData.sizes.join(', ')}` : '';
  const discountInfo = productData.discount ? `Desconto: ${productData.discount}%` : '';

  const prompt = `Analise este produto para um consumidor brasileiro e forneça insights práticos:

Produto: ${productData.title}
Preço: ${productData.price || 'N/A'}
${productData.originalPrice ? `Preço Original: ${productData.originalPrice}` : ''}
${discountInfo}
${colorInfo}
${sizeInfo}
${productData.description ? `Descrição: ${productData.description}` : ''}

Forneça uma análise em português com:
1. 💰 Análise de preço e custo-benefício
2. 🎯 Para quem é ideal este produto
3. ✅ Principais pontos positivos
4. ⚠️ Pontos de atenção antes de comprar
5. 💡 Dica de compra
6. 🏆 Pontuação geral: X/10

Seja objetivo, prático e útil para quem vai comprar.`;

  try {
    let analysis;

    if (aiProvider === 'openai' && openai) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.7
      });
      analysis = response.choices[0].message.content;
    } else {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      });
      analysis = response.content[0].text;
    }

    res.json({
      success: true,
      data: { analysis, product: productData, provider: aiProvider, timestamp: new Date().toISOString() }
    });

  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ success: false, error: 'Chave da API inválida' });
    }
    console.error('Analysis error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
