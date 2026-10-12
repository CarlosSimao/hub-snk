'use strict';

const fundo = document.getElementById('fundo');
const painel = document.getElementById('downloads');
const lista = document.getElementById('lista');
const aviso = document.getElementById('aviso');
/** Distância mínima entre o cartão e a borda da janela. */
const MARGEM_DA_JANELA = 8;

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KB', 'MB', 'GB'];
  let valor = bytes;
  let i = -1;
  do {
    valor /= 1024;
    i++;
  } while (valor >= 1024 && i < unidades.length - 1);
  return `${valor.toFixed(valor < 10 ? 1 : 0).replace('.', ',')} ${unidades[i]}`;
}

function textoDaSituacao(d) {
  if (d.estado === 'baixando') {
    return d.total > 0
      ? `${formatarTamanho(d.recebidos)} de ${formatarTamanho(d.total)}`
      : `${formatarTamanho(d.recebidos)} baixados`;
  }
  if (d.estado === 'cancelado') return 'Cancelado';
  if (d.estado === 'interrompido') return 'Falhou';
  if (d.sumiu) return 'Arquivo removido ou movido';
  return `${d.total > 0 ? formatarTamanho(d.total) : formatarTamanho(d.recebidos)} · clique para abrir`;
}

function svgIcone(caminho) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [chave, valor] of Object.entries({
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(chave, valor);
  }
  const forma = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  forma.setAttribute('d', caminho);
  svg.appendChild(forma);
  return svg;
}

function criarLinha(d) {
  const abrivel = d.estado === 'concluido' && !d.sumiu;
  const falha = d.estado === 'cancelado' || d.estado === 'interrompido' || d.sumiu;
  const linha = document.createElement('div');
  linha.className = `linha${abrivel ? ' abrivel' : ''}${falha ? ' falha' : ''}`;

  const icone = document.createElement('span');
  icone.className = 'icone';
  icone.appendChild(
    svgIcone('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5'),
  );
  linha.appendChild(icone);

  const corpo = document.createElement('button');
  corpo.type = 'button';
  corpo.className = 'corpo';
  const nome = document.createElement('div');
  nome.className = 'nome';
  nome.textContent = d.nome;
  nome.title = d.nome;
  const situacao = document.createElement('div');
  situacao.className = 'situacao';
  situacao.textContent = textoDaSituacao(d);
  corpo.append(nome, situacao);
  if (d.estado === 'baixando') {
    const barra = document.createElement('div');
    barra.className = `barra${d.total > 0 ? '' : ' indeterminada'}`;
    const preenchimento = document.createElement('div');
    preenchimento.style.width = `${d.total > 0 ? Math.min(100, (d.recebidos / d.total) * 100) : 0}%`;
    barra.appendChild(preenchimento);
    corpo.appendChild(barra);
  }
  if (abrivel) corpo.addEventListener('click', () => window.camadaHub.abrirDownload(d.id));
  linha.appendChild(corpo);

  if (d.estado === 'concluido' && !d.sumiu) {
    const pasta = document.createElement('button');
    pasta.type = 'button';
    pasta.className = 'pasta';
    pasta.title = 'Mostrar na pasta';
    pasta.setAttribute('aria-label', 'Mostrar na pasta');
    pasta.appendChild(
      svgIcone('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
    );
    pasta.addEventListener('click', () => window.camadaHub.mostrarNaPasta(d.id));
    linha.appendChild(pasta);
  }
  return linha;
}

/** Abre com a borda direita no ponto pedido (o botão fica no canto direito da barra). */
function posicionarPainel(x, y) {
  const esquerda = Math.min(
    Math.max(MARGEM_DA_JANELA, x - painel.offsetWidth),
    window.innerWidth - painel.offsetWidth - MARGEM_DA_JANELA,
  );
  painel.style.left = `${esquerda}px`;
  painel.style.top = `${y + 4}px`;
}

function mostrar({ modo, downloads, aviso: conteudoDoAviso, x, y }) {
  const noPainel = modo === 'downloads';
  fundo.hidden = !noPainel;
  painel.hidden = !noPainel;
  aviso.hidden = noPainel;
  if (noPainel) {
    const rolagem = lista.scrollTop;
    if (downloads.length === 0) {
      const vazio = document.createElement('div');
      vazio.className = 'vazio';
      vazio.textContent = 'Nenhum arquivo baixado.';
      lista.replaceChildren(vazio);
    } else {
      lista.replaceChildren(...downloads.map(criarLinha));
    }
    lista.scrollTop = rolagem;
    posicionarPainel(x, y);
  } else if (conteudoDoAviso) {
    document.getElementById('aviso-titulo').textContent = conteudoDoAviso.titulo;
    document.getElementById('aviso-texto').textContent = conteudoDoAviso.texto;
  }
}

window.camadaHub.aoMostrar(mostrar);
document.getElementById('limpar').addEventListener('click', () => window.camadaHub.limpar());
fundo.addEventListener('mousedown', () => window.camadaHub.fechar());
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') window.camadaHub.fechar();
});
