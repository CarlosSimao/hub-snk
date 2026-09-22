/**
 * Janela de acompanhamento do `server.log` de uma base local, em tempo real
 * via SSE. Sem dependência do `app.js` — a janela abre isolada, só com o que
 * precisa pra ler o log.
 */

const MARGEM_DE_SCROLL_NO_FINAL_EM_PX = 40;

const parametros = new URLSearchParams(location.search);
const idDaBase = parametros.get('baseId');
const nomeDaBase = parametros.get('nome') ?? '';

const elementoTitulo = document.getElementById('log-titulo');
const elementoStatus = document.getElementById('log-status');
const elementoCorpo = document.getElementById('log-corpo');
const botaoDeRolagem = document.getElementById('log-rolagem');
const botaoDePausa = document.getElementById('log-pausar');
const botaoDeDownload = document.getElementById('log-baixar');

/**
 * `posicaoLida` é o deslocamento em bytes já consumido do arquivo — é o que
 * permite retomar de onde parou depois de uma pausa, sem repetir nem perder
 * o que o WildFly escreveu enquanto o acompanhamento estava parado.
 */
const estado = {
  fonte: null,
  pausado: false,
  rolagemAutomatica: true,
  posicaoLida: null,
};

const titulo = nomeDaBase ? `Log — ${nomeDaBase}` : 'Log';
elementoTitulo.textContent = titulo;
document.title = `${titulo} — HUB SNK`;

if (!idDaBase) {
  elementoStatus.textContent = 'Base não informada na URL.';
  botaoDePausa.disabled = true;
  botaoDeDownload.disabled = true;
} else {
  botaoDeRolagem.addEventListener('click', alternarRolagemAutomatica);
  botaoDePausa.addEventListener('click', alternarPausa);
  botaoDeDownload.addEventListener('click', baixarLog);
  elementoCorpo.addEventListener('scroll', desligarRolagemAoSubir);
  conectar();
}

function conectar() {
  const base = `/api/local/bases/${idDaBase}/log/stream`;
  const endereco = estado.posicaoLida === null ? base : `${base}?desde=${estado.posicaoLida}`;
  const fonte = new EventSource(endereco);
  estado.fonte = fonte;

  fonte.addEventListener('open', () => {
    elementoStatus.textContent = 'Acompanhando em tempo real';
  });

  fonte.addEventListener('trecho', (evento) => {
    adicionarTexto(JSON.parse(evento.data));
  });

  fonte.addEventListener('posicao', (evento) => {
    estado.posicaoLida = Number(JSON.parse(evento.data));
  });

  fonte.addEventListener('aviso', (evento) => {
    elementoStatus.textContent = JSON.parse(evento.data);
  });

  fonte.addEventListener('erro', (evento) => {
    adicionarTexto(`\n[erro ao ler o log: ${JSON.parse(evento.data)}]\n`);
  });

  fonte.onerror = () => {
    elementoStatus.textContent = 'Conexão perdida — tentando reconectar...';
  };
}

/**
 * Pausar fecha a conexão de verdade (o servidor para de ler o arquivo);
 * retomar reabre a partir de `posicaoLida`.
 */
function alternarPausa() {
  estado.pausado = !estado.pausado;

  if (estado.pausado) {
    estado.fonte?.close();
    estado.fonte = null;
    elementoStatus.textContent = 'Pausado';
    botaoDePausa.textContent = 'Retomar';
    return;
  }

  botaoDePausa.textContent = 'Pausar';
  elementoStatus.textContent = 'Retomando...';
  conectar();
}

function alternarRolagemAutomatica() {
  definirRolagemAutomatica(!estado.rolagemAutomatica);

  if (estado.rolagemAutomatica) {
    rolarParaOFinal();
  }
}

function definirRolagemAutomatica(ligada) {
  estado.rolagemAutomatica = ligada;
  botaoDeRolagem.classList.toggle('ativo', ligada);
  botaoDeRolagem.setAttribute('aria-pressed', String(ligada));
}

/**
 * Subir a rolagem para ler algo antes desliga o acompanhamento automático —
 * senão o próximo trecho arrancaria o usuário de volta pro final. Rolar de
 * volta ao final não religa sozinho: quem religa é o botão, para o estado da
 * chave ser sempre uma escolha explícita.
 */
function desligarRolagemAoSubir() {
  if (estado.rolagemAutomatica && !estaNoFinal()) {
    definirRolagemAutomatica(false);
  }
}

function estaNoFinal() {
  return (
    elementoCorpo.scrollTop + elementoCorpo.clientHeight >=
    elementoCorpo.scrollHeight - MARGEM_DE_SCROLL_NO_FINAL_EM_PX
  );
}

function rolarParaOFinal() {
  elementoCorpo.scrollTop = elementoCorpo.scrollHeight;
}

function adicionarTexto(texto) {
  if (!texto) {
    return;
  }

  elementoCorpo.textContent += texto;

  if (estado.rolagemAutomatica) {
    rolarParaOFinal();
  }
}

/**
 * Baixa o arquivo inteiro do disco, não o trecho que está na tela. O `HEAD`
 * antes evita trocar a janela por um JSON de erro quando o log ainda não
 * existe — nesse caso a mensagem aparece na própria barra.
 */
async function baixarLog() {
  const endereco = `/api/local/bases/${idDaBase}/log/download`;

  try {
    const resposta = await fetch(endereco, { method: 'HEAD' });
    if (!resposta.ok) {
      elementoStatus.textContent = 'Log ainda não existe no disco — nada para baixar.';
      return;
    }
  } catch (erro) {
    elementoStatus.textContent = `Falha ao baixar o log: ${erro.message}`;
    return;
  }

  const link = document.createElement('a');
  link.href = endereco;
  link.download = '';
  link.click();
}
