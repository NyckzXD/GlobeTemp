# 🌍 Thermal Earth — Globo 3D de Temperatura

Visualização interativa de um globo terrestre 3D com um heatmap de temperatura renderizado sobre a superfície do planeta. O projeto combina um backend em Python (que gera os dados e serve os arquivos) com um frontend em JavaScript baseado em [globe.gl](https://globe.gl/) e [Three.js](https://threejs.org/).

O resultado é um globo com rotação automática, paletas de cores intercambiáveis, tooltip de temperatura ao passar o mouse e um painel de controle com estatísticas em tempo real.

---

## ✨ Funcionalidades

- **Globo 3D interativo** com rotação automática (que pausa ao arrastar) e atmosfera colorida.
- **Heatmap de temperatura** desenhado em um canvas equiretangular (2048×1024) e aplicado como textura sobre uma esfera levemente maior que o globo.
- **Interpolação bilinear** dos pontos da grade para gerar um gradiente suave entre as leituras.
- **4 paletas visuais**: Thermal (clássica), Plasma (neon), Magma (vulcânica) e Glacier (subzero).
- **Painel de estatísticas** com temperatura mínima, média e máxima.
- **Tooltip ao passar o mouse**, mostrando a temperatura e as coordenadas do ponto sob o cursor.
- **Contagem regressiva** para a próxima atualização, com barra de progresso.
- **Controle de intervalo** de atualização (1 a 60 minutos) e botão de atualização forçada.

---

## 🗂️ Estrutura do projeto

```
.
├── server.py        # Backend em Python: simulação térmica + servidor HTTP
└── static/
    ├── index.html   # Estrutura da página e painel de controle
    ├── style.css    # Estilo do painel, tooltip e componentes
    └── app.js        # Lógica do globo, heatmap, tooltip e comunicação com a API
```

> O backend serve os arquivos estáticos a partir da pasta `static/`. Certifique-se de que `index.html`, `style.css` e `app.js` estejam dentro dela.

---

## ⚙️ Como funciona

### Backend (`server.py`)

O núcleo é a classe `ThermalSimulation`, que gera um campo de temperatura sintético sobre uma grade de 4 graus (latitude × longitude):

- **Temperatura base por latitude**: aproximadamente 35 °C no equador e −30 °C nos polos, usando o cosseno da latitude.
- **Ciclo diurno**: uma oscilação em função da longitude e do `tick` atual, simulando a passagem do dia.
- **Anomalias móveis**: 6 focos de calor/frio que se deslocam para leste a cada `tick`, com decaimento gaussiano ao redor do centro.

A cada requisição, o servidor devolve os pontos da grade, as estatísticas (min/máx/média), o tick atual, o intervalo e o timestamp da última atualização.

### Frontend (`app.js`)

1. Faz `fetch` em `/api/data` e recebe a lista de pontos.
2. Constrói um mapa de lookup `lat,lng → temp` e preenche o canvas via interpolação bilinear.
3. Converte cada temperatura em cor com base na paleta ativa (`interpolateColor`).
4. Gera uma `CanvasTexture` e a aplica sobre uma esfera de raio 101 (o globo tem raio 100), levemente transparente.
5. Atualiza o painel, inicia a contagem regressiva e reage às interações do usuário.

---

## 🔌 API

O servidor expõe dois endpoints:

### `GET /api/data`

Retorna o estado atual da simulação.

```json
{
  "points": [ { "lat": -90, "lng": -180, "temp": -28.4 }, ... ],
  "stats": { "min": -35.2, "max": 39.8, "avg": 4.1 },
  "tick": 12,
  "interval": 5,
  "last_update": 1720000000.0
}
```

### `POST /api/settings`

Aceita um corpo JSON com uma ou ambas as opções:

| Campo      | Tipo      | Descrição                                                    |
|------------|-----------|-------------------------------------------------------------|
| `action`   | `string`  | Se for `"force_update"`, avança a simulação em um tick.     |
| `interval` | `int`     | Define o intervalo de atualização, em minutos.              |

Exemplo:

```json
{ "action": "force_update" }
```

Resposta: `{ "status": "ok" }`

---

## 🚀 Como executar

**Pré-requisitos:** apenas Python 3 (o backend usa somente a biblioteca padrão — não há dependências externas).

```bash
python3 server.py
```

Depois abra o navegador em:

```
http://localhost:5005
```

A porta padrão é `5005` e pode ser alterada na constante `PORT` no topo de `server.py`.

---

## 🎨 Personalização

- **Resolução da grade**: ajuste o passo de 4 graus nos laços de `get_data()` (`server.py`) e na constante `STEP` de `renderHeatmapCanvas()` (`app.js`). Os dois valores precisam coincidir.
- **Paletas de cores**: edite ou adicione novas paletas em `paletteDefs` (`app.js`); cada uma é uma lista de pontos `{ t, c }` (temperatura → RGB).
- **Anomalias**: altere a quantidade em `self._generate_anomalies(6)` ou os intervalos de intensidade, raio e velocidade de deriva.
- **Aparência do globo**: as texturas base e a atmosfera são configuradas na inicialização de `Globe()` em `app.js`.

---

## 🛠️ Tecnologias

- **Python** (`http.server` / `socketserver`) — servidor e simulação
- **globe.gl** — renderização do globo 3D
- **Three.js** — camada de renderização WebGL (textura de canvas sobre a esfera)
- **HTML / CSS / JavaScript** — interface e interações