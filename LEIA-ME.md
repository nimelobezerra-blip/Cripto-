# Cripto

Site de criptomoedas com preços ao vivo em **R$, US$ e €**.

- **Visão geral:** valor total do mercado, volume em 24h, dominância do Bitcoin e o índice Medo & Ganância.
- **Mercado:** as 50 maiores moedas, com busca, favoritas (★) e minigráfico dos últimos 7 dias. Atualiza sozinho a cada minuto.
- **Análise e previsão:** toque numa moeda para ver:
  - preço, máxima e mínima de 24h e distância do recorde;
  - gráfico com médias de 7 e 30 dias, suporte e resistência e RSI;
  - faixa provável para os próximos 7, 14 ou 30 dias;
  - chance de alta e tendência (alta, baixa ou neutra) com o motivo;
  - **acerto histórico** do modelo, ou seja, quantas vezes a faixa acertou no passado.
- **Carteira:** quantidade e preço médio pago, valor total, variação em 24h, lucro ou prejuízo e gráfico de distribuição. Tem **backup**: baixe um arquivo e restaure em outro aparelho.
- **Alertas:** recebe um aviso quando uma moeda passar de um valor e pode reativar alertas que já dispararam. Os alertas só são verificados com a página aberta.
- **Conversor:** de cripto para R$, US$ ou € e vice-versa.
- **Tema:** automático, claro ou escuro (botão da lua).

A carteira, os alertas e as favoritas ficam guardados só no navegador. Use o backup para não os perder.

Os dados vêm da API pública da [CoinGecko](https://www.coingecko.com/) e do índice [Medo & Ganância da Alternative.me](https://alternative.me/crypto/fear-and-greed-index/). Nenhum dos dois precisa de conta nem de chave. Se a página fizer muitos pedidos seguidos, a CoinGecko trava por um minuto e o site avisa.

A previsão é estatística: usa a volatilidade dos últimos 90 dias e metade da tendência dos últimos 30. Ninguém sabe o preço futuro, por isso **não é recomendação de investimento**.

## Pôr no ar no Cloudflare

Faça uma vez, como no Bezerra:

1. Em <https://dash.cloudflare.com>, abra **Workers e Pages → Criar → Importar um repositório** e escolha este repositório (`Cripto-`).
2. Deixe o comando de build vazio. O comando de deploy é `npx wrangler deploy`.
3. A cada envio (push) para `main`, o site é publicado em **https://cripto.nimelobezerra.workers.dev/**.

A configuração está em `wrangler.jsonc`. O `_headers` define a política de segurança: o site só fala com a CoinGecko, a Alternative.me e o Google Fonts (fonte Inter).

## No iPhone

Abra o endereço no **Safari** e toque em **Compartilhar → Adicionar à Tela de Início**.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | A página |
| `app.js` | Dados, cálculos, gráficos, carteira, alertas e conversor |
| `theme.js` | Aplica o tema escolhido antes de a página aparecer |
| `style.css` | Visual (claro e escuro, conforme o sistema) |
| `_headers` | Cabeçalhos de segurança no Cloudflare |
| `manifest.webmanifest`, `icons/` | Ícone e instalação na tela de início |
