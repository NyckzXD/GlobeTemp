# GlobeTemp — Globo 3D de Temperatura

Globo terrestre 3D interativo com um mapa de calor da **temperatura real do ar a 2 m**, obtida do [Open-Meteo](https://open-meteo.com/). O backend em Python (só biblioteca padrão) busca e guarda os dados; o frontend em JavaScript, com [globe.gl](https://globe.gl/) / [Three.js](https://threejs.org/), interpola a grade e pinta a textura do planeta.

---

## Funcionalidades

- **Globo 3D** com rotação automática (para ao arrastar), relevo, fronteiras dos países e atmosfera colorida.
- **Mapa de calor** gerado num canvas equiretangular (2048×1024) por interpolação bilinear da grade e aplicado como textura do globo.
- **4 escalas de cor** (Thermal, Plasma, Magma, Glacier) com **legenda** de -40 °C a 50 °C.
- **Tooltip** com a temperatura interpolada sob o cursor (o mesmo valor que o mapa pinta) e as coordenadas. No celular, toque sem arrastar.
- **Estatísticas**: mínimo, máximo e média global **ponderada por área**.
- **Indicador de estado**: `Live`, `Updating`, `Retrying`, `Stale`, `Estimated`, `Offline`.
- **Horário da observação** e crédito ao Open-Meteo no rodapé do painel.
- **Atualização** automática (90–360 min) com contagem regressiva e botão **Force Update** (cooldown de 10 min).
- **Painel recolhível**, que vira uma folha na parte de baixo da tela no celular.

---

## Como executar

**Pré-requisito:** Python 3.8+. Não há dependências externas.

```bash
python server.py
```

Abra <http://localhost:5005>.

Nos primeiros segundos o globo mostra uma **estimativa por latitude** (estado `Estimated`). Assim que a primeira busca ao Open-Meteo termina, os dados reais substituem a estimativa e ficam salvos em `cache.json`. Ao reiniciar, o servidor usa esse cache e só busca de novo quando o intervalo vence.

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

- A grade tem **12°** de passo: 16 latitudes × 31 longitudes = 496 pontos. Polos e o meridiano ±180° são o mesmo lugar físico, então só **422 localizações únicas** são consultadas e o resto é copiado.
- As consultas vão em lotes de 100 localizações.
- O intervalo mínimo é **90 min**: 422 × 16 atualizações/dia ≈ 6.750 localizações/dia.
- Se uma rodada falhar no meio, os lotes já baixados são reaproveitados na próxima tentativa (por até 30 min).
- Erros usam **backoff exponencial** (30 s → 1 min → … → 30 min). Um `429` espera pelo menos 5 min, ou o `Retry-After` se for maior.

### Backend (`server.py`)

- `ThermalSimulation` mantém a grade, as estatísticas e uma thread em segundo plano que decide quando buscar (intervalo vencido, atualização forçada ou ainda sem dado real).
- A média global é ponderada por `cos(latitude)`, porque cada ponto de uma grade equiretangular cobre menos área perto dos polos.
- Servidor `ThreadingHTTPServer`. A API não é cacheada; os arquivos estáticos são revalidados.

### Frontend (`static/app.js`)

1. Busca `/api/data` e monta a grade `lat × lng`.
2. Interpola cada pixel do canvas com `sampleTemp` (bilinear) e converte para cor via uma tabela pré-calculada da paleta ativa.
3. Mistura uma textura sutil da Terra para os continentes continuarem reconhecíveis e aplica o canvas como textura do globo.
4. Agenda a próxima busca para o `next_update` do servidor, com um mínimo de 10 s entre buscas e nova tentativa a cada 15 s se o servidor não responder.

---

## API

### `GET /api/data`

```json
{
  "points": [ { "lat": -90, "lng": -180, "temp": -28.4 }, ... ],
  "stats": { "min": -51.7, "max": 36.6, "avg": 15.1 },
  "interval": 90,
  "interval_min": 90,
  "interval_max": 360,
  "last_update": 1793640000.0,
  "observed_at": "2026-11-02T17:30Z",
  "next_update": 1793645400.0,
  "refreshing": false,
  "retrying": false,
  "source": "open-meteo"
}
```

- `last_update`: quando o servidor obteve os dados (epoch, segundos).
- `observed_at`: horário da observação informado pelo Open-Meteo (UTC). É `null` enquanto a fonte for a estimativa.
- `source`: `open-meteo` ou `synthetic` (estimativa por latitude).
- `next_update`: nunca está no passado; o cliente pode agendar a próxima busca direto por ele.

### `POST /api/settings`

Corpo JSON (`Content-Type: application/json`, máx. 1 KB):

| Campo | Tipo | Descrição |
|---|---|---|
| `interval` | número | Intervalo de atualização em minutos, limitado a 90–360. |
| `action` | `"force_update"` | Pede uma busca imediata (cooldown de 10 min). |

Resposta:

```json
{ "status": "ok", "interval": 120, "refresh": "queued", "retry_after": 600 }
```

`refresh` é `"queued"` ou `"cooldown"`, e `retry_after` diz em quantos segundos um novo pedido será aceito. Erros de validação respondem `400`/`411`/`413`/`415` com `{ "error": "..." }`.

---

## Personalização

- **Resolução da grade**: `GRID_STEP` em `server.py`. O cliente deriva os eixos dos dados, então não precisa mudar nada no JS. Recalcule a cota antes: localizações únicas × atualizações por dia deve ficar abaixo de 10.000.
- **Paletas**: `paletteDefs` em `app.js`. Cada paleta é uma lista de pontos `{ t, c }` (temperatura → RGB).
- **Aparência do globo**: texturas, luzes e atmosfera são configuradas logo no início de `app.js`.

---

## Tecnologias

- **Python** (`http.server`, `threading`, `urllib`): servidor, agendamento e cache.
- **globe.gl 2.46.2** / **Three.js**: renderização WebGL do globo.
- **HTML / CSS / JavaScript** sem build.

## Licença

Código sob a licença [MIT](LICENSE). Os dados e recursos de terceiros abaixo seguem as licenças deles.

## Créditos

- Dados meteorológicos: [Open-Meteo.com](https://open-meteo.com/), licenciados sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Fronteiras dos países: [Natural Earth](https://www.naturalearthdata.com/) (domínio público), via exemplos do globe.gl.
- Texturas da Terra: exemplos do [three-globe](https://github.com/vasturiano/three-globe).
