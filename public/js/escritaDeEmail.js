/**
 * Formulário "Novo e-mail", aberto pelo envelope de um contato (já com ele no Para) ou
 * pelo botão avulso da tela de Contatos. Funciona como a escrita do Gmail — Para, Cc,
 * Cco, assunto, corpo formatado e anexos —, mas só com contatos cadastrados e pelo
 * SMTP de Configurações.
 *
 * O corpo vai para o backend como árvore de nós, e não como HTML: `serializarCorpo` só
 * aceita as marcações da barra de formatação, e o resto (span, estilo, fonte) é
 * desembrulhado. O HTML do e-mail é gerado no backend (src/notificacoes/emailAvulso.ts).
 */

/* Mesmo limite do backend (src/rotas/rotasEmail.ts). */
const MEGABYTE = 1024 * 1024;
export const LIMITE_DOS_ANEXOS_BYTES = 18 * MEGABYTE;
const MENSAGEM_DO_LIMITE_DOS_ANEXOS = `Os anexos passam de ${LIMITE_DOS_ANEXOS_BYTES / MEGABYTE} MB.`;

/* "anexo", "anexado", "em anexo", "anexei", "anexa"… */
const MENCAO_A_ANEXO = /\banex/i;

/* Link que não começa assim ganha o `https://`, como faz o Gmail. */
const ESQUEMA_DE_LINK = /^(https?:|mailto:)/i;

const CAMPOS_DE_DESTINATARIO = ['para', 'copia', 'copiaOculta'];

const MARCA_DA_TAG = {
  B: 'strong',
  STRONG: 'strong',
  I: 'em',
  EM: 'em',
  U: 'u',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
  A: 'a',
  DIV: 'div',
  P: 'div',
  BR: 'br',
};

/* Desenhos no mesmo traço dos ícones do app.js (viewBox 24, stroke). */
const TRACADOS_DA_BARRA = {
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7z M7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8 M6 19h8 M14 5l-4 14',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14',
  insertUnorderedList: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  insertOrderedList: 'M10 6h10 M10 12h10 M10 18h10 M4 5l1-1v4 M4 14h2l-2 3h2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  removeFormat: 'M5 6h11 M11 6l-3 13 M4 4l16 16',
};

const TRACADO_DO_CLIPE =
  'M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9';

const ROTULOS_DA_BARRA = {
  bold: 'Negrito (Ctrl+B)',
  italic: 'Itálico (Ctrl+I)',
  underline: 'Sublinhado (Ctrl+U)',
  insertUnorderedList: 'Lista com marcadores',
  insertOrderedList: 'Lista numerada',
  link: 'Inserir link',
  removeFormat: 'Remover formatação',
};

/** Primeiro problema que impede o envio, ou `null`. */
export function erroDoEnvio({ para, tamanhoDosAnexos }) {
  if (para.length === 0) return 'Informe ao menos um destinatário em Para.';
  if (tamanhoDosAnexos > LIMITE_DOS_ANEXOS_BYTES) return MENSAGEM_DO_LIMITE_DOS_ANEXOS;
  return null;
}

/** Nomes dos clientes distintos entre os destinatários; contato sem cliente não conta. */
export function clientesDosDestinatarios(contatos, clienteDoContato) {
  const nomes = contatos.map((contato) => clienteDoContato(contato)?.nome).filter(Boolean);
  return [...new Set(nomes)].sort((um, outro) => um.localeCompare(outro, 'pt-BR'));
}

/** O que vale conferir antes de enviar; o envio segue se a pessoa confirmar. */
export function avisosDoEnvio({ assunto, textoDoCorpo, quantidadeDeAnexos, clientes }) {
  const avisos = [];
  if (clientes.length > 1) {
    avisos.push(`Há destinatários de clientes diferentes: ${clientes.join(', ')}.`);
  }
  if (quantidadeDeAnexos === 0 && MENCAO_A_ANEXO.test(`${assunto} ${textoDoCorpo}`)) {
    avisos.push('O e-mail fala em anexo, mas nenhum arquivo foi anexado.');
  }
  if (!assunto.trim()) avisos.push('O e-mail está sem assunto.');
  if (!textoDoCorpo.trim()) avisos.push('O corpo do e-mail está vazio.');
  return avisos;
}

