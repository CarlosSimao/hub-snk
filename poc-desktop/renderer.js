'use strict';

const logDiv = document.getElementById('log');
function logar(texto) {
  const linha = `[${new Date().toLocaleTimeString()}] ${texto}`;
  logDiv.textContent += linha + '\n';
  logDiv.scrollTop = logDiv.scrollHeight;
  console.log(linha);
}

function medirEEnviarAltura() {
  const altura = document.getElementById('topo').getBoundingClientRect().height;
  window.hub.layout.definirAlturaTopo(altura);
}
window.addEventListener('load', medirEEnviarAltura);
window.addEventListener('resize', medirEEnviarAltura);
new ResizeObserver(medirEEnviarAltura).observe(document.getElementById('topo'));

document.querySelectorAll('#abas button[data-id]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('#abas button[data-id]').forEach((b) => b.classList.remove('ativa'));
    btn.classList.add('ativa');
    await window.hub.tabs.mostrar(btn.dataset.id);
    logar(`aba ativa: ${btn.dataset.id}`);
  });
});

document.getElementById('recarregar').addEventListener('click', async () => {
  const ativa = document.querySelector('#abas button.ativa').dataset.id;
  await window.hub.tabs.recarregar(ativa);
  logar(`recarregado: ${ativa}`);
});

document.getElementById('btnCookies').addEventListener('click', async () => {
  const r = await window.hub.diag.cookiesErp();
  document.getElementById('outCookies').textContent =
    `total=${r.total} httpOnly=${r.httpOnly} seguros=${r.seguros} dominios=${r.dominios.join(',')}`;
  const status = r.total > 0 ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste4-cookies-erp', status, r);
  logar(`teste4 cookies ERP: ${status} — ${JSON.stringify(r)}`);
});

document.getElementById('chkBackendIndisponivel').addEventListener('change', async (e) => {
  const r = await window.hub.diag.definirBackendIndisponivel(e.target.checked);
  logar(`simulação de backend indisponível: ${r.ativo ? 'LIGADA (porta isolada 4099)' : 'desligada (backend real)'}`);
});

document.getElementById('btnAgenda').addEventListener('click', async () => {
  const de = document.getElementById('agendaDe').value;
  const ate = document.getElementById('agendaAte').value;
  const out = document.getElementById('outAgenda');
  out.textContent = 'buscando...';
  const simulandoIndisponivel = document.getElementById('chkBackendIndisponivel').checked;
  const r = await window.hub.agenda.fetch(de, ate);
  out.textContent = JSON.stringify(r, null, 2);

  if (simulandoIndisponivel) {
    // Aqui o CERTO é falhar em importar mas preservar o conteúdo capturado da Agenda —
    // isso é sucesso da resiliência, não falha do teste.
    const status = r.ok && r.backend === null && r.backendErro ? 'PASS' : 'FAIL';
    await window.hub.report.registrar('teste-backend-indisponivel-recuperacao', status, r);
    logar(`teste backend indisponível (degradação graciosa): ${status} — ${JSON.stringify(r).slice(0, 300)}`);
  } else {
    const status = r.ok ? (r.backend?.httpStatus === 200 ? 'PASS' : 'FAIL') : 'FAIL';
    await window.hub.report.registrar('teste6-agenda-inpage', status, r);
    logar(`teste6 agenda: ${status} — ${JSON.stringify(r).slice(0, 300)}`);
  }
});

document.getElementById('btnToken').addEventListener('click', async () => {
  const r = await window.hub.experience.capturarToken();
  document.getElementById('outToken').textContent = r.presente
    ? `token presente, exp=${r.expIso || 'sem exp no payload'}`
    : `sem token (${r.erro || 'localStorage vazio — faça login na aba Experience'})`;
  const status = r.presente ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste5-jwt-experience-captura', status, r);
  logar(`teste5 captura token: ${status} — ${JSON.stringify(r)}`);
});

document.getElementById('btnTarefas').addEventListener('click', async () => {
  const projetoId = Number(document.getElementById('expProjeto').value);
  const personId = Number(document.getElementById('expPerson').value);
  const out = document.getElementById('outTarefas');
  out.textContent = 'buscando...';
  const r = await window.hub.experience.tarefas(projetoId, personId);
  out.textContent = JSON.stringify(r, null, 2);
  const status = r.ok ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste5-jwt-experience-leitura', status, r);
  logar(`teste5 leitura tarefas: ${status} — ${JSON.stringify(r).slice(0, 300)}`);
});

document.getElementById('btnLimparToken').addEventListener('click', async () => {
  await window.hub.diag.limparSessaoExperience();
  document.getElementById('outLimpar').textContent = 'sessão capturada limpa localmente — capture de novo para testar recaptura';
  await window.hub.report.registrar('teste5b-logout-recaptura-limpeza', 'PASS', {});
  logar('teste5b: sessão Experience capturada foi limpa (simula logout local)');
});

