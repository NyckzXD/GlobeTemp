# GlobeTemp — Globo 3D de Temperatura

Globo terrestre 3D interativo com um mapa de calor da **temperatura do ar a 2 m** (série horária do [Open-Meteo](https://open-meteo.com/)), no estilo do [earth.nullschool.net](https://earth.nullschool.net/). O backend em Python (só biblioteca padrão) busca e guarda os dados; o frontend em JavaScript, com [globe.gl](https://globe.gl/) / [Three.js](https://threejs.org/), interpola a grade num shader e pinta a superfície do planeta.

---

## Funcionalidades

- **Globo 3D** com rotação automática (para ao arrastar), cor chapada, linhas de costa nítidas (Natural Earth 1:50m), fronteiras discretas e atmosfera colorida.
- **Mapa de calor na GPU**: a grade (6°) vai para uma textura de floats e o shader da superfície faz interpolação **bicúbica** (Catmull-Rom) por fragmento. Fica nítido em qualquer zoom, e trocar a paleta ou o horário é instantâneo.
- **Linha do tempo**: a série horária vai de 6 h atrás até 24 h à frente. Por padrão o globo acompanha o relógio (mistura suave entre as horas). Dá para arrastar o slider, tocar a animação ou voltar para **Now**.
- **5 escalas de cor** com **legenda** de -40 °C a 50 °C: Thermal (divergente, centrada em 0 °C), Viridis, Cividis (segura para daltonismo), Plasma e Magma. A escolha fica salva no navegador.
- **Tooltip** com a temperatura interpolada sob o cursor, no horário exibido (o mesmo valor que o shader pinta), e as coordenadas. No celular, toque sem arrastar.
- **Estatísticas** do horário exibido: mínimo, máximo e média global **ponderada por área**.
- **Indicador de estado**: `Live`, `Updating`, `Retrying`, `Stale`, `Estimated`, `Offline`.
- **Horário da busca** e crédito ao Open-Meteo no rodapé do painel.
- **Atualização** automática (6–12 h) com contagem regressiva e botão **Force Update** (cooldown de 10 min e teto diário de cota).
- **Painel recolhível**, que vira uma folha na parte de baixo da tela no celular.
- **Acessibilidade**: foco visível no teclado, rótulos nos controles e menos movimento (sem rotação automática nem animações) para quem ativa `prefers-reduced-motion`.

---

## Como executar

**Pré-requisito:** Python 3.10+. Não há dependências externas para rodar.

```bash
python -m globetemp
```

`python server.py` também funciona (é só um atalho para o mesmo comando).

Abra <http://localhost:5005>.

Nos primeiros minutos (uma rodada leva uns 3,5 min) o globo mostra uma **estimativa por latitude** (estado `Estimated`). Assim que a primeira busca ao Open-Meteo termina, os dados reais substituem a estimativa e ficam salvos em `cache.json`. Ao reiniciar, o servidor usa esse cache e só busca de novo quando o intervalo vence.

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `GLOBETEMP_HOST` | `127.0.0.1` | Endereço de escuta. Use `0.0.0.0` para expor na rede (não há autenticação). |
| `GLOBETEMP_PORT` | `5005` | Porta HTTP. |
| `GLOBETEMP_CACHE` | `./cache.json` | Arquivo do cache dos últimos dados reais. |
| `GLOBETEMP_LOG_LEVEL` | `INFO` | `DEBUG` também mostra cada requisição HTTP. |

---

## Como funciona

### Dados e cota do Open-Meteo

O plano gratuito do Open-Meteo é limitado por **número de localizações** (~600/min, ~10.000/dia), não por número de requisições. Por isso:

- A grade tem **6°** de passo: 31 latitudes × 61 longitudes = 1.891 pontos. Polos e o meridiano ±180° são o mesmo lugar físico, então só **1.742 localizações únicas** são consultadas e o resto é copiado.
- Cada localização traz a **série horária** (`past_hours=6`, `forecast_hours=25`) numa só consulta. Como a série cobre o intervalo inteiro, o globo continua "ao vivo" entre as rodadas sem gastar cota.
- As consultas vão em lotes de 100 localizações, uma a cada 12 s (≈ 500/min, abaixo do limite de 600/min). Uma rodada leva uns 3,5 min.
- O intervalo mínimo é **6 h**: 1.742 × 4 atualizações/dia ≈ 7.000 localizações/dia.
- Um **teto de 9.000 localizações em 24 h** segura atualizações forçadas e agendadas que passariam da cota. O registro fica em memória (reiniciar o servidor o zera).
- Se lotes de uma rodada chegarem em horas diferentes, só ficam os horários que todas as localizações trouxeram.
- Se uma rodada falhar no meio, os lotes já baixados são reaproveitados na próxima tentativa (por até 30 min).
- Erros usam **backoff exponencial** (30 s → 1 min → … → 30 min). Um `429` espera pelo menos 5 min, ou o `Retry-After` se for maior.

### Estrutura

```
globetemp/            backend (pacote Python)
  config.py           constantes e variáveis de ambiente
  grid.py             grade, localizações únicas, estatísticas ponderadas por área
  open_meteo.py       cliente da API
  service.py          TemperatureService: cache em disco, agendamento, backoff
  web.py              handler HTTP (arquivos estáticos + API)
  __main__.py         `python -m globetemp`
static/
  index.html, style.css
  js/
    main.js           liga tudo: estado, agendamento das buscas, controles
    palettes.js       escalas de cor e tabela de cores (puro, testado no Node)
    grid.js           grade horária, interpolação bicúbica e no tempo (puro, testado no Node)
    heatmap.js        shader da superfície: grade em textura de floats + paleta
    globe.js          configuração do globe.gl, linhas de costa e fronteiras
    topology.js       leitura mínima de TopoJSON (puro, testado no Node)
    api.js, config.js
    ui/               tooltip, legenda, painel, status, linha do tempo
tests/                pytest (backend) e tests/js (node:test)
```

### Backend

- `TemperatureService` mantém a série horária, as estatísticas de cada horário e uma thread em segundo plano que decide quando buscar (intervalo vencido, atualização forçada ou ainda sem dado real), respeitando o teto diário de cota.
- A média global é ponderada por `cos(latitude)`, porque cada ponto de uma grade equiretangular cobre menos área perto dos polos.
- Servidor `ThreadingHTTPServer`. A API não é cacheada; os arquivos estáticos são revalidados.

### Frontend

1. Busca `/api/data` e monta a grade `lat × lng` de cada horário.
2. Empilha todos os horários numa textura de floats (`R32F`) e a paleta numa textura de 512×1. O material Phong do globo recebe, via `onBeforeCompile`, um trecho de shader que calcula lat/lng do fragmento, faz a bicúbica nos dois horários vizinhos, mistura e consulta a paleta. O globe.gl não exporta o Three.js, então os construtores necessários vêm de objetos que ele já criou.
3. As linhas de costa e as fronteiras saem do TopoJSON do `world-atlas` (arco de um só país = costa; compartilhado = fronteira) e viram duas geometrias de linhas (dois draw calls).
4. O tooltip usa a mesma interpolação (`sampleTemp` em `grid.js`), então o número sempre bate com a cor.
5. Agenda a próxima busca para o `next_update` do servidor, com um mínimo de 10 s entre buscas e nova tentativa a cada 15 s se o servidor não responder.

---

## API

### `GET /api/data`

```json
{
  "grid": {
    "lats": [-90, -84, ..., 90],
    "lngs": [-180, -174, ..., 180],
    "times": ["2026-11-02T12:00", "2026-11-02T13:00", ...],
    "values": [[-28.4, -28.4, ...], ...]
  },
  "stats": [{ "min": -51.7, "max": 36.6, "avg": 15.1 }, ...],
  "interval": 360,
  "interval_min": 360,
  "interval_max": 720,
  "last_update": 1793640000.0,
  "next_update": 1793661600.0,
  "refreshing": false,
  "retrying": false,
  "source": "open-meteo"
}
```

- `grid.times`: horários UTC da série. `grid.values[k]` é a grade do horário k em ordem lat-major (sul → norte, oeste → leste), com as bordas ±180° e os polos repetidos.
- `stats[k]`: estatísticas do horário k.
- `last_update`: quando o servidor obteve os dados (epoch, segundos).
- `source`: `open-meteo` ou `synthetic` (estimativa por latitude).
- `next_update`: nunca está no passado; o cliente pode agendar a próxima busca direto por ele.

### `POST /api/settings`

Corpo JSON (`Content-Type: application/json`, máx. 1 KB):

| Campo | Tipo | Descrição |
|---|---|---|
| `interval` | número | Intervalo de atualização em minutos, limitado a 360–720. |
| `action` | `"force_update"` | Pede uma busca imediata (cooldown de 10 min, e só se a rodada couber no teto diário de cota). |

Resposta:

```json
{ "status": "ok", "interval": 480, "refresh": "queued", "retry_after": 600 }
```

`refresh` é `"queued"` ou `"cooldown"`, e `retry_after` diz em quantos segundos um novo pedido será aceito. Erros de validação respondem `400`/`411`/`413`/`415` com `{ "error": "..." }`.

---

## Personalização

- **Resolução da grade**: `GRID_STEP` em `globetemp/config.py`. O cliente deriva os eixos dos dados, então não precisa mudar nada no JS. Recalcule a cota antes: localizações únicas × atualizações por dia deve ficar abaixo de 10.000.
- **Paletas**: `PALETTES` em `static/js/palettes.js`. Cada paleta tem um rótulo, a cor da atmosfera e uma lista de paradas `{ t, c }` (temperatura → RGB). O seletor e a legenda são gerados a partir dela.
- **Aparência do globo**: luzes, relevo e atmosfera em `static/js/globe.js`; a sobreposição da Terra em `static/js/heatmap.js`.

---

## Desenvolvimento

```bash
pip install -r requirements-dev.txt
npm install
```

| Comando | O que faz |
|---|---|
| `pytest` | Testes do backend (sem rede: o Open-Meteo é simulado). |
| `ruff check .` / `ruff format .` | Lint e formatação do Python. |
| `npm test` | Testes do JS puro (`palettes.js`, `grid.js`, status) com `node:test`. |
| `npm run lint` | ESLint no JS. |

O GitHub Actions (`.github/workflows/ci.yml`) roda tudo isso em cada push no `master` e em cada pull request.

---

## Tecnologias

- **Python** (`http.server`, `threading`, `urllib`): servidor, agendamento e cache.
- **globe.gl 2.46.2** / **Three.js**: renderização WebGL do globo.
- **HTML / CSS / JavaScript** com ES modules nativos, sem build.
- **pytest**, **ruff**, **ESLint** e **node:test** no desenvolvimento.

## Licença

Código sob a licença [MIT](LICENSE). Os dados e recursos de terceiros abaixo seguem as licenças deles.

## Créditos

- Dados meteorológicos: [Open-Meteo.com](https://open-meteo.com/), licenciados sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Fronteiras dos países: [Natural Earth](https://www.naturalearthdata.com/) (domínio público), via exemplos do globe.gl.
- Texturas da Terra: exemplos do [three-globe](https://github.com/vasturiano/three-globe).
