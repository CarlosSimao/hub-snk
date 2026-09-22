/*
 * Leitura do arquivo de cadastros do HUB SNK.
 *
 * É o mesmo texto que os botões "Exportar" e "Compartilhar" geram: blocos
 * separados por uma linha de traços, cada um encabeçado por `Cliente:` e seguido
 * dos campos rotulados da base e, quando exportado, do banco de dados.
 *
 * O formato é legível de propósito — quem recebe abre no bloco de notas —, então
 * a leitura tolera acento, caixa, espaço sobrando e campo ausente. O que não dá
 * para aproveitar não derruba o arquivo inteiro: vira aviso e o resto entra.
 *
 * O módulo é puro de propósito — nada de DOM — porque o mesmo código precisa
 * rodar fora do navegador nos testes.
 */

/*
 * A exportação escreve 60 traços, mas três já bastam para separar: arquivo
 * editado à mão ou colado em outro programa costuma perder alguns.
 */
const SEPARADOR_DE_BLOCO = /^\s*-{3,}\s*$/;

const DIACRITICOS = /\p{Diacritic}/gu;
const FORA_DE_LETRA_OU_DIGITO = /[^\p{L}\p{N}]+/gu;

/* Marca que a exportação grava no lugar de um campo opcional em branco. */
const MARCA_DE_CAMPO_VAZIO = '—';

const ROTULO_DO_CLIENTE = 'cliente';

/* Linha sem valor que abre a seção do banco de dados dentro do bloco. */
const ROTULO_DE_ABERTURA_DO_BANCO = 'banco de dados';

/* Rótulo do arquivo → propriedade da base. */
const PROPRIEDADES_DA_BASE = {
  'tipo de base': 'tipo',
  url: 'url',
  usuario: 'usuario',
  senha: 'senha',
};

/* Rótulo do arquivo → propriedade do banco de dados. */
const PROPRIEDADES_DO_BANCO = {
  host: 'host',
  porta: 'porta',
  servico: 'nomeDoServico',
  'nome do servico': 'nomeDoServico',
  usuario: 'usuario',
  senha: 'senha',
};

/* O rótulo exportado do tipo, achatado, é igual ao valor guardado no cadastro. */
const TIPOS_DE_BASE = ['producao', 'teste', 'outro'];

/* Tipo de quem chegou sem rótulo reconhecível: não dá para inventar ambiente. */
const TIPO_PADRAO = 'outro';

const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;

function semAcentos(valor) {
  return valor.normalize('NFD').replace(DIACRITICOS, '');
}

/** Rótulos e tipos são comparados sem acento, sem caixa e sem espaço nas pontas. */
function achatarRotulo(valor) {
  return semAcentos(valor).trim().toLocaleLowerCase('pt-BR');
}

/**
 * Só letras e dígitos, minúsculos e sem acento.
 *
 * É a mesma chave do servidor: "NecoTruck", "necotruck" e "Neco Truck" viram um
 * cliente só, mesmo que o arquivo tenha sido escrito de outro jeito.
 */
function chaveAchatadaDeNome(valor) {
  return semAcentos(valor).toLocaleLowerCase('pt-BR').replace(FORA_DE_LETRA_OU_DIGITO, '');
}

/*
 * Cópia da checagem do app.js de propósito: este módulo roda nos testes fora do
 * navegador e não pode depender da tela.
 */
function ehEnderecoNavegavel(endereco) {
  try {
    const protocolo = new URL(endereco).protocol;
    return protocolo === 'http:' || protocolo === 'https:';
  } catch {
    return false;
  }
}

/**
 * Separa `Rótulo: valor` na primeira aparição de `:`.
 *
 * O valor fica com os `:` restantes — a URL tem o do protocolo e o da porta.
 * Devolve `null` para linha sem `:`, que não é um campo.
 */
function separarRotuloEValor(linha) {
  const posicao = linha.indexOf(':');
  if (posicao === -1) {
    return null;
  }

  return {
    rotulo: achatarRotulo(linha.slice(0, posicao)),
    valor: linha.slice(posicao + 1).trim(),
  };
}

function criarBaseEmBranco() {
  return { url: '', tipo: '', usuario: '', senha: '' };
}

function criarBancoEmBranco() {
  return { host: '', porta: '', nomeDoServico: '', usuario: '', senha: '' };
}

function dividirEmBlocos(texto) {
  const blocos = [[]];

  for (const linha of texto.split(/\r?\n/)) {
    if (SEPARADOR_DE_BLOCO.test(linha)) {
      blocos.push([]);
      continue;
    }

    blocos.at(-1).push(linha);
  }

  return blocos.map((linhas) => linhas.join('\n')).filter((bloco) => bloco.trim() !== '');
}

/**
 * Um bloco do arquivo: o nome do cliente e as bases que vierem nele.
 *
 * A exportação escreve uma base por bloco, mas repetir um rótulo já preenchido é
 * lido como o começo de outra base — assim um arquivo montado à mão, com as
 * bases do cliente em sequência, também é aproveitado.
 */
