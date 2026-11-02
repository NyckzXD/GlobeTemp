# GlobeTemp — Análise técnica e plano de melhorias

> Análise feita sobre o estado atual do `master` (commit `a36db9e`): `server.py`, `static/app.js`, `static/index.html`, `static/style.css` e `README.MD`.
> Os itens estão ordenados por prioridade dentro de cada seção. Referências no formato `arquivo:linha`.

---

## Sumário executivo

O projeto é pequeno (~750 linhas), sem dependências e com uma ideia boa: buscar temperatura real no Open-Meteo, montar uma grade grossa e interpolar no cliente para pintar um heatmap sobre um globo 3D (globe.gl). A renderização do heatmap já tem bons cuidados (LUT de cores, busca binária, eixos derivados dos dados).

Os problemas principais são:

1. **Bugs de lógica que afetam o uso real**: o cliente entra em loop de requisições quando a atualização atrasa, o botão "Force Update" não força nada e o slider de intervalo é decorativo.
2. **Cota do Open-Meteo**: o consumo diário passa do limite gratuito, e ~15% das consultas são duplicadas.
3. **Estatística errada**: a média global não pondera por área, então os polos (31 pontos repetidos cada) puxam a média para baixo.
4. **Documentação desatualizada**: o README descreve uma versão antiga (simulação sintética com "ticks" e anomalias) que não existe mais.
5. **Fragilidade de stack**: CDNs sem versão fixa, servidor single-thread exposto na rede, fallback TLS que não funciona e, se funcionasse, seria inseguro.
6. **UX do heatmap**: não há legenda de cores, o tooltip mostra um valor diferente do que está pintado e o layout quebra no celular.

---

## 1. Bugs críticos (P0)

### 1.1 Loop infinito de requisições no cliente quando a atualização atrasa

**Onde:** `static/app.js:389-411` + `server.py:162-168`

Quando o contador chega a zero, o cliente chama `fetchData()`. O servidor devolve `next_update = last_update + 60min`, que **já está no passado** enquanto o servidor ainda não terminou de buscar os dados novos (o loop do servidor acorda a cada 30 s e a busca leva vários segundos). Resultado:

`fetchData → startCountdown → tick → remaining = 0 → fetchData → …`

Cada cliente aberto dispara `/api/data` sem parar e **re-renderiza um canvas de 2048×1024 (2 M pixels) a cada resposta**. Se o Open-Meteo retornar 429 (backoff de 300 s) ou estiver fora do ar, o loop dura minutos ou não termina nunca.

**Correção:**

- No servidor, nunca devolver `next_update` no passado: `next_update = max(next_update, now + 15)`.
- No cliente, garantir um intervalo mínimo entre fetches (ex.: `Math.max(nextUpdate, Date.now() + 10_000)`) e só re-renderizar o heatmap se `last_update` mudou.

### 1.2 "Force Update" não força a atualização

**Onde:** `server.py:133-157`

`request_refresh()` só acorda a thread. Quando `source == 'open-meteo'`, `due` continua sendo calculado pelo intervalo (`(now - last_update) >= cadence`), então a busca **não acontece**. O cliente ainda chama `fetchData()` logo depois do POST (`app.js:383`) e recebe os mesmos dados, o que dá a impressão de que a atualização funcionou.

**Correção:** um flag `self._force = True` que torna `due` verdadeiro (respeitando o backoff e um cooldown mínimo, ex.: 5 min, para proteger a cota). O cliente deve esperar a atualização terminar (polling curto ou o endpoint responder só após o refresh) em vez de buscar na hora.

### 1.3 O slider de intervalo é decorativo

**Onde:** `static/index.html:59-60`, `server.py:21,159-160`, `app.js:430-435`

- O slider vai de **10 a 60** com valor padrão **15**, mas o servidor aplica `max(60, minutos)`. Qualquer valor diferente de 60 é ignorado.
- O cliente atribui `simInterval = v` localmente e reinicia o contador com o valor errado até o próximo fetch.
- O README diz "1 a 60 minutos".

**Correção:** decidir a regra (ex.: 60–360 min, passo 30) e usar a mesma nos três lugares. O servidor deve validar e devolver o valor efetivo no POST, e o cliente deve usar esse valor. Outra opção é remover o controle, já que a temperatura real muda devagar.

### 1.4 Média global sem ponderação por área