document.getElementById('btnIsolamento').addEventListener('click', async () => {
  const r = await window.hub.diag.isolamentoBridge();
  document.getElementById('outIsolamento').textContent = JSON.stringify(r.detalhe);
  const status = r.isolado ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste12-isolamento-bridge', status, r);
  logar(`teste12 isolamento: ${status} — ${JSON.stringify(r)}`);
});

document.getElementById('fecharLink').addEventListener('click', async () => {
  await window.hub.links.fecharAbaCliente();
});

window.hub.links.aoAbrirAbaCliente((url) => {
  document.getElementById('tabLink').style.display = '';
  document.getElementById('fecharLink').style.display = '';
  document.querySelectorAll('#abas button[data-id]').forEach((b) => b.classList.remove('ativa'));
  document.getElementById('tabLink').classList.add('ativa');
  logar(`link de cliente cadastrado aberto em aba própria (sem privilégio de integração): ${url}`);
});

window.hub.links.aoFecharAbaCliente(() => {
  document.getElementById('tabLink').style.display = 'none';
  document.getElementById('fecharLink').style.display = 'none';
  document.querySelector('#abas button[data-id="hub"]').classList.add('ativa');
  logar('aba de link de cliente fechada, voltando ao Hub.');
});

// --- Teste 7: OS de homologação — só com alvo e conteúdo confirmados pelo usuário ---

let ultimoPreparoOsOk = false;
let ultimoAprovadorMascarado = '(preparo não trouxe aprovador)';

document.getElementById('btnOsPreparar').addEventListener('click', async () => {
  const clienteId = Number(document.getElementById('osClienteId').value);
  const tarefaIds = document
    .getElementById('osTarefaIds')
    .value.split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const out = document.getElementById('outOsPreparar');
  if (!clienteId || !tarefaIds.length) {
    out.textContent = 'informe clienteId e ao menos um tarefaId';
    return;
  }
  out.textContent = 'preparando (leitura, sem efeito)...';
  const r = await window.hub.os.preparar(clienteId, tarefaIds);
  out.textContent = JSON.stringify(r, null, 2);
  ultimoPreparoOsOk = r.httpStatus === 200;
  // Preenche automaticamente com o texto EXATO sugerido pelo preparo — evita que o
  // usuário precise digitar quebra de linha num campo de texto simples.
  if (ultimoPreparoOsOk && typeof r.corpo?.observacoes === 'string') {
    document.getElementById('osObs').value = r.corpo.observacoes;
  }
  const primeiroAprovador = r.corpo?.aprovadores?.[0];
  ultimoAprovadorMascarado = primeiroAprovador ? mascararNome(primeiroAprovador.nome) : '(sem aprovador retornado)';
  await window.hub.report.registrar('teste7-os-preparar', ultimoPreparoOsOk ? 'PASS' : 'FAIL', r);
  logar(`teste7 preparar OS: ${ultimoPreparoOsOk ? 'PASS' : 'FAIL'} — ${JSON.stringify(r).slice(0, 400)}`);
});

document.getElementById('osConfirmacao').addEventListener('input', (e) => {
  document.getElementById('btnOsCriar').disabled = e.target.value !== 'CRIAR OS' || !ultimoPreparoOsOk;
});

document.getElementById('btnOsCriar').addEventListener('click', async () => {
  if (document.getElementById('osConfirmacao').value !== 'CRIAR OS' || !ultimoPreparoOsOk) return;
  const payload = {
    clienteId: Number(document.getElementById('osClienteId').value),
    tarefaIds: document
      .getElementById('osTarefaIds')
      .value.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    dia: document.getElementById('osDia').value,
    horaInicio: document.getElementById('osHoraInicio').value,
    horaFim: document.getElementById('osHoraFim').value,
    intervalo: document.getElementById('osIntervalo').value || '01:00',
    observacoes: document.getElementById('osObs').value,
    notas: document.getElementById('osNotas').value,
  };
  const out = document.getElementById('outOsCriar');
  out.textContent = 'criando OS de verdade...';
  document.getElementById('btnOsCriar').disabled = true;
  const r = await window.hub.os.criar(payload);
  out.textContent = JSON.stringify(r, null, 2);
  const indeterminado = r.corpo?.indeterminado === true;
  const status = indeterminado ? 'BLOCKED' : r.httpStatus === 200 ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste7-os-criar', status, r);
  logar(`teste7 CRIAR OS: ${status} — ${JSON.stringify(r).slice(0, 500)}`);

  if (status === 'PASS' && r.corpo?.orderId) {
    osCriadaContexto = {
      orderId: r.corpo.orderId,
      numos: r.corpo.numos,
      clienteId: payload.clienteId,
      clienteLabel: `clienteId=${payload.clienteId}`,
      aprovadorMascarado: ultimoAprovadorMascarado,
    };
    document.getElementById('btnAbrirModalAceite').disabled = false;
  }
});

// --- Teste 7, passo 3: aceite/e-mail — modal LOCAL, nunca window.open remoto ---

