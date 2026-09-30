'use strict';

const botoesFixos = document.querySelectorAll('#abas button[data-id]');
const containerClientes = document.getElementById('abasClientes');
let abaAtiva = 'hub';

function marcarAtiva(id) {
  abaAtiva = id;
  for (const botao of botoesFixos) {
    botao.classList.toggle('ativa', botao.dataset.id === id);
  }
  for (const botao of containerClientes.querySelectorAll('.aba-cliente')) {
    botao.classList.toggle('ativa', botao.dataset.origin === id);
  }
}

async function mostrarAba(id) {
  const resultado = await window.hub.tabs.mostrar(id);
  if (resultado.ok) marcarAtiva(id);
}

function definirVisibilidade(botao, visivel) {
  if (!botao) return;
  botao.hidden = !visivel;
  botao.setAttribute('aria-hidden', String(!visivel));
}

for (const botao of botoesFixos) {
  botao.addEventListener('click', () => mostrarAba(botao.dataset.id));
}

const botaoRecarregar = document.getElementById('recarregar');
botaoRecarregar.addEventListener('click', () => {
  window.hub.tabs.recarregar(abaAtiva);
  // Remover e forçar reflow reinicia a animação mesmo em cliques seguidos.
  botaoRecarregar.classList.remove('girando');
  void botaoRecarregar.offsetWidth;
  botaoRecarregar.classList.add('girando');
});

document.getElementById('menu').addEventListener('click', (evento) => {
  const { left, bottom } = evento.currentTarget.getBoundingClientRect();
  window.hub.menu.abrir(left, bottom);
});

function renderizarAbasClientes(lista) {
  containerClientes.innerHTML = '';
  // A barra pode crescer (quebrar linha) conforme guias de cliente abrem/fecham — o
  // shell reposiciona as WebContentsView pela altura informada, então precisa saber.
  setTimeout(informarAlturaTopo, 0);
  for (const { origin, titulo, visivel } of lista) {
    const botao = document.createElement('span');
    botao.className = 'aba-cliente' + (origin === abaAtiva ? ' ativa' : '');
    botao.dataset.origin = origin;
    definirVisibilidade(botao, visivel);

    const rotulo = document.createElement('span');
    rotulo.textContent = titulo;
    rotulo.addEventListener('click', () => mostrarAba(origin));
    botao.appendChild(rotulo);

    const fechar = document.createElement('span');
    fechar.className = 'fechar';
    fechar.textContent = '×';
    fechar.title = 'Fechar';
    fechar.addEventListener('click', async (evento) => {
      evento.stopPropagation();
      await window.hub.links.fechar(origin);
    });
    botao.appendChild(fechar);

    containerClientes.appendChild(botao);
  }
}

window.hub.links.aoAtualizarLista(renderizarAbasClientes);
window.hub.links.listar().then(renderizarAbasClientes);
window.hub.tabs.aoMostrar(marcarAtiva);

function informarAlturaTopo() {
  window.hub.layout.definirAlturaTopo(document.getElementById('barra').offsetHeight);
}
window.addEventListener('resize', informarAlturaTopo);
informarAlturaTopo();

/**
 * Guias escondidas pelo menu do aplicativo.
 *
 * Esconder e' so' visual: a guia continua carregada no shell, entao trazer de volta e'
 * instantaneo. O botao sai da barra, e a altura muda — por isso informa a altura de novo,
 * senao o conteudo das guias fica com um vao (ou sobrepondo a barra).
 */
function aplicarEstadoDasGuias(guias) {
  for (const { id, visivel } of guias) {
    const botao =
      document.querySelector(`#abas button[data-id="${CSS.escape(id)}"]`) ??
      document.querySelector(`#abasClientes .aba-cliente[data-origin="${CSS.escape(id)}"]`);
    definirVisibilidade(botao, visivel);
  }
  setTimeout(informarAlturaTopo, 0);
}

window.hub.guias.aoAtualizar(aplicarEstadoDasGuias);
window.hub.guias.estado().then(aplicarEstadoDasGuias);

/**
 * Barra lateral de comunicação: cada botão abre o serviço no painel por cima das guias, ou o
 * esconde se ele já estiver aberto — quem decide é o shell (src/comunicacao.ts).
 */
const barraLateral = document.getElementById('lateral');
const botoesComunicacao = document.querySelectorAll('#servicos button[data-servico]');
const botaoAlternarLateral = document.getElementById('alternarLateral');
/** Preferência só desta tela: nada no shell depende dela, então não vai para o `userData`. */
const CHAVE_LATERAL_OCULTA = 'hub.lateralOculta';
let servicoAtivo = null;
/** Conversas não lidas por serviço, pelo título da página (só o WhatsApp informa). */
const naoLidasPorServico = new Map();
const LIMITE_DO_CONTADOR = 99;

function marcarServicoAtivo(servico) {
  servicoAtivo = servico;
  for (const botao of botoesComunicacao) {
    botao.classList.toggle('ativa', botao.dataset.servico === servico);
  }
  atualizarPiscar();
}

/** Pisca quem tem não lidas e não está aberto: aberto, você já está vendo. */
function atualizarPiscar() {
  for (const botao of botoesComunicacao) {
    const servico = botao.dataset.servico;
    const temNaoLidas = (naoLidasPorServico.get(servico) ?? 0) > 0;
    botao.classList.toggle('piscando', temNaoLidas && servico !== servicoAtivo);
  }
}

