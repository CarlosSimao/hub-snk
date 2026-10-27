const lista = document.getElementById('fontes');
const abas = document.querySelectorAll('nav button');
const botaoCompartilhar = document.getElementById('compartilhar');
const caixaDoAudio = document.getElementById('audio');

let fontes = [];
let tipoAtual = 'tela';
let escolhida = null;

function criarCartao(fonte) {
  const cartao = document.createElement('button');
  cartao.className = 'fonte';
  cartao.setAttribute('role', 'option');
  cartao.setAttribute('aria-selected', String(fonte.id === escolhida));

  const miniatura = document.createElement('img');
  miniatura.className = 'miniatura';
  miniatura.src = fonte.miniatura;
  miniatura.alt = '';

  const nome = document.createElement('div');
  nome.className = 'nome';
  if (fonte.icone) {
    const icone = document.createElement('img');
    icone.src = fonte.icone;
    icone.alt = '';
    nome.append(icone);
  }
  const texto = document.createElement('span');
  texto.textContent = fonte.nome;
  texto.title = fonte.nome;
  nome.append(texto);

  cartao.append(miniatura, nome);
  cartao.addEventListener('click', () => escolher(fonte.id));
  cartao.addEventListener('dblclick', () =>
    window.seletorDeTela.escolher(fonte.id, caixaDoAudio.checked),
  );
  return cartao;
}

function desenhar() {
  const daAba = fontes.filter((fonte) => fonte.tipo === tipoAtual);
  if (daAba.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'vazio';
    vazio.textContent = 'Nada para compartilhar aqui.';
    lista.replaceChildren(vazio);
    return;
  }
  lista.replaceChildren(...daAba.map(criarCartao));
}

function escolher(id) {
  escolhida = id;
  botaoCompartilhar.disabled = false;
  desenhar();
}

abas.forEach((aba) =>
  aba.addEventListener('click', () => {
    tipoAtual = aba.dataset.tipo;
    abas.forEach((outra) => outra.setAttribute('aria-selected', String(outra === aba)));
    // Quem escolheu numa aba e trocou de aba não compartilha mais o que está fora de vista.
    escolhida = null;
    botaoCompartilhar.disabled = true;
    desenhar();
  }),
);

botaoCompartilhar.addEventListener('click', () =>
  window.seletorDeTela.escolher(escolhida, caixaDoAudio.checked),
);
document
  .getElementById('cancelar')
  .addEventListener('click', () => window.seletorDeTela.cancelar());
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') window.seletorDeTela.cancelar();
});

window.seletorDeTela.aoMostrar((dados) => {
  fontes = dados.fontes;
  document.getElementById('rotuloDoAudio').hidden = !dados.oferecerAudio;
  // Abre na aba que tem o que mostrar: sem telas (raro), cai direto em janelas.
  if (!fontes.some((fonte) => fonte.tipo === 'tela')) {
    abas[1].click();
    return;
  }
  desenhar();
});
