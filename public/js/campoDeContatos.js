/**
 * Campo de contatos com pesquisa e chips, como o "Para" do Gmail: digita parte do nome, do
 * e-mail ou do cliente, escolhe na lista e o contato vira um chip com ✕ para tirar. Só
 * oferece contatos cadastrados com e-mail, e a lista termina no atalho para cadastrar um.
 *
 * Usado pelo formulário "Novo e-mail" (escritaDeEmail.js), com um campo por Para, Cc e Cco,
 * e pela cobrança do alerta da agenda (app.js).
 *
 * `linha` é o elemento que contém `.destinatarios` (chips e pesquisa) e `.opcoes-de-contatos`
 * (sugestões). `indisponiveis` devolve ids que já estão em outro campo do mesmo formulário.
 */
export function criarCampoDeContatos(linha, dependencias) {
  const {
    criarElemento,
    criarBotao,
    contatos,
    clienteDoContato,
    contatosOrdenados,
    cadastrarContato,
    rotulo,
    indisponiveis = () => [],
    aoMudar = () => {},
  } = dependencias;

  const destino = linha.querySelector('.destinatarios');
  const lista = linha.querySelector('.opcoes-de-contatos');
  let escolhidos = [];

  function contatoPorId(id) {
    return contatos().find((contato) => contato.id === id) ?? null;
  }

  function ocupados() {
    return [...escolhidos, ...indisponiveis()];
  }

  function descricao(contato) {
    const cliente = clienteDoContato(contato);
    return cliente ? `${contato.email} · ${cliente.nome}` : contato.email;
  }

  function adicionar(id) {
    if (ocupados().includes(id)) return;
    escolhidos = [...escolhidos, id];
    aoMudar();
    renderizar();
  }

  function remover(id) {
    escolhidos = escolhidos.filter((escolhido) => escolhido !== id);
    aoMudar();
    renderizar();
  }

  function criarChip(contato) {
    const chip = criarElemento('span', 'chip-de-destinatario');
    chip.title = descricao(contato);
    const botaoRemover = criarBotao('chip-de-destinatario-remover', '✕', () => remover(contato.id));
    botaoRemover.setAttribute('aria-label', `Tirar ${contato.nome}`);
    chip.append(criarElemento('span', null, contato.nome), botaoRemover);
    return chip;
  }

  function sugeridos(busca) {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    const indisponivel = ocupados();
    return contatosOrdenados(
      contatos().filter((contato) => {
        if (!contato.email || indisponivel.includes(contato.id)) return false;
        const cliente = clienteDoContato(contato)?.nome ?? '';
        return `${contato.nome} ${contato.email} ${cliente}`
          .toLocaleLowerCase('pt-BR')
          .includes(termo);
      }),
    );
  }

  function criarSugestao(contato) {
    const opcao = criarBotao('opcao-de-contato', '', () => {
      adicionar(contato.id);
      focar();
    });
    opcao.append(
      criarElemento('span', 'opcao-de-contato-nome', contato.nome),
      criarElemento('span', 'opcao-de-contato-detalhe', descricao(contato)),
    );
    return opcao;
  }

  function mostrarSugestoes(busca) {
    const encontrados = sugeridos(busca);
    const novo = criarBotao(
      'btn tiny ghost opcao-de-contato-novo',
      'Cadastrar contato novo',
      () => {
        fecharSugestoes();
        cadastrarContato((contato) => adicionar(contato.id));
      },
    );
    lista.replaceChildren(
      ...(encontrados.length > 0
        ? encontrados.map(criarSugestao)
        : [criarElemento('p', 'texto-auxiliar', 'Nenhum contato com e-mail encontrado.')]),
      novo,
    );
    lista.hidden = false;
  }

  function fecharSugestoes() {
    lista.hidden = true;
  }

  /* Como no Gmail: Enter escolhe o primeiro, Backspace no campo vazio tira o último. */
  function tratarTecla(evento) {
    const busca = evento.target;
    if (evento.key === 'Enter') {
      evento.preventDefault();
      const [primeiro] = sugeridos(busca.value);
      if (primeiro) adicionar(primeiro.id);
      return;
    }
    if (evento.key === 'Backspace' && busca.value === '') {
      const ultimo = escolhidos.at(-1);
      if (ultimo) remover(ultimo);
      return;
    }
    // Esc com a lista aberta fecha só a lista, e não o modal.
    if (evento.key === 'Escape' && !lista.hidden) {
      evento.preventDefault();
      fecharSugestoes();
    }
  }

  function criarBusca() {
    const busca = criarElemento('input', 'busca-de-destinatario');
    busca.type = 'text';
    busca.autocomplete = 'off';
    busca.placeholder = escolhidos.length === 0 ? 'Digite um nome…' : '';
    busca.setAttribute('aria-label', `Adicionar contato em ${rotulo}`);
    busca.addEventListener('focus', () => mostrarSugestoes(busca.value));
    busca.addEventListener('input', () => mostrarSugestoes(busca.value));
    busca.addEventListener('keydown', tratarTecla);
    return busca;
  }

  /* Contato excluído depois de escolhido some do chip, mas só sai dos ids ao definir de novo. */
  function renderizar() {
    const chips = escolhidos.map(contatoPorId).filter(Boolean).map(criarChip);
    const busca = criarBusca();
    destino.replaceChildren(...chips, busca);
    // Com a lista aberta a pessoa está escolhendo: o foco segue na pesquisa nova.
    if (!lista.hidden) busca.focus();
  }

  function focar() {
    destino.querySelector('.busca-de-destinatario')?.focus();
  }

  return {
    ids: () => escolhidos.filter((id) => contatoPorId(id) !== null),
    definir(ids) {
      escolhidos = [...ids];
      fecharSugestoes();
      renderizar();
    },
    renderizar,
    fecharSugestoes,
    focar,
  };
}
