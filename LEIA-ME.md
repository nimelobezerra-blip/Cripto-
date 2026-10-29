# Cripto

Site de criptomoedas: preços ao vivo, gráfico com previsão, carteira e alertas.

- **Mercado:** top 10 (ou top 20) por valor de mercado, em R$ ou US$, com a variação em 24h, 7 e 30 dias. Atualiza sozinho a cada minuto.
- **Análise e previsão:** toque numa moeda para ver o gráfico com as médias de 7 e 30 dias e o RSI. Também mostra uma faixa provável para os próximos 7, 14 ou 30 dias e um resumo da tendência (alta, baixa ou neutra).
- **Carteira:** registre quanto tem de cada moeda e, se quiser, o preço médio que pagou. O site mostra o valor total e o lucro ou prejuízo.
- **Alertas:** recebe um aviso quando uma moeda passar de um valor. Os alertas só são verificados com a página aberta.

A carteira e os alertas ficam guardados só no navegador onde foram criados.

Os dados vêm da API pública da [CoinGecko](https://www.coingecko.com/), que não precisa de conta nem de chave. Se a página fizer muitos pedidos seguidos, a CoinGecko trava por um minuto e o site avisa.

A previsão é estatística: usa a volatilidade dos últimos 90 dias e metade da tendência dos últimos 30. Ninguém sabe o preço futuro, por isso **não é recomendação de investimento**.

## Pôr no ar no Cloudflare

Faça uma vez, como no Bezerra:

1. Em <https://dash.cloudflare.com>, abra **Workers e Pages → Criar → Importar um repositório** e escolha este repositório (`Cripto-`).
2. Deixe o comando de build vazio. O comando de deploy é `npx wrangler deploy`.
3. A cada envio (push) para `main`, o site é publicado em **https://cripto.nimelobezerra.workers.dev/**.

A configuração está em `wrangler.jsonc`. O `_headers` define a política de segurança: o site só fala com a API e as imagens da CoinGecko.

## No iPhone

Abra o endereço no **Safari** e toque em **Compartilhar → Adicionar à Tela de Início**.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | A página |
| `app.js` | Dados, cálculos, gráficos, carteira e alertas |
| `style.css` | Visual (claro e escuro, conforme o sistema) |
| `_headers` | Cabeçalhos de segurança no Cloudflare |
| `manifest.webmanifest`, `icons/` | Ícone e instalação na tela de início |