function lerBloco(bloco) {
  let nome = '';
  const bases = [];
  let base = null;
  let banco = null;

  const iniciarBase = () => {
    base = criarBaseEmBranco();
    banco = null;
    bases.push(base);
  };

  for (const linhaBruta of bloco.split('\n')) {
    const linha = linhaBruta.trim();
    if (linha === '') {
      continue;
    }

    if (achatarRotulo(linha) === ROTULO_DE_ABERTURA_DO_BANCO) {
      if (!base) {
        iniciarBase();
      }
      banco = criarBancoEmBranco();
      base.bancoDeDados = banco;
      continue;
    }

    const campo = separarRotuloEValor(linha);
    if (!campo) {
      continue;
    }

    const valor = campo.valor === MARCA_DE_CAMPO_VAZIO ? '' : campo.valor;

    if (campo.rotulo === ROTULO_DO_CLIENTE) {
      nome = valor;
      continue;
    }

    if (banco) {
      const propriedade = PROPRIEDADES_DO_BANCO[campo.rotulo];
      if (propriedade) {
        banco[propriedade] = valor;
      }
      continue;
    }

    const propriedade = PROPRIEDADES_DA_BASE[campo.rotulo];
    if (!propriedade) {
      continue;
    }

    if (base && base[propriedade] !== '') {
      iniciarBase();
    }
    if (!base) {
      iniciarBase();
    }

    base[propriedade] = valor;
  }

  return { nome, bases };
}

/**
 * Banco aproveitável ou `null`: faltando qualquer campo, o cadastro seria
 * recusado pelo servidor, e importar a base sem o banco é melhor do que perder a
 * base inteira.
 */
function validarBanco(banco, nomeDoCliente, url, avisos) {
  const porta = Number(banco.porta);
  const camposPreenchidos =
    banco.host !== '' && banco.nomeDoServico !== '' && banco.usuario !== '' && banco.senha !== '';
  const portaValida = Number.isInteger(porta) && porta >= PORTA_MINIMA && porta <= PORTA_MAXIMA;

  if (!camposPreenchidos || !portaValida) {
    avisos.push(
      `O banco de dados de "${nomeDoCliente}" em ${url} está incompleto no arquivo e foi ignorado.`,
    );
    return null;
  }

  return {
    host: banco.host,
    porta,
    nomeDoServico: banco.nomeDoServico,
    usuario: banco.usuario,
    senha: banco.senha,
  };
}

/** Base aproveitável ou `null`; sem URL navegável não há o que cadastrar. */
function validarBase(base, nomeDoCliente, avisos) {
  if (base.url === '') {
    avisos.push(
      `Um bloco de "${nomeDoCliente}" veio sem URL e foi ignorado — só a URL identifica a base.`,
    );
    return null;
  }

  if (!ehEnderecoNavegavel(base.url)) {
    avisos.push(`A base "${base.url}" de "${nomeDoCliente}" não é um endereço http ou https.`);
    return null;
  }

  const tipoDoArquivo = achatarRotulo(base.tipo);
  const tipo = TIPOS_DE_BASE.includes(tipoDoArquivo) ? tipoDoArquivo : TIPO_PADRAO;
  if (tipo !== tipoDoArquivo) {
    avisos.push(
      `A base "${base.url}" de "${nomeDoCliente}" entrou como "Outro": tipo não indicado.`,
    );
  }

  const validada = {
    url: base.url,
    tipo,
    usuario: base.usuario,
    senha: base.senha,
  };

  if (base.bancoDeDados) {
    const banco = validarBanco(base.bancoDeDados, nomeDoCliente, base.url, avisos);
    if (banco) {
      validada.bancoDeDados = banco;
    }
  }

  return validada;
}

/**
 * Lê o texto exportado e devolve `{ clientes, avisos }`.
 *
 * Blocos do mesmo cliente viram um cadastro só, com as bases reunidas — é o que
 * o arquivo de exportação sempre traz, uma base por bloco. A URL repetida no
 * mesmo cliente fica na primeira aparição.
 *
 * Lança `Error` com a mensagem exibida ao usuário quando não sobrou nada para
 * importar; o resto é reportado em `avisos`, sem interromper a leitura.
 */
export function lerCadastrosDoTexto(conteudo) {
  const avisos = [];
  const clientesPorChave = new Map();

  for (const bloco of dividirEmBlocos(conteudo)) {
    const { nome, bases } = lerBloco(bloco);

    if (nome === '') {
      avisos.push('Um bloco do arquivo veio sem a linha "Cliente:" e foi ignorado.');
      continue;
    }

    const chave = chaveAchatadaDeNome(nome);
    if (!clientesPorChave.has(chave)) {
      clientesPorChave.set(chave, { nome, bases: [], urlsLidas: new Set() });
    }
    const cliente = clientesPorChave.get(chave);

    for (const base of bases) {
      const validada = validarBase(base, cliente.nome, avisos);
      if (!validada) {
        continue;
      }

      const urlAchatada = validada.url.toLocaleLowerCase('pt-BR');
      if (cliente.urlsLidas.has(urlAchatada)) {
        avisos.push(
          `A base "${validada.url}" aparece mais de uma vez em "${cliente.nome}"; valeu a primeira.`,
        );
        continue;
      }

      cliente.urlsLidas.add(urlAchatada);
      cliente.bases.push(validada);
    }
  }

  if (clientesPorChave.size === 0) {
    throw new Error(
      'Nenhum cliente encontrado no arquivo. Use o arquivo gerado pelo "Exportar" ou pelo "Compartilhar" do HUB SNK.',
    );
  }

  const clientes = [...clientesPorChave.values()].map((cliente) => ({
    nome: cliente.nome,
    bases: cliente.bases,
  }));

  return { clientes, avisos };
}