export function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MEGABYTE).toFixed(1).replace('.', ',')} MB`;
}

export function normalizarLink(endereco) {
  const limpo = endereco.trim();
  if (!limpo) return '';
  return ESQUEMA_DE_LINK.test(limpo) ? limpo : `https://${limpo}`;
}

/** Árvore do corpo a partir do editor: só as marcações da barra, o resto desembrulhado. */
export function serializarCorpo(elemento) {
  return [...elemento.childNodes].flatMap(serializarNo);
}

function serializarNo(no) {
  if (no.nodeType === Node.TEXT_NODE) return no.textContent ? [no.textContent] : [];
  if (no.nodeType !== Node.ELEMENT_NODE) return [];

  const marca = MARCA_DA_TAG[no.tagName];
  if (marca === 'br') return [{ marca, filhos: [] }];
  const filhos = [...no.childNodes].flatMap(serializarNo);
  if (!marca) return filhos;
  if (marca === 'a') return [{ marca, href: no.getAttribute('href') ?? '', filhos }];
  return [{ marca, filhos }];
}

function lerComoBase64(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    // O resultado é "data:<tipo>;base64,<conteúdo>": só o conteúdo interessa.
    leitor.onload = () => resolver(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => rejeitar(new Error(`Não foi possível ler ${arquivo.name}.`));
    leitor.readAsDataURL(arquivo);
  });
}

