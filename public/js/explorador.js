/**
 * Explorador de arquivos locais do cliente e de cada projeto.
 *
 * Cada cliente ou projeto aponta para UMA pasta do computador; daí em diante tudo é
 * relativo a ela (o backend recusa o que sai dela). A tela navega, cria pasta e arquivo,
 * renomeia, exclui, envia arquivos (botão ou arrastar) e abre no programa padrão.
 *
 * O detalhe do cliente é redesenhado várias vezes por minuto (Git, bases). Por isso cada
 * explorador é criado uma vez por cliente/projeto e reaproveitado: a pasta aberta e o
 * campo de nome em edição sobrevivem ao redesenho.
 */

const LIMITE_DO_ENVIO_BYTES = 30 * 1024 * 1024;

export function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let indice = -1;
  do {
    valor /= 1024;
    indice++;
  } while (valor >= 1024 && indice < unidades.length - 1);
  return `${valor.toFixed(valor < 10 ? 1 : 0).replace('.', ',')} ${unidades[indice]}`;
}

export function juntarCaminho(pasta, nome) {
  return pasta ? `${pasta}/${nome}` : nome;
}

export function caminhoDoPai(caminho) {
  const partes = caminho.split('/');
  partes.pop();
  return partes.join('/');
}

function lerArquivoEmBase64(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => rejeitar(new Error(`Não foi possível ler "${arquivo.name}".`));
    leitor.readAsDataURL(arquivo);
  });
}

const ICONE_DE_PASTA =
  'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
const ICONE_DE_ARQUIVO = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5';
const ICONE_DE_SUBIR = 'M19 12H5 M11 6l-6 6 6 6';

/**
 * `dependencias` traz o que o `app.js` já tem pronto. O retorno cria (ou devolve o já
 * criado) o explorador de um cliente — ou de um projeto dele.
 */