**Onde:** `server.py:115-126`

A grade equiretangular tem o mesmo número de pontos em todas as latitudes. Em ±90° há **31 pontos para o mesmo lugar físico**, e perto dos polos cada ponto representa uma área minúscula. A média aritmética fica muito enviesada para o frio. A média real da superfície fica em torno de 14–15 °C, e o painel mostra bem menos que isso.

**Correção:** média ponderada por `cos(lat)` e deduplicação dos polos/antimeridiano (ver 2.1).

```python
w = math.cos(math.radians(lat))
s += t * w; ws += w
avg = s / ws
```

---

## 2. Backend (`server.py`)

### 2.1 Desperdício e estouro de cota do Open-Meteo (P0/P1)

- `range(-180, 181, 12)` inclui **-180 e 180**, que são o mesmo meridiano: 16 consultas duplicadas.
- `range(-90, 91, 12)` inclui os dois polos, e cada um é consultado 31 vezes: 60 consultas duplicadas.
- Total: **496 localizações por atualização, das quais ~422 são únicas** (~15% de desperdício).
- O limite gratuito é contado **por localização** (~10.000/dia). Atualizando a cada 60 min: `496 × 24 ≈ 11.900/dia`, **acima do limite**. Cada reinício do servidor também gasta uma rodada completa (não há cache em disco).

**Correções:**

- Consultar só pontos únicos (longitudes `-180..168`, polos uma vez) e replicar no array de saída, ou deixar o cliente fazer o wrap.
- Considerar uma grade deslocada (centros de célula, ex.: `-84, -72, …`), que evita os polos degenerados.
- **Persistir o último resultado em disco** (`cache.json` com timestamp) e, ao iniciar, só buscar se estiver vencido.
- Cadência padrão ≥ 90 min, ou calcular: `cadência_min = ceil(locs × 24 × 60 / 9000)`.
- Hoje, se a busca falhar no meio, os chunks já buscados (que já gastaram cota) são descartados (`server.py:85-105`). Melhor guardar o resultado parcial e completar só o que falta.

### 2.2 Fallback TLS quebrado e inseguro (P1)

**Onde:** `server.py:26-31, 73-78`

- `urllib.request.urlopen` encapsula erros SSL em `URLError`, então **`except ssl.SSLError` nunca captura nada**. O fallback é código morto.
- Se funcionasse, desligar a verificação de certificado permite que alguém na rede (MITM) injete dados falsos.

**Correção:** remover `_INSECURE_CTX`. Se o problema for falta de CA no Python do Windows/macOS, usar `certifi` (`ssl.create_default_context(cafile=certifi.where())`) ou documentar o `Install Certificates.command` do macOS.

### 2.3 Servidor HTTP (P1)

- `socketserver.TCPServer` é **single-thread**: um cliente lento bloqueia todos. Use `http.server.ThreadingHTTPServer`.
- Sem `allow_reuse_address = True`, reiniciar logo em seguida dá "Address already in use".
- Bind em `""` expõe o servidor (inclusive `POST /api/settings`, sem autenticação) para toda a rede local. O padrão deveria ser `127.0.0.1`, configurável por variável de ambiente.
- `directory="static"` é relativo ao **diretório atual**: rodar `python C:\Globetemp\server.py` de outra pasta quebra o site. Use `Path(__file__).parent / "static"`.
- `Cache-Control: no-store` em **tudo**, inclusive JS/CSS. Aplique só no `/api/*` e use `ETag`/`Last-Modified` no `/api/data` (o cliente recebe 304 quando nada mudou).
- `if self.path == '/'` falha com query string (`/?x=1`), e o `SimpleHTTPRequestHandler` já serve `index.html` sozinho. Pode remover.

### 2.4 Validação do `POST /api/settings` (P1)

**Onde:** `server.py:204-224`

- `int(self.headers['Content-Length'])` fica **fora** do `try`: sem o header, a exceção derruba a requisição sem resposta adequada.
- Não há limite de tamanho no corpo. Limite a ~1 KB.
- `payload` que não é dict (ex.: `[]`) só funciona por acaso do `except Exception`.
- Respostas de erro sem corpo JSON. Devolva `{"error": "..."}` com `Content-Type`.
- Verifique `Content-Type: application/json`, o que protege contra CSRF simples de outras páginas, já que hoje qualquer site aberto no navegador pode dar POST em `localhost:5005`.

