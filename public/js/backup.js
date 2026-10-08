/**
 * Janela "Backup e Google Drive": a conexão com a conta do Google, a cópia dos dados
 * mantida no Drive, o backup periódico numa pasta do computador e a restauração.
 *
 * Nada aqui espera um "Salvar": cada caixa e cada campo grava na hora, e os botões agem
 * sobre o que já está gravado.
 */

function formatarTamanho(bytes) {
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

function formatarData(iso) {
  const data = new Date(iso);
  if (!iso || Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** De quanto em quanto a tela pergunta se o consentimento do Google já foi concluído. */
const INTERVALO_DA_ESPERA_DA_AUTORIZACAO_MS = 2_000;

export function iniciarBackup(dependencias) {
  const {
    requisitar,
    criarElemento,
    criarBotao,
    exibirAviso,
    selecionarPasta,
    copiarParaAreaDeTransferencia,
    modal,
    corpo,
  } = dependencias;

  const estado = {
    drive: null,
    backup: null,
    /** Cópias guardadas no Drive, lidas só quando o usuário pede para restaurar de lá. */
    copias: null,
    /** Endereço do consentimento, para copiar quando o navegador não abre sozinho. */
    enderecoDaAutorizacao: '',
    /** Rótulo da ação em curso: os botões ficam travados até ela terminar. */
    ocupado: '',
  };
  let esperaDaAutorizacao = null;

  async function carregar() {
    const [drive, backup] = await Promise.all([
      requisitar('/api/drive'),
      requisitar('/api/backup'),
    ]);
    estado.drive = drive;
    estado.backup = backup;
  }

  /** Roda a ação com os botões travados e redesenha no fim, com erro ou sem. */
  async function executar(rotulo, acao, mensagemDeSucesso) {
    if (estado.ocupado) return;
    estado.ocupado = rotulo;
    desenhar();
    try {
      await acao();
      if (mensagemDeSucesso) exibirAviso(mensagemDeSucesso);
    } catch (erro) {
      exibirAviso(erro.message, 'erro');
    } finally {
      estado.ocupado = '';
      desenhar();
    }
  }

  function pararEsperaDaAutorizacao() {
    clearTimeout(esperaDaAutorizacao);
    esperaDaAutorizacao = null;
  }

  /** Enquanto a tela do Google está aberta, confere se o usuário já autorizou. */
  function esperarAutorizacao() {
    pararEsperaDaAutorizacao();
    esperaDaAutorizacao = setTimeout(async () => {
      try {
        const antes = estado.drive?.conectado;
        estado.drive = await requisitar('/api/drive');
        if (estado.drive.conectado && !antes) {
          exibirAviso(
            `Google Drive conectado${estado.drive.email ? `: ${estado.drive.email}` : ''}.`,
          );
        }
      } catch {
        // Falha passageira da consulta: a próxima rodada tenta de novo.
      }
      desenhar();
      if (estado.drive?.autorizando && modal.open) {
        esperarAutorizacao();
      }
    }, INTERVALO_DA_ESPERA_DA_AUTORIZACAO_MS);
  }

  function conectar() {
    return executar('conectar', async () => {
      const { url } = await requisitar('/api/drive/conectar', { metodo: 'POST' });
      estado.enderecoDaAutorizacao = url;
      estado.drive = await requisitar('/api/drive');
      esperarAutorizacao();
    });
  }

  /** Serve também para desistir de uma autorização em aberto. */
  function desconectar(mensagem) {
    return executar(
      'desconectar',
      async () => {
        pararEsperaDaAutorizacao();
        estado.drive = await requisitar('/api/drive', { metodo: 'DELETE' });
        estado.copias = null;
        estado.backup = await requisitar('/api/backup');
      },
      mensagem,
    );
  }

  function salvarConfiguracao(mudanca, mensagem) {
    return executar(
      'salvar',
      async () => {
        estado.backup = await requisitar('/api/backup/configuracao', {
          metodo: 'PUT',
          corpo: { ...estado.backup.configuracao, ...mudanca },
        });
      },
      mensagem,
    );
  }

  async function escolherPasta(mudancaJunto = {}) {
    let escolha;
    try {
      escolha = await selecionarPasta();
    } catch (erro) {
      exibirAviso(erro.message, 'erro');
      return;
    }
    if (!escolha?.caminho) {
      desenhar();
      return;
    }
    await salvarConfiguracao({ ...mudancaJunto, pasta: escolha.caminho }, 'Pasta do backup salva.');
  }

  function prepararRestauracao(corpoDaRequisicao) {
    return executar('restaurar', async () => {
      const situacao = await requisitar('/api/backup/restauracao', {
        metodo: 'POST',
        corpo: corpoDaRequisicao,
      });
      // Sem resposta, o seletor de arquivo foi cancelado.
      if (situacao) {
        estado.backup = situacao;
        estado.copias = null;
      }
    });
  }

  function reiniciar() {
    return executar('reiniciar', async () => {
      try {
        await requisitar('/api/backup/reiniciar', { metodo: 'POST' });
      } catch (erro) {
        if (erro.shellIndisponivel) {
          throw new Error('Feche o HUB SNK e abra de novo para concluir a restauração.');
        }
        throw erro;
      }
    });
  }

  /* ------------------------------- desenho -------------------------------- */

  function criarCartao(titulo, selo) {
    const cartao = criarElemento('section', 'cartao-credencial');
    const cabecalho = criarElemento('div', 'cartao-credencial-cabecalho');
    cabecalho.append(criarElemento('h3', null, titulo));
    if (selo) {
      cabecalho.append(criarElemento('span', `selo-situacao ${selo.classe}`, selo.texto));
    }
    cartao.append(cabecalho);
    return cartao;
  }

  function criarAcoes(...filhos) {
    const acoes = criarElemento('div', 'cartao-credencial-acoes');
    acoes.append(...filhos);
    return acoes;
  }

  function criarBotaoDeAcao(classe, texto, aoClicar) {
    const botao = criarBotao(classe, texto, aoClicar);
    botao.disabled = Boolean(estado.ocupado);
    return botao;
  }

  function criarCaixa(texto, marcada, habilitada, aoMudar) {
    const rotulo = criarElemento('label', 'campo-checkbox');
    const caixa = criarElemento('input');
    caixa.type = 'checkbox';
    caixa.checked = marcada;
    caixa.disabled = !habilitada || Boolean(estado.ocupado);
    caixa.addEventListener('change', () => aoMudar(caixa.checked));
    rotulo.append(caixa, ` ${texto}`);
    return rotulo;
  }

  /** Itens lado a lado, quebrando só se a janela ficar estreita. */
  function criarLinha(...filhos) {
    const linha = criarElemento('div', 'linha-do-cartao');
    linha.append(...filhos);
    return linha;
  }

  function criarCampoNumerico(id, texto, unidade, valor, minimo, maximo, aoMudar) {
    const campo = criarElemento('label', 'campo-numerico-inline');
    campo.htmlFor = id;
    const entrada = criarElemento('input');
    entrada.id = id;
    entrada.type = 'number';
    entrada.min = String(minimo);
    entrada.max = String(maximo);
    entrada.value = String(valor);
    entrada.disabled = Boolean(estado.ocupado);
    entrada.addEventListener('change', () => {
      const numero = Number(entrada.value);
      if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
        exibirAviso(`Informe um número inteiro de ${minimo} a ${maximo}.`, 'erro');
        entrada.value = String(valor);
        return;
      }
      aoMudar(numero);
    });
    campo.append(texto, entrada, unidade);
    return campo;
  }

  function seloDoDrive() {
    const { drive } = estado;
    if (drive.conectado) return { classe: 'ok', texto: 'Conectado' };
    if (drive.autorizando) return { classe: 'atencao', texto: 'Aguardando a autorização' };
    return { classe: '', texto: 'Não conectado' };
  }

  function criarCartaoDoDrive() {
    const { drive, backup } = estado;
    const cartao = criarCartao('Google Drive', seloDoDrive());

    if (!drive.configurado) {
      cartao.append(
        criarElemento(
          'p',
          'texto-auxiliar',
          'Esta versão do HUB SNK ainda não tem a integração com o Google Drive configurada.',
        ),
      );
      return cartao;
    }
    if (!drive.cofreDisponivel) {
      cartao.append(
        criarElemento(
          'p',
          'aviso-shell',
          'O aplicativo HUB SNK não está respondendo. A conexão com o Google Drive só funciona com o painel aberto por ele.',
        ),
      );
      return cartao;
    }

    if (drive.autorizando) {
      /*
       * Reabrir é começar outra tentativa, que abre o navegador padrão de novo. Um link
       * comum abriria numa guia do HUB SNK, e o Google recusa o login dentro de aplicativo.
       */
      const acoes = criarAcoes(
        criarBotaoDeAcao('btn ghost', 'Abrir a tela de novo', () => conectar()),
      );
      if (estado.enderecoDaAutorizacao) {
        acoes.append(
          criarBotaoDeAcao('btn ghost', 'Copiar o link', () =>
            copiarParaAreaDeTransferencia(
              estado.enderecoDaAutorizacao,
              'Link copiado. Cole no seu navegador.',
            ),
          ),
        );
      }
      acoes.append(
        criarElemento('span', 'rodape-espacador'),
        criarBotaoDeAcao('btn ghost', 'Cancelar', () => desconectar()),
      );
      cartao.append(
        criarElemento(
          'p',
          'texto-auxiliar',
          'Conclua a autorização na tela do Google, que abriu no seu navegador padrão.',
        ),
        acoes,
      );
      return cartao;
    }

    if (!drive.conectado) {
      cartao.append(
        criarElemento(
          'p',
          'texto-auxiliar',
          'Conecte a sua conta para guardar no Drive uma cópia dos dados do HUB SNK. O HUB SNK só ' +
            'enxerga e altera os arquivos que ele mesmo criou, nunca o resto do seu Drive.',
        ),
      );
      if (drive.erro) {
        cartao.append(criarElemento('p', 'erro-formulario', drive.erro));
      }
      cartao.append(
        criarAcoes(criarBotaoDeAcao('btn primario', 'Conectar ao Google Drive', () => conectar())),
      );
      return cartao;
    }

    const enviar = criarBotaoDeAcao(
      'btn ghost',
      estado.ocupado === 'enviar' ? 'Enviando…' : 'Enviar agora',
      () =>
        executar(
          'enviar',
          async () => {
            estado.backup = await requisitar('/api/backup/drive', { metodo: 'POST' });
          },
          'Cópia enviada ao Google Drive.',
        ),
    );
    enviar.disabled ||= !drive.podeGuardarCopia;
    cartao.append(
      criarLinha(
        criarElemento(
          'span',
          'linha-do-cartao-texto',
          drive.email ? `Conta: ${drive.email}` : 'Conta conectada.',
        ),
        enviar,
        criarBotaoDeAcao('btn ghost', 'Desconectar', () =>
          desconectar('Google Drive desconectado.'),
        ),
      ),
    );
    if (!drive.podeGuardarCopia) {
      cartao.append(
        criarElemento(
          'p',
          'aviso-shell',
          'A conta foi conectada sem a permissão de guardar a cópia dos dados. Desconecte e conecte ' +
            'de novo, deixando a permissão marcada na tela do Google.',
        ),
      );
    }

    cartao.append(
      criarCaixa(
        'Manter no Google Drive uma cópia sempre atual dos dados',
        backup.configuracao.espelharNoDrive,
        drive.podeGuardarCopia,
        (ligado) =>
          salvarConfiguracao(
            { espelharNoDrive: ligado },
            ligado ? 'Cópia no Google Drive ligada.' : 'Cópia no Google Drive desligada.',
          ),
      ),
    );
    if (backup.drive.erro) {
      cartao.append(
        criarElemento('p', 'erro-formulario', `A última tentativa falhou: ${backup.drive.erro}`),
      );
    } else {
      const ultima = backup.drive.ultimoEm
        ? ` Última cópia em ${formatarData(backup.drive.ultimoEm)}.`
        : '';
      cartao.append(
        criarElemento(
          'p',
          'texto-auxiliar',
          `Arquivo ${backup.drive.nomeDoArquivo}, na pasta "HUB SNK" do seu Drive. ` +
            `As senhas do cadastro vão dentro: não compartilhe a pasta.${ultima}`,
        ),
      );
    }
    return cartao;
  }

  function criarCartaoDoBackupLocal() {
    const { configuracao, local } = estado.backup;
    const ligado = configuracao.ativo && configuracao.pasta !== '';
    const cartao = criarCartao(
      'Backup neste computador',
      ligado ? { classe: 'ok', texto: 'Ligado' } : { classe: '', texto: 'Desligado' },
    );

    // Ligar sem pasta abre o seletor: backup ligado sem destino não faria nada.
    const caixa = criarCaixa('Fazer backup periodicamente', configuracao.ativo, true, (marcada) =>
      marcada && !configuracao.pasta
        ? escolherPasta({ ativo: true })
        : salvarConfiguracao({ ativo: marcada }, marcada ? 'Backup ligado.' : 'Backup desligado.'),
    );
    caixa.title = 'Grava um .zip com todos os dados, só quando algo mudou desde o backup anterior.';

    const entradaDaPasta = criarElemento('input');
    entradaDaPasta.id = 'campo-backup-pasta';
    entradaDaPasta.type = 'text';
    entradaDaPasta.readOnly = true;
    entradaDaPasta.value = configuracao.pasta;
    entradaDaPasta.placeholder = 'Pasta do backup: outro disco, rede, OneDrive…';
    entradaDaPasta.setAttribute('aria-label', 'Pasta do backup');
    const campoDaPasta = criarElemento('div', 'campo-com-acao');
    campoDaPasta.append(
      entradaDaPasta,
      criarBotaoDeAcao('btn ghost', 'Escolher pasta', () => escolherPasta()),
    );

    const agora = criarBotaoDeAcao(
      'btn ghost',
      estado.ocupado === 'backup' ? 'Gravando…' : 'Fazer backup agora',
      () =>
        executar(
          'backup',
          async () => {
            estado.backup = await requisitar('/api/backup/local', { metodo: 'POST' });
          },
          'Backup gravado.',
        ),
    );
    agora.disabled ||= !configuracao.pasta;

    cartao.append(
      criarLinha(
        caixa,
        criarElemento('span', 'rodape-espacador'),
        criarCampoNumerico(
          'campo-backup-intervalo',
          'a cada',
          'h',
          configuracao.intervaloHoras,
          1,
          720,
          (intervaloHoras) => salvarConfiguracao({ intervaloHoras }, 'Intervalo do backup salvo.'),
        ),
        criarCampoNumerico(
          'campo-backup-copias',
          'manter as últimas',
          'cópias',
          configuracao.copiasMantidas,
          1,
          365,
          (copiasMantidas) => salvarConfiguracao({ copiasMantidas }, 'Quantidade de cópias salva.'),
        ),
      ),
      campoDaPasta,
    );

    let situacao;
    if (local.erro) {
      situacao = criarElemento(
        'span',
        'linha-do-cartao-erro',
        `O último backup falhou: ${local.erro}`,
      );
    } else {
      situacao = criarElemento(
        'span',
        'linha-do-cartao-texto',
        local.ultimoEm
          ? `Último backup em ${formatarData(local.ultimoEm)}.`
          : 'Nenhum backup feito ainda.',
      );
      situacao.title = local.arquivo;
    }
    cartao.append(criarLinha(situacao, agora));
    return cartao;
  }

  function criarLinhaDeCopia(copia) {
    const linha = criarElemento('div', 'linha-de-copia');
    linha.append(
      criarElemento('span', 'linha-de-copia-nome', copia.nome),
      criarElemento(
        'span',
        'linha-de-copia-meta',
        `${formatarData(copia.modificadoEm)} · ${formatarTamanho(copia.tamanho)}`,
      ),
      criarBotaoDeAcao('btn tiny', 'Restaurar esta', () =>
        prepararRestauracao({ origem: 'drive', idDoArquivo: copia.id }),
      ),
    );
    return linha;
  }

  function criarCartaoDaRestauracao() {
    const { drive, backup } = estado;
    const pendente = backup.restauracaoPendente;
    const cartao = criarCartao(
      'Restaurar',
      pendente ? { classe: 'atencao', texto: 'À espera do reinício' } : null,
    );

    if (pendente) {
      cartao.append(
        criarElemento(
          'p',
          'texto-auxiliar',
          `O backup de ${formatarData(pendente.geradoEm)} está pronto: ao reiniciar, os dados voltam ` +
            'ao que eram nele. Os de agora ficam guardados antes da troca.',
        ),
        criarAcoes(
          criarBotaoDeAcao('btn primario', 'Reiniciar o HUB SNK agora', () => reiniciar()),
          criarBotaoDeAcao('btn ghost', 'Cancelar a restauração', () =>
            executar(
              'cancelar',
              async () => {
                estado.backup = await requisitar('/api/backup/restauracao', { metodo: 'DELETE' });
              },
              'Restauração cancelada.',
            ),
          ),
        ),
      );
      return cartao;
    }

    cartao.append(
      criarElemento(
        'p',
        'texto-auxiliar',
        'Troca todos os dados pelos do backup escolhido, só depois de reiniciar. Os de agora ficam guardados.',
      ),
    );

    const doDrive = criarBotaoDeAcao('btn ghost', 'Restaurar do Google Drive', () =>
      executar('copias', async () => {
        estado.copias = (await requisitar('/api/backup/drive/copias')).copias;
      }),
    );
    doDrive.disabled ||= !drive.conectado || !drive.podeGuardarCopia;
    cartao.append(
      criarAcoes(
        doDrive,
        criarBotaoDeAcao('btn ghost', 'Restaurar de um arquivo de backup', () =>
          prepararRestauracao({ origem: 'arquivo' }),
        ),
      ),
    );

    if (estado.copias) {
      if (estado.copias.length === 0) {
        cartao.append(
          criarElemento('p', 'secao-vazia', 'Nenhuma cópia dos dados nesta conta do Google Drive.'),
        );
      } else {
        const lista = criarElemento('div', 'lista-de-copias');
        lista.append(...estado.copias.map(criarLinhaDeCopia));
        cartao.append(lista);
      }
    }
    return cartao;
  }

  function desenhar() {
    if (!estado.drive || !estado.backup) {
      corpo.replaceChildren(criarElemento('p', 'secao-vazia', 'Carregando…'));
      return;
    }
    corpo.replaceChildren(
      criarCartaoDoDrive(),
      criarCartaoDoBackupLocal(),
      criarCartaoDaRestauracao(),
    );
  }

  modal.addEventListener('close', pararEsperaDaAutorizacao);

  return {
    async abrir() {
      estado.copias = null;
      desenhar();
      try {
        await carregar();
      } catch (erro) {
        corpo.replaceChildren(criarElemento('p', 'erro-formulario', erro.message));
        return;
      }
      desenhar();
      if (estado.drive.autorizando) esperarAutorizacao();
    },
  };
}
