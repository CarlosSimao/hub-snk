/*
 * Kanban dos projetos do cliente: a seção dentro de cada projeto, o bloco das órfãs no
 * fim da aba Projetos e as janelas do quadro, da tarefa, do documento e da exclusão.
 *
 * O que é puro (colunas, ordem dos cartões, posição do arrasto) fica exportado à parte
 * e roda nos testes sem navegador. O resto recebe do `app.js`, em `iniciarKanban`, os
 * auxiliares de tela que ele já tem: requisição, botões, avisos e erros de formulário.
 *
 * Os dados do kanban não vêm com o cadastro do cliente: são lidos à parte, quando a aba
 * Projetos aparece, e ficam guardados para o cliente selecionado. Enquanto algum kanban
 * está sendo analisado, a leitura se repete sozinha até a IA terminar.
 */

export const COLUNAS = [
  { estado: 'backlog', rotulo: 'Backlog' },
  { estado: 'a_fazer', rotulo: 'A fazer' },
  { estado: 'em_andamento', rotulo: 'Em andamento' },
  { estado: 'em_revisao', rotulo: 'Em revisão' },
  { estado: 'concluido', rotulo: 'Concluído' },
];

export const ROTULOS_DOS_TIPOS = {
  backend: 'Backend',
  frontend: 'Frontend',
  dados: 'Dados',
  relatorio: 'Relatório',
  bi: 'BI',
  integracao: 'Integração',
  configuracao: 'Configuração',
  teste: 'Teste',
  documentacao: 'Documentação',
  outro: 'Outro',
};

const NOMES_DOS_ASSISTENTES = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent',
};

export const ROTULOS_DAS_PRIORIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

/* `classe` é a do `.selo-situacao`: a cor sempre vem acompanhada do texto. */
export const SITUACOES = {
  'sem-documento': { rotulo: 'Sem documento', classe: '' },
  enviado: { rotulo: 'Documento enviado', classe: 'atencao' },
  analisando: { rotulo: 'Analisando com a IA…', classe: 'atencao' },
  analisado: { rotulo: 'Tarefas geradas', classe: 'ok' },
  falhou: { rotulo: 'Análise falhou', classe: 'erro' },
};

const EXTENSOES_ACEITAS = ['.docx', '.pdf', '.md', '.markdown', '.txt'];
const TAMANHO_MAXIMO_DO_ARQUIVO = 20 * 1024 * 1024;
const INTERVALO_DA_CONSULTA_DA_ANALISE_MS = 4000;
/* Uma rajada de mudanças (o agente moveu e anotou, a IA gravou dez tarefas) vira uma releitura. */
const ESPERA_PARA_RELER_MS = 300;
const TODAS_AS_DEMANDAS = 'todas';

/** Total de tarefas, concluídas e horas, para o resumo de um kanban ou de um projeto. */
export function progressoDasTarefas(tarefas) {
  let concluidas = 0;
  let horas = 0;
  let horasConcluidas = 0;
  for (const tarefa of tarefas) {
    horas += tarefa.estimativaHoras;
    if (tarefa.estado === 'concluido') {
      concluidas += 1;
      horasConcluidas += tarefa.estimativaHoras;
    }
  }
  return { total: tarefas.length, concluidas, horas, horasConcluidas };
}

/**
 * Os cartões de uma coluna, na ordem em que aparecem. Com mais de um kanban na tela,
 * a ordem de cada um é a dele (`ordem`), e o desempate é pelo kanban: assim os cartões
 * de cada um continuam na ordem relativa certa.
 */
export function cartoesDaColuna(tarefas, estado) {
  return tarefas
    .filter((tarefa) => tarefa.estado === estado)
    .sort((uma, outra) => uma.ordem - outra.ordem || uma.demandaId - outra.demandaId);
}

/**
 * A posição que o servidor espera ao soltar um cartão: contada só entre os cartões do
 * mesmo kanban, porque a ordem é guardada por kanban. `antes` é o cartão sobre o qual
 * ele foi solto (`null` no fim da coluna).
 */
export function indiceAoSoltar(cartoesNaColuna, movida, antes) {
  let indice = 0;
  for (const cartao of cartoesNaColuna) {
    if (antes && cartao.id === antes.id) {
      break;
    }
    if (cartao.id !== movida.id && cartao.demandaId === movida.demandaId) {
      indice += 1;
    }
  }
  return indice;
}

function formatarHoras(horas) {
  return `${Number.isInteger(horas) ? horas : horas.toFixed(1).replace('.', ',')} h`;
}

function horario(iso) {
  return iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
}

/** A situação do arquivo de tarefas numa frase, para a janela de edição e a linha do kanban. */
export function descreverArquivo(arquivo) {
  if (!arquivo) return '';
  if (arquivo.erro && !arquivo.caminho) return arquivo.erro;
  const partes = [`Arquivo de tarefas: ${arquivo.caminho}`];
  if (arquivo.sincronizadoEm) partes.push(`gravado às ${horario(arquivo.sincronizadoEm)}`);
  if (arquivo.mudancasImportadas > 0) {
    const plural = arquivo.mudancasImportadas === 1 ? 'mudança veio' : 'mudanças vieram';
    partes.push(
      `${arquivo.mudancasImportadas} ${plural} do arquivo (última às ${horario(arquivo.importadoEm)})`,
    );
  }
  if (arquivo.gitignore) partes.push('a pasta Tarefas está no .gitignore do repositório');
  const frase = `${partes.join(' · ')}.`;
  return arquivo.erro ? `${frase} Atenção: ${arquivo.erro}` : frase;
}