### 2.5 Concorrência e robustez do loop de atualização (P2)

- `self.interval`, `self.source`, `self._backoff_until` e `self.last_update` são lidos/escritos fora do lock. Funciona por causa do GIL, mas é frágil. Centralize o estado num objeto imutável trocado de uma vez sob o lock.
- Erros que não são 429 são re-tentados a cada 20–30 s sem backoff. Use backoff exponencial com teto (ex.: 30 s → 1 min → 2 min → … → 30 min) e respeite o header `Retry-After`.
- `print()` em vez de `logging`. Sem níveis nem timestamp.
- `sim = ThermalSimulation()` no import **sobe uma thread de rede**, o que impede importar o módulo em testes. Mova para dentro do `if __name__ == "__main__"`, ou para uma função `main()`.

### 2.6 Organização e nomes (P2)

- A classe `ThermalSimulation` não simula mais nada: é um **provedor/cache de dados**. Renomeie para `TemperatureService`/`OpenMeteoProvider`, com a parte sintética como fallback separado.
- A fórmula sintética `35*c - 30*(1-c)` aparece duplicada (`server.py:61` e `:111`). Extraia uma função.
- Constantes (`PORT`, `GRID_STEP`, `CHUNK`, intervalos) deveriam aceitar variáveis de ambiente (`GLOBETEMP_PORT`, etc.).
- Sugestão de estrutura:
  ```
  globetemp/
    __main__.py      # CLI / bootstrap
    config.py
    providers/open_meteo.py
    providers/synthetic.py
    service.py       # cache, agendamento, estatísticas
    http.py          # handler
  static/
  tests/
  ```

### 2.7 Contrato da API (P2)

- `points` como lista de objetos `{lat, lng, temp}` repete as chaves 496 vezes. Um formato em grade é menor e o cliente não precisa reconstruir eixos:
  ```json
  { "lats": [...], "lngs": [...], "temps": [[...], ...], "units": "°C",
    "source": "open-meteo", "observed_at": "2026-11-02T12:00Z", "next_update": ... }
  ```
- Inclua `observed_at` (o horário da observação devolvido pelo Open-Meteo em `current.time`), que é diferente de `last_update` (quando o servidor buscou).
- Versione a rota (`/api/v1/...`).

---

## 3. Frontend — lógica (`static/app.js`)

### 3.1 Tooltip mostra um valor diferente do pintado (P1)

**Onde:** `app.js:307-332`

- O tooltip procura o **ponto da grade mais próximo** (até ~6° de distância) usando distância Manhattan em graus, enquanto o mapa mostra um valor **interpolado**. O usuário vê uma cor e lê um número que não corresponde a ela.
- A distância não faz o wrap do antimeridiano (179° vs -180°) e ignora `cos(lat)`.
- **Correção:** extrair a interpolação bilinear para uma função `sampleTemp(lat, lng)` usada tanto pelo canvas quanto pelo tooltip. Isso elimina a busca O(N) e garante consistência.
- Limitar o `mousemove` com `requestAnimationFrame`.
- Montar o tooltip com elementos/`textContent` em vez de `innerHTML`, e mover os estilos inline (`app.js:290-304`) para o CSS. As classes `.scene-tooltip`, `.tooltip-title` e `.tooltip-value` em `style.css:272-294` existem e **não são usadas**.
- Sem suporte a toque: no celular não há como ver o valor. Adicione toque/clique para fixar um ponto.

### 3.2 Renderização do heatmap pesada no thread principal (P1)

**Onde:** `app.js:185-285`

- Cada atualização ou troca de tema: loop em 2 M pixels + `toDataURL('image/jpeg')` (síncrono, lento, gera uma string de MB) + o globe.gl recarrega a textura por URL (nova textura na GPU a cada vez, sem `dispose` explícito).
- **Opções, em ordem de esforço:**
  1. Usar `THREE.CanvasTexture` em `world.globeMaterial().map` e só marcar `texture.needsUpdate = true`. Elimina o `toDataURL` e o reupload por URL.
  2. Renderizar num `OffscreenCanvas` dentro de um **Web Worker** para não travar a rotação.
  3. **Shader:** subir a grade de temperatura (31×16) como `DataTexture` float e a paleta como textura 1D. A GPU faz a interpolação e a coloração por pixel, de graça, em qualquer resolução. A troca de tema fica instantânea.
