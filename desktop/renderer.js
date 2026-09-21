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

for (const botao of botoesFixos) {
  botao.addEventListener('click', () => mostrarAba(botao.dataset.id));
}

document.getElementById('recarregar').addEventListener('click', () => {
  window.hub.tabs.recarregar(abaAtiva);
});

function renderizarAbasClientes(lista) {
  containerClientes.innerHTML = '';
  // A barra pode crescer (quebrar linha) conforme guias de cliente abrem/fecham — o
  // shell reposiciona as WebContentsView pela altura informada, então precisa saber.
  setTimeout(informarAlturaTopo, 0);
  for (const { origin, titulo } of lista) {
    const botao = document.createElement('span');
    botao.className = 'aba-cliente' + (origin === abaAtiva ? ' ativa' : '');
    botao.dataset.origin = origin;

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

function informarAlturaTopo() {
  window.hub.layout.definirAlturaTopo(document.getElementById('barra').offsetHeight);
}
window.addEventListener('resize', informarAlturaTopo);
informarAlturaTopo();

async function atualizarStatus() {
  const status = document.getElementById('status');
  try {
    const diag = await window.hub.diag.status();
    status.textContent = diag.backend
      ? `backend online · ${diag.erp.total} cookie(s) ERP · Experience ${diag.experienceCapturada ? 'logada' : 'deslogada'}`
      : 'backend indisponível';
    status.classList.toggle('offline', !diag.backend);
  } catch {
    status.textContent = 'status indisponível';
    status.classList.add('offline');
  }
}
atualizarStatus();
setInterval(atualizarStatus, 20_000);

/**
 * Guias escondidas pelo menu do aplicativo.
 *
 * Esconder e' so' visual: a guia continua carregada no shell, entao trazer de volta e'
 * instantaneo. O botao sai da barra, e a altura muda — por isso informa a altura de novo,
 * senao o conteudo das guias fica com um vao (ou sobrepondo a barra).
 */
function aplicarEstadoDasGuias(guias) {
  for (const { id, visivel } of guias) {
    const botao = document.querySelector(`#abas button[data-id="${id}"]`);
    if (botao) botao.hidden = !visivel;
  }
  setTimeout(informarAlturaTopo, 0);
}

window.hub.guias.aoAtualizar(aplicarEstadoDasGuias);
window.hub.guias.estado().then(aplicarEstadoDasGuias);
