/**
 * Dashboard do sankhya-hub.
 *
 * O fluxo é: abre um SSE em /api/stream, recebe `snapshot` (tudo) uma vez e depois
 * `check` (um check por vez). O snapshot completo redesenha a grade; os deltas
 * substituem só a linha do check afetado e recalculam as cores agregadas — assim a
 * tela não pisca inteira a cada 10 segundos.
 */

const STATUS_LABEL = {
  up: 'operacional',
  degraded: 'degradado',
  down: 'fora do ar',
  unknown: 'sem dados',
};

const SEVERITY = { up: 0, unknown: 1, degraded: 2, down: 3 };

/** Estado espelhado do servidor. Nunca lemos do DOM para decidir nada. */
let model = { services: [], warnings: [], generatedAt: 0 };

/** `serviceId:checkId` -> elemento <div class="check">, só os do projeto selecionado. */
const checkNodes = new Map();
/** `serviceId` -> elemento da lista lateral. */
const listNodes = new Map();

const SEVERITY_TITLE = {
  critical: '🔴 Fora do ar',
  warning: '🟡 Degradado',
  recovery: '🟢 Recuperado',
};

const el = {
  layout: document.getElementById('layout'),
  projectListItems: document.getElementById('project-list-items'),
  detail: document.getElementById('detail'),
  toolbarCount: document.getElementById('toolbar-count'),
  btnNotify: document.getElementById('btn-notify'),
  notifyLabel: document.getElementById('notify-label'),
  empty: document.getElementById('empty'),
  warnings: document.getElementById('warnings'),
  conn: document.getElementById('conn'),
  brandMark: document.getElementById('brand-mark'),
  globalSummary: document.getElementById('global-summary'),
  footerMeta: document.getElementById('footer-meta'),
  toasts: document.getElementById('toasts'),
  btnReload: document.getElementById('btn-reload'),
  btnTheme: document.getElementById('btn-theme'),
  modalConfig: document.getElementById('modal-config'),
  formConfig: document.getElementById('form-config'),
  configTitulo: document.getElementById('config-titulo'),
  configSub: document.getElementById('config-sub'),
  configCampos: document.getElementById('config-campos'),
  btnConfigSalvar: document.getElementById('btn-config-salvar'),
  modalCheckSettings: document.getElementById('modal-check-settings'),
  formCheckSettings: document.getElementById('form-check-settings'),
  checkSettingsTitulo: document.getElementById('check-settings-titulo'),
  checkSettingsInterval: document.getElementById('check-settings-interval'),
  checkSettingsTimeout: document.getElementById('check-settings-timeout'),
  btnCheckSettingsToggle: document.getElementById('btn-check-settings-toggle'),
  btnCheckSettingsSalvar: document.getElementById('btn-check-settings-salvar'),
};

/* ----------------------------- utilitários ------------------------------ */

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function worst(statuses) {
  let result = 'unknown';
  let seen = false;
  for (const s of statuses) {
    if (!seen || SEVERITY[s] > SEVERITY[result]) {
      result = s;
      seen = true;
    }
  }
  return seen ? result : 'unknown';
}