- Trocar de tema não precisa recalcular a interpolação, só a coloração. Se ficar na CPU, guarde o `Float32Array` de temperaturas interpoladas e reaplique só a LUT.

### 3.3 Qualidade da interpolação (P2)

- Bilinear sobre uma grade de 12° gera artefatos em losango e "achata" detalhes (cordilheiras, costas, gradientes continentais).
- Interpolação bicúbica (Catmull-Rom) melhora visualmente com custo baixo.
- Para melhorar de fato, é preciso **mais dados** (ver 6.1). A interpolação não cria informação.
- Correção física barata: ajustar pela altitude (lapse rate de ~6,5 °C/km) usando um DEM.

### 3.4 Ciclo de atualização (P1)

- Se `fetchData()` falhar (servidor caiu), o contador **não é reiniciado** e o app para de atualizar para sempre, sem aviso. Adicione retry com backoff e um estado de erro visível.
- Use `document.visibilitychange` para pausar quando a aba estiver oculta e buscar ao voltar.
- `simInterval = 15` e `nextUpdate` iniciais (`app.js:3-6`) não batem com o servidor (60).
- A barra de progresso usa `simInterval` como total, mas em modo sintético `next_update = now + 15 s`, então a barra aparece quase vazia.
- O ícone de "loading" é removido com `setTimeout(800)` fixo (`app.js:369`), e não quando a carga termina de verdade. Desabilite o botão durante a operação.
- Verifique `response.ok` antes de `response.json()`.

### 3.5 Dependências e carregamento (P1)

**Onde:** `index.html:8-12`, `app.js:12-13, 153, 156`

- `https://unpkg.com/globe.gl` **sem versão**: qualquer release com mudança incompatível quebra o site. Fixe a versão (`globe.gl@2.x.y`) e adicione `integrity` (SRI).
- Texturas `three-globe/example/img/...` também sem versão, e são imagens de exemplo de terceiros.
- Fronteiras vindo de `raw.githubusercontent.com/.../master/...`: esse host não é uma CDN, tem rate limit e o arquivo pode mudar ou sumir.
- **Recomendação:** copiar texturas e o GeoJSON para `static/assets/` (ou um script `fetch-assets`), o que deixa o app funcional offline e determinístico.
- FontAwesome inteiro (~100 KB CSS + fontes) para **2 ícones**. Troque por SVG inline.
- `earth-dark.jpg` é baixado duas vezes (textura do globo e overlay do canvas), e a textura do globo é substituída logo em seguida pelo heatmap.

### 3.6 Estrutura do código (P2)

- Tudo em um arquivo, com estado em variáveis globais e `document.getElementById` espalhado.
- Sugestão (ES modules nativos, sem build):
  ```
  static/js/
    main.js        # bootstrap
    api.js         # fetch/settings, retry
    state.js       # estado único + eventos
    palettes.js    # definições + LUT
    heatmap.js     # grade → textura (sampleTemp compartilhado)
    globe.js       # setup globe.gl, luzes, bordas
    ui/panel.js, ui/tooltip.js, ui/legend.js
  ```
- Se o projeto crescer, Vite + TypeScript resolvem a fixação de dependências (npm lockfile), bundling e tipos do contrato da API.
- Comentário enganoso em `app.js:34-35`: diz que o "sol" cria um "terminador dia/noite em movimento", mas a luz é **fixa** (`position.set(-1, 0.5, 1)`). Ver 6.3.
- Expressão de clamp obscura em `app.js:244` (`k < 0 ? 0 : (...) | 0`) está correta, mas é difícil de ler. Prefira `Math.min(LUT_SIZE - 1, Math.max(0, k | 0))`.

---

## 4. Design e UX

### 4.1 Falta legenda de cores (P0 de UX)

Um heatmap sem escala não se lê. Adicione uma barra de gradiente com marcações (-40, -20, 0, 20, 40 °C), gerada a partir da paleta ativa (o mesmo `getLUT`), e atualize na troca de tema.

### 4.2 Paletas (P1)

