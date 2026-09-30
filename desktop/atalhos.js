'use strict';

const conteudo = document.getElementById('secoes');

function criarElemento(tag, texto, classe) {
  const elemento = document.createElement(tag);
  if (texto !== undefined) elemento.textContent = texto;
  if (classe) elemento.className = classe;
  return elemento;
}

/** `Ctrl+Shift+Space` vira uma tecla desenhada por parte, ligadas por `+`. */
function criarTeclas(teclas) {
  const termo = criarElemento('dt');
  teclas.split('+').forEach((tecla, indice) => {
    if (indice > 0) termo.append('+');
    termo.append(criarElemento('kbd', tecla));
  });
  return termo;
}

function criarSecao({ titulo, atalhos }) {
  const lista = criarElemento('dl');
  for (const { teclas, descricao } of atalhos) {
    const linha = criarElemento('div', undefined, 'atalho');
    linha.append(criarTeclas(teclas), criarElemento('dd', descricao));
    lista.append(linha);
  }
  return [criarElemento('h2', titulo), lista];
}

function lerSecoes() {
  try {
    return JSON.parse(new URLSearchParams(location.search).get('secoes') ?? '[]');
  } catch (erro) {
    console.error('Lista de atalhos ilegível:', erro);
    return [];
  }
}

conteudo.append(
  ...lerSecoes().flatMap(criarSecao),
  criarElemento('p', 'Esc fecha esta janela.', 'rodape'),
);

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') window.close();
});