function relativeTime(ts) {
  if (!ts) return 'nunca';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

function formatIndicator(indicator) {
  if (indicator.value === null || indicator.value === undefined) return '—';
  if (typeof indicator.value === 'number') {
    const digits = indicator.precision ?? 0;
    const formatted = indicator.value.toLocaleString('pt-BR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return indicator.unit ? `${formatted} ${indicator.unit}` : formatted;
  }
  return String(indicator.value);
}

/* ------------------------------- fragmentos ------------------------------ */

function semaphore(status, extraClass = '') {
  return `<span class="semaphore ${extraClass}" data-status="${status}" title="${STATUS_LABEL[status]}">
    <i class="lamp red"></i><i class="lamp amber"></i><i class="lamp green"></i>
  </span>`;
}

/** Barra de histórico: uma coluna por amostra, mais antiga à esquerda. */
function historyBars(history) {
  if (!history.length) return '<div class="bars"></div>';

  const bars = history
    .map((point) => {
      const when = new Date(point.ts).toLocaleTimeString('pt-BR');
      const latency = point.latencyMs === null ? 's/ resposta' : `${point.latencyMs}ms`;
      const height = point.status === 'unknown' ? 40 : 100;
      return `<i class="${point.status}" style="height:${height}%" title="${when} — ${STATUS_LABEL[point.status]}, ${latency}"></i>`;
    })
    .join('');

  return `<div class="bars">${bars}</div>`;
}

/** Sparkline de latência. Escala no próprio conjunto — interessa a forma, não o valor absoluto. */
function sparkline(history) {
  const points = history.filter((p) => typeof p.latencyMs === 'number');
  if (points.length < 2) return '';

  const width = 92;
  const height = 24;
  const values = points.map((p) => p.latencyMs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = `M${coords.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${area}" />
    <path class="line" d="${line}" />
  </svg>`;
}

/** Sparkline com legenda — sem ela o gráfico não diz o que está medindo. */
function sparklineBlock(history) {
  const svg = sparkline(history);
  if (!svg) return '';

  return `<span class="spark-wrap" title="Latência das últimas amostras — mostra a tendência, a escala não é um valor absoluto">
    ${svg}<i class="spark-caption">latência</i>
  </span>`;
}

function indicatorPills(indicators) {
  if (!indicators.length) return '';

  const pills = indicators
    .map((indicator) => {
      const tone = indicator.status === 'down' ? 'bad' : indicator.status === 'degraded' ? 'warn' : '';
      const meter =
        indicator.max && typeof indicator.value === 'number'
          ? `<span class="meter"><span style="width:${Math.min(100, (indicator.value / indicator.max) * 100).toFixed(1)}%"></span></span>`
          : '';
      const suffix = indicator.max && typeof indicator.value === 'number' ? ` / ${indicator.max}` : '';

      return `<span class="pill ${tone}">${esc(indicator.label)} ${meter}
        <b>${esc(formatIndicator(indicator))}${esc(suffix)}</b></span>`;
    })
    .join('');

  return `<div class="pills">${pills}</div>`;
}

function componentPills(components) {
  if (!components.length) return '';

  const pills = components
    .map(
      (component) => `<span class="component" data-status="${component.status}"${
        component.detail ? ` title="${esc(component.detail)}"` : ''
      }><i></i>${esc(component.label)}</span>`,
    )
    .join('');

  return `<div class="components">${pills}</div>`;
}

/** Chaves `serviceId:checkId` com o painel "como verifica" aberto. */
const infoAbertas = new Set();

/**
 * Explicação de como o hub verifica este check. Só entra no DOM quando aberta —
 * renderizar escondido repetiria o bug do `hidden` vencido por uma regra de `display`.
 */
function checkInfoMarkup(check) {
  const chave = `${check.serviceId}:${check.checkId}`;
  if (!infoAbertas.has(chave) || !check.explicacao?.length) return '';

  return `<div class="check-info">
    <ul>${check.explicacao.map((linha) => `<li>${esc(linha)}</li>`).join('')}</ul>
  </div>`;
}

/** Painel de ações do serviço (check) — só entra no DOM quando aberto, mesma regra do check-info. */
function checkActionsMarkup(check, actions) {
  const chave = `${check.serviceId}:${check.checkId}`;
  if (!acoesServicoAbertas.has(chave) || !actions.length) return '';

  return `<div class="actions-panel inline">${actionButtons(check.serviceId, actions)}</div>`;
}

function checkMarkup(check, muted, actions) {
  const uptime = check.uptimePct === null ? '—' : `${check.uptimePct.toFixed(check.uptimePct >= 99.95 ? 2 : 1)}%`;
  const infoAberta = infoAbertas.has(`${check.serviceId}:${check.checkId}`);
  const acoesAberta = acoesServicoAbertas.has(`${check.serviceId}:${check.checkId}`);

  return `
    <div class="check-left">
      <div class="check-main">
        ${semaphore(check.status, 'vertical')}
        <div class="check-id">
          <div class="check-name">
            <strong>${esc(check.name)}</strong>
            <span class="check-type">${esc(check.type)}</span>
            <button class="btn-info" data-info="${esc(check.serviceId)}|${esc(check.checkId)}"
                    aria-expanded="${infoAberta}"
                    title="Como o monitor verifica este serviço">i</button>
            ${muted ? '<span class="badge-muted">silenciado</span>' : ''}
            ${check.disabled ? '<span class="badge-disabled">desabilitado</span>' : ''}
          </div>
          <div class="check-status-row">
            <p class="check-msg">${esc(check.message)} · ${esc(relativeTime(check.ts))}</p>
            <div class="viz-top">
              <div class="uptime" title="Disponibilidade na janela de retenção">
                <b>${uptime}</b>uptime
              </div>
              ${sparklineBlock(check.history)}
            </div>
          </div>
          ${checkInfoMarkup(check)}
        </div>
      </div>
      <div class="viz">
        ${historyBars(check.history)}
      </div>
      ${componentPills(check.components)}
      ${indicatorPills(check.indicators)}
      ${checkActionsMarkup(check, actions)}
    </div>
    <div class="check-actions">
      <button class="btn tiny ghost" data-run="${esc(check.serviceId)}|${esc(check.checkId)}"
              ${check.disabled ? 'disabled' : ''}
              title="${check.disabled ? 'Habilite o monitoramento para rodar agora' : 'Executar este check agora'}">Testar</button>
      <button class="btn tiny ghost" data-check-actions="${esc(check.serviceId)}|${esc(check.checkId)}"
              aria-expanded="${acoesAberta}" ${actions.length ? '' : 'disabled'}
              title="${actions.length ? 'Ações deste serviço' : 'Nenhuma ação disponível para este check'}">Ações</button>
      <button class="btn tiny ghost" data-check-settings="${esc(check.serviceId)}|${esc(check.checkId)}"
              title="Intervalo, timeout e habilitar/desabilitar este check">Configurações</button>
    </div>
  `;
}

function buildCheckNode(check, muted, actions) {
  const node = document.createElement('div');
  node.className = `check${muted ? ' muted' : ''}${check.disabled ? ' disabled' : ''}`;
  node.dataset.status = check.status;
  node.innerHTML = checkMarkup(check, muted, actions);
  return node;
}

/**
 * Botão que abre o formulário de variáveis do projeto.
 *
 * Fica junto das ações e não no cabeçalho porque configurar é tarefa ocasional — o
 * cabeçalho recolhido precisa do espaço para status, que é o que se olha o tempo todo.
 * Quando falta alguma variável ele ganha destaque; com tudo preenchido, fica discreto.
 */
function faltamVariaveis(service) {
  // Só conta o que veio do formulário: uma variável resolvida por default do YAML ou
  // por variável de ambiente do container não passou pelo painel, então continua
  // contando como pendente aqui.
  return (service.envVars ?? []).filter((v) => !v.fromVault).length;
}

/**
 * Botão do rodapé, sempre presente quando o projeto tem variável.
 *
 * Único ponto de entrada pro formulário — o card não repete o aviso de pendência
 * fora do semáforo cinza e do sinal ao lado do nome (`configPendenteMarkup`).
 */
function configButton(service) {
  if (!service.envVars?.length) return '';

  return `<button class="btn tiny ghost" data-config="${esc(service.id)}"
            title="Informar as variáveis que este projeto usa">Variáveis</button>`;
}

/**
 * As ações vêm de `service.actions` num único array; `checkId` decide se é ação do
 * projeto (ausente) ou de um serviço específico (aponta um check). Quem chama já
 * filtrou o subconjunto certo — esta função só desenha os botões.
 */
function actionButtons(serviceId, actions) {
  return actions
    .map((action) => {
      if (action.kind === 'link') {
        // Popup: janela separada com chrome próprio, não dá pra fazer com <a target>
        // sozinho — precisa de window.open com a string de features.
        if (action.popup) {
          return `<button class="btn tiny" data-popup-url="${esc(action.url)}"
                    data-popup-name="popup-${esc(serviceId)}-${esc(action.id)}"
                    ${action.description ? `title="${esc(action.description)}"` : ''}>${esc(action.label)} ↗</button>`;
        }
        return `<a class="btn tiny" href="${esc(action.url)}" target="_blank" rel="noopener"
                   ${action.description ? `title="${esc(action.description)}"` : ''}>${esc(action.label)} ↗</a>`;
      }
      return `<button class="btn tiny${action.danger ? ' danger' : ''}"
                data-action="${esc(serviceId)}|${esc(action.id)}"
                data-confirm="${action.confirm ? '1' : '0'}"
                data-label="${esc(action.label)}"
                ${action.description ? `title="${esc(action.description)}"` : ''}>${esc(action.label)}</button>`;
    })
    .join('');
}

/** Ações do projeto: as que não estão amarradas a nenhum check específico. */
function acoesDoProjeto(service) {
  return service.actions.filter((a) => !a.checkId);
}

/** Ações de um serviço (check) específico dentro do projeto. */
function acoesDoServico(service, checkId) {
  return service.actions.filter((a) => a.checkId === checkId);
}

/** Chaves com o painel de ações aberto: `serviceId` para projeto, `serviceId:checkId` para serviço. */
const acoesProjetoAbertas = new Set();
const acoesServicoAbertas = new Set();

/**
 * Projeto selecionado na lista lateral, preservado entre recargas.
 *
 * Só um por vez: a lista mostra a visão macro de todos os projetos, e o detalhe
 * completo de um único projeto ocupa o painel à direita.
 */
let selecionado = localStorage.getItem('sankhya-hub-selecionado') || null;

function salvarSelecao() {
  if (selecionado) localStorage.setItem('sankhya-hub-selecionado', selecionado);
}

/** Uma linha honesta sobre o serviço, sem precisar abrir o card. */
function resumoServico(service) {
  const considerados = service.checks.filter(
    (c) => !mutedKeys.has(`${service.id}:${c.checkId}`) && !c.disabled,
  );
  const conta = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const c of considerados) conta[c.status] += 1;

  const partes = [];
  if (conta.down) partes.push(`<span class="bad">${conta.down} fora do ar</span>`);
  if (conta.degraded) partes.push(`<span class="warn">${conta.degraded} degradado${conta.degraded > 1 ? 's' : ''}</span>`);
  if (conta.unknown) partes.push(`${conta.unknown} sem dados`);
  if (!partes.length) partes.push(`${conta.up} operacionai${conta.up === 1 ? 'l' : 's'}`);

  const silenciados = service.checks.filter(
    (c) => mutedKeys.has(`${service.id}:${c.checkId}`) && !c.disabled,
  ).length;
  const desabilitados = service.checks.filter((c) => c.disabled).length;

  const sufixoPartes = [];
  if (silenciados) sufixoPartes.push(`${silenciados} silenciado${silenciados > 1 ? 's' : ''}`);
  if (desabilitados) sufixoPartes.push(`${desabilitados} desabilitado${desabilitados > 1 ? 's' : ''}`);
  const sufixo = sufixoPartes.length ? ` · ${sufixoPartes.join(' · ')}` : '';

  return `${service.checks.length} check${service.checks.length > 1 ? 's' : ''} · ${partes.join(' · ')}${sufixo}`;
}

/** Um ponto por check — dá para ver qual está fora sem abrir o card. */
function dotsServico(service) {
  return `<div class="dots">${service.checks
    .map((c) => {
      const muted = mutedKeys.has(`${service.id}:${c.checkId}`);
      const classes = [c.status, muted ? 'muted' : '', c.disabled ? 'disabled' : ''].filter(Boolean).join(' ');
      const sufixoTitulo = c.disabled ? ' (desabilitado)' : muted ? ' (silenciado)' : '';
      return `<i class="${classes}" title="${esc(c.name)}: ${STATUS_LABEL[c.status]}${sufixoTitulo}"></i>`;
    })
    .join('')}</div>`;
}

/**
 * Logo do projeto quando o YAML define `image`, senão o emoji do `icon`, senão a
 * inicial do nome. A cadeia de fallback importa: um caminho de imagem errado não
 * pode deixar o card sem identidade visual nenhuma.
 *
 * `loading="eager"`: são duas imagens acima da dobra, e o lazy faria o avatar
 * piscar vazio a cada re-render do card.
 */
function avatarMarkup(service) {
  if (service.image) {
    return `<img src="${esc(service.image)}" alt="" loading="eager" decoding="async" />`;
  }
  return esc(service.icon || service.name.slice(0, 1).toUpperCase());
}

/**
 * Sinal discreto de "falta configurar", ao lado do nome do projeto.
 *
 * Deliberadamente só um símbolo com tooltip: os nomes das variáveis ficam na linha do
 * check que precisa delas, dentro do card. Repetir a lista aqui reconstruiria o banner
 * global que este sinal veio substituir — só que dentro do card.
 */
function configPendenteMarkup(service) {
  const pendentes = service.checks.filter((c) => c.needsConfig);
  if (!pendentes.length) return '';

  const nomes = pendentes.map((c) => c.name).join(', ');
  const titulo =
    pendentes.length === 1
      ? `${nomes}: aguardando configuração — abra o card para ver quais variáveis`
      : `${pendentes.length} checks aguardando configuração (${nomes}) — abra o card para ver quais variáveis`;

  return `<span class="cfg-pendente" title="${esc(titulo)}" aria-label="${esc(titulo)}">⚠</span>`;
}

/** Linha compacta da lista lateral: identidade + resumo, sem o detalhe dos checks. */
function listItemMarkup(service) {
  return `
    <div class="avatar">${avatarMarkup(service)}</div>
    <div class="li-title">
      <h2>${esc(service.name)}${configPendenteMarkup(service)}</h2>
      <p class="li-summary">${resumoServico(service)}</p>
    </div>
    ${dotsServico(service)}
    ${semaphore(service.status, 'vertical')}
  `;
}

/** Cabeçalho do painel de detalhe: mesma identidade da lista, com descrição e tags. */
function detailHeadMarkup(service) {
  const temAcoes = acoesDoProjeto(service).length > 0;
  const aberto = acoesProjetoAbertas.has(service.id);

  return `
    <div class="avatar">${avatarMarkup(service)}</div>
    <div class="card-title">
      <h2>${esc(service.name)}${service.disabled ? '<span class="badge-disabled">desabilitado</span>' : ''}${configPendenteMarkup(service)}</h2>
      ${service.description ? `<p title="${esc(service.description)}">${esc(service.description)}</p>` : ''}
      <p class="card-summary">${resumoServico(service)}</p>
      ${service.tags.length ? `<div class="tags">${service.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${semaphore(service.status, 'vertical lg')}
    <div class="detail-actions">
      ${temAcoes ? `<button class="btn tiny ghost" data-project-actions="${esc(service.id)}"
              aria-expanded="${aberto}" title="Ações do projeto">Ações</button>` : ''}
      ${configButton(service)}
      <button class="btn tiny ghost" data-toggle-service="${esc(service.id)}"
              title="${service.disabled ? 'Reativar o monitoramento deste projeto' : 'Pausar o monitoramento deste projeto — os checks param de rodar'}">
        ${service.disabled ? '▶ Habilitar' : '⏸ Desabilitar'}
      </button>
    </div>
  `;
}

/** Painel de ações do projeto — só entra no DOM quando aberto. */
function projectActionsPanelMarkup(service) {
  if (!acoesProjetoAbertas.has(service.id)) return '';

  return `<div class="actions-panel">${actionButtons(service.id, acoesDoProjeto(service))}</div>`;
}

function buildListItem(service) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `project-item${service.disabled ? ' disabled' : ''}`;
  item.dataset.status = service.status;
  item.dataset.serviceId = service.id;
  item.setAttribute('aria-pressed', String(service.id === selecionado));
  item.classList.toggle('active', service.id === selecionado);
  item.innerHTML = listItemMarkup(service);
  item.addEventListener('click', () => selecionarProjeto(service.id));
  return item;
}

function buildDetail(service) {
  const card = document.createElement('article');
  card.className = `card detail-card${service.disabled ? ' disabled' : ''}`;
  card.dataset.status = service.status;
  card.dataset.serviceId = service.id;
  if (service.accent) card.style.setProperty('--accent-color', service.accent);

  const head = document.createElement('div');
  head.className = 'detail-head';
  head.innerHTML = detailHeadMarkup(service);
  card.appendChild(head);

  const projectActions = document.createElement('div');
  projectActions.className = 'project-actions';
  projectActions.innerHTML = projectActionsPanelMarkup(service);
  card.appendChild(projectActions);

  const list = document.createElement('div');
  list.className = 'checks';
  for (const check of service.checks) {
    const muted = isMuted(service, check.checkId);
    const actions = acoesDoServico(service, check.checkId);
    const node = buildCheckNode(check, muted, actions);
    list.appendChild(node);
    checkNodes.set(`${service.id}:${check.checkId}`, node);
  }
  card.appendChild(list);

  return card;
}

function selecionarProjeto(serviceId) {
  if (selecionado === serviceId) return;
  selecionado = serviceId;
  salvarSelecao();
  atualizarSelecaoLista();
  renderDetail();
}

function alternarAcoesProjeto(serviceId) {
  if (acoesProjetoAbertas.has(serviceId)) acoesProjetoAbertas.delete(serviceId);
  else acoesProjetoAbertas.add(serviceId);
  renderDetail();
}

function alternarAcoesServico(serviceId, checkId) {
  const chave = `${serviceId}:${checkId}`;
  if (acoesServicoAbertas.has(chave)) acoesServicoAbertas.delete(chave);
  else acoesServicoAbertas.add(chave);
  renderDetail();
}

function atualizarSelecaoLista() {
  for (const [id, node] of listNodes) {
    const ativo = id === selecionado;
    node.classList.toggle('active', ativo);
    node.setAttribute('aria-pressed', String(ativo));
  }
}

/** Redesenha só o painel de detalhe, a partir do projeto selecionado. */
function renderDetail() {
  checkNodes.clear();
  el.detail.replaceChildren();

  const service = model.services.find((s) => s.id === selecionado);
  if (!service) {
    el.detail.innerHTML = '<p class="detail-empty">Selecione um projeto ao lado.</p>';
    return;
  }
  el.detail.appendChild(buildDetail(service));
}

/** Atualiza a linha na lista e, se for o projeto aberto, o cabeçalho e o rodapé do detalhe. */
function atualizarItemLista(service) {
  const item = listNodes.get(service.id);
  if (item) {
    item.dataset.status = service.status;
    item.innerHTML = listItemMarkup(service);
  }

  if (service.id !== selecionado) return;

  const card = el.detail.querySelector('.detail-card');
  if (!card) return;

  card.dataset.status = service.status;
  const head = card.querySelector('.detail-head');
  if (head) head.innerHTML = detailHeadMarkup(service);

  const projectActions = card.querySelector('.project-actions');
  if (projectActions) projectActions.innerHTML = projectActionsPanelMarkup(service);
}

/** Chaves `serviceId:checkId` silenciadas — não entram no status agregado do card. */
const mutedKeys = new Set();

function isMuted(service, checkId) {
  return mutedKeys.has(`${service.id}:${checkId}`);
}

/* ------------------------------- renderização ---------------------------- */

function renderAll() {
  listNodes.clear();
  el.projectListItems.replaceChildren();

  const ordenados = [...model.services].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  for (const service of ordenados) {
    const item = buildListItem(service);
    listNodes.set(service.id, item);
    el.projectListItems.appendChild(item);
  }

  if (!ordenados.some((s) => s.id === selecionado)) {
    selecionado = ordenados[0]?.id ?? null;
    salvarSelecao();
  }

  el.empty.hidden = model.services.length > 0;
  el.layout.hidden = model.services.length === 0;
  renderDetail();
  renderWarnings();
  renderHeader();
}

function renderWarnings() {
  if (!model.warnings.length) {
    el.warnings.hidden = true;
    el.warnings.replaceChildren();
    return;
  }
  el.warnings.hidden = false;
  el.warnings.innerHTML = model.warnings
    .map((warning) => `<div class="warning"><span>⚠</span><span>${esc(warning)}</span></div>`)
    .join('');
}

function renderHeader() {
  // Projeto desabilitado não pinta o semáforo global nem entra na contagem por status.
  const habilitados = model.services.filter((s) => !s.disabled);
  const statuses = habilitados.map((s) => s.status);
  const overall = worst(statuses);
  el.brandMark.dataset.status = overall;

  const counts = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const status of statuses) counts[status] += 1;

  const total = model.services.length;
  const desabilitados = total - habilitados.length;
  const parts = [];
  if (counts.up) parts.push(`${counts.up} ok`);
  if (counts.degraded) parts.push(`${counts.degraded} degradado${counts.degraded > 1 ? 's' : ''}`);
  if (counts.down) parts.push(`${counts.down} fora do ar`);
  if (counts.unknown) parts.push(`${counts.unknown} sem dados`);
  if (desabilitados) parts.push(`${desabilitados} desabilitado${desabilitados > 1 ? 's' : ''}`);

  el.globalSummary.textContent = total
    ? `${total} serviço${total > 1 ? 's' : ''} — ${parts.join(' · ')}`
    : 'nenhum serviço configurado';

  const checkCount = model.services.reduce((sum, s) => sum + s.checks.length, 0);
  el.footerMeta.textContent = `${checkCount} check(s) · atualizado ${relativeTime(model.generatedAt)}`;
  el.toolbarCount.textContent = `${total} projeto${total > 1 ? 's' : ''} · ${checkCount} check${checkCount > 1 ? 's' : ''}`;
}

/** Aplica um delta vindo do SSE sem redesenhar a grade inteira. */
function applyCheck(snapshot) {
  const service = model.services.find((s) => s.id === snapshot.serviceId);
  if (!service) return;

  const index = service.checks.findIndex((c) => c.checkId === snapshot.checkId);
  if (index === -1) {
    // Check novo (config recarregada): pede o snapshot completo em vez de remendar.
    void refresh();
    return;
  }
  service.checks[index] = snapshot;
  model.generatedAt = Date.now();

  const key = `${service.id}:${snapshot.checkId}`;
  const muted = Boolean(snapshot.muted);
  if (muted) mutedKeys.add(key);
  else mutedKeys.delete(key);

  // Recalcula o agregado do serviço a partir dos checks não silenciados e não desabilitados.
  const considered = service.checks
    .filter((c) => !mutedKeys.has(`${service.id}:${c.checkId}`) && !c.disabled)
    .map((c) => c.status);
  service.status = worst(considered);

  // A linha na lista lateral reflete todo serviço; o nó do check só existe no DOM
  // quando este é o projeto aberto no painel de detalhe.
  atualizarItemLista(service);

  const node = checkNodes.get(key);
  if (node) {
    node.dataset.status = snapshot.status;
    node.classList.toggle('muted', muted);
    node.classList.toggle('disabled', Boolean(snapshot.disabled));
    node.innerHTML = checkMarkup(snapshot, muted, acoesDoServico(service, snapshot.checkId));
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 120);
  }

  renderHeader();
}

/* ------------------------ configuração do projeto ------------------------ */

/**
 * Formulário de variáveis do projeto.
 *
 * Os campos vêm pré-preenchidos com o valor atual, buscado num GET dedicado
 * (`/api/services/:id/env`) só disparado ao abrir o modal — o snapshot geral
 * (`/api/state`, SSE) nunca carrega valor, só nome e se está definida.
 */
let projetoEmConfiguracao = null;

async function abrirConfig(serviceId) {
  const service = model.services.find((s) => s.id === serviceId);
  if (!service?.envVars?.length) return;

  projetoEmConfiguracao = serviceId;
  el.configTitulo.textContent = `Configurar ${service.name}`;
  el.configSub.textContent = 'Carregando valores atuais…';
  el.configCampos.innerHTML = '';
  el.modalConfig.showModal();

  let valores = {};
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/env`);
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.error || 'falha ao carregar valores');
    valores = corpo.valores ?? {};
  } catch (err) {
    toast(`Não consegui carregar os valores atuais: ${err.message}`, 'err');
  }

  // Modal pode ter sido trocado/fechado enquanto o fetch corria.
  if (projetoEmConfiguracao !== serviceId) return;

  const faltando = service.envVars.filter((v) => !v.fromVault).length;
  el.configSub.textContent = faltando
    ? `${faltando} de ${service.envVars.length} variáveis ainda sem valor`
    : `${service.envVars.length} variáveis, todas preenchidas`;

  el.configCampos.innerHTML = service.envVars
    .map((v) => {
      // Só o cofre conta como preenchida: um default do YAML ou uma variável do
      // ambiente do container não passaram pelo formulário, então seguem "faltando"
      // aqui mesmo com valor atual — é o que empurra a variável a ser definida aqui.
      const selo = v.fromVault
        ? '<span class="selo ok">preenchida</span>'
        : '<span class="selo falta">faltando</span>';

      return `<label class="campo">
        <span class="campo-nome"><code>${esc(v.name)}</code>${selo}</span>
        <input type="text"
               name="${esc(v.name)}"
               value="${esc(valores[v.name] ?? '')}"
               autocomplete="off"
               spellcheck="false"
               placeholder="${v.fromVault ? '' : 'informe o valor'}" />
      </label>`;
    })
    .join('');
}