- **Glacier** vai de azul escuro a **branco a 50 °C**. Calor extremo fica parecido com gelo, o que é semanticamente confuso. Ou é monocromática por design (e então deve ser explicada), ou deve ser removida.
- **Thermal** não é perceptualmente uniforme (saltos de luminosidade entre 0 e 20 °C).
- **Plasma/Magma** são aproximações do matplotlib com mapeamento de temperatura arbitrário. Use os stops oficiais (viridis/plasma/magma/inferno/cividis), distribuídos uniformemente.
- Para temperatura, uma **paleta divergente centrada em 0 °C** (ex.: RdBu, ou a "temperature" da NOAA) comunica melhor "abaixo/acima de zero".
- Ofereça pelo menos uma opção segura para daltonismo (cividis).
- Escala configurável: fixa (-40..50) ou "auto" (min..max atual).
- A LUT cobre -60..60 e as paletas -40..50. Unifique.

### 4.3 Painel e responsividade (P1)

- Painel com `width: 350px` fixo e sem media queries: em celulares (375 px) cobre quase o globo inteiro. Torne o painel recolhível e use bottom-sheet no mobile.
- `body { height: 100vh }` tem problemas na barra de endereço do mobile. Use `100dvh`.
- Os cards de estatística têm efeito de hover sem serem clicáveis, o que sugere uma interação que não existe.

### 4.4 Informação e honestidade da interface (P1)

- O indicador de status **sempre** fica verde e pulsando, mesmo em "Sim" (dados sintéticos) ou com erro. Use cores e textos por estado: `Live`, `Estimado`, `Atualizando`, `Offline`.
- Mostre **horário da observação** e **fonte dos dados**.
- **Atribuição obrigatória:** o Open-Meteo é licenciado sob **CC BY 4.0** e exige crédito visível ("Weather data by Open-Meteo.com"). Hoje não há nenhum.
- Mostre onde ocorrem o mínimo e o máximo (clicar no card leva a câmera até o ponto).
- O texto "Simulation Update" não faz mais sentido com dados reais.

### 4.5 Acessibilidade (P2)

