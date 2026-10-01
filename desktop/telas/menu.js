'use strict';

const cartao = document.getElementById('menu');
/** Distância mínima entre o cartão e a borda da janela. */
const MARGEM_DA_JANELA = 8;

function criarMarcaDeCheck() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('aria-hidden', 'true');
  const traco = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  traco.setAttribute('d', 'M2 5.2 4.2 7.4 8 2.8');
  traco.setAttribute('fill', 'none');
  traco.setAttribute('stroke', '#0d1015');
  traco.setAttribute('stroke-width', '1.8');
  traco.setAttribute('stroke-linecap', 'round');
  traco.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(traco);
  return svg;
}

function criarTexto(classe, texto) {
  const elemento = document.createElement('div');
  elemento.className = classe;
  elemento.textContent = texto;
  return elemento;
}

function criarItemClicavel({ id, tipo, rotulo, marcado, atalho }) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = `item ${tipo}${marcado ? ' marcado' : ''}`;
  botao.setAttribute('role', tipo === 'caixa' ? 'menuitemcheckbox' : 'menuitem');
  if (tipo === 'caixa') botao.setAttribute('aria-checked', String(marcado));

  const marca = document.createElement('span');
  marca.className = 'marca';
  if (tipo === 'caixa') marca.appendChild(criarMarcaDeCheck());
  botao.appendChild(marca);

  const texto = document.createElement('span');
  texto.textContent = rotulo;
  botao.appendChild(texto);

  if (atalho) {
    const dica = document.createElement('span');
    dica.className = 'atalho';
    dica.textContent = atalho;
    botao.appendChild(dica);
  }
  botao.addEventListener('click', () => window.menuHub.escolher(id));
  return botao;
}

function criarElemento(item) {
  if (item.tipo === 'titulo') return criarTexto('titulo', item.rotulo);
  if (item.tipo === 'nota') return criarTexto('nota', item.rotulo);
  return criarItemClicavel(item);
}

/** Abre no ponto pedido, mas recua para dentro da janela se não couber. */
function posicionar(x, y) {
  const limiteX = window.innerWidth - cartao.offsetWidth - MARGEM_DA_JANELA;
  const limiteY = window.innerHeight - cartao.offsetHeight - MARGEM_DA_JANELA;
  cartao.style.left = `${Math.max(MARGEM_DA_JANELA, Math.min(x, limiteX))}px`;
  cartao.style.top = `${Math.max(MARGEM_DA_JANELA, Math.min(y, limiteY))}px`;
}

/**
 * Chamado ao abrir e de novo a cada caixa marcada. No redesenho, o foco volta ao mesmo
 * item, para quem usa o teclado não perder o lugar.
 */
function mostrar({ itens, x, y }) {
  const idFocado = document.activeElement?.dataset?.id;
  const rolagem = cartao.scrollTop;
  cartao.replaceChildren(
    ...itens.map((item) => {
      const elemento = criarElemento(item);
      elemento.dataset.id = item.id;
      return elemento;
    }),
  );
  cartao.hidden = false;
  cartao.scrollTop = rolagem;
  posicionar(x, y);
  const focar = idFocado && cartao.querySelector(`[data-id="${CSS.escape(idFocado)}"]`);
  if (focar) focar.focus();
}

window.menuHub.aoMostrar(mostrar);
document.getElementById('fundo').addEventListener('mousedown', () => window.menuHub.fechar());
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') window.menuHub.fechar();
});