function lerArquivoEmBase64(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Liga o kanban à tela. `dependencias` traz o que o `app.js` já tem pronto; o retorno
 * é o que ele chama ao montar a aba Projetos e ao excluir um projeto.
 */
export function iniciarKanban(dependencias) {
  const {
    requisitar,
    criarElemento,
    criarBotao,
    criarBotaoDeIcone,
    ICONES,
    exibirAviso,
    exibirErro,
    limparErro,
    selecionarPasta,
    clienteSelecionado,
    excluirProjetoSemKanban,
  } = dependencias;

  const api = {
    doCliente: (idDoCliente) => requisitar(`/api/clientes/${idDoCliente}/kanbans`),
    criar: (idDoCliente, corpo) =>
      requisitar(`/api/clientes/${idDoCliente}/kanbans`, { metodo: 'POST', corpo }),
    alterar: (id, corpo) => requisitar(`/api/kanban/demandas/${id}`, { metodo: 'PUT', corpo }),
    excluir: (id) => requisitar(`/api/kanban/demandas/${id}`, { metodo: 'DELETE' }),
    anexarDocumento: (id, corpo) =>
      requisitar(`/api/kanban/demandas/${id}/documento`, { metodo: 'PUT', corpo }),
    removerDocumento: (id) =>
      requisitar(`/api/kanban/demandas/${id}/documento`, { metodo: 'DELETE' }),
    textoDoDocumento: (id) => requisitar(`/api/kanban/demandas/${id}/documento/texto`),
    analisar: (id) => requisitar(`/api/kanban/demandas/${id}/analisar`, { metodo: 'POST' }),
    definirMcp: (id, ligado) =>
      requisitar(`/api/kanban/demandas/${id}/mcp`, { metodo: 'PUT', corpo: { ligado } }),
    configuracaoDoMcp: () => requisitar('/api/mcp/configuracao'),
    kanbansNoMcp: () => requisitar('/api/mcp/kanbans'),
    criarTarefa: (id, corpo) =>
      requisitar(`/api/kanban/demandas/${id}/tarefas`, { metodo: 'POST', corpo }),
    alterarTarefa: (id, corpo) => requisitar(`/api/kanban/tarefas/${id}`, { metodo: 'PUT', corpo }),
    moverTarefa: (id, corpo) =>
      requisitar(`/api/kanban/tarefas/${id}/mover`, { metodo: 'POST', corpo }),
    excluirTarefa: (id) => requisitar(`/api/kanban/tarefas/${id}`, { metodo: 'DELETE' }),
    excluirProjeto: (idDoCliente, idDoProjeto, kanbans) =>
      requisitar(`/api/clientes/${idDoCliente}/projetos/${idDoProjeto}?kanbans=${kanbans}`, {
        metodo: 'DELETE',
      }),
  };

  const el = (id) => document.getElementById(id);
  const elementos = {
    modalQuadro: el('modal-kanban'),
    tituloQuadro: el('titulo-kanban'),
    subtituloQuadro: el('subtitulo-kanban'),
    campoDemanda: el('campo-kanban-demanda'),
    botaoNovaTarefa: el('btn-kanban-nova-tarefa'),
    botaoDocumento: el('btn-kanban-documento'),
    botaoAnalisar: el('btn-kanban-analisar'),
    situacaoQuadro: el('situacao-kanban'),
    resumoQuadro: el('resumo-kanban'),
    textoResumo: el('texto-resumo-kanban'),
    colunas: el('colunas-kanban'),
    botaoFecharQuadro: el('btn-fechar-kanban'),

    modalNovo: el('modal-kanban-novo'),
    formularioNovo: el('formulario-kanban-novo'),
    tituloNovo: el('titulo-kanban-novo'),
    subtituloNovo: el('subtitulo-kanban-novo'),
    grupoModo: el('grupo-kanban-modo'),
    modoDocumento: el('campo-kanban-modo-documento'),
    modoVazio: el('campo-kanban-modo-vazio'),
    blocoArquivo: el('bloco-kanban-arquivo'),
    campoArquivo: el('campo-kanban-arquivo'),
    blocoPasta: el('bloco-kanban-pasta'),
    campoPasta: el('campo-kanban-pasta'),
    botaoEscolherPasta: el('btn-kanban-escolher-pasta'),
    blocoAnalisar: el('bloco-kanban-analisar'),
    campoAnalisar: el('campo-kanban-analisar'),
    erroNovo: el('erro-kanban-novo'),
    botaoSalvarNovo: el('btn-salvar-kanban-novo'),
    botaoCancelarNovo: el('btn-cancelar-kanban-novo'),

    modalEditar: el('modal-kanban-editar'),
    formularioEditar: el('formulario-kanban-editar'),
    subtituloEditar: el('subtitulo-kanban-editar'),
    blocoEditarNome: el('bloco-kanban-editar-nome'),
    campoEditarNome: el('campo-kanban-editar-nome'),
    campoEditarProjeto: el('campo-kanban-editar-projeto'),
    campoEditarPasta: el('campo-kanban-editar-pasta'),
    botaoEditarEscolherPasta: el('btn-kanban-editar-escolher-pasta'),
    blocoEditarDocumento: el('bloco-kanban-editar-documento'),
    textoEditarDocumento: el('texto-kanban-editar-documento'),
    botaoRemoverDocumento: el('btn-kanban-remover-documento'),
    campoEditarMcp: el('campo-kanban-editar-mcp'),
    situacaoEditarArquivo: el('situacao-kanban-editar-arquivo'),

    configuracaoMcp: el('configuracao-kanban-mcp'),
    botaoCopiarConfiguracaoMcp: el('btn-copiar-configuracao-kanban-mcp'),
    listaMcp: el('lista-kanbans-mcp'),
    erroEditar: el('erro-kanban-editar'),
    botaoSalvarEditar: el('btn-salvar-kanban-editar'),
    botaoCancelarEditar: el('btn-cancelar-kanban-editar'),

    modalTarefa: el('modal-kanban-tarefa'),
    formularioTarefa: el('formulario-kanban-tarefa'),
    tituloTarefa: el('titulo-kanban-tarefa'),
    blocoTarefaDemanda: el('bloco-kanban-tarefa-demanda'),
    campoTarefaDemanda: el('campo-kanban-tarefa-demanda'),
    campoTarefaTitulo: el('campo-kanban-tarefa-titulo'),
    campoTarefaDescricao: el('campo-kanban-tarefa-descricao'),
    campoTarefaGrupo: el('campo-kanban-tarefa-grupo'),
    campoTarefaTipo: el('campo-kanban-tarefa-tipo'),
    campoTarefaPrioridade: el('campo-kanban-tarefa-prioridade'),
    campoTarefaHoras: el('campo-kanban-tarefa-horas'),
    campoTarefaEstado: el('campo-kanban-tarefa-estado'),
    campoTarefaCriterios: el('campo-kanban-tarefa-criterios'),
    campoTarefaNotas: el('campo-kanban-tarefa-notas'),
    listaTarefa: el('lista-kanban-tarefa'),
    progressoListaTarefa: el('progresso-kanban-tarefa-lista'),
    campoNovoItem: el('campo-kanban-tarefa-novo-item'),
    botaoAdicionarItem: el('btn-kanban-tarefa-adicionar-item'),
    erroTarefa: el('erro-kanban-tarefa'),
    botaoExcluirTarefa: el('btn-excluir-kanban-tarefa'),
    botaoSalvarTarefa: el('btn-salvar-kanban-tarefa'),
    botaoCancelarTarefa: el('btn-cancelar-kanban-tarefa'),

    modalDocumento: el('modal-kanban-documento'),
    tituloDocumento: el('titulo-kanban-documento'),
    abasDocumento: el('abas-kanban-documento'),
    abaTexto: el('aba-kanban-documento-texto'),
    abaOriginal: el('aba-kanban-documento-original'),
    textoDocumento: el('texto-kanban-documento'),
    originalDocumento: el('original-kanban-documento'),
    linkBaixarDocumento: el('link-kanban-baixar-documento'),
    botaoFecharDocumento: el('btn-fechar-kanban-documento'),

    modalExclusaoProjeto: el('modal-kanban-exclusao-projeto'),
    textoExclusaoProjeto: el('texto-kanban-exclusao-projeto'),
    campoManter: el('campo-kanban-exclusao-manter'),
    campoExcluirJunto: el('campo-kanban-exclusao-excluir'),
    erroExclusaoProjeto: el('erro-kanban-exclusao-projeto'),
    botaoConfirmarExclusaoProjeto: el('btn-confirmar-kanban-exclusao-projeto'),
    botaoCancelarExclusaoProjeto: el('btn-cancelar-kanban-exclusao-projeto'),
  };

  /* Dados do cliente selecionado. `consulta` é a leitura em andamento, para não repetir. */
  const cache = { idDoCliente: null, dados: null, erro: null, consulta: null, temporizador: null };
  /* Seções montadas na tela: redesenhadas quando os dados chegam ou mudam. */
  const secoes = new Set();
  /* O quadro aberto: projeto (ou `null`, para uma órfã) e o filtro de kanban. */
  const quadro = { projetoId: null, demandaId: TODAS_AS_DEMANDAS, arrastada: null };
  /* O que cada janela de formulário está editando. */
  let novoEmAndamento = null;
  let edicaoEmAndamento = null;
  let tarefaEmEdicao = null;
  /* A lista de verificação da janela da tarefa, editada até o Salvar. */
  let listaEmEdicao = [];
  let exclusaoDeProjetoPendente = null;

  // --- dados ----------------------------------------------------------------------

  function dadosDoCliente(idDoCliente) {
    return cache.idDoCliente === idDoCliente ? cache.dados : null;
  }

  function demandasDoProjeto(idDoCliente, projetoId) {
    return (dadosDoCliente(idDoCliente)?.demandas ?? []).filter(
      (demanda) => demanda.projetoId === projetoId,
    );
  }

  function tarefasDasDemandas(idDoCliente, demandas) {
    const ids = new Set(demandas.map((demanda) => demanda.id));
    return (dadosDoCliente(idDoCliente)?.tarefas ?? []).filter((tarefa) =>
      ids.has(tarefa.demandaId),
    );
  }

  function demandaPorId(id) {
    return cache.dados?.demandas.find((demanda) => demanda.id === id) ?? null;
  }

  /** Lê os kanbans do cliente e redesenha o que estiver na tela. */
  function carregar(idDoCliente, { forcar = false } = {}) {
    if (cache.idDoCliente !== idDoCliente) {
      clearTimeout(cache.temporizador);
      Object.assign(cache, { idDoCliente, dados: null, erro: null, consulta: null });
    }
    if (cache.consulta || (cache.dados && !forcar)) {
      return cache.consulta ?? Promise.resolve();
    }

    cache.consulta = api
      .doCliente(idDoCliente)
      .then((dados) => {
        if (cache.idDoCliente !== idDoCliente) return;
        cache.dados = dados;
        cache.erro = null;
      })
      .catch((erro) => {
        if (cache.idDoCliente !== idDoCliente) return;
        cache.erro = erro.message;
      })
      .finally(() => {
        if (cache.idDoCliente !== idDoCliente) return;
        cache.consulta = null;
        redesenhar();
        acompanharAnalises(idDoCliente);
      });
    return cache.consulta;
  }

  /* Enquanto a IA trabalha, relê sozinho; para quando nada mais está em análise. */
  function acompanharAnalises(idDoCliente) {
    clearTimeout(cache.temporizador);
    const analisando = cache.dados?.demandas.some((demanda) => demanda.situacao === 'analisando');
    if (!analisando) return;
    cache.temporizador = setTimeout(() => {
      if (clienteSelecionado()?.id === idDoCliente) {
        carregar(idDoCliente, { forcar: true });
      }
    }, INTERVALO_DA_CONSULTA_DA_ANALISE_MS);
  }

  async function recarregar() {
    if (cache.idDoCliente) {
      await carregar(cache.idDoCliente, { forcar: true });
    }
  }

  function redesenhar() {
    for (const secao of [...secoes]) {
      if (!secao.elemento.isConnected) {
        secoes.delete(secao);
        continue;
      }
      secao.desenhar();
    }
    if (elementos.modalQuadro.open) {
      desenharQuadro();
    }
  }

  /** Seção que se redesenha sozinha quando os dados do kanban mudam. */
  function criarSecaoViva(classe, desenharConteudo) {
    const elemento = criarElemento('div', classe);
    const secao = {
      elemento,
      desenhar: () => elemento.replaceChildren(...desenharConteudo()),
    };
    secoes.add(secao);
    secao.desenhar();
    return elemento;
  }

  // --- seção do projeto e das órfãs -------------------------------------------------

  function criarSeloDeSituacao(demanda) {
    const situacao = SITUACOES[demanda.situacao] ?? SITUACOES['sem-documento'];
    const selo = criarElemento('span', `selo-situacao ${situacao.classe}`.trim(), situacao.rotulo);
    if (demanda.situacao === 'falhou' && demanda.erro) {
      selo.title = demanda.erro;
    }
    return selo;
  }

  function criarLinhaDeKanban(cliente, demanda) {
    const tarefas = tarefasDasDemandas(cliente.id, [demanda]);
    const progresso = progressoDasTarefas(tarefas);

    const detalhes = criarElemento('div', 'detalhes-kanban');
    detalhes.append(criarSeloDeSituacao(demanda));
    if (demanda.mcp) {
      const selo = criarElemento('span', 'selo-situacao ok', 'MCP');
      selo.title = 'Disponível para agentes de IA pelo servidor MCP do HUB SNK';
      detalhes.append(selo);
    }
    if (demanda.pasta) {
      const comErro = Boolean(demanda.arquivo?.erro);
      const selo = criarElemento('span', `selo-situacao ${comErro ? 'erro' : 'ok'}`, 'Arquivo');
      selo.title = descreverArquivo(demanda.arquivo) || `Pasta: ${demanda.pasta}`;
      detalhes.append(selo);
    }
    const partes = [];
    if (progresso.total > 0) {
      partes.push(
        `${progresso.concluidas}/${progresso.total} concluídas`,
        formatarHoras(progresso.horas),
      );
    } else {
      partes.push('Nenhuma tarefa');
    }
    if (demanda.documento) {
      partes.push(demanda.documento.nome);
    }
    detalhes.append(criarElemento('span', 'texto-auxiliar', partes.join(' · ')));

    const informacoes = criarElemento('div', 'recurso-info');
    // Com projeto, o nome do kanban é o do projeto, já escrito no card: só a órfã o mostra.
    if (!demanda.projetoId) {
      const nome = criarBotao('nome-recurso link-kanban', demanda.nome, () =>
        abrirQuadro(cliente, null, demanda.id),
      );
      nome.title = 'Abrir o quadro';
      informacoes.append(nome);
    }
    informacoes.append(detalhes);
    if (demanda.situacao === 'falhou' && demanda.erro) {
      informacoes.append(criarElemento('p', 'erro-kanban', demanda.erro));
    }

    const acoes = criarElemento('div', 'recurso-acoes');
    const linhaDeAcoes = criarElemento('div', 'recurso-acoes-linha');
    linhaDeAcoes.append(
      criarBotaoDeIcone('btn tiny primario', ICONES.seta, 'Abrir o quadro', () =>
        abrirQuadro(cliente, demanda.projetoId || null, demanda.id),
      ),
    );
    if (demanda.documento) {
      // Documento parado (sem análise, ou com análise que falhou) ganha o atalho para a IA.
      if (demanda.situacao === 'enviado' || demanda.situacao === 'falhou') {
        linhaDeAcoes.append(
          criarBotao('btn tiny', 'Gerar tarefas', () => analisarDemanda(demanda)),
        );
      }
      linhaDeAcoes.append(
        criarBotaoDeIcone('btn tiny', ICONES.log, 'Ver o documento', () => abrirDocumento(demanda)),
      );
    }
    linhaDeAcoes.append(
      criarBotaoDeIcone(
        'btn tiny',
        ICONES.exportar,
        demanda.documento ? 'Trocar o documento' : 'Inserir documento para gerar as tarefas',
        () => abrirNovo(cliente, { anexarA: demanda }),
      ),
      criarBotaoDeIcone('btn tiny', ICONES.lapis, 'Editar o kanban', () =>
        abrirEdicao(cliente, demanda),
      ),
      criarBotaoDeIcone('btn tiny danger', ICONES.lixeira, 'Excluir o kanban', () =>
        pedirExclusaoDeKanban(demanda),
      ),
    );
    acoes.append(linhaDeAcoes);

    const linha = criarElemento('div', 'linha-recurso linha-kanban');
    linha.append(informacoes, acoes);
    return linha;
  }

  function conteudoEnquantoCarrega(cliente) {
    if (cache.erro && cache.idDoCliente === cliente.id) {
      const erro = criarElemento('p', 'secao-vazia', `Kanbans indisponíveis: ${cache.erro}`);
      return [
        erro,
        criarBotao('btn tiny', 'Tentar de novo', () => carregar(cliente.id, { forcar: true })),
      ];
    }
    return [criarElemento('p', 'secao-vazia', 'Carregando kanbans…')];
  }

  /** A seção "Kanban" dentro do card do projeto: um kanban por projeto. */
  function criarSecaoDoProjeto(cliente, projeto) {
    carregar(cliente.id);
    return criarSecaoViva('secao-recursos secao-kanbans', () => {
      const cabecalho = criarElemento('div', 'secao-cabecalho');
      cabecalho.append(criarElemento('h3', null, 'Kanban'));

      if (!dadosDoCliente(cliente.id)) {
        return [cabecalho, ...conteudoEnquantoCarrega(cliente)];
      }

      const demandas = demandasDoProjeto(cliente.id, projeto.id);
      if (demandas.length === 0) {
        cabecalho.append(
          criarBotaoDeIcone('btn tiny primario', ICONES.mais, 'Novo kanban', () =>
            abrirNovo(cliente, { projetoId: projeto.id }),
          ),
        );
        return [
          cabecalho,
          criarElemento(
            'p',
            'secao-vazia',
            'Nenhum kanban. Crie no +: com o documento de escopo, a IA gera as tarefas.',
          ),
        ];
      }

      const lista = criarElemento('div', 'lista-recursos');
      lista.append(...demandas.map((demanda) => criarLinhaDeKanban(cliente, demanda)));
      return [cabecalho, lista];
    });
  }

  /** Bloco "Kanbans sem projeto", no fim da aba Projetos: some quando não há órfã. */
  function criarSecaoDeOrfaos(cliente) {
    carregar(cliente.id);
    return criarSecaoViva('secao-kanbans-orfaos', () => {
      const orfas = demandasDoProjeto(cliente.id, '');
      if (orfas.length === 0) {
        return [];
      }
      const cabecalho = criarElemento('div', 'secao-cabecalho');
      cabecalho.append(criarElemento('h3', null, 'Kanbans sem projeto'));
      const explicacao = criarElemento(
        'p',
        'texto-auxiliar',
        'O projeto destes kanbans foi excluído. Vincule cada um a outro projeto, ou dê um nome que o identifique.',
      );
      const lista = criarElemento('div', 'lista-recursos');
      lista.append(...orfas.map((demanda) => criarLinhaDeKanban(cliente, demanda)));
      const card = criarElemento('div', 'card card-projeto card-kanbans-orfaos');
      card.append(cabecalho, explicacao, lista);
      return [card];
    });
  }

  // --- quadro ---------------------------------------------------------------------

  function demandasDoQuadro() {
    const cliente = clienteSelecionado();
    if (!cliente) return [];
    const doProjeto = demandasDoProjeto(cliente.id, quadro.projetoId ?? '');
    if (quadro.demandaId === TODAS_AS_DEMANDAS) return doProjeto;
    return doProjeto.filter((demanda) => demanda.id === quadro.demandaId);
  }

  function abrirQuadro(cliente, projetoId, demandaId) {
    quadro.projetoId = projetoId;
    quadro.demandaId = demandaId;
    const projeto = cliente.projetos.find((item) => item.id === projetoId);
    elementos.tituloQuadro.textContent = projeto ? projeto.nome : 'Kanban sem projeto';
    elementos.subtituloQuadro.textContent = cliente.nome;
    desenharQuadro();
    if (!elementos.modalQuadro.open) {
      elementos.modalQuadro.showModal();
    }
  }

  function desenharSeletorDeDemanda(cliente) {
    const doProjeto = demandasDoProjeto(cliente.id, quadro.projetoId ?? '');
    const opcoes = [];
    // Órfã é sempre vista sozinha: duas órfãs não têm nada em comum além de não ter projeto.
    if (quadro.projetoId && doProjeto.length > 1) {
      opcoes.push(new Option('Todos os kanbans do projeto', TODAS_AS_DEMANDAS));
    }
    for (const demanda of doProjeto) {
      opcoes.push(new Option(demanda.nome, String(demanda.id)));
    }
    elementos.campoDemanda.replaceChildren(...opcoes);
    elementos.campoDemanda.value = String(quadro.demandaId);
    elementos.campoDemanda.hidden = opcoes.length <= 1;
  }

  function criarCartao(tarefa, mostrarDemanda) {
    const cartao = criarElemento('div', 'cartao-kanban');
    cartao.draggable = true;
    cartao.tabIndex = 0;
    cartao.dataset.id = String(tarefa.id);
    cartao.setAttribute('role', 'button');
    cartao.setAttribute('aria-label', `${tarefa.titulo}: abrir tarefa`);

    if (mostrarDemanda) {
      const demanda = demandaPorId(tarefa.demandaId);
      if (demanda) cartao.append(criarElemento('span', 'cartao-kanban-demanda', demanda.nome));
    }
    cartao.append(criarElemento('p', 'cartao-kanban-titulo', tarefa.titulo));

    const selos = criarElemento('div', 'cartao-kanban-selos');
    selos.append(
      criarElemento('span', 'selo-kanban', ROTULOS_DOS_TIPOS[tarefa.tipo] ?? tarefa.tipo),
      criarElemento(
        'span',
        `selo-kanban prioridade-${tarefa.prioridade}`,
        ROTULOS_DAS_PRIORIDADES[tarefa.prioridade] ?? tarefa.prioridade,
      ),
    );
    if (tarefa.estimativaHoras > 0) {
      selos.append(criarElemento('span', 'selo-kanban', formatarHoras(tarefa.estimativaHoras)));
    }
    if (tarefa.checklist?.length) {
      const feitos = tarefa.checklist.filter((item) => item.feito).length;
      const completa = feitos === tarefa.checklist.length;
      const selo = criarElemento(
        'span',
        `selo-kanban${completa ? ' lista-completa' : ''}`,
        `✓ ${feitos}/${tarefa.checklist.length}`,
      );
      selo.title = 'Itens da lista de verificação marcados';
      selos.append(selo);
    }
    if (tarefa.grupo) {
      const grupo = criarElemento('span', 'selo-kanban grupo', tarefa.grupo);
      grupo.title = 'Grupo';
      selos.append(grupo);
    }
    cartao.append(selos);

    cartao.addEventListener('click', () => abrirTarefa(tarefa));
    cartao.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') {
        evento.preventDefault();
        abrirTarefa(tarefa);
      }
    });
    cartao.addEventListener('dragstart', (evento) => {
      quadro.arrastada = tarefa;
      evento.dataTransfer.effectAllowed = 'move';
      evento.dataTransfer.setData('text/plain', String(tarefa.id));
      requestAnimationFrame(() => cartao.classList.add('arrastando'));
    });
    cartao.addEventListener('dragend', () => {
      quadro.arrastada = null;
      cartao.classList.remove('arrastando');
      for (const marcada of elementos.colunas.querySelectorAll('.alvo-do-arrasto')) {
        marcada.classList.remove('alvo-do-arrasto');
      }
    });
    return cartao;
  }

  /** O cartão diante do qual o arrastado cai, pela altura do ponteiro. */
  function cartaoSobOPonteiro(lista, y) {
    for (const cartao of lista.querySelectorAll('.cartao-kanban:not(.arrastando)')) {
      const caixa = cartao.getBoundingClientRect();
      if (y < caixa.top + caixa.height / 2) {
        return cartao;
      }
    }
    return null;
  }

  function criarColuna(coluna, tarefas, mostrarDemanda) {
    const cartoes = cartoesDaColuna(tarefas, coluna.estado);
    const progresso = progressoDasTarefas(cartoes);

    const cabecalho = criarElemento('div', 'coluna-kanban-cabecalho');
    cabecalho.append(
      criarElemento('h3', null, coluna.rotulo),
      criarElemento(
        'span',
        'texto-auxiliar',
        progresso.horas > 0
          ? `${cartoes.length} · ${formatarHoras(progresso.horas)}`
          : String(cartoes.length),
      ),
    );

    const lista = criarElemento('div', 'coluna-kanban-cartoes');
    lista.append(...cartoes.map((tarefa) => criarCartao(tarefa, mostrarDemanda)));
    if (cartoes.length === 0) {
      lista.append(criarElemento('p', 'coluna-kanban-vazia', 'Arraste uma tarefa para cá.'));
    }

    const elemento = criarElemento('section', 'coluna-kanban');
    elemento.setAttribute('aria-label', coluna.rotulo);
    elemento.append(cabecalho, lista);

    elemento.addEventListener('dragover', (evento) => {
      if (!quadro.arrastada) return;
      evento.preventDefault();
      evento.dataTransfer.dropEffect = 'move';
      elemento.classList.add('alvo-do-arrasto');
    });
    elemento.addEventListener('dragleave', (evento) => {
      if (!elemento.contains(evento.relatedTarget)) {
        elemento.classList.remove('alvo-do-arrasto');
      }
    });
    elemento.addEventListener('drop', (evento) => {
      evento.preventDefault();
      elemento.classList.remove('alvo-do-arrasto');
      const movida = quadro.arrastada;
      if (!movida) return;
      const antesDoElemento = cartaoSobOPonteiro(lista, evento.clientY);
      const antes = antesDoElemento
        ? cartoes.find((cartao) => String(cartao.id) === antesDoElemento.dataset.id)
        : null;
      soltarTarefa(movida, coluna.estado, indiceAoSoltar(cartoes, movida, antes ?? null));
    });
    return elemento;
  }

  async function soltarTarefa(tarefa, estado, indice) {
    // Redesenha já na posição nova; a resposta do servidor confirma (ou desfaz) em seguida.
    const local = cache.dados?.tarefas.find((item) => item.id === tarefa.id);
    if (local) {
      local.estado = estado;
      local.ordem = indice - 0.5;
      desenharQuadro();
    }
    try {
      await api.moverTarefa(tarefa.id, { estado, indice });
    } catch (erro) {
      exibirAviso(`Não foi possível mover a tarefa: ${erro.message}`, 'erro');
    }
    await recarregar();
  }

  function desenharQuadro() {
    const cliente = clienteSelecionado();
    if (!cliente || !dadosDoCliente(cliente.id)) {
      elementos.colunas.replaceChildren(criarElemento('p', 'secao-vazia', 'Carregando…'));
      return;
    }

    // O kanban filtrado pode ter sido excluído, ou vinculado a outro projeto.
    const doProjeto = demandasDoProjeto(cliente.id, quadro.projetoId ?? '');
    if (
      quadro.demandaId !== TODAS_AS_DEMANDAS &&
      !doProjeto.some((demanda) => demanda.id === quadro.demandaId)
    ) {
      quadro.demandaId =
        doProjeto.length > 1 && quadro.projetoId ? TODAS_AS_DEMANDAS : (doProjeto[0]?.id ?? null);
    }
    if (doProjeto.length === 0) {
      elementos.modalQuadro.close();
      return;
    }

    desenharSeletorDeDemanda(cliente);
    const demandas = demandasDoQuadro();
    const tarefas = tarefasDasDemandas(cliente.id, demandas);
    const unica = demandas.length === 1 ? demandas[0] : null;

    // Documento, análise e resumo só fazem sentido olhando um kanban.
    elementos.botaoDocumento.hidden = !unica?.documento;
    elementos.botaoAnalisar.hidden = !unica?.documento;
    elementos.botaoAnalisar.disabled = unica?.situacao === 'analisando';
    elementos.botaoAnalisar.textContent =
      unica?.situacao === 'analisado' ? 'Analisar de novo' : 'Gerar tarefas com a IA';

    elementos.situacaoQuadro.replaceChildren();
    if (unica) {
      elementos.situacaoQuadro.append(criarSeloDeSituacao(unica));
      if (unica.situacao === 'falhou' && unica.erro) {
        elementos.situacaoQuadro.append(criarElemento('span', 'erro-kanban', unica.erro));
      }
      if (unica.assistente && unica.situacao === 'analisado') {
        const assistente = NOMES_DOS_ASSISTENTES[unica.assistente] ?? unica.assistente;
        const origem = unica.modelo ? `${assistente} · ${unica.modelo}` : assistente;
        elementos.situacaoQuadro.append(
          criarElemento('span', 'texto-auxiliar', `Gerado por ${origem}`),
        );
      }
    }
    const progresso = progressoDasTarefas(tarefas);
    if (progresso.total > 0) {
      elementos.situacaoQuadro.append(
        criarElemento(
          'span',
          'texto-auxiliar',
          `${progresso.concluidas}/${progresso.total} concluídas · ${formatarHoras(progresso.horasConcluidas)} de ${formatarHoras(progresso.horas)}`,
        ),
      );
    }

    elementos.resumoQuadro.hidden = !unica?.resumo;
    elementos.textoResumo.textContent = unica?.resumo ?? '';

    const mostrarDemanda = demandas.length > 1;
    elementos.colunas.replaceChildren(
      ...COLUNAS.map((coluna) => criarColuna(coluna, tarefas, mostrarDemanda)),
    );
  }

  // --- tarefa ---------------------------------------------------------------------

  function preencherOpcoesDaTarefa() {
    if (elementos.campoTarefaTipo.options.length === 0) {
      for (const [valor, rotulo] of Object.entries(ROTULOS_DOS_TIPOS)) {
        elementos.campoTarefaTipo.append(new Option(rotulo, valor));
      }
      for (const [valor, rotulo] of Object.entries(ROTULOS_DAS_PRIORIDADES)) {
        elementos.campoTarefaPrioridade.append(new Option(rotulo, valor));
      }
      for (const coluna of COLUNAS) {
        elementos.campoTarefaEstado.append(new Option(coluna.rotulo, coluna.estado));
      }
    }
  }

  function abrirTarefa(tarefa, demandaPadrao = null) {
    preencherOpcoesDaTarefa();
    limparErro(elementos.erroTarefa);
    tarefaEmEdicao = tarefa;
    const demandas = demandasDoQuadro();

    elementos.tituloTarefa.textContent = tarefa ? 'Tarefa' : 'Nova tarefa';
    elementos.campoTarefaDemanda.replaceChildren(
      ...demandas.map((demanda) => new Option(demanda.nome, String(demanda.id))),
    );
    // O kanban da tarefa só se escolhe ao criar, e só quando há mais de um na tela.
    elementos.blocoTarefaDemanda.hidden = Boolean(tarefa) || demandas.length <= 1;
    elementos.campoTarefaDemanda.value = String(demandaPadrao ?? demandas[0]?.id ?? '');

    elementos.campoTarefaTitulo.value = tarefa?.titulo ?? '';
    elementos.campoTarefaDescricao.value = tarefa?.descricao ?? '';
    elementos.campoTarefaGrupo.value = tarefa?.grupo ?? '';
    elementos.campoTarefaTipo.value = tarefa?.tipo ?? 'outro';
    elementos.campoTarefaPrioridade.value = tarefa?.prioridade ?? 'media';
    elementos.campoTarefaHoras.value = tarefa ? String(tarefa.estimativaHoras) : '';
    elementos.campoTarefaEstado.value = tarefa?.estado ?? 'backlog';
    elementos.campoTarefaCriterios.value = tarefa?.criteriosDeAceite ?? '';
    elementos.campoTarefaNotas.value = tarefa?.notas ?? '';
    listaEmEdicao = (tarefa?.checklist ?? []).map((item) => ({ ...item }));
    elementos.campoNovoItem.value = '';
    desenharLista();
    elementos.botaoExcluirTarefa.hidden = !tarefa;

    elementos.modalTarefa.showModal();
    elementos.campoTarefaTitulo.focus();
  }

  async function salvarTarefa(evento) {
    evento.preventDefault();
    const titulo = elementos.campoTarefaTitulo.value.trim();
    if (!titulo) {
      exibirErro(elementos.erroTarefa, 'Informe o título da tarefa.');
      return;
    }
    const horas = elementos.campoTarefaHoras.value.trim().replace(',', '.');
    const dados = {
      titulo,
      descricao: elementos.campoTarefaDescricao.value,
      grupo: elementos.campoTarefaGrupo.value.trim(),
      tipo: elementos.campoTarefaTipo.value,
      prioridade: elementos.campoTarefaPrioridade.value,
      estimativaHoras: horas === '' ? 0 : Number(horas),
      criteriosDeAceite: elementos.campoTarefaCriterios.value,
      notas: elementos.campoTarefaNotas.value,
      checklist: listaEmEdicao
        .map((item) => ({ texto: item.texto.trim(), feito: item.feito }))
        .filter((item) => item.texto),
    };
    if (!Number.isFinite(dados.estimativaHoras) || dados.estimativaHoras < 0) {
      exibirErro(elementos.erroTarefa, 'A estimativa deve ser um número de horas.');
      return;
    }

    limparErro(elementos.erroTarefa);
    elementos.botaoSalvarTarefa.disabled = true;
    try {
      const estado = elementos.campoTarefaEstado.value;
      if (tarefaEmEdicao) {
        await api.alterarTarefa(tarefaEmEdicao.id, dados);
        if (estado !== tarefaEmEdicao.estado) {
          await api.moverTarefa(tarefaEmEdicao.id, { estado });
        }
      } else {
        await api.criarTarefa(Number(elementos.campoTarefaDemanda.value), { ...dados, estado });
      }
      elementos.modalTarefa.close();
      await recarregar();
    } catch (erro) {
      exibirErro(elementos.erroTarefa, erro.message);
    } finally {
      elementos.botaoSalvarTarefa.disabled = false;
    }
  }

  async function excluirTarefa() {
    if (!tarefaEmEdicao) return;
    // O botão pede confirmação no próprio lugar: um segundo clique em "Confirmar exclusão".
    if (elementos.botaoExcluirTarefa.dataset.confirmar !== 'sim') {
      elementos.botaoExcluirTarefa.dataset.confirmar = 'sim';
      elementos.botaoExcluirTarefa.textContent = 'Confirmar exclusão';
      return;
    }
    elementos.botaoExcluirTarefa.disabled = true;
    try {
      await api.excluirTarefa(tarefaEmEdicao.id);
      elementos.modalTarefa.close();
      exibirAviso('Tarefa excluída.');
      await recarregar();
    } catch (erro) {
      exibirErro(elementos.erroTarefa, erro.message);
    } finally {
      elementos.botaoExcluirTarefa.disabled = false;
    }
  }

  function desenharLista() {
    const feitos = listaEmEdicao.filter((item) => item.feito).length;
    elementos.progressoListaTarefa.textContent = listaEmEdicao.length
      ? `${feitos} de ${listaEmEdicao.length} feitos`
      : 'marque cada passo feito';
    elementos.listaTarefa.replaceChildren(
      ...listaEmEdicao.map((item, posicao) => {
        const linha = criarElemento('div', `item-kanban-tarefa${item.feito ? ' feito' : ''}`);
        const marcador = criarElemento('input');
        marcador.type = 'checkbox';
        marcador.checked = item.feito;
        marcador.setAttribute('aria-label', `Marcar "${item.texto}"`);
        marcador.addEventListener('change', () => {
          item.feito = marcador.checked;
          desenharLista();
        });
        // O texto fica editável no lugar: corrigir um item não pede apagar e criar de novo.
        const texto = criarElemento('input', 'texto-item-kanban-tarefa');
        texto.type = 'text';
        texto.maxLength = 300;
        texto.value = item.texto;
        texto.setAttribute('aria-label', `Item ${posicao + 1} da lista`);
        texto.addEventListener('input', () => {
          item.texto = texto.value;
        });
        texto.addEventListener('keydown', (evento) => {
          if (evento.key === 'Enter') evento.preventDefault();
        });
        const remover = criarBotaoDeIcone('btn tiny ghost', ICONES.lixeira, 'Tirar o item', () => {
          listaEmEdicao.splice(posicao, 1);
          desenharLista();
        });
        linha.append(marcador, texto, remover);
        return linha;
      }),
    );
  }

  function adicionarItem() {
    const texto = elementos.campoNovoItem.value.trim();
    if (!texto) return;
    if (listaEmEdicao.length >= 50) {
      exibirErro(elementos.erroTarefa, 'A lista tem no máximo 50 itens.');
      return;
    }
    listaEmEdicao.push({ texto, feito: false });
    elementos.campoNovoItem.value = '';
    desenharLista();
    elementos.campoNovoItem.focus();
  }

  function restaurarBotaoDeExcluirTarefa() {
    delete elementos.botaoExcluirTarefa.dataset.confirmar;
    elementos.botaoExcluirTarefa.textContent = 'Excluir';
  }

  // --- novo kanban e documento ------------------------------------------------------

  /** Projeto que já tem kanban fica desabilitado: cada projeto tem um só. */
  function preencherProjetos(campo, cliente, selecionado, comVazio) {
    const opcoes = cliente.projetos.map((projeto) => {
      const opcao = new Option(projeto.nome, projeto.id);
      opcao.disabled =
        projeto.id !== selecionado && demandasDoProjeto(cliente.id, projeto.id).length > 0;
      return opcao;
    });
    if (comVazio) {
      opcoes.unshift(new Option('Sem projeto (escolha um para vincular)', ''));
    }
    campo.replaceChildren(...opcoes);
    campo.value = selecionado ?? '';
  }

  function aplicarModoDoNovo() {
    const comDocumento = elementos.modoDocumento.checked;
    const anexando = Boolean(novoEmAndamento?.anexarA);
    elementos.blocoArquivo.hidden = !comDocumento;
    elementos.blocoAnalisar.hidden = !comDocumento;
    elementos.blocoPasta.hidden = comDocumento || anexando;
    elementos.botaoSalvarNovo.textContent = comDocumento
      ? elementos.campoAnalisar.checked
        ? 'Enviar e gerar tarefas'
        : 'Enviar'
      : 'Criar kanban';
  }

  /**
   * `projetoId` é o do projeto cujo + foi clicado: o kanban é sempre dele. `anexarA` é o
   * kanban que recebe (ou troca) o documento, quando o pedido sai da linha de um kanban.
   */
  function abrirNovo(cliente, { projetoId = null, modo = 'vazio', anexarA = null } = {}) {
    novoEmAndamento = { cliente, anexarA, projetoId };
    limparErro(elementos.erroNovo);
    elementos.formularioNovo.reset();

    elementos.tituloNovo.textContent = anexarA
      ? anexarA.documento
        ? 'Trocar o documento'
        : 'Inserir documento'
      : 'Novo kanban';
    elementos.subtituloNovo.textContent = anexarA
      ? 'As tarefas que já saíram do Backlog continuam no quadro.'
      : 'Com o documento de escopo, a IA gera as tarefas. Sem ele, o quadro começa vazio.';
    elementos.grupoModo.hidden = Boolean(anexarA);
    elementos.modoDocumento.checked = anexarA ? true : modo === 'documento';
    elementos.modoVazio.checked = !elementos.modoDocumento.checked;
    elementos.campoAnalisar.checked = true;
    aplicarModoDoNovo();

    elementos.modalNovo.showModal();
    (elementos.modoDocumento.checked ? elementos.campoArquivo : elementos.campoPasta).focus();
  }

  function arquivoEscolhido() {
    const arquivo = elementos.campoArquivo.files?.[0] ?? null;
    if (!arquivo) return { erro: 'Escolha o documento de escopo.' };
    const extensao = arquivo.name.slice(arquivo.name.lastIndexOf('.')).toLowerCase();
    if (extensao === '.doc')
      return { erro: 'O .doc do Word antigo não é suportado: salve como .docx ou .pdf.' };
    if (!EXTENSOES_ACEITAS.includes(extensao)) return { erro: 'Envie .docx, .pdf, .md ou .txt.' };
    if (arquivo.size > TAMANHO_MAXIMO_DO_ARQUIVO) return { erro: 'O arquivo passa de 20 MB.' };
    return { arquivo };
  }

  async function salvarNovo(evento) {
    evento.preventDefault();
    if (!novoEmAndamento) return;
    const { cliente, anexarA, projetoId } = novoEmAndamento;
    const comDocumento = elementos.modoDocumento.checked;
    const analisar = comDocumento && elementos.campoAnalisar.checked;

    let documento;
    if (comDocumento) {
      const { arquivo, erro } = arquivoEscolhido();
      if (erro) {
        exibirErro(elementos.erroNovo, erro);
        return;
      }
      documento = { nome: arquivo.name, conteudoBase64: await lerArquivoEmBase64(arquivo) };
    }

    limparErro(elementos.erroNovo);
    elementos.botaoSalvarNovo.disabled = true;
    try {
      let demanda;
      if (anexarA) {
        demanda = await api.anexarDocumento(anexarA.id, { ...documento, analisar });
      } else {
        demanda = await api.criar(cliente.id, {
          projetoId,
          ...(comDocumento
            ? { documento, analisar }
            : { pasta: elementos.campoPasta.value.trim() }),
        });
      }
      elementos.modalNovo.close();
      exibirAviso(
        analisar
          ? 'Documento enviado. A IA está gerando as tarefas; o quadro se atualiza sozinho.'
          : comDocumento
            ? 'Documento enviado.'
            : 'Kanban criado.',
      );
      await carregar(cliente.id, { forcar: true });
      if (!comDocumento && !anexarA) {
        abrirQuadro(cliente, demanda.projetoId, demanda.id);
      }
    } catch (erro) {
      exibirErro(elementos.erroNovo, erro.message);
    } finally {
      elementos.botaoSalvarNovo.disabled = false;
    }
  }

  async function escolherPasta(campo, elementoDeErro) {
    try {
      const escolha = await selecionarPasta();
      if (escolha?.caminho) campo.value = escolha.caminho;
    } catch (erro) {
      exibirErro(elementoDeErro, erro.message);
    }
  }

  async function analisarDemanda(demanda) {
    try {
      await api.analisar(demanda.id);
      exibirAviso('A IA está gerando as tarefas; o quadro se atualiza sozinho.');
    } catch (erro) {
      exibirAviso(erro.message, 'erro');
    }
    await recarregar();
  }

  async function analisarDeNovo() {
    const demandas = demandasDoQuadro();
    if (demandas.length !== 1) return;
    elementos.botaoAnalisar.disabled = true;
    await analisarDemanda(demandas[0]);
  }

  // --- edição do kanban -------------------------------------------------------------

  function abrirEdicao(cliente, demanda) {
    edicaoEmAndamento = { cliente, demanda };
    limparErro(elementos.erroEditar);
    elementos.subtituloEditar.textContent = demanda.projetoId
      ? 'Projeto e pasta do arquivo de tarefas.'
      : 'Este kanban está sem projeto: vincule a um projeto ou dê um nome que o identifique.';
    elementos.blocoEditarNome.hidden = Boolean(demanda.projetoId);
    elementos.campoEditarNome.value = demanda.nome;
    preencherProjetos(elementos.campoEditarProjeto, cliente, demanda.projetoId, !demanda.projetoId);
    elementos.campoEditarPasta.value = demanda.pasta;
    elementos.campoEditarMcp.checked = demanda.mcp;
    elementos.situacaoEditarArquivo.textContent = descreverArquivo(demanda.arquivo);
    elementos.situacaoEditarArquivo.hidden = !demanda.arquivo;
    elementos.blocoEditarDocumento.hidden = !demanda.documento;
    elementos.textoEditarDocumento.textContent = demanda.documento
      ? `Documento: ${demanda.documento.nome}`
      : '';
    elementos.modalEditar.showModal();
    (demanda.projetoId ? elementos.campoEditarProjeto : elementos.campoEditarNome).focus();
  }

  async function salvarEdicao(evento) {
    evento.preventDefault();
    if (!edicaoEmAndamento) return;
    const { cliente, demanda } = edicaoEmAndamento;
    const projetoId = elementos.campoEditarProjeto.value;
    // Vinculado a um projeto, o nome passa a ser o dele; quem aplica é o backend.
    const nome = elementos.campoEditarNome.value.trim();
    if (!projetoId && !nome) {
      exibirErro(elementos.erroEditar, 'Informe o nome do kanban.');
      return;
    }
    limparErro(elementos.erroEditar);
    elementos.botaoSalvarEditar.disabled = true;
    try {
      await api.alterar(demanda.id, {
        ...(projetoId ? {} : { nome }),
        pasta: elementos.campoEditarPasta.value.trim(),
        ...(projetoId ? { projetoId } : {}),
      });
      if (elementos.campoEditarMcp.checked !== demanda.mcp) {
        await api.definirMcp(demanda.id, elementos.campoEditarMcp.checked);
      }
      elementos.modalEditar.close();
      exibirAviso(
        projetoId && !demanda.projetoId ? 'Kanban vinculado ao projeto.' : 'Kanban salvo.',
      );
      await carregar(cliente.id, { forcar: true });
    } catch (erro) {
      exibirErro(elementos.erroEditar, erro.message);
    } finally {
      elementos.botaoSalvarEditar.disabled = false;
    }
  }

  async function removerDocumento() {
    if (!edicaoEmAndamento) return;
    const botao = elementos.botaoRemoverDocumento;
    if (botao.dataset.confirmar !== 'sim') {
      botao.dataset.confirmar = 'sim';
      botao.textContent = 'Confirmar: tirar o documento';
      return;
    }
    botao.disabled = true;
    try {
      await api.removerDocumento(edicaoEmAndamento.demanda.id);
      elementos.modalEditar.close();
      exibirAviso('Documento removido. As tarefas continuam no quadro.');
      await recarregar();
    } catch (erro) {
      exibirErro(elementos.erroEditar, erro.message);
    } finally {
      botao.disabled = false;
    }
  }

  function restaurarBotaoDeRemoverDocumento() {
    delete elementos.botaoRemoverDocumento.dataset.confirmar;
    elementos.botaoRemoverDocumento.textContent = 'Remover documento';
  }

  function pedirExclusaoDeKanban(demanda) {
    dependencias.pedirExclusao(
      'Excluir kanban',
      `Excluir o kanban com as ${tarefasDasDemandas(cache.idDoCliente, [demanda]).length} tarefas e o documento? Esta ação não pode ser desfeita.`,
      () => api.excluir(demanda.id),
      'Kanban excluído.',
      recarregar,
    );
  }

  // --- documento ------------------------------------------------------------------

  function mostrarAbaDoDocumento(original) {
    elementos.abaTexto.classList.toggle('ativa', !original);
    elementos.abaTexto.setAttribute('aria-selected', String(!original));
    elementos.abaOriginal.classList.toggle('ativa', original);
    elementos.abaOriginal.setAttribute('aria-selected', String(original));
    elementos.textoDocumento.hidden = original;
    elementos.originalDocumento.hidden = !original;
  }

  async function abrirDocumento(demanda) {
    const endereco = `/api/kanban/demandas/${demanda.id}/documento`;
    elementos.tituloDocumento.textContent = demanda.documento?.nome ?? 'Documento';
    elementos.linkBaixarDocumento.href = `${endereco}?baixar=1`;
    const pdf = demanda.documento?.tipo === 'pdf';
    elementos.abasDocumento.hidden = !pdf;
    elementos.originalDocumento.replaceChildren();
    if (pdf) {
      const quadroDoPdf = criarElemento('iframe', 'visor-kanban-pdf');
      quadroDoPdf.src = endereco;
      quadroDoPdf.title = demanda.documento.nome;
      elementos.originalDocumento.append(quadroDoPdf);
    }
    mostrarAbaDoDocumento(false);
    elementos.textoDocumento.textContent = 'Carregando…';
    elementos.modalDocumento.showModal();

    try {
      const { texto } = await api.textoDoDocumento(demanda.id);
      elementos.textoDocumento.textContent = texto.trim()
        ? texto
        : pdf
          ? 'Este PDF não tem texto selecionável (parece digitalizado). Veja a aba Original ou baixe o arquivo.'
          : 'O documento não tem texto legível. Use "Baixar original".';
    } catch (erro) {
      elementos.textoDocumento.textContent = `Não foi possível ler o documento: ${erro.message}`;
    }
  }

  // --- exclusão do projeto ----------------------------------------------------------

  /**
   * Projeto sem kanban segue a exclusão de sempre. Com kanban, a janela própria
   * pergunta se eles ficam no cliente, sem projeto e renomeados, ou vão junto.
   */
  async function pedirExclusaoDeProjeto(cliente, projeto) {
    await carregar(cliente.id);
    const demandas = demandasDoProjeto(cliente.id, projeto.id);
    if (demandas.length === 0) {
      excluirProjetoSemKanban(cliente, projeto);
      return;
    }

    exclusaoDeProjetoPendente = { cliente, projeto };
    limparErro(elementos.erroExclusaoProjeto);
    elementos.textoExclusaoProjeto.textContent = `O projeto "${projeto.nome}" tem kanban. O que fazer com ele?`;
    elementos.campoManter.checked = true;
    aplicarEscolhaDaExclusao();
    elementos.modalExclusaoProjeto.showModal();
  }

  function aplicarEscolhaDaExclusao() {
    elementos.botaoConfirmarExclusaoProjeto.textContent = elementos.campoManter.checked
      ? 'Excluir projeto e manter kanban'
      : 'Excluir projeto e kanban';
  }

  async function confirmarExclusaoDeProjeto() {
    if (!exclusaoDeProjetoPendente) return;
    const { cliente, projeto } = exclusaoDeProjetoPendente;
    const manter = elementos.campoManter.checked;

    limparErro(elementos.erroExclusaoProjeto);
    elementos.botaoConfirmarExclusaoProjeto.disabled = true;
    try {
      await api.excluirProjeto(cliente.id, projeto.id, manter ? 'manter' : 'excluir');
      elementos.modalExclusaoProjeto.close();
      exibirAviso(
        manter
          ? 'Projeto excluído. O kanban está em "Kanbans sem projeto".'
          : 'Projeto e kanban excluídos.',
      );
      await dependencias.recarregarClientes();
      await carregar(cliente.id, { forcar: true });
    } catch (erro) {
      exibirErro(elementos.erroExclusaoProjeto, erro.message);
    } finally {
      elementos.botaoConfirmarExclusaoProjeto.disabled = false;
    }
  }

  // --- aba MCP das configurações ---------------------------------------------------

  let textoDaConfiguracaoMcp = '';

  /** Preenche a seção "Kanban por MCP": o bloco para colar no agente e os kanbans liberados. */
  async function carregarMcpDaConfiguracao() {
    elementos.configuracaoMcp.textContent = 'Carregando…';
    elementos.listaMcp.replaceChildren();
    try {
      const [configuracao, { kanbans }] = await Promise.all([
        api.configuracaoDoMcp(),
        api.kanbansNoMcp(),
      ]);
      textoDaConfiguracaoMcp = JSON.stringify({ mcpServers: configuracao.mcpServers }, null, 2);
      elementos.configuracaoMcp.textContent = textoDaConfiguracaoMcp;
      desenharKanbansNoMcp(kanbans);
    } catch (erro) {
      elementos.configuracaoMcp.textContent = `Não foi possível ler a configuração do MCP: ${erro.message}`;
    }
  }

  function desenharKanbansNoMcp(kanbans) {
    if (kanbans.length === 0) {
      elementos.listaMcp.replaceChildren(
        criarElemento(
          'p',
          'secao-vazia',
          'Nenhum kanban disponível. Marque "Disponível para agentes de IA por MCP" em Editar o kanban.',
        ),
      );
      return;
    }
    elementos.listaMcp.replaceChildren(
      ...kanbans.map((item) => {
        const informacoes = criarElemento('div', 'recurso-info');
        const detalhes = [
          item.cliente,
          item.projeto || 'sem projeto',
          `${item.tarefas} tarefas`,
          `id ${item.kanbanId}`,
        ];
        informacoes.append(
          criarElemento('strong', null, item.kanban),
          criarElemento('span', 'texto-auxiliar', detalhes.join(' · ')),
        );
        const tirar = criarBotao('btn tiny', 'Tirar do MCP', async () => {
          tirar.disabled = true;
          try {
            await api.definirMcp(item.kanbanId, false);
            exibirAviso(`"${item.kanban}" não está mais disponível por MCP.`);
            await recarregar();
            desenharKanbansNoMcp((await api.kanbansNoMcp()).kanbans);
          } catch (erro) {
            exibirAviso(erro.message, 'erro');
            tirar.disabled = false;
          }
        });
        const linha = criarElemento('div', 'linha-recurso');
        linha.append(informacoes, tirar);
        return linha;
      }),
    );
  }

  async function copiarConfiguracaoMcp() {
    try {
      await navigator.clipboard.writeText(textoDaConfiguracaoMcp);
      exibirAviso('Configuração do MCP copiada.');
    } catch {
      exibirAviso('Não foi possível copiar: selecione o bloco e copie com Ctrl+C.', 'erro');
    }
  }

  // --- mudanças de fora da tela ----------------------------------------------------

  /*
   * O MCP, o arquivo de tarefas e a IA mudam o kanban sem passar pela tela: o servidor
   * avisa pelo fluxo, e o cliente aberto é relido. O EventSource reconecta sozinho; ao
   * voltar, relê também, porque o que mudou com a conexão caída não foi avisado.
   */
  let releituraAgendada = null;

  function agendarReleitura() {
    clearTimeout(releituraAgendada);
    releituraAgendada = setTimeout(() => {
      if (cache.idDoCliente && clienteSelecionado()?.id === cache.idDoCliente) {
        void carregar(cache.idDoCliente, { forcar: true });
      }
    }, ESPERA_PARA_RELER_MS);
  }

  function acompanharMudancas() {
    if (typeof EventSource === 'undefined') return;
    const fluxo = new EventSource('/api/kanban/fluxo');
    let jaAbriu = false;
    fluxo.addEventListener('open', () => {
      if (jaAbriu) agendarReleitura();
      jaAbriu = true;
    });
    fluxo.addEventListener('kanban', (evento) => {
      try {
        const { clienteId } = JSON.parse(evento.data);
        if (clienteId === cache.idDoCliente) agendarReleitura();
      } catch {
        // Aviso malformado: a próxima mudança ou a reconexão relê.
      }
    });
  }

  // --- eventos --------------------------------------------------------------------

  elementos.campoDemanda.addEventListener('change', () => {
    const valor = elementos.campoDemanda.value;
    quadro.demandaId = valor === TODAS_AS_DEMANDAS ? valor : Number(valor);
    desenharQuadro();
  });
  elementos.botaoNovaTarefa.addEventListener('click', () => abrirTarefa(null));
  elementos.botaoDocumento.addEventListener('click', () => {
    const [unica] = demandasDoQuadro();
    if (unica?.documento) abrirDocumento(unica);
  });
  elementos.botaoAnalisar.addEventListener('click', analisarDeNovo);
  elementos.botaoFecharQuadro.addEventListener('click', () => elementos.modalQuadro.close());

  elementos.formularioNovo.addEventListener('submit', salvarNovo);
  elementos.botaoCancelarNovo.addEventListener('click', () => elementos.modalNovo.close());
  elementos.modoDocumento.addEventListener('change', aplicarModoDoNovo);
  elementos.modoVazio.addEventListener('change', aplicarModoDoNovo);
  elementos.campoAnalisar.addEventListener('change', aplicarModoDoNovo);
  elementos.botaoEscolherPasta.addEventListener('click', () =>
    escolherPasta(elementos.campoPasta, elementos.erroNovo),
  );

  elementos.formularioEditar.addEventListener('submit', salvarEdicao);
  elementos.botaoCancelarEditar.addEventListener('click', () => elementos.modalEditar.close());
  elementos.botaoEditarEscolherPasta.addEventListener('click', () =>
    escolherPasta(elementos.campoEditarPasta, elementos.erroEditar),
  );
  elementos.botaoRemoverDocumento.addEventListener('click', removerDocumento);
  elementos.modalEditar.addEventListener('close', restaurarBotaoDeRemoverDocumento);

  elementos.formularioTarefa.addEventListener('submit', salvarTarefa);
  elementos.botaoCancelarTarefa.addEventListener('click', () => elementos.modalTarefa.close());
  elementos.botaoExcluirTarefa.addEventListener('click', excluirTarefa);
  elementos.botaoAdicionarItem.addEventListener('click', adicionarItem);
  // Enter no campo do item adiciona, em vez de salvar a tarefa pela metade.
  elementos.campoNovoItem.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      adicionarItem();
    }
  });
  elementos.modalTarefa.addEventListener('close', restaurarBotaoDeExcluirTarefa);

  elementos.abaTexto.addEventListener('click', () => mostrarAbaDoDocumento(false));
  elementos.abaOriginal.addEventListener('click', () => mostrarAbaDoDocumento(true));
  elementos.botaoFecharDocumento.addEventListener('click', () => elementos.modalDocumento.close());
  // O iframe do PDF segura o arquivo aberto; some junto com a janela.
  elementos.modalDocumento.addEventListener('close', () =>
    elementos.originalDocumento.replaceChildren(),
  );

  elementos.botaoCopiarConfiguracaoMcp.addEventListener('click', copiarConfiguracaoMcp);
  elementos.campoManter.addEventListener('change', aplicarEscolhaDaExclusao);
  elementos.campoExcluirJunto.addEventListener('change', aplicarEscolhaDaExclusao);
  elementos.botaoConfirmarExclusaoProjeto.addEventListener('click', confirmarExclusaoDeProjeto);
  elementos.botaoCancelarExclusaoProjeto.addEventListener('click', () =>
    elementos.modalExclusaoProjeto.close(),
  );

  acompanharMudancas();

  return {
    criarSecaoDoProjeto,
    criarSecaoDeOrfaos,
    pedirExclusaoDeProjeto,
    carregarMcpDaConfiguracao,
    /** O cadastro mudou (projeto renomeado, cliente trocado): relê na próxima montagem. */
    descartar: () => {
      clearTimeout(cache.temporizador);
      Object.assign(cache, { idDoCliente: null, dados: null, erro: null, consulta: null });
    },
  };
}
