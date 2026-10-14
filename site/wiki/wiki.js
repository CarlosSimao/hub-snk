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
  { arquivo: 'comunicacao.html', titulo: 'WhatsApp, Gmail e Google', pronta: false },
  { arquivo: 'bandeja.html', titulo: 'Bandeja e segundo plano', pronta: false },
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

montarMenu();
aplicarPrintsDoTema();
ativarAmpliacao();
document.addEventListener('mudanca-de-tema', aplicarPrintsDoTema);