function botaoDoServico(servico) {
  return document.querySelector(`#servicos button[data-servico="${CSS.escape(servico)}"]`);
}

function mostrarNaoLidas({ servico, quantidade }) {
  naoLidasPorServico.set(servico, quantidade);
  const contador = botaoDoServico(servico)?.querySelector('.contador');
  if (contador) {
    contador.hidden = quantidade === 0;
    contador.textContent = quantidade > LIMITE_DO_CONTADOR ? `${LIMITE_DO_CONTADOR}+` : quantidade;
  }
  atualizarPiscar();
}

/** Botão de serviço desabilitado no menu da engrenagem some da barra. */
function aplicarServicosHabilitados(servicos) {
  for (const { servico, habilitado } of servicos) {
    const botao = botaoDoServico(servico);
    if (botao) botao.hidden = !habilitado;
  }
}

for (const botao of botoesComunicacao) {
  botao.addEventListener('click', () => window.hub.comunicacao.alternar(botao.dataset.servico));
}
window.hub.comunicacao.aoMudarAtivo(marcarServicoAtivo);
window.hub.comunicacao.aoMudarNaoLidas(mostrarNaoLidas);
window.hub.comunicacao.aoMensagemNova(tocarSomDeMensagemNova);
window.hub.comunicacao.aoMudarServicos(aplicarServicosHabilitados);
window.hub.comunicacao.estado().then(aplicarServicosHabilitados);

document.getElementById('configurarServicos').addEventListener('click', (evento) => {
  const { right, top } = evento.currentTarget.getBoundingClientRect();
  window.hub.comunicacao.abrirMenu(right, top);
});

/*
 * Som sintetizado com Web Audio, como o das notificações do Painel (public/app.js), mas
 * com duas notas subindo — dá para distinguir de ouvido uma mensagem de um aviso do HUB.
 */
const NOTAS_DA_MENSAGEM_HZ = [784, 1175];
const DURACAO_DA_NOTA_S = 0.18;
const INTERVALO_ENTRE_NOTAS_S = 0.12;
const VOLUME_DA_MENSAGEM = 0.2;
const VOLUME_SILENCIOSO = 0.0001;
const SUBIDA_DO_VOLUME_S = 0.02;
/* Criado no primeiro som: o navegador pode recusar um contexto de áudio antes disso. */
let contextoDeAudio = null;

function tocarSomDeMensagemNova() {
  try {
    contextoDeAudio ??= new AudioContext();
    void contextoDeAudio.resume();
    const inicio = contextoDeAudio.currentTime;
    NOTAS_DA_MENSAGEM_HZ.forEach((frequencia, indice) => {
      const comeco = inicio + indice * INTERVALO_ENTRE_NOTAS_S;
      const oscilador = contextoDeAudio.createOscillator();
      const volume = contextoDeAudio.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.value = frequencia;
      volume.gain.setValueAtTime(VOLUME_SILENCIOSO, comeco);
      volume.gain.exponentialRampToValueAtTime(VOLUME_DA_MENSAGEM, comeco + SUBIDA_DO_VOLUME_S);
      volume.gain.exponentialRampToValueAtTime(VOLUME_SILENCIOSO, comeco + DURACAO_DA_NOTA_S);
      oscilador.connect(volume).connect(contextoDeAudio.destination);
      oscilador.start(comeco);
      oscilador.stop(comeco + DURACAO_DA_NOTA_S);
    });
  } catch (erro) {
    // Sem áudio (sem saída de som): o ícone pisca mesmo assim.
    console.warn('Som de mensagem nova indisponível:', erro);
  }
}

// Clique fora do painel que cai nesta página (a barra de guias): esconde o painel. Clique
// numa guia o shell já percebe pela troca de foco.
document.addEventListener('mousedown', (evento) => {
  if (!servicoAtivo || barraLateral.contains(evento.target)) return;
  window.hub.comunicacao.ocultar();
});

function informarLarguraLateral() {
  window.hub.layout.definirLarguraLateral(barraLateral.offsetWidth);
}

function lerLateralOculta() {
  try {
    return localStorage.getItem(CHAVE_LATERAL_OCULTA) === 'S';
  } catch {
    // Armazenamento indisponível: abre com a barra visível, que é o padrão.
    return false;
  }
}

function gravarLateralOculta(oculta) {
  try {
    localStorage.setItem(CHAVE_LATERAL_OCULTA, oculta ? 'S' : 'N');
  } catch (err) {
    console.error('preferência da barra lateral não gravada', err);
  }
}

function aplicarLateralOculta(oculta) {
  document.body.classList.toggle('lateral-oculta', oculta);
  const rotulo = oculta ? 'Exibir barra de comunicação' : 'Ocultar barra de comunicação';
  botaoAlternarLateral.title = rotulo;
  botaoAlternarLateral.setAttribute('aria-label', rotulo);
  botaoAlternarLateral.setAttribute('aria-expanded', String(!oculta));
  // Sem os botões à vista, o painel aberto ficaria sem como ser fechado pela barra.
  if (oculta && servicoAtivo) window.hub.comunicacao.ocultar();
  informarLarguraLateral();
  // A barra de guias perde ou ganha largura e pode quebrar linha, mudando de altura.
  setTimeout(informarAlturaTopo, 0);
}

botaoAlternarLateral.addEventListener('click', () => {
  const oculta = !document.body.classList.contains('lateral-oculta');
  gravarLateralOculta(oculta);
  aplicarLateralOculta(oculta);
});

aplicarLateralOculta(lerLateralOculta());
