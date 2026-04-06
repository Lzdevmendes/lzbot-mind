]# LzBot StarMind

Sistema web completo para análise de produtos com IA e web scraping.

## Instalação

```bash
npm install
cp .env.example .env
# Configure OPENAI_API_KEY no .env
npm start
```

## Uso

Acesse `http://localhost:3000`

- Visualize produtos extraídos automaticamente
- Use a busca para filtrar produtos
- Clique em "Analisar com IA" para análises detalhadas

## Deploy

Configure as variáveis:

- `OPENAI_API_KEY`: Sua chave da OpenAI
- `PORT`: Porta do servidor (padrão: 3000)

Sistema pronto para Heroku, Vercel, Railway.
