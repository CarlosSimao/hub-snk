/**
 * Tema claro/escuro do site e da wiki. Toda visita começa no escuro, o tema do aplicativo;
 * o claro escolhido no botão do topo vale até fechar a aba (`sessionStorage`), para não
 * voltar ao escuro a cada página da wiki.
 *
 * Carregado no `<head>`, sem `defer`: o tema precisa estar no `<html>` antes da página
 * aparecer, senão ela pisca no tema errado a cada abertura. O botão só é montado quando
 * o topo já existe.
 */
const CHAVE_DO_TEMA = 'hub-snk:tema';

function temaInicial() {
  return sessionStorage.getItem(CHAVE_DO_TEMA) === 'light' ? 'light' : 'dark';
}

document.documentElement.dataset.theme = temaInicial();

const ICONE_DO_SOL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICONE_DA_LUA =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

/* O ícone mostra o tema de destino, como no aplicativo: sol no escuro, lua no claro. */
function atualizarBotao(botao) {
  const claro = document.documentElement.dataset.theme === 'light';
  botao.innerHTML = claro ? ICONE_DA_LUA : ICONE_DO_SOL;
  botao.title = claro ? 'Ativar tema escuro' : 'Ativar tema claro';
  botao.setAttribute('aria-label', botao.title);
}

function montarBotaoDoTema() {
  const topo = document.querySelector('header.topo nav');
  if (!topo) return;

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'botao-tema';
  botao.addEventListener('click', () => {
    const novo = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = novo;
    sessionStorage.setItem(CHAVE_DO_TEMA, novo);
    atualizarBotao(botao);
    // A wiki escuta para trocar os prints pelos do tema novo.
    document.dispatchEvent(new Event('mudanca-de-tema'));
  });
  atualizarBotao(botao);
  topo.append(botao);
}

document.addEventListener('DOMContentLoaded', montarBotaoDoTema);