let osCriadaContexto = null; // { orderId, numos, clienteId, clienteLabel, aprovadorMascarado }
let ordersComAceiteConcluido = new Set();

function mascararNome(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '(sem aprovador)';
  return [partes[0], ...partes.slice(1).map((p) => p[0]?.toUpperCase() + '.')].join(' ');
}

document.getElementById('btnCarregarOsExistente').addEventListener('click', () => {
  const orderId = Number(document.getElementById('osOrderIdExistente').value);
  const numos = document.getElementById('osNumosExistente').value;
  const clienteId = Number(document.getElementById('osClienteId').value);
  if (!orderId || !clienteId) {
    logar('informe orderId e clienteId pra carregar uma OS existente (nenhuma OS é criada aqui).');
    return;
  }
  osCriadaContexto = {
    orderId,
    numos,
    clienteId,
    clienteLabel: `clienteId=${clienteId}`,
    aprovadorMascarado: ultimoAprovadorMascarado,
  };
  document.getElementById('btnAbrirModalAceite').disabled = false;
  logar(`OS existente carregada pra teste de aceite (NÃO criada agora): orderId=${orderId}`);
});

const modal = document.getElementById('modalAceite');

document.getElementById('btnAbrirModalAceite').addEventListener('click', () => {
  if (!osCriadaContexto) return;
  if (ordersComAceiteConcluido.has(osCriadaContexto.orderId)) {
    logar(`OS ${osCriadaContexto.orderId} já teve aceite processado nesta sessão — não reabre para evitar duplicar.`);
    return;
  }
  document.getElementById('mdOrderId').textContent = `${osCriadaContexto.orderId} (${osCriadaContexto.numos})`;
  document.getElementById('mdCliente').textContent = osCriadaContexto.clienteLabel;
  document.getElementById('mdAprovador').textContent = osCriadaContexto.aprovadorMascarado;
  document.getElementById('mdChkAceite').checked = false;
  document.getElementById('mdChkEmail').checked = false;
  document.getElementById('mdChkEmail').disabled = true;
  document.getElementById('mdConfirmacao').value = '';
  document.getElementById('mdConfirmar').disabled = true;
  document.getElementById('mdResultado').textContent = '';
  modal.showModal();
});

// Clique fora (backdrop) cancela — <dialog> não faz isso sozinho.
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close('cancelado-backdrop');
});
modal.addEventListener('cancel', () => logar('modal de aceite/e-mail cancelado (Esc) — nenhum efeito.'));
modal.addEventListener('close', () => {
  if (modal.returnValue === 'cancelado-backdrop') logar('modal de aceite/e-mail cancelado (clique fora) — nenhum efeito.');
});
document.getElementById('mdCancelar').addEventListener('click', () => modal.close('cancelado-botao'));

function atualizarBotaoConfirmarModal() {
  const aceite = document.getElementById('mdChkAceite').checked;
  const texto = document.getElementById('mdConfirmacao').value;
  document.getElementById('mdConfirmar').disabled = !aceite || texto !== 'ENVIAR PARA APROVACAO';
}
document.getElementById('mdChkAceite').addEventListener('change', (e) => {
  const chkEmail = document.getElementById('mdChkEmail');
  chkEmail.disabled = !e.target.checked;
  if (!e.target.checked) chkEmail.checked = false; // nunca implícito
  atualizarBotaoConfirmarModal();
});
document.getElementById('mdConfirmacao').addEventListener('input', atualizarBotaoConfirmarModal);

document.getElementById('mdConfirmar').addEventListener('click', async () => {
  const botao = document.getElementById('mdConfirmar');
  if (botao.disabled) return;
  botao.disabled = true; // trava contra duplo clique — some diretamente
  document.getElementById('mdCancelar').disabled = true;
  const enviarEmail = document.getElementById('mdChkEmail').checked;
  const { orderId, clienteId } = osCriadaContexto;
  document.getElementById('mdResultado').textContent = 'executando...';

  const r = await window.hub.os.gerarAceite(orderId, clienteId, enviarEmail);
  document.getElementById('mdResultado').textContent = JSON.stringify(r, null, 2);

  const indeterminado = r.corpo?.indeterminado === true;
  const status = indeterminado ? 'BLOCKED' : r.httpStatus === 200 ? 'PASS' : 'FAIL';
  await window.hub.report.registrar('teste7b-os-aceite-email', status, { orderId, enviarEmail, ...r });
  logar(`teste7b aceite/e-mail OS ${orderId}: ${status} — ${JSON.stringify(r).slice(0, 400)}`);

  if (status === 'PASS' || indeterminado) {
    // PASS: não repete (evita duplicar aceite). Indeterminado: não repete sozinho —
    // exige verificação manual no Experience real antes de qualquer nova tentativa.
    ordersComAceiteConcluido.add(orderId);
  } else {
    document.getElementById('mdCancelar').disabled = false; // FAIL claro pode tentar de novo
  }
});

logar('UI carregada. Faça login manual nas abas ERP e Experience antes de rodar os testes.');
