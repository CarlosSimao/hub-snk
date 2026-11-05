/**
 * Partes comuns a todas as páginas da wiki: o menu das macro funcionalidades, num lugar
 * só, e a ampliação do print ao clicar nele.
 */

/** As macro funcionalidades, na ordem do menu. `pronta: false` aparece sem link. */
const PAGINAS = [
  { arquivo: 'primeiros-passos.html', titulo: 'Primeiros passos', pronta: true },
  { arquivo: 'clientes.html', titulo: 'Clientes', pronta: true },
  { arquivo: 'bases.html', titulo: 'Bases', pronta: true },
  { arquivo: 'links-gerais.html', titulo: 'Links gerais', pronta: true },
  { arquivo: 'projetos.html', titulo: 'Projetos', pronta: true },
  { arquivo: 'kanban.html', titulo: 'Kanban', pronta: true },
  { arquivo: 'contatos.html', titulo: 'Contatos', pronta: true },
  { arquivo: 'importar-e-exportar.html', titulo: 'Importar e exportar', pronta: true },
  { arquivo: 'resumo-do-dia.html', titulo: 'Resumo do dia', pronta: true },
  { arquivo: 'agenda-de-recursos.html', titulo: 'Agenda de Recursos', pronta: true },
  { arquivo: 'ordens-de-servico.html', titulo: 'Ordens de Serviço', pronta: true },
  { arquivo: 'ambiente-local.html', titulo: 'Ambiente local', pronta: true },
  { arquivo: 'lembretes-e-notificacoes.html', titulo: 'Lembretes e notificações', pronta: true },
  { arquivo: 'buscas-e-atalhos.html', titulo: 'Buscas e atalhos', pronta: true },
  { arquivo: 'repositorios-git.html', titulo: 'Repositórios Git', pronta: true },
  { arquivo: 'git-autosync.html', titulo: 'Git AutoSync', pronta: true },
  { arquivo: 'guias-e-navegacao.html', titulo: 'Guias e navegação', pronta: true },
  { arquivo: 'sankhya-id.html', titulo: 'Sankhya ID e login automático', pronta: true },
  { arquivo: 'comunicacao.html', titulo: 'WhatsApp, Gmail e Google', pronta: true },
  { arquivo: 'bandeja.html', titulo: 'Bandeja e segundo plano', pronta: true },
  { arquivo: 'mcp.html', titulo: 'MCP e agentes de IA', pronta: true },
  { arquivo: 'backup.html', titulo: 'Backup e Google Drive', pronta: true },
  { arquivo: 'configuracoes.html', titulo: 'Configurações', pronta: true },
  { arquivo: 'suporte.html', titulo: 'Suporte', pronta: true },
];

function montarMenu() {
  const menu = document.querySelector('.menu-da-wiki');
  if (!menu) return;

  const paginaAtual = location.pathname.split('/').pop() || 'index.html';
  const titulo = document.createElement('h2');
  titulo.textContent = 'Funcionalidades';
  const lista = document.createElement('ol');

  for (const pagina of PAGINAS) {
    const item = document.createElement('li');
    const rotulo = document.createElement(pagina.pronta ? 'a' : 'span');
    rotulo.textContent = pagina.titulo;
    if (pagina.pronta) {
      rotulo.href = pagina.arquivo;
      if (pagina.arquivo === paginaAtual) rotulo.setAttribute('aria-current', 'page');
    } else {
      rotulo.title = 'Em breve';
    }
    item.append(rotulo);
    lista.append(item);
  }

  menu.replaceChildren(titulo, lista);
}

function ativarAmpliacao() {
  const ampliacao = document.createElement('dialog');
  ampliacao.className = 'ampliacao';
  const imagemAmpliada = document.createElement('img');
  ampliacao.append(imagemAmpliada);
  document.body.append(ampliacao);
  ampliacao.addEventListener('click', () => ampliacao.close());

  for (const imagem of document.querySelectorAll('.passos img')) {
    imagem.addEventListener('click', () => {
      imagemAmpliada.src = imagem.src;
      imagemAmpliada.alt = imagem.alt;
      ampliacao.showModal();
    });
  }
}

/**
 * Cada print existe nos dois temas do HUB SNK: `nome.webp` (escuro, o do HTML) e
 * `nome-claro.webp`. Mostra o do tema da página, e troca quando o usuário alterna.
 */
function aplicarPrintsDoTema() {
  const claro = document.documentElement.dataset.theme === 'light';
  for (const imagem of document.querySelectorAll('.passos img')) {
    imagem.dataset.escuro ??= imagem.getAttribute('src');
    imagem.src = claro
      ? imagem.dataset.escuro.replace(/\.webp$/, '-claro.webp')
      : imagem.dataset.escuro;
  }
}

const ICONE_DE_LINK =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const DURACAO_DO_AVISO_DE_COPIA_MS = 1500;

/**
 * Põe no título de cada seção (e em cada campo das Configurações) um link para a própria
 * âncora, para compartilhar a URL que cai direto nela. O clique segue o link e ainda copia
 * a URL completa.
 */
function adicionarLinksDasSecoes() {
  const alvos = document.querySelectorAll('.funcionalidade[id] > h2, .funcionalidade dt[id]');
  for (const alvo of alvos) {
    const id = alvo.id || alvo.parentElement.id;
    const link = document.createElement('a');
    link.className = 'link-da-secao';
    link.href = `#${id}`;
    link.title = 'Copiar o link desta seção';
    link.setAttribute('aria-label', 'Copiar o link desta seção');
    link.innerHTML = ICONE_DE_LINK;
    link.addEventListener('click', () => copiarLink(link));
    alvo.append(link);
  }
}

async function copiarLink(link) {
  try {
    await navigator.clipboard.writeText(link.href);
  } catch (erro) {
    // Sem permissão de área de transferência a URL já foi para a barra de endereço pelo próprio link.
    console.warn('Não foi possível copiar o link da seção:', erro);
    return;
  }
  link.dataset.aviso = 'Link copiado';
  setTimeout(() => delete link.dataset.aviso, DURACAO_DO_AVISO_DE_COPIA_MS);
}

montarMenu();
aplicarPrintsDoTema();
ativarAmpliacao();
adicionarLinksDasSecoes();
document.addEventListener('mudanca-de-tema', aplicarPrintsDoTema);
