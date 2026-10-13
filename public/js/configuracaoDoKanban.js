/*
 * Aba Kanban das Configurações: o cadastro das colunas e dos tipos que todos os quadros
 * usam. Grava na hora, item a item, e o servidor avisa os quadros abertos pelo fluxo do
 * kanban. Excluir o que algum card usa é recusado: os cards aparecem na aba para a
 * pessoa mover ou trocar o tipo deles no quadro.
 */

const TAMANHO_MAXIMO_DO_NOME = 60;

/* `caminho` é o da API e o sufixo dos ids da aba; só as colunas têm ordem. */
const CADASTROS = [
  { caminho: 'colunas', ordenavel: true },
  { caminho: 'tipos', ordenavel: false },
];

export function iniciarConfiguracaoDoKanban(dependencias) {
  const { requisitar, criarElemento, criarBotaoDeIcone, ICONES, exibirAviso } = dependencias;

  const el = (id) => document.getElementById(id);
  const partes = Object.fromEntries(
    CADASTROS.map(({ caminho }) => [
      caminho,
      {
        lista: el(`lista-kanban-${caminho}`),
        bloqueio: el(`bloqueio-kanban-${caminho}`),
        campoNovo: el(`campo-kanban-novo-${caminho}`),
        botaoNovo: el(`btn-kanban-novo-${caminho}`),
      },
    ]),
  );
  let dados = { colunas: [], tipos: [] };

  async function carregar() {
    try {
      dados = await requisitar('/api/kanban/cadastros');
    } catch (erro) {
      exibirAviso(`Não foi possível ler as colunas e os tipos: ${erro.message}`, 'erro');
      return;
    }
    for (const cadastro of CADASTROS) {
      desenharLista(cadastro);
    }
  }

  function desenharLista(cadastro) {
    const itens = dados[cadastro.caminho];
    partes[cadastro.caminho].lista.replaceChildren(
      ...itens.map((item, posicao) => criarLinha(cadastro, item, posicao, itens.length)),
    );
  }

  /** O papel que a posição dá à coluna: só a primeira e a última têm um. */
  function papelDaColuna(posicao, total) {
    if (posicao === 0) return 'recebe as novas';
    if (posicao === total - 1) return 'concluídas';
    return '';
  }

  function criarLinha(cadastro, item, posicao, total) {
    const { caminho } = cadastro;
    const endereco = `/api/kanban/${caminho}/${encodeURIComponent(item.chave)}`;
    const nome = criarElemento('input');
    nome.type = 'text';
    nome.maxLength = TAMANHO_MAXIMO_DO_NOME;
    nome.value = item.nome;
    nome.setAttribute('aria-label', `Nome de "${item.nome}"`);
    // `change` só dispara com o nome alterado, ao sair do campo ou no Enter.
    nome.addEventListener('change', () =>
      agir(caminho, () => requisitar(endereco, { metodo: 'PUT', corpo: { nome: nome.value } })),
    );
    nome.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        nome.blur();
      }
    });

    const linha = criarElemento('div', 'linha-kanban-cadastro');
    linha.append(nome);
    if (cadastro.ordenavel) {
      const subir = criarBotaoDeIcone('btn tiny', ICONES.chevronCima, 'Subir', () =>
        mover(posicao, posicao - 1),
      );
      subir.disabled = posicao === 0;
      const descer = criarBotaoDeIcone('btn tiny', ICONES.chevronBaixo, 'Descer', () =>
        mover(posicao, posicao + 1),
      );
      descer.disabled = posicao === total - 1;
      linha.append(
        criarElemento(
          'span',
          'texto-auxiliar papel-kanban-cadastro',
          papelDaColuna(posicao, total),
        ),
        subir,
        descer,
      );
    }
    linha.append(
      criarBotaoDeIcone('btn tiny danger', ICONES.lixeira, `Excluir "${item.nome}"`, () =>
        agir(caminho, () => requisitar(endereco, { metodo: 'DELETE' })),
      ),
    );
    return linha;
  }

  function mover(de, para) {
    const chaves = dados.colunas.map((coluna) => coluna.chave);
    const [movida] = chaves.splice(de, 1);
    chaves.splice(para, 0, movida);
    return agir('colunas', () =>
      requisitar('/api/kanban/ordem-das-colunas', { metodo: 'PUT', corpo: { chaves } }),
    );
  }

  async function adicionar(caminho) {
    const { campoNovo } = partes[caminho];
    if (!campoNovo.value.trim()) {
      campoNovo.focus();
      return;
    }
    const criado = await agir(caminho, () =>
      requisitar(`/api/kanban/${caminho}`, { metodo: 'POST', corpo: { nome: campoNovo.value } }),
    );
    if (criado) {
      campoNovo.value = '';
    }
  }

  /*
   * Grava e relê a lista. Na recusa, a lista também é relida: o nome digitado que não
   * foi aceito volta ao gravado.
   */
  async function agir(caminho, gravar) {
    const { bloqueio } = partes[caminho];
    bloqueio.hidden = true;
    try {
      await gravar();
      return true;
    } catch (erro) {
      if (erro.tarefas?.length) {
        mostrarBloqueio(bloqueio, erro);
      } else {
        exibirAviso(erro.message, 'erro');
      }
      return false;
    } finally {
      await carregar();
    }
  }

  function mostrarBloqueio(bloqueio, erro) {
    const cards = erro.tarefas.map(({ titulo, cliente, quadro }) => {
      const onde = cliente && cliente !== quadro ? `${cliente} · ${quadro}` : quadro;
      return criarElemento('li', null, `${titulo} — ${onde}`);
    });
    const lista = criarElemento('ul');
    lista.append(...cards);
    bloqueio.replaceChildren(criarElemento('p', 'erro-formulario', erro.message), lista);
    bloqueio.hidden = false;
  }

  for (const { caminho } of CADASTROS) {
    const { campoNovo, botaoNovo } = partes[caminho];
    botaoNovo.addEventListener('click', () => adicionar(caminho));
    // Enter no campo adiciona: o formulário das Configurações não é o dono deste campo.
    campoNovo.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        void adicionar(caminho);
      }
    });
  }

  return { carregar };
}
