/*
 * Aba Kanban das Configurações: o cadastro das colunas e dos tipos que todos os quadros
 * usam. Os itens aparecem como chips; o clique num deles o leva para o campo de edição,
 * e sem chip escolhido o campo inclui um novo. Grava na hora, item a item, e o servidor
 * avisa os quadros abertos pelo fluxo do kanban. Excluir o que algum card usa é recusado:
 * os cards aparecem na aba para a pessoa mover ou trocar o tipo deles no quadro.
 */

/* Mais que isso esticaria a janela das Configurações até criar barra de rolagem. */
const MAXIMO_DE_CARDS_NO_BLOQUEIO = 5;

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
        campo: el(`campo-kanban-${caminho}`),
        salvar: el(`btn-kanban-salvar-${caminho}`),
        excluir: el(`btn-kanban-excluir-${caminho}`),
        cancelar: el(`btn-kanban-cancelar-${caminho}`),
      },
    ]),
  );
  let dados = { colunas: [], tipos: [] };
  /* A chave do chip escolhido em cada cadastro; `null` deixa o campo no modo de incluir. */
  const escolhidas = { colunas: null, tipos: null };

  async function carregar() {
    try {
      dados = await requisitar('/api/kanban/cadastros');
    } catch (erro) {
      exibirAviso(`Não foi possível ler as colunas e os tipos: ${erro.message}`, 'erro');
      return;
    }
    for (const cadastro of CADASTROS) {
      desenhar(cadastro);
    }
  }

  function itemEscolhido(caminho) {
    return dados[caminho].find((item) => item.chave === escolhidas[caminho]);
  }

  function escolher(cadastro, chave) {
    escolhidas[cadastro.caminho] = chave;
    partes[cadastro.caminho].bloqueio.hidden = true;
    desenhar(cadastro);
  }

  function desenhar(cadastro) {
    const { caminho } = cadastro;
    // O item escolhido pode ter sido excluído: o campo volta ao modo de incluir.
    if (!itemEscolhido(caminho)) {
      escolhidas[caminho] = null;
    }
    const itens = dados[caminho];
    partes[caminho].lista.replaceChildren(
      ...itens.map((item, posicao) => criarChip(cadastro, item, posicao, itens.length)),
    );
    preencherEdicao(cadastro);
  }

  /** O papel que a posição dá à coluna: só a primeira e a última têm um. */
  function papelDaColuna(posicao, total) {
    if (posicao === 0) return 'novas';
    if (posicao === total - 1) return 'concluídas';
    return '';
  }

  function criarChip(cadastro, item, posicao, total) {
    const chip = criarElemento('button', 'chip-kanban-cadastro', item.nome);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(item.chave === escolhidas[cadastro.caminho]));
    chip.addEventListener('click', () =>
      escolher(cadastro, item.chave === escolhidas[cadastro.caminho] ? null : item.chave),
    );
    const papel = cadastro.ordenavel ? papelDaColuna(posicao, total) : '';
    if (papel) {
      chip.append(criarElemento('span', 'papel-kanban-cadastro', papel));
    }
    return chip;
  }

  function preencherEdicao(cadastro) {
    const { caminho, ordenavel } = cadastro;
    const { campo, salvar, excluir, cancelar, esquerda, direita } = partes[caminho];
    const item = itemEscolhido(caminho);
    campo.value = item?.nome ?? '';
    salvar.textContent = item ? 'Salvar' : 'Adicionar';
    excluir.hidden = !item;
    cancelar.hidden = !item;
    if (!ordenavel) return;
    const posicao = dados[caminho].indexOf(item);
    esquerda.hidden = !item;
    direita.hidden = !item;
    esquerda.disabled = posicao <= 0;
    direita.disabled = posicao === dados[caminho].length - 1;
  }

  function endereco(caminho, item) {
    return `/api/kanban/${caminho}/${encodeURIComponent(item.chave)}`;
  }

  async function salvar(caminho) {
    const { campo } = partes[caminho];
    const nome = campo.value;
    if (!nome.trim()) {
      campo.focus();
      return;
    }
    const item = itemEscolhido(caminho);
    const gravou = await agir(caminho, () =>
      item
        ? requisitar(endereco(caminho, item), { metodo: 'PUT', corpo: { nome } })
        : requisitar(`/api/kanban/${caminho}`, { metodo: 'POST', corpo: { nome } }),
    );
    // Recusado na inclusão, o nome digitado fica para a pessoa corrigir.
    if (!gravou && !item) {
      campo.value = nome;
    }
  }

  function mover(deslocamento) {
    const chaves = dados.colunas.map((coluna) => coluna.chave);
    const de = chaves.indexOf(escolhidas.colunas);
    const [movida] = chaves.splice(de, 1);
    chaves.splice(de + deslocamento, 0, movida);
    return agir('colunas', () =>
      requisitar('/api/kanban/ordem-das-colunas', { metodo: 'PUT', corpo: { chaves } }),
    );
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
    const cards = erro.tarefas.slice(0, MAXIMO_DE_CARDS_NO_BLOQUEIO).map((tarefa) => {
      const { titulo, cliente, quadro } = tarefa;
      const onde = cliente && cliente !== quadro ? `${cliente} · ${quadro}` : quadro;
      return criarElemento('li', null, `${titulo} — ${onde}`);
    });
    const restantes = erro.tarefas.length - cards.length;
    if (restantes > 0) {
      cards.push(criarElemento('li', null, `e mais ${restantes} card${restantes > 1 ? 's' : ''}`));
    }
    const lista = criarElemento('ul');
    lista.append(...cards);
    bloqueio.replaceChildren(criarElemento('p', 'erro-formulario', erro.message), lista);
    bloqueio.hidden = false;
  }

  for (const cadastro of CADASTROS) {
    const { caminho } = cadastro;
    const parte = partes[caminho];
    parte.salvar.addEventListener('click', () => salvar(caminho));
    parte.excluir.addEventListener('click', () =>
      agir(caminho, () =>
        requisitar(endereco(caminho, itemEscolhido(caminho)), { metodo: 'DELETE' }),
      ),
    );
    parte.cancelar.addEventListener('click', () => escolher(cadastro, null));
    // Enter no campo grava: o formulário das Configurações não é o dono deste campo.
    parte.campo.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        void salvar(caminho);
      }
    });
    if (cadastro.ordenavel) {
      parte.esquerda = criarBotaoDeIcone(
        'btn tiny',
        ICONES.chevronEsquerda,
        'Mover para a esquerda',
        () => mover(-1),
      );
      parte.direita = criarBotaoDeIcone(
        'btn tiny',
        ICONES.chevronDireita,
        'Mover para a direita',
        () => mover(1),
      );
      parte.salvar.before(parte.esquerda, parte.direita);
    }
  }

  return { carregar };
}