export function iniciarExplorador(dependencias) {
  const {
    requisitar,
    criarElemento,
    criarBotao,
    criarBotaoDeIcone,
    ICONES,
    exibirAviso,
    selecionarPasta,
  } = dependencias;

  const exploradores = new Map();

  function raizDaApi(cliente, projeto) {
    const base = `/api/clientes/${cliente.id}`;
    return projeto ? `${base}/projetos/${projeto.id}/arquivos` : `${base}/arquivos`;
  }

  function criarExplorador(cliente, projeto) {
    const api = raizDaApi(cliente, projeto);
    const estado = { caminho: '', dados: null, editando: false, excluindo: null };

    const elemento = criarElemento('div', 'explorador');
    const cabecalho = criarElemento('div', 'explorador-cabecalho');
    const trilha = criarElemento('div', 'explorador-trilha');
    const barra = criarElemento('div', 'explorador-barra');
    const lista = criarElemento('div', 'explorador-lista');
    const entradaDeArquivos = criarElemento('input');
    entradaDeArquivos.type = 'file';
    entradaDeArquivos.multiple = true;
    entradaDeArquivos.hidden = true;
    elemento.append(cabecalho, trilha, barra, lista, entradaDeArquivos);

    const chamar = (sufixo, corpo, metodo = 'POST') =>
      requisitar(`${api}${sufixo}`, { metodo, corpo });

    async function executar(acao, mensagemDeSucesso) {
      try {
        await acao();
        if (mensagemDeSucesso) exibirAviso(mensagemDeSucesso);
      } catch (erro) {
        exibirAviso(erro.message, 'erro');
      }
      await atualizar();
    }

    async function atualizar() {
      try {
        estado.dados = await requisitar(`${api}?caminho=${encodeURIComponent(estado.caminho)}`);
      } catch (erro) {
        // A subpasta sumiu (apagada por fora): volta para a raiz em vez de travar na tela.
        if (estado.caminho) {
          estado.caminho = '';
          return atualizar();
        }
        estado.dados = { pasta: null, itens: [], existe: false, erro: erro.message };
      }
      desenhar();
    }

    function navegar(caminho) {
      estado.caminho = caminho;
      estado.editando = false;
      estado.excluindo = null;
      void atualizar();
    }

    async function escolherPasta() {
      try {
        const escolha = await selecionarPasta();
        if (!escolha?.caminho) return;
        await chamar('/pasta', { pasta: escolha.caminho }, 'PUT');
        estado.caminho = '';
        await atualizar();
      } catch (erro) {
        exibirAviso(erro.message, 'erro');
      }
    }

    async function desvincular() {
      await executar(() => chamar('/pasta', { pasta: null }, 'PUT'), 'Pasta desvinculada.');
    }

    async function enviar(arquivos) {
      for (const arquivo of arquivos) {
        if (arquivo.size > LIMITE_DO_ENVIO_BYTES) {
          exibirAviso(`"${arquivo.name}" passa de 30 MB: copie-o direto pela pasta.`, 'erro');
          continue;
        }
        try {
          const conteudoBase64 = await lerArquivoEmBase64(arquivo);
          await chamar('/enviar', { caminho: estado.caminho, nome: arquivo.name, conteudoBase64 });
          exibirAviso(`"${arquivo.name}" enviado.`);
        } catch (erro) {
          exibirAviso(erro.message, 'erro');
        }
      }
      await atualizar();
    }

    entradaDeArquivos.addEventListener('change', () => {
      const arquivos = [...entradaDeArquivos.files];
      entradaDeArquivos.value = '';
      void enviar(arquivos);
    });

    // Arrastar do Windows para a lista envia para a pasta aberta.
    let arrastos = 0;
    elemento.addEventListener('dragenter', (evento) => {
      if (!evento.dataTransfer?.types.includes('Files') || !estado.dados?.pasta) return;
      evento.preventDefault();
      arrastos++;
      elemento.classList.add('explorador-recebendo');
    });
    elemento.addEventListener('dragover', (evento) => {
      if (estado.dados?.pasta && evento.dataTransfer?.types.includes('Files')) {
        evento.preventDefault();
      }
    });
    elemento.addEventListener('dragleave', () => {
      arrastos = Math.max(0, arrastos - 1);
      if (!arrastos) elemento.classList.remove('explorador-recebendo');
    });
    elemento.addEventListener('drop', (evento) => {
      arrastos = 0;
      elemento.classList.remove('explorador-recebendo');
      if (!estado.dados?.pasta || !evento.dataTransfer?.files.length) return;
      evento.preventDefault();
      void enviar([...evento.dataTransfer.files]);
    });

    /** Linha com campo de nome: serve para criar pasta, criar arquivo e renomear. */
    function criarLinhaDeEdicao({ icone, valorInicial, rotulo, aoConfirmar }) {
      const linha = criarElemento('div', 'explorador-linha explorador-edicao');
      linha.append(criarIcone(icone));
      const campo = criarElemento('input', 'explorador-campo');
      campo.type = 'text';
      campo.value = valorInicial;
      campo.setAttribute('aria-label', rotulo);
      campo.spellcheck = false;
      const cancelar = () => {
        estado.editando = false;
        desenhar();
      };
      const confirmar = async () => {
        const nome = campo.value.trim();
        if (!nome) return;
        estado.editando = false;
        await executar(() => aoConfirmar(nome));
      };
      campo.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          void confirmar();
        } else if (evento.key === 'Escape') {
          cancelar();
        }
      });
      linha.append(
        campo,
        criarBotao('btn tiny primario', 'OK', () => void confirmar()),
        criarBotao('btn tiny ghost', 'Cancelar', cancelar),
      );
      requestAnimationFrame(() => {
        campo.focus();
        const ponto = valorInicial.lastIndexOf('.');
        campo.setSelectionRange(0, ponto > 0 ? ponto : valorInicial.length);
      });
      return linha;
    }

    function criarIcone(caminho) {
      const span = criarElemento('span', 'explorador-icone');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const forma = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      forma.setAttribute('d', caminho);
      svg.append(forma);
      span.append(svg);
      return span;
    }

    function criarLinhaDeItem(item) {
      const caminho = juntarCaminho(estado.caminho, item.nome);
      const ehPasta = item.tipo === 'pasta';

      if (estado.editando?.tipo === 'renomear' && estado.editando.nome === item.nome) {
        return criarLinhaDeEdicao({
          icone: ehPasta ? ICONE_DE_PASTA : ICONE_DE_ARQUIVO,
          valorInicial: item.nome,
          rotulo: `Novo nome de ${item.nome}`,
          aoConfirmar: (nome) =>
            chamar('/renomear', { caminho, nome }).then(() => exibirAviso('Renomeado.')),
        });
      }

      const linha = criarElemento('div', `explorador-linha${ehPasta ? ' explorador-pasta' : ''}`);
      linha.append(criarIcone(ehPasta ? ICONE_DE_PASTA : ICONE_DE_ARQUIVO));

      const nome = criarElemento('button', 'explorador-nome', item.nome);
      nome.type = 'button';
      nome.title = ehPasta ? 'Abrir a pasta' : 'Abrir no programa padrão';
      nome.addEventListener('click', () => {
        if (ehPasta) navegar(caminho);
        else void executar(() => chamar('/abrir', { caminho }));
      });
      linha.append(nome);

      linha.append(
        criarElemento('span', 'explorador-meta', ehPasta ? '' : formatarTamanho(item.tamanho)),
        criarElemento(
          'span',
          'explorador-meta',
          new Date(item.modificadoEm).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          }),
        ),
      );

      if (estado.excluindo === item.nome) {
        const confirmacao = criarElemento('span', 'explorador-confirmar');
        confirmacao.append(
          criarElemento(
            'span',
            null,
            ehPasta ? 'Excluir a pasta e tudo dentro dela?' : 'Excluir o arquivo?',
          ),
          criarBotao('btn tiny danger', 'Excluir', () => {
            estado.excluindo = null;
            void executar(() => chamar('/excluir', { caminho }), `"${item.nome}" excluído.`);
          }),
          criarBotao('btn tiny ghost', 'Cancelar', () => {
            estado.excluindo = null;
            desenhar();
          }),
        );
        linha.append(confirmacao);
        return linha;
      }

      const acoes = criarElemento('span', 'explorador-acoes');
      acoes.append(
        criarBotaoDeIcone('btn tiny ghost', ICONES.pasta, 'Mostrar no Windows Explorer', () =>
          executar(() => chamar('/mostrar', { caminho })),
        ),
        criarBotaoDeIcone('btn tiny ghost', ICONES.lapis, 'Renomear', () => {
          estado.editando = { tipo: 'renomear', nome: item.nome };
          desenhar();
        }),
        criarBotaoDeIcone('btn tiny ghost', ICONES.lixeira, 'Excluir', () => {
          estado.excluindo = item.nome;
          desenhar();
        }),
      );
      linha.append(acoes);
      return linha;
    }

    function desenharCabecalho() {
      const { dados } = estado;
      cabecalho.replaceChildren();
      const titulo = criarElemento(
        'span',
        'explorador-raiz',
        dados.pasta ?? 'Nenhuma pasta escolhida',
      );
      titulo.title = dados.pasta ?? '';
      cabecalho.append(titulo);
      const acoes = criarElemento('span', 'explorador-acoes-topo');
      acoes.append(
        criarBotao('btn tiny', dados.pasta ? 'Trocar pasta' : 'Escolher pasta', () =>
          escolherPasta(),
        ),
      );
      if (dados.pasta) {
        acoes.append(
          criarBotaoDeIcone('btn tiny', ICONES.recarregar, 'Atualizar a lista', () => atualizar()),
          criarBotaoDeIcone('btn tiny', ICONES.pasta, 'Abrir no Windows Explorer', () =>
            executar(() => chamar('/abrir', { caminho: estado.caminho })),
          ),
          criarBotao('btn tiny ghost', 'Desvincular', () => desvincular()),
        );
      }
      cabecalho.append(acoes);
    }

    function desenharTrilha() {
      trilha.replaceChildren();
      const partes = estado.caminho ? estado.caminho.split('/') : [];
      const raiz = criarElemento('button', 'explorador-migalha', 'Pasta raiz');
      raiz.type = 'button';
      raiz.addEventListener('click', () => navegar(''));
      trilha.append(raiz);
      partes.forEach((parte, indice) => {
        trilha.append(criarElemento('span', 'explorador-separador', '›'));
        const migalha = criarElemento('button', 'explorador-migalha', parte);
        migalha.type = 'button';
        migalha.addEventListener('click', () => navegar(partes.slice(0, indice + 1).join('/')));
        trilha.append(migalha);
      });
    }

    function desenharBarra() {
      barra.replaceChildren(
        criarBotao('btn tiny', 'Nova pasta', () => {
          estado.editando = { tipo: 'pasta' };
          desenhar();
        }),
        criarBotao('btn tiny', 'Novo arquivo', () => {
          estado.editando = { tipo: 'arquivo' };
          desenhar();
        }),
        criarBotao('btn tiny', 'Enviar arquivos', () => entradaDeArquivos.click()),
      );
    }

    function desenharLista() {
      const { dados } = estado;
      lista.replaceChildren();
      if (estado.caminho) {
        const subir = criarElemento('div', 'explorador-linha explorador-pasta');
        subir.append(criarIcone(ICONE_DE_SUBIR));
        const botao = criarElemento('button', 'explorador-nome', '..');
        botao.type = 'button';
        botao.title = 'Subir um nível';
        botao.addEventListener('click', () => navegar(caminhoDoPai(estado.caminho)));
        subir.append(botao);
        lista.append(subir);
      }
      if (estado.editando?.tipo === 'pasta' || estado.editando?.tipo === 'arquivo') {
        const ehPasta = estado.editando.tipo === 'pasta';
        lista.append(
          criarLinhaDeEdicao({
            icone: ehPasta ? ICONE_DE_PASTA : ICONE_DE_ARQUIVO,
            valorInicial: ehPasta ? 'Nova pasta' : 'novo-arquivo.txt',
            rotulo: ehPasta ? 'Nome da nova pasta' : 'Nome do novo arquivo',
            aoConfirmar: (nome) =>
              chamar(ehPasta ? '/criar-pasta' : '/criar-arquivo', {
                caminho: estado.caminho,
                nome,
              }),
          }),
        );
      }
      for (const item of dados.itens) lista.append(criarLinhaDeItem(item));
      if (!dados.itens.length && !estado.editando) {
        lista.append(criarElemento('p', 'texto-auxiliar explorador-vazio', 'Pasta vazia.'));
      }
      if (dados.cortada) {
        lista.append(
          criarElemento(
            'p',
            'texto-auxiliar explorador-vazio',
            'A pasta tem itens demais: só os primeiros 2.000 aparecem.',
          ),
        );
      }
    }

    function desenhar() {
      const { dados } = estado;
      desenharCabecalho();
      const semPasta = !dados.pasta;
      trilha.hidden = semPasta || !dados.existe;
      barra.hidden = semPasta || !dados.existe;
      if (semPasta) {
        lista.replaceChildren(
          criarElemento(
            'p',
            'texto-auxiliar explorador-vazio',
            projeto
              ? 'Escolha a pasta do computador onde ficam os arquivos deste projeto.'
              : 'Escolha a pasta do computador onde ficam os arquivos deste cliente.',
          ),
        );
        return;
      }
      if (!dados.existe) {
        lista.replaceChildren(
          criarElemento(
            'p',
            'texto-auxiliar explorador-vazio',
            'A pasta não existe mais neste computador. Escolha outra ou desvincule.',
          ),
        );
        return;
      }
      desenharTrilha();
      desenharBarra();
      desenharLista();
    }

    elemento.atualizarSeOcioso = () => {
      if (!estado.editando && !estado.excluindo && elemento.isConnected) void atualizar();
    };

    void atualizar();
    return elemento;
  }

  // Voltar do Windows Explorer ou de outro programa: a lista reflete o que mudou na pasta.
  window.addEventListener('focus', () => {
    for (const elemento of exploradores.values()) elemento.atualizarSeOcioso();
  });

  return {
    /** O mesmo explorador a cada chamada: a pasta aberta não se perde no redesenho. */
    criar(cliente, projeto = null) {
      const chave = `${cliente.id}:${projeto?.id ?? ''}`;
      let elemento = exploradores.get(chave);
      if (!elemento) {
        elemento = criarExplorador(cliente, projeto);
        exploradores.set(chave, elemento);
      }
      return elemento;
    },
  };
}
