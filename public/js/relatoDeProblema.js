/**
 * Diálogo "Reportar problema ou sugerir", aberto por Configurações › Sobre.
 *
 * Sem dependência do `app.js`: o diálogo só precisa das duas rotas de suporte. É a
 * única tela do HUB SNK que manda algo para fora da máquina, então ela diz isso com
 * todas as letras e deixa a pessoa ver o que seguirá junto antes de enviar. O envio exige
 * nome, empresa, time e e-mail preenchidos em Configurações, e eles aparecem na prévia.
 */

const modal = document.getElementById('modal-relato');
const formulario = document.getElementById('formulario-relato');
const campoTipo = document.getElementById('campo-tipo-relato');
const campoMensagem = document.getElementById('campo-mensagem-relato');
const campoEmail = document.getElementById('campo-email-relato');
const campoIncluirLog = document.getElementById('campo-incluir-log-relato');
const botaoAbrir = document.getElementById('btn-reportar-problema');
const botaoCancelar = document.getElementById('btn-cancelar-relato');
const botaoEnviar = document.getElementById('btn-enviar-relato');
const botaoPrevia = document.getElementById('btn-previa-relato');
const areaDaPrevia = document.getElementById('previa-relato');
const erro = document.getElementById('erro-relato');
const aviso = document.getElementById('aviso-relato');

const TAMANHO_MAXIMO_DA_PREVIA = 200_000;

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.hidden = !mensagem;
}

function reiniciar() {
  formulario.reset();
  campoIncluirLog.checked = true;
  areaDaPrevia.hidden = true;
  areaDaPrevia.textContent = '';
  aviso.hidden = true;
  botaoEnviar.hidden = false;
  botaoEnviar.disabled = false;
  botaoCancelar.textContent = 'Cancelar';
  mostrarErro('');
}

async function chamar(caminho, corpo) {
  const resposta = await fetch(caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const conteudo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(conteudo?.mensagem ?? `Falha na requisição (HTTP ${resposta.status}).`);
  }
  return conteudo;
}

async function alternarPrevia() {
  if (!areaDaPrevia.hidden) {
    areaDaPrevia.hidden = true;
    return;
  }

  areaDaPrevia.hidden = false;
  areaDaPrevia.textContent = 'Carregando…';
  try {
    const previa = await chamar('/api/suporte/previa');
    const contexto = Object.entries(previa.contexto)
      .map(([chave, valor]) => `${chave}: ${valor}`)
      .join('\n');
    const log = campoIncluirLog.checked
      ? previa.log || '(não há log para anexar)'
      : '(o log não será enviado: a opção está desmarcada)';
    // O log pode ter 1 MB; a prévia mostra o final, que é o que mais interessa.
    const logVisivel =
      log.length > TAMANHO_MAXIMO_DA_PREVIA
        ? `[… início omitido na prévia; o envio leva o texto inteiro …]\n${log.slice(-TAMANHO_MAXIMO_DA_PREVIA)}`
        : log;
    areaDaPrevia.textContent = `— Dados técnicos —\n${contexto}\n\n— Log de diagnóstico —\n${logVisivel}`;
  } catch (falha) {
    areaDaPrevia.textContent = `Não foi possível montar a prévia: ${falha.message}`;
  }
}

/**
 * Nome, empresa, time e e-mail vêm de Configurações e são obrigatórios. Devolve os que faltam;
 * se a configuração não puder ser lida, devolve vazio e deixa a rota decidir.
 */
async function camposDeIdentificacaoPendentes() {
  try {
    const configuracao = await chamar('/api/configuracao');
    return [
      ['Nome do usuário', configuracao.nomeDoUsuario],
      ['Empresa', configuracao.empresaDoUsuario],
      ['Time', configuracao.timeDoUsuario],
      ['E-mail', configuracao.emailDoUsuario],
    ]
      .filter(([, valor]) => !String(valor ?? '').trim())
      .map(([rotulo]) => rotulo);
  } catch {
    return [];
  }
}

async function enviar(evento) {
  evento.preventDefault();
  mostrarErro('');

  if (!campoMensagem.value.trim()) {
    mostrarErro('Descreva o que aconteceu.');
    campoMensagem.focus();
    return;
  }

  const pendentes = await camposDeIdentificacaoPendentes();
  if (pendentes.length > 0) {
    mostrarErro(`Preencha em Configurações antes de enviar: ${pendentes.join(', ')}.`);
    return;
  }

  botaoEnviar.disabled = true;
  botaoEnviar.textContent = 'Enviando…';
  try {
    const resultado = await chamar('/api/suporte/relatos', {
      tipo: campoTipo.value,
      mensagem: campoMensagem.value,
      email: campoEmail.value,
      incluirLog: campoIncluirLog.checked,
    });

    aviso.textContent =
      resultado.situacao === 'enviado'
        ? 'Relato enviado. Obrigado!'
        : 'Sem conexão com o suporte agora. O relato ficou guardado e será enviado na próxima abertura do HUB SNK.';
    aviso.hidden = false;
    botaoEnviar.hidden = true;
    botaoCancelar.textContent = 'Fechar';
  } catch (falha) {
    mostrarErro(falha.message);
    botaoEnviar.disabled = false;
  } finally {
    botaoEnviar.textContent = 'Enviar';
  }
}

if (modal && botaoAbrir) {
  botaoAbrir.addEventListener('click', () => {
    reiniciar();
    modal.showModal();
    campoMensagem.focus();
  });
  botaoCancelar.addEventListener('click', () => modal.close());
  botaoPrevia.addEventListener('click', alternarPrevia);
  // Marcar ou desmarcar o log muda o que a prévia mostra.
  campoIncluirLog.addEventListener('change', () => {
    if (!areaDaPrevia.hidden) {
      areaDaPrevia.hidden = true;
      void alternarPrevia();
    }
  });
  formulario.addEventListener('submit', enviar);
}