export function iniciarEscritaDeEmail(dependencias) {
  const {
    requisitar,
    criarElemento,
    criarBotao,
    criarBotaoDeIcone,
    criarIcone,
    exibirAviso,
    exibirErro,
    limparErro,
    exibirErroComConfiguracao,
    criarLinkDeConfiguracaoPendente,
    lerConfiguracao,
    smtpConfigurado,
    contatos,
    carregarContatos,
    clienteDoContato,
    contatosOrdenados,
    cadastrarContato,
    modalDeConfiguracao,
  } = dependencias;

  const modal = document.getElementById('modal-email');
  const formulario = document.getElementById('formulario-email');
  const avisoSmtp = document.getElementById('aviso-smtp-email');
  const campoAssunto = document.getElementById('campo-assunto-email');
  const barra = document.getElementById('barra-formatacao-email');
  const grupoDoLink = document.getElementById('grupo-link-email');
  const campoDoLink = document.getElementById('campo-link-email');
  const editor = document.getElementById('editor-email');
  const campoAnexos = document.getElementById('campo-anexos-email');
  const listaAnexos = document.getElementById('lista-anexos-email');
  const caixaDeAvisos = document.getElementById('avisos-email');
  const erro = document.getElementById('erro-email');
  const botaoEnviar = document.getElementById('btn-enviar-email');
  const botaoDescartar = document.getElementById('btn-descartar-email');
  const linhas = {
    para: document.getElementById('linha-para-email'),
    copia: document.getElementById('linha-copia-email'),
    copiaOculta: document.getElementById('linha-copia-oculta-email'),
  };
  const botoesDeMostrar = {
    copia: document.getElementById('btn-mostrar-copia-email'),
    copiaOculta: document.getElementById('btn-mostrar-copia-oculta-email'),
  };

  const estado = {
    escolhidos: { para: [], copia: [], copiaOculta: [] },
    /** Arquivos na ordem em que foram anexados. */
    anexos: [],
    /** Avisos que a pessoa já viu: enviar de novo com os mesmos é o "enviar assim mesmo". */
    avisosVistos: '',
    /** Seleção do editor guardada ao abrir o campo do link, que tira o foco dele. */
    selecaoDoLink: null,
  };

  function contatoPorId(id) {
    return contatos().find((contato) => contato.id === id) ?? null;
  }

  function todosOsEscolhidos() {
    return CAMPOS_DE_DESTINATARIO.flatMap((campo) => estado.escolhidos[campo]);
  }

  /* Qualquer mudança no e-mail vale como revisão: os avisos voltam a ser conferidos. */
  function esquecerAvisos() {
    estado.avisosVistos = '';
    caixaDeAvisos.hidden = true;
    botaoEnviar.textContent = 'Enviar';
  }

  /* ------------------------------ destinatários ----------------------------- */

  function adicionarDestinatario(campo, id) {
    if (todosOsEscolhidos().includes(id)) return;
    estado.escolhidos[campo] = [...estado.escolhidos[campo], id];
    esquecerAvisos();
    renderizarDestinatarios(campo);
  }

  function removerDestinatario(campo, id) {
    estado.escolhidos[campo] = estado.escolhidos[campo].filter((escolhido) => escolhido !== id);
    esquecerAvisos();
    renderizarDestinatarios(campo);
  }

  function criarChip(campo, contato) {
    const chip = criarElemento('span', 'chip-de-destinatario');
    const cliente = clienteDoContato(contato);
    chip.title = cliente ? `${contato.email} · ${cliente.nome}` : contato.email;
    const remover = criarBotao('chip-de-destinatario-remover', '✕', () =>
      removerDestinatario(campo, contato.id),
    );
    remover.setAttribute('aria-label', `Tirar ${contato.nome}`);
    chip.append(criarElemento('span', null, contato.nome), remover);
    return chip;
  }

  function contatosSugeridos(busca) {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    const escolhidos = todosOsEscolhidos();
    return contatosOrdenados(
      contatos().filter((contato) => {
        if (!contato.email || escolhidos.includes(contato.id)) return false;
        const cliente = clienteDoContato(contato)?.nome ?? '';
        return `${contato.nome} ${contato.email} ${cliente}`
          .toLocaleLowerCase('pt-BR')
          .includes(termo);
      }),
    );
  }

  function criarSugestao(campo, contato) {
    const opcao = criarBotao('opcao-de-contato', '', () => {
      adicionarDestinatario(campo, contato.id);
      linhas[campo].querySelector('.busca-de-destinatario').focus();
    });
    const cliente = clienteDoContato(contato);
    opcao.append(
      criarElemento('span', 'opcao-de-contato-nome', contato.nome),
      criarElemento(
        'span',
        'opcao-de-contato-detalhe',
        cliente ? `${contato.email} · ${cliente.nome}` : contato.email,
      ),
    );
    return opcao;
  }

  function renderizarSugestoes(campo, busca) {
    const lista = linhas[campo].querySelector('.opcoes-de-contatos');
    const sugeridos = contatosSugeridos(busca);
    const novo = criarBotao(
      'btn tiny ghost opcao-de-contato-novo',
      'Cadastrar contato novo',
      () => {
        fecharSugestoes();
        cadastrarContato((contato) => adicionarDestinatario(campo, contato.id));
      },
    );
    lista.replaceChildren(
      ...(sugeridos.length > 0
        ? sugeridos.map((contato) => criarSugestao(campo, contato))
        : [criarElemento('p', 'texto-auxiliar', 'Nenhum contato com e-mail encontrado.')]),
      novo,
    );
    lista.hidden = false;
  }

  function fecharSugestoes() {
    for (const linha of Object.values(linhas)) {
      linha.querySelector('.opcoes-de-contatos').hidden = true;
    }
  }

  /* Como no Gmail: Enter escolhe o primeiro, Backspace no campo vazio tira o último. */
  function tratarTeclaDaBusca(campo, evento) {
    const busca = evento.target;
    if (evento.key === 'Enter') {
      evento.preventDefault();
      const [primeiro] = contatosSugeridos(busca.value);
      if (primeiro) adicionarDestinatario(campo, primeiro.id);
      return;
    }
    if (evento.key === 'Backspace' && busca.value === '') {
      const ultimo = estado.escolhidos[campo].at(-1);
      if (ultimo) removerDestinatario(campo, ultimo);
      return;
    }
    if (evento.key === 'Escape' && !linhas[campo].querySelector('.opcoes-de-contatos').hidden) {
      evento.preventDefault();
      fecharSugestoes();
    }
  }

  function criarBusca(campo) {
    const busca = criarElemento('input', 'busca-de-destinatario');
    busca.type = 'text';
    busca.autocomplete = 'off';
    busca.placeholder = estado.escolhidos[campo].length === 0 ? 'Digite um nome…' : '';
    busca.setAttribute('aria-label', `Adicionar contato em ${rotuloDoCampo(campo)}`);
    busca.addEventListener('focus', () => renderizarSugestoes(campo, busca.value));
    busca.addEventListener('input', () => renderizarSugestoes(campo, busca.value));
    busca.addEventListener('keydown', (evento) => tratarTeclaDaBusca(campo, evento));
    return busca;
  }

  function rotuloDoCampo(campo) {
    return { para: 'Para', copia: 'Cc', copiaOculta: 'Cco' }[campo];
  }

  function renderizarDestinatarios(campo) {
    const chips = estado.escolhidos[campo].map(contatoPorId).filter(Boolean);
    const destino = linhas[campo].querySelector('.destinatarios');
    const busca = criarBusca(campo);
    destino.replaceChildren(...chips.map((contato) => criarChip(campo, contato)), busca);
    if (!linhas[campo].querySelector('.opcoes-de-contatos').hidden) {
      busca.focus();
    }
  }

  function mostrarLinha(campo) {
    linhas[campo].hidden = false;
    botoesDeMostrar[campo].hidden = true;
    linhas[campo].querySelector('.busca-de-destinatario').focus();
  }

  /* --------------------------------- editor -------------------------------- */

  function aplicarComando(comando) {
    editor.focus();
    document.execCommand(comando);
    esquecerAvisos();
  }

  function abrirCampoDoLink() {
    const selecao = window.getSelection();
    const dentroDoEditor = selecao.rangeCount > 0 && editor.contains(selecao.anchorNode);
    estado.selecaoDoLink = dentroDoEditor ? selecao.getRangeAt(0).cloneRange() : null;
    grupoDoLink.hidden = false;
    campoDoLink.value = '';
    campoDoLink.focus();
  }

  function fecharCampoDoLink() {
    grupoDoLink.hidden = true;
    estado.selecaoDoLink = null;
  }

  /* Sem texto selecionado, o próprio endereço vira o texto do link. */
  function inserirLink() {
    const endereco = normalizarLink(campoDoLink.value);
    const faixa = estado.selecaoDoLink;
    fecharCampoDoLink();
    if (!endereco) return;

    editor.focus();
    const selecao = window.getSelection();
    selecao.removeAllRanges();
    if (faixa) {
      selecao.addRange(faixa);
    } else {
      const fim = document.createRange();
      fim.selectNodeContents(editor);
      fim.collapse(false);
      selecao.addRange(fim);
    }
    if (selecao.isCollapsed) {
      document.execCommand('insertText', false, endereco);
      const inserido = selecao.getRangeAt(0);
      inserido.setStart(inserido.endContainer, inserido.endOffset - endereco.length);
    }
    document.execCommand('createLink', false, endereco);
    selecao.collapseToEnd();
    esquecerAvisos();
  }

  function montarBarraDeFormatacao() {
    const botoes = Object.keys(TRACADOS_DA_BARRA).map((comando) => {
      const acao = comando === 'link' ? abrirCampoDoLink : () => aplicarComando(comando);
      const botao = criarBotaoDeIcone(
        'btn tiny ghost',
        TRACADOS_DA_BARRA[comando],
        ROTULOS_DA_BARRA[comando],
        acao,
      );
      // Sem isto o clique tira a seleção do editor antes de o comando valer.
      botao.addEventListener('mousedown', (evento) => evento.preventDefault());
      return botao;
    });
    barra.prepend(...botoes);
  }

  /* Colar entra como texto: a formatação de outra página não chegaria ao e-mail mesmo. */
  function colarComoTexto(evento) {
    evento.preventDefault();
    document.execCommand('insertText', false, evento.clipboardData.getData('text/plain'));
  }

  /* --------------------------------- anexos -------------------------------- */

  function tamanhoDosAnexos() {
    return estado.anexos.reduce((soma, arquivo) => soma + arquivo.size, 0);
  }

  function criarItemDeAnexo(arquivo) {
    const item = criarElemento('span', 'anexo-do-email');
    item.append(
      criarIcone(TRACADO_DO_CLIPE),
      criarElemento('span', 'anexo-do-email-nome', arquivo.name),
      criarElemento('span', 'anexo-do-email-tamanho', formatarTamanho(arquivo.size)),
    );
    const remover = criarBotao('chip-de-destinatario-remover', '✕', () => {
      estado.anexos = estado.anexos.filter((anexo) => anexo !== arquivo);
      esquecerAvisos();
      renderizarAnexos();
    });
    remover.setAttribute('aria-label', `Tirar o anexo ${arquivo.name}`);
    item.append(remover);
    return item;
  }

  function renderizarAnexos() {
    listaAnexos.replaceChildren(...estado.anexos.map(criarItemDeAnexo));
    listaAnexos.hidden = estado.anexos.length === 0;
  }

  function anexarArquivos() {
    estado.anexos = [...estado.anexos, ...campoAnexos.files];
    // Limpar deixa anexar de novo o mesmo arquivo depois de tirá-lo.
    campoAnexos.value = '';
    esquecerAvisos();
    renderizarAnexos();
    if (tamanhoDosAnexos() > LIMITE_DOS_ANEXOS_BYTES) {
      exibirErro(erro, MENSAGEM_DO_LIMITE_DOS_ANEXOS);
    }
  }

  /* ---------------------------------- envio --------------------------------- */

  function exibirAvisos(avisos) {
    const lista = criarElemento('ul');
    lista.append(...avisos.map((aviso) => criarElemento('li', null, aviso)));
    caixaDeAvisos.replaceChildren(
      criarElemento('strong', null, 'Confira antes de enviar:'),
      lista,
      criarElemento('span', 'texto-auxiliar', 'Clique em "Enviar assim mesmo" para seguir.'),
    );
    caixaDeAvisos.hidden = false;
    botaoEnviar.textContent = 'Enviar assim mesmo';
  }

  /* `true` quando há aviso novo a mostrar: o envio para e espera a confirmação. */
  function pararPelosAvisos() {
    const destinatarios = todosOsEscolhidos().map(contatoPorId).filter(Boolean);
    const avisos = avisosDoEnvio({
      assunto: campoAssunto.value,
      textoDoCorpo: editor.innerText,
      quantidadeDeAnexos: estado.anexos.length,
      clientes: clientesDosDestinatarios(destinatarios, clienteDoContato),
    });
    const chave = avisos.join('|');
    if (avisos.length === 0 || chave === estado.avisosVistos) return false;
    estado.avisosVistos = chave;
    exibirAvisos(avisos);
    return true;
  }

  async function montarCorpoDaRequisicao() {
    const anexos = await Promise.all(
      estado.anexos.map(async (arquivo) => ({
        nome: arquivo.name,
        tipo: arquivo.type,
        conteudoBase64: await lerComoBase64(arquivo),
      })),
    );
    return {
      ...estado.escolhidos,
      assunto: campoAssunto.value.trim(),
      corpo: serializarCorpo(editor),
      anexos,
    };
  }

  async function enviar(evento) {
    evento.preventDefault();
    const problema = erroDoEnvio({
      para: estado.escolhidos.para,
      tamanhoDosAnexos: tamanhoDosAnexos(),
    });
    if (problema) {
      exibirErro(erro, problema);
      return;
    }
    limparErro(erro);
    if (pararPelosAvisos()) return;

    botaoEnviar.disabled = true;
    try {
      const corpo = await montarCorpoDaRequisicao();
      const { mensagem } = await requisitar('/api/email', { metodo: 'POST', corpo });
      modal.close();
      exibirAviso(mensagem);
    } catch (falha) {
      exibirErroComConfiguracao(erro, falha);
    } finally {
      botaoEnviar.disabled = false;
    }
  }

  /* --------------------------------- abertura -------------------------------- */

  async function avisarSmtpPendente() {
    avisoSmtp.hidden = true;
    try {
      const configuracao = await lerConfiguracao();
      if (smtpConfigurado(configuracao.smtp)) return;
      avisoSmtp.replaceChildren(
        'Configure o SMTP (host, remetente e destinatário) para o e-mail sair.',
        ' ',
        criarLinkDeConfiguracaoPendente('smtp'),
      );
    } catch (falha) {
      avisoSmtp.replaceChildren(`Não foi possível conferir o SMTP: ${falha.message}`);
    }
    avisoSmtp.hidden = false;
  }

  function reiniciar(contato) {
    estado.escolhidos = { para: contato?.email ? [contato.id] : [], copia: [], copiaOculta: [] };
    estado.anexos = [];
    campoAssunto.value = '';
    editor.replaceChildren();
    fecharCampoDoLink();
    fecharSugestoes();
    esquecerAvisos();
    limparErro(erro);
    linhas.copia.hidden = true;
    linhas.copiaOculta.hidden = true;
    botoesDeMostrar.copia.hidden = false;
    botoesDeMostrar.copiaOculta.hidden = false;
    CAMPOS_DE_DESTINATARIO.forEach(renderizarDestinatarios);
    renderizarAnexos();
  }

  function temConteudo() {
    return (
      todosOsEscolhidos().length > 0 ||
      campoAssunto.value.trim() !== '' ||
      editor.innerText.trim() !== '' ||
      estado.anexos.length > 0
    );
  }

  /** `contato`: abre com ele no Para; `null` abre o e-mail em branco. */
  async function abrir(contato = null) {
    reiniciar(contato);
    modal.showModal();
    (contato ? campoAssunto : linhas.para.querySelector('.busca-de-destinatario')).focus();
    void avisarSmtpPendente();
    // A lista pode ter mudado noutro lugar desde a última leitura.
    await carregarContatos();
    if (modal.open) CAMPOS_DE_DESTINATARIO.forEach(renderizarDestinatarios);
  }

  function registrarEventos() {
    montarBarraDeFormatacao();
    document.getElementById('rotulo-anexar-email').prepend(criarIcone(TRACADO_DO_CLIPE));
    formulario.addEventListener('submit', enviar);
    formulario.addEventListener('input', (evento) => {
      if (
        evento.target !== campoDoLink &&
        !evento.target.classList.contains('busca-de-destinatario')
      ) {
        esquecerAvisos();
      }
    });
    botaoDescartar.addEventListener('click', () => modal.close());
    for (const campo of Object.keys(botoesDeMostrar)) {
      botoesDeMostrar[campo].addEventListener('click', () => mostrarLinha(campo));
    }
    editor.addEventListener('paste', colarComoTexto);
    campoAnexos.addEventListener('change', anexarArquivos);
    document.getElementById('btn-inserir-link-email').addEventListener('click', inserirLink);
    document.getElementById('btn-cancelar-link-email').addEventListener('click', fecharCampoDoLink);
    campoDoLink.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        inserirLink();
      }
      if (evento.key === 'Escape') {
        evento.preventDefault();
        fecharCampoDoLink();
        editor.focus();
      }
    });
    // Esc com o e-mail começado não joga o texto fora: descartar é só pelo botão.
    modal.addEventListener('cancel', (evento) => {
      if (temConteudo()) evento.preventDefault();
    });
    // O "Abrir configuração" do aviso abre por cima do e-mail: na volta, o aviso é refeito.
    modalDeConfiguracao.addEventListener('close', () => {
      if (modal.open) void avisarSmtpPendente();
    });
    modal.addEventListener('click', (evento) => {
      if (!evento.target.closest('.linha-destinatarios')) fecharSugestoes();
    });
  }

  registrarEventos();
  return { abrir };
}
