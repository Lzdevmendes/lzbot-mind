# LzBot Mind

Extração inteligente de produtos de qualquer loja online usando IA. Cole o link de qualquer site e obtenha preços, tamanhos, cores e disponibilidade automaticamente.

## Como funciona

1. O usuário cola a URL de qualquer loja (Shopify, WooCommerce, etc.)
2. O sistema tenta extrair via API nativa do Shopify (quando disponível)
3. Fallback para dados estruturados JSON-LD embutidos no HTML
4. Fallback final: Google Gemini analisa o conteúdo da página e extrai os produtos
5. Os dados são exibidos com filtros interativos de cor, tamanho e preço

## Stack

- **Backend:** Node.js + Express
- **Scraping:** Axios + Cheerio
- **IA:** Google Gemini 2.0 Flash (gratuito) + OpenAI como fallback
- **Frontend:** HTML, CSS e JavaScript vanilla — sem frameworks

## Instalação

```bash
git clone <repo>
cd Lzbot-starmind
npm install
cp .env.example .env
```

Configure o `.env`:

```env
GEMINI_API_KEY=sua_chave_aqui
PORT=3001
```

Obtenha a chave Gemini gratuitamente em [aistudio.google.com](https://aistudio.google.com) — sem cartão de crédito.

```bash
npm start
```

Acesse `http://localhost:3001`

## Funcionalidades

- Extração de produtos de qualquer URL de e-commerce
- Suporte nativo a lojas Shopify via `/products.json`
- Extração via JSON-LD (schema.org) para sites modernos
- Filtros por cor, tamanho e faixa de preço
- Busca textual nos produtos extraídos
- Análise individual de produto com IA
- UI responsiva e 100% compatível com mobile

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | Sim | Chave do Google Gemini (gratuita) |
| `PORT` | Não | Porta do servidor (padrão: 3000) |

## Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/extract` | Extrai produtos de uma URL |
| `POST` | `/api/analyze` | Analisa um produto com IA |
| `GET` | `/api/ai-status` | Verifica status da IA configurada |

### POST /api/extract

```json
{ "url": "https://loja.com/categoria" }
```

### POST /api/analyze

```json
{ "productData": { "title": "...", "price": "...", "colors": [], "sizes": [] } }
```

## Deploy

Compatível com Railway, Render, Heroku e qualquer plataforma Node.js.

Variáveis necessárias em produção: `GEMINI_API_KEY` e `PORT`.