async function salvarConfig() {
  const service = model.services.find((s) => s.id === projetoEmConfiguracao);
  if (!service) return;

  // Campo vazio não vai no corpo: mandar "" APAGARIA o valor guardado, e branco aqui
  // significa "não mexi neste".
  const entradas = {};
  for (const input of el.configCampos.querySelectorAll('input')) {
    if (input.value !== '') entradas[input.name] = input.value;
  }

  if (!Object.keys(entradas).length) {
    toast('Nenhum campo preenchido — nada foi alterado.', 'ok');
    return;
  }

  el.btnConfigSalvar.disabled = true;
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(service.id)}/env`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entradas),
    });
    const corpo = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(corpo.error || 'Não consegui salvar as variáveis', 'err');
      return;
    }

    const restantes = (corpo.envVars ?? []).filter((v) => !v.fromVault).length;
    toast(
      restantes
        ? `Salvo. Ainda faltam ${restantes} variável(is).`
        : 'Salvo. Os checks já estão medindo com os valores novos.',
      'ok',
    );
    // O engine recarregou no servidor e o SSE manda um `snapshot` novo — a tela se
    // atualiza sozinha, sem precisar recarregar a página.
  } catch (err) {
    toast(`Falha ao salvar: ${err.message}`, 'err');
  } finally {
    el.btnConfigSalvar.disabled = false;
    projetoEmConfiguracao = null;
  }
}

/* -------------------------- configurações do check ------------------------ */

/** Check em edição no modal — `{ serviceId, checkId }`, ou `null` fechado. */
let checkEmConfiguracao = null;

function atualizarBotaoToggleCheck(disabled) {
  el.btnCheckSettingsToggle.textContent = disabled ? '▶ Habilitar' : '⏸ Desabilitar';
  el.btnCheckSettingsToggle.title = disabled
    ? 'Reativar o monitoramento deste check'
    : 'Pausar o monitoramento deste check — ele para de rodar';
}

function abrirCheckSettings(serviceId, checkId) {
  const service = model.services.find((s) => s.id === serviceId);
  const check = service?.checks.find((c) => c.checkId === checkId);
  if (!check) return;

  checkEmConfiguracao = { serviceId, checkId };
  el.checkSettingsTitulo.textContent = `Configurações — ${check.name}`;
  el.checkSettingsInterval.value = Math.round(check.intervalMs / 1000);
  el.checkSettingsTimeout.value = Math.round(check.timeoutMs / 1000);
  atualizarBotaoToggleCheck(check.disabled);
  el.modalCheckSettings.showModal();
}

/** Botão dentro do modal — mesma rota que o toggle já usava fora dele. */
async function alternarCheckNoModal() {
  if (!checkEmConfiguracao) return;
  const { serviceId, checkId } = checkEmConfiguracao;
  const service = model.services.find((s) => s.id === serviceId);
  const check = service?.checks.find((c) => c.checkId === checkId);
  if (!check) return;

  const enabled = Boolean(check.disabled); // estava desabilitado -> este clique habilita
  el.btnCheckSettingsToggle.disabled = true;
  try {
    const res = await fetch(
      `/api/services/${encodeURIComponent(serviceId)}/checks/${encodeURIComponent(checkId)}/enabled`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(payload.error || 'Não consegui alterar o check', 'err');
      return;
    }
    // O SSE atualiza `model` sozinho; aqui só refletimos no botão na hora, sem
    // esperar o round-trip do `reload`.
    atualizarBotaoToggleCheck(Boolean(payload.check?.disabled));
  } catch (err) {
    toast(`Falha ao alterar o check: ${err.message}`, 'err');
  } finally {
    el.btnCheckSettingsToggle.disabled = false;
  }
}

async function salvarCheckSettings() {
  if (!checkEmConfiguracao) return;
  const { serviceId, checkId } = checkEmConfiguracao;

  const intervalSeconds = Number(el.checkSettingsInterval.value);
  const timeoutSeconds = Number(el.checkSettingsTimeout.value);

  el.btnCheckSettingsSalvar.disabled = true;
  try {
    const res = await fetch(
      `/api/services/${encodeURIComponent(serviceId)}/checks/${encodeURIComponent(checkId)}/settings`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intervalSeconds, timeoutSeconds }),
      },
    );
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(payload.error || 'Não consegui salvar as configurações', 'err');
      return;
    }
    toast('Configurações salvas — o check já roda com os valores novos.', 'ok');
  } catch (err) {
    toast(`Falha ao salvar: ${err.message}`, 'err');
  } finally {
    el.btnCheckSettingsSalvar.disabled = false;
    checkEmConfiguracao = null;
  }
}

/* -------------------------------- alertas -------------------------------- */

/*
 * Um alerta aparece de duas formas, ambas efêmeras: um toast no canto e uma
 * notificação do Windows. Não há feed com histórico na tela — quem quiser o
 * histórico consulta `GET /api/alerts`, que continua guardando 168h no SQLite.
 */

function renderNotifyButton() {
  if (!('Notification' in window)) {
    el.btnNotify.hidden = true;
    return;
  }
  const permission = Notification.permission;
  el.btnNotify.dataset.state = permission === 'granted' ? 'on' : permission === 'denied' ? 'blocked' : 'off';
  el.notifyLabel.textContent =
    permission === 'granted'
      ? 'Notificações ativas'
      : permission === 'denied'
        ? 'Notificações bloqueadas'
        : 'Ativar notificações';
  el.btnNotify.title =
    permission === 'denied'
      ? 'Bloqueadas no navegador — libere no cadeado da barra de endereço'
      : 'Notificações do Windows quando algo cair';
}

/**
 * Levanta o toast nativo do sistema. O Chrome entrega isso à central de notificações
 * do Windows, então aparece mesmo com a aba em segundo plano — só precisa do
 * navegador aberto.
 */
function notifyDesktop(alert) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notification = new Notification(`${SEVERITY_TITLE[alert.severity]} — ${alert.serviceName}`, {
    body: `${alert.checkName}: ${alert.detail}`,
    // `tag` por check faz uma nova notificação SUBSTITUIR a anterior do mesmo check,
    // em vez de empilhar. Um serviço instável não vira 40 toasts.
    tag: `${alert.serviceId}:${alert.checkId}`,
    renotify: true,
    // Falha fica na tela até você reagir; recuperação some sozinha.
    requireInteraction: alert.severity === 'critical',
    silent: alert.severity === 'recovery',
  });

  // Clicar na notificação traz o painel para a frente; o card do serviço que caiu
  // já foi expandido por `abrirEmIncidente`, então a informação está na tela.
  notification.addEventListener('click', () => {
    window.focus();
    notification.close();
  });
}

function onAlert(alert) {
  notifyDesktop(alert);
  abrirEmIncidente(alert);
  toast(
    `${SEVERITY_TITLE[alert.severity]} — ${alert.serviceName} · ${alert.checkName}`,
    alert.severity === 'recovery' ? 'ok' : 'err',
    alert.detail,
  );
}

el.btnNotify.addEventListener('click', async () => {
  if (Notification.permission === 'granted') {
    // Já ativo: o clique vira uma prévia, para você ver como aparece.
    notifyDesktop({
      severity: 'recovery',
      serviceName: 'sankhya-hub',
      checkName: 'Notificações',
      detail: 'Está funcionando — é assim que um alerta vai aparecer.',
      serviceId: '_test',
      checkId: 'perm',
    });
    return;
  }
  // A permissão só pode ser pedida a partir de um gesto do usuário.
  await Notification.requestPermission();
  renderNotifyButton();
});


/* --------------------------------- rede ---------------------------------- */

function setConnection(state, label) {
  el.conn.dataset.state = state;
  el.conn.querySelector('.conn-label').textContent = label;
}

function adoptSnapshot(snapshot) {
  model = snapshot;
  mutedKeys.clear();
  for (const service of snapshot.services) {
    for (const check of service.checks) {
      if (check.muted) mutedKeys.add(`${service.id}:${check.checkId}`);
    }
  }
  // `snapshot.alerts` chega e é ignorado de propósito: o painel só mostra alerta
  // ao vivo, pelo evento `alert`. Renderizar o histórico na conexão faria cada
  // refresh da página ressuscitar toasts de incidentes já resolvidos.
  renderAll();
}

async function refresh() {
  const res = await fetch('/api/state');
  if (!res.ok) return;
  adoptSnapshot(await res.json());
}

let retryDelay = 1000;

function connect() {
  const source = new EventSource('/api/stream');

  source.addEventListener('open', () => {
    retryDelay = 1000;
    setConnection('live', 'ao vivo');
  });

  source.addEventListener('snapshot', (event) => {
    adoptSnapshot(JSON.parse(event.data));
    setConnection('live', 'ao vivo');
  });

  source.addEventListener('check', (event) => applyCheck(JSON.parse(event.data)));
  source.addEventListener('alert', (event) => onAlert(JSON.parse(event.data)));

  source.addEventListener('error', () => {
    setConnection('down', 'reconectando');
    source.close();
    // Backoff até 15s — o hub pode estar reiniciando.
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  });
}

/* -------------------------------- interação ------------------------------ */

function toast(message, kind = 'ok', detail) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `<div>${esc(message)}</div>${detail ? `<pre>${esc(detail)}</pre>` : ''}`;
  el.toasts.appendChild(node);
  setTimeout(() => node.remove(), kind === 'err' ? 9000 : 5000);
}

el.formConfig.addEventListener('submit', (event) => {
  // `method="dialog"` fecha o modal sozinho; só o botão "save" tem trabalho a fazer.
  if (event.submitter?.value === 'save') void salvarConfig();
});

el.formCheckSettings.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'save') void salvarCheckSettings();
});

el.btnCheckSettingsToggle.addEventListener('click', () => void alternarCheckNoModal());

el.detail.addEventListener('click', async (event) => {
  const toggleServiceButton = event.target.closest('[data-toggle-service]');
  if (toggleServiceButton) {
    const serviceId = toggleServiceButton.dataset.toggleService;
    const service = model.services.find((s) => s.id === serviceId);
    if (!service) return;

    const enabled = Boolean(service.disabled); // estava desabilitado -> este clique habilita
    toggleServiceButton.disabled = true;
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/enabled`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) toast(payload.error || 'Não consegui alterar o projeto', 'err');
      // Sucesso: o servidor recarrega e o SSE manda um `snapshot` novo — a tela se
      // atualiza sozinha, sem precisar remendar o estado aqui.
    } catch (err) {
      toast(`Falha ao alterar o projeto: ${err.message}`, 'err');
    } finally {
      toggleServiceButton.disabled = false;
    }
    return;
  }

  const checkSettingsButton = event.target.closest('[data-check-settings]');
  if (checkSettingsButton) {
    const [serviceId, checkId] = checkSettingsButton.dataset.checkSettings.split('|');
    abrirCheckSettings(serviceId, checkId);
    return;
  }

  const projectActionsButton = event.target.closest('[data-project-actions]');
  if (projectActionsButton) {
    alternarAcoesProjeto(projectActionsButton.dataset.projectActions);
    return;
  }

  const checkActionsButton = event.target.closest('[data-check-actions]');
  if (checkActionsButton) {
    const [serviceId, checkId] = checkActionsButton.dataset.checkActions.split('|');
    alternarAcoesServico(serviceId, checkId);
    return;
  }

  const configButtonEl = event.target.closest('[data-config]');
  if (configButtonEl) {
    abrirConfig(configButtonEl.dataset.config);
    return;
  }

  const popupButton = event.target.closest('[data-popup-url]');
  if (popupButton) {
    window.open(
      popupButton.dataset.popupUrl,
      popupButton.dataset.popupName || '_blank',
      'width=960,height=640,resizable=yes,scrollbars=yes',
    );
    return;
  }

  const infoButton = event.target.closest('[data-info]');
  if (infoButton) {
    const chave = infoButton.dataset.info.replace('|', ':');
    if (infoAbertas.has(chave)) infoAbertas.delete(chave);
    else infoAbertas.add(chave);

    // Re-renderiza só este check, a partir do estado que o cliente já tem.
    const [serviceId, checkId] = infoButton.dataset.info.split('|');
    const service = model.services.find((s) => s.id === serviceId);
    const check = service?.checks.find((c) => c.checkId === checkId);
    if (check) applyCheck(check);
    return;
  }

  const runButton = event.target.closest('[data-run]');
  if (runButton) {
    const [serviceId, checkId] = runButton.dataset.run.split('|');
    runButton.disabled = true;
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/checks/${encodeURIComponent(checkId)}/run`, {
        method: 'POST',
      });
      if (res.ok) applyCheck(await res.json());
      else toast('Não consegui executar o check', 'err');
    } catch (err) {
      toast(`Falha ao executar: ${err.message}`, 'err');
    } finally {
      runButton.disabled = false;
    }
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;

  const [serviceId, actionId] = actionButton.dataset.action.split('|');
  const label = actionButton.dataset.label;

  if (actionButton.dataset.confirm === '1' && !window.confirm(`Executar "${label}"?`)) return;

  actionButton.disabled = true;
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) toast(`${label}: ${payload.message ?? 'ok'}`, 'ok', payload.detail);
    else toast(`${label}: ${payload.message ?? payload.error ?? `HTTP ${res.status}`}`, 'err', payload.detail);
  } catch (err) {
    toast(`${label}: ${err.message}`, 'err');
  } finally {
    actionButton.disabled = false;
  }
});

el.btnReload.addEventListener('click', async () => {
  el.btnReload.disabled = true;
  try {
    const res = await fetch('/api/reload', { method: 'POST' });
    const payload = await res.json();
    if (res.ok) {
      toast(`Config recarregada — ${payload.services} serviço(s)`, 'ok');
      await refresh();
    } else {
      toast('services.yaml inválido — a config anterior continua ativa', 'err', payload.error);
    }
  } catch (err) {
    toast(`Falha ao recarregar: ${err.message}`, 'err');
  } finally {
    el.btnReload.disabled = false;
  }
});

const savedTheme = localStorage.getItem('sankhya-hub-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

el.btnTheme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('sankhya-hub-theme', next);
});

// Os textos "há Xmin" envelhecem sozinhos; um tick de segundo em segundo mantém
// a tela honesta mesmo quando nenhum check dispara.
setInterval(() => {
  for (const service of model.services) {
    for (const check of service.checks) {
      const node = checkNodes.get(`${service.id}:${check.checkId}`);
      const msg = node?.querySelector('.check-msg');
      if (msg) msg.textContent = `${check.message} · ${relativeTime(check.ts)}`;
    }
  }
  el.footerMeta.textContent = el.footerMeta.textContent.replace(/atualizado .*/, `atualizado ${relativeTime(model.generatedAt)}`);
}, 5000);

/**
 * Um serviço que CAI abre sozinho no painel de detalhe. É a única seleção automática:
 * quando algo quebra, você quer o detalhe na tela sem ter que caçar o projeto certo.
 */
function abrirEmIncidente(alert) {
  if (alert.severity === 'critical') selecionarProjeto(alert.serviceId);
}

renderNotifyButton();
connect();