- `<label>` do slider sem `for`/`id`. O `<select>` não tem label (usa `<h3>`).
- Informação só por cor. A legenda (4.1) e o tooltip ajudam.
- O `outline: none` no select remove o foco. Mantenha um `:focus-visible` claro.
- `prefers-reduced-motion`: desligar a rotação automática e o pulse.
- Contraste de `--text-muted` (#7d8590) sobre o painel translúcido está no limite em cima de áreas claras do globo.

### 4.6 Idioma e identidade (P2)

- A UI está em inglês, e os comentários e o README em português. O nome aparece de três jeitos: "GlobeTemp" (README), "Thermal Earth" (UI) e "3D Earth Heatmap Globe" (`<title>`). `html lang="en"`.
- Escolha um idioma e um nome, ou implemente i18n simples (pt-BR/en).
- Adicione alternância **°C/°F** e favicon.

---

## 5. Repositório, qualidade e operação

| Item            | Situação                                                                                                                                                      | Ação                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| README          | **Desatualizado**: descreve simulação com `tick`, 6 anomalias, grade de 4°, `STEP` no app.js, esfera de raio 101, intervalo 1–60 min. Nada disso existe mais. | Reescrever com base no código atual (Open-Meteo, grade 12°, cota, cache).                                                                    |
| Nome do arquivo | `README.MD` (maiúsculo)                                                                                                                                       | Renomear para `README.md`.                                                                                                                   |
| `.gitignore`    | Ausente                                                                                                                                                       | Adicionar (`__pycache__/`, `.venv/`, `cache.json`, `.env`).                                                                                  |
| Licença         | Ausente                                                                                                                                                       | Adicionar `LICENSE` e créditos (Open-Meteo CC BY 4.0, Natural Earth, three-globe).                                                           |
| Testes          | Nenhum                                                                                                                                                        | `pytest` para grade/estatísticas/handler (mock do Open-Meteo); testes de `interpolateColor`, `bracket` e `sampleTemp` no JS (`node --test`). |
| Lint/format     | Nenhum                                                                                                                                                        | `ruff` (Python) e `prettier`/`eslint` (JS); `pre-commit`.                                                                                    |
| CI              | Nenhum                                                                                                                                                        | GitHub Actions rodando lint + testes.                                                                                                        |
| Dependências    | Python stdlib (bom)                                                                                                                                           | Se adotar `certifi`, criar `requirements.txt`/`pyproject.toml`.                                                                              |
| Deploy          | Só `python server.py`                                                                                                                                         | `Dockerfile` simples; variáveis de ambiente para host/porta/cadência.                                                                        |
| Commits         | Mensagens vagas ("Um monte de coisa", "Chega vou abandonar isso")                                                                                             | Commits pequenos e descritivos, de preferência Conventional Commits.                                                                         |

---

## 6. Evoluções de produto (opcionais)

### 6.1 Dados de maior resolução

A grade de 12° é imposta pela cota do Open-Meteo. Alternativas:

- **NOAA GFS 0.25°** (gratuito, sem cota, atualizado a cada 6 h) via NOMADS com filtro de variável (`TMP` a 2 m). O backend baixa um GRIB pequeno, converte para uma grade (ex.: 1°) e serve ao cliente. Exige `eccodes`/`cfgrib` ou `pygrib`.
- **Open-Meteo com cache agressivo** e grade de 6° atualizada a cada 3–4 h (mesma cota, 4× mais pontos).
- Imagens prontas da NASA GIBS (sem dados numéricos para o tooltip).

### 6.2 Dimensão temporal

O Open-Meteo devolve `hourly` no mesmo request: dá para mostrar previsão de 24–48 h com um slider de tempo e animação, sem custo extra de cota (desde que a busca seja feita junto).

### 6.3 Iluminação realista ✅ _Aplicada em 2026-11-02: `static/js/sun.js` calcula o ponto subsolar pelo horário UTC da linha do tempo e o shader do mapa de calor escurece o lado noturno, com faixa de crepúsculo._

Calcular a posição real do sol (declinação + hora UTC) e posicionar a `DirectionalLight` para um terminador dia/noite verdadeiro, que é o que o comentário em `app.js:34` promete.

### 6.4 Outras ideias

- Busca de cidade / clique para fixar um ponto com o valor exato (consulta pontual ao Open-Meteo).
- Camadas alternativas: anomalia vs. média climatológica, sensação térmica, umidade.
- Exportar imagem/screenshot do globo.
- PWA com cache offline do último estado.

---

## 7. Plano de execução sugerido

**Fase 1 — Correções (1 dia)** ✅ _Aplicada em 2026-11-02. Escolhas feitas: intervalo de 90–360 min (passo 30), cooldown de 10 min no Force Update, bind padrão em `127.0.0.1` (`GLOBETEMP_HOST`/`GLOBETEMP_PORT` configuram)._

1. Corrigir o loop de fetch (1.1) e o `next_update` no passado.
2. Fazer o Force Update funcionar com cooldown (1.2).
3. Alinhar ou remover o slider de intervalo (1.3).
4. Média ponderada por área + deduplicação da grade (1.4, 2.1).
5. Remover o fallback TLS inseguro (2.2).
6. `ThreadingHTTPServer`, bind em `127.0.0.1`, caminho absoluto do `static/`, validação do POST (2.3, 2.4).
7. Fixar versões das CDNs (3.5).

**Fase 2 — Robustez e UX (2–3 dias)** ✅ _Aplicada em 2026-11-02, com `LICENSE` MIT. Também entraram: `logging`, `Cache-Control` só na API, serviço criado no `main()` e `README.MD` → `README.md`._

1. Cache em disco + backoff exponencial (2.1, 2.5).
2. `sampleTemp` compartilhado e tooltip consistente (3.1).
3. Legenda, status honesto, atribuição ao Open-Meteo, horário da observação (4.1, 4.4).
4. Painel responsivo/recolhível (4.3).
5. Reescrever README, `.gitignore`, LICENSE (5).

**Fase 3 — Qualidade e performance (2–4 dias)** ✅ _Aplicada em 2026-11-02. Textura atualizada direto do canvas (sem shader nem Web Worker: com ~20 ms por troca de paleta não foi preciso). Paleta Glacier trocada por Viridis e Cividis. CI no GitHub Actions com Python 3.10/3.14 e Node 22._

1. Modularizar o JS e o Python (2.6, 3.6).
2. Textura via `CanvasTexture` ou shader (3.2).
3. Paletas revisadas e acessíveis (4.2, 4.5).
4. Testes, lint e CI (5).

**Fase 4 — Produto (opcional)**
Dados de maior resolução, linha do tempo de previsão, sol real (6).
