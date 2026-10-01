import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ehPerfilProfissional,
  FUNCIONALIDADES_OCULTAS_POR_PERFIL,
  PERFIL_PADRAO,
} from '../acessos.ts';
import {
  DESTINOS_DE_LINK,
  FUNCIONALIDADES,
  SEGURANCAS_SMTP,
  type AlertaDaAgenda,
  type Atalho,
  type ConfiguracaoGlobal,
  type ConfiguracaoSmtp,
  type DestinoDeLink,
  type Funcionalidade,
  type PerfilProfissional,
} from '../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import { FilaDeOperacoes } from './filaDeOperacoes.ts';
import type {
  ConfiguracaoParaSalvar,
  DadosDeAtalho,
  RepositorioConfiguracao,
} from './repositorioConfiguracao.ts';

const NOME_DO_ARQUIVO = 'configuracao.json';
const CHAVE_DO_CORPO = 'configuracao';
const INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S = 30;
const TEMPO_LIMITE_PADRAO_S = 5;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;

const DESTINO_DOS_LINKS_PADRAO: DestinoDeLink = 'hub';

const PORTA_SMTP_PADRAO = 587;
const INTERVALO_DO_ALERTA_DA_AGENDA_PADRAO_MIN = 120;

const SMTP_INICIAL: ConfiguracaoSmtp = {
  host: '',
  porta: PORTA_SMTP_PADRAO,
  seguranca: 'starttls',
  usuario: '',
  senha: '',
  remetente: '',
  destinatario: '',
};

/* Nasce desligado: sem SMTP e sem saber se o usuário lança OS, ligar sozinho só faria barulho. */
const ALERTA_DA_AGENDA_INICIAL: AlertaDaAgenda = {
  ativo: false,
  intervaloMinutos: INTERVALO_DO_ALERTA_DA_AGENDA_PADRAO_MIN,
  incluirProximoDiaUtil: false,
  repetirAteResolver: false,
  enviarEmail: true,
};

const CONFIGURACAO_INICIAL: Omit<
  ConfiguracaoGlobal,
  'perfil' | 'funcionalidadesOcultas' | 'terceiro'
> = {
  scriptPadrao: '',
  intervaloDeExecucaoAutomaticaSegundos: INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
  tempoLimiteSegundos: TEMPO_LIMITE_PADRAO_S,
  caminhoDoSchemaMcp: '',
  atalhos: [],
  destinoDosLinks: DESTINO_DOS_LINKS_PADRAO,
  caminhoDoExecutavelDaIde: '',
  experiencePersonId: '',
  sankhyaOmCodUsu: '',
  smtp: SMTP_INICIAL,
  alertaDaAgenda: ALERTA_DA_AGENDA_INICIAL,
};

/**
 * Nomes usados por versões anteriores do arquivo. O intervalo só foi
 * renomeado; o tempo limite, além de renomeado, era gravado em milissegundos.
 */
interface ConfiguracaoAnterior {
  intervaloDeAtualizacaoDoStatusDoBancoSegundos?: number;
  tempoLimiteDeStatusDaBaseMs?: number;
}

function lerTempoLimiteSegundos(dados: Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior): number {
  if (dados.tempoLimiteSegundos !== undefined) {
    return dados.tempoLimiteSegundos;
  }

  if (dados.tempoLimiteDeStatusDaBaseMs !== undefined) {
    return Math.max(1, Math.round(dados.tempoLimiteDeStatusDaBaseMs / MILISSEGUNDOS_POR_SEGUNDO));
  }

  return TEMPO_LIMITE_PADRAO_S;
}

function ehDestinoDeLink(valor: unknown): valor is DestinoDeLink {
  return (DESTINOS_DE_LINK as readonly unknown[]).includes(valor);
}

/** Arquivo de antes desta versão não tem a chave, e um valor editado à mão inválido volta ao padrão. */
function lerDestinoDosLinks(valor: unknown): DestinoDeLink {
  return ehDestinoDeLink(valor) ? valor : DESTINO_DOS_LINKS_PADRAO;
}

function ehFuncionalidade(valor: unknown): valor is Funcionalidade {
  return (FUNCIONALIDADES as readonly unknown[]).includes(valor);
}

/** Repetidas saem, e uma que deixou de existir numa versão nova some do arquivo. */
function normalizarFuncionalidadesOcultas(valores: readonly unknown[]): Funcionalidade[] {
  return [...new Set(valores.filter(ehFuncionalidade))];
}

/** O que o instalador escolheu; só vale para o que o arquivo ainda não tem gravado. */
export interface AcessosIniciais {
  perfil: PerfilProfissional;
  terceiro: boolean;
  /** Falso quando a caixa do Git AutoSync ficou desmarcada no instalador. */
  autosyncInstalado: boolean;
  /** Caixas desmarcadas na página do perfil; ausente, vale o preset do perfil. */
  funcionalidadesOcultas?: readonly unknown[];
}

const ACESSOS_INICIAIS_PADRAO: AcessosIniciais = {
  perfil: PERFIL_PADRAO,
  terceiro: false,
  autosyncInstalado: true,
};

/** Sem o Git AutoSync instalado, a aba Git do menu e a seção do cliente não teriam o que mostrar. */
const FUNCIONALIDADES_DO_AUTOSYNC: readonly Funcionalidade[] = ['autosync', 'cliente.autosync'];

/** As caixas do instalador só valem para o perfil escolhido junto com elas. */
function presetInicial(perfil: PerfilProfissional, iniciais: AcessosIniciais): unknown[] {
  const escolhidasNoInstalador =
    perfil === iniciais.perfil ? iniciais.funcionalidadesOcultas : undefined;
  const preset = escolhidasNoInstalador ?? FUNCIONALIDADES_OCULTAS_POR_PERFIL[perfil];
  return iniciais.autosyncInstalado ? [...preset] : [...preset, ...FUNCIONALIDADES_DO_AUTOSYNC];
}

/**
 * Arquivo sem os acessos — instalação nova ou anterior a eles — recebe o perfil
 * escolhido no instalador com as caixas marcadas lá ou, sem elas, com o preset do
 * perfil. Com o perfil gravado e sem a lista,
 * vale o preset desse perfil. Terceiro segue a mesma regra, campo a campo: uma
 * instalação atualizada, que já tem perfil mas ainda não tem o campo, recebe o
 * que foi marcado no instalador. O Git AutoSync desmarcado no instalador oculta, por
 * cima do preset, a aba Git e a seção AutoSync do cliente.
 */
function lerAcessos(
  dados: Partial<Record<keyof ConfiguracaoGlobal, unknown>>,
  iniciais: AcessosIniciais,
): Pick<ConfiguracaoGlobal, 'perfil' | 'funcionalidadesOcultas' | 'terceiro'> {
  const perfil = ehPerfilProfissional(dados.perfil) ? dados.perfil : iniciais.perfil;
  const ocultas = Array.isArray(dados.funcionalidadesOcultas)
    ? dados.funcionalidadesOcultas
    : presetInicial(perfil, iniciais);

  return {
    perfil,
    funcionalidadesOcultas: normalizarFuncionalidadesOcultas(ocultas),
    terceiro: booleanoOuPadrao(dados.terceiro, iniciais.terceiro),
  };
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function textoOuPadrao(valor: unknown, padrao: string): string {
  return typeof valor === 'string' ? valor : padrao;
}

function numeroOuPadrao(valor: unknown, padrao: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : padrao;
}

function booleanoOuPadrao(valor: unknown, padrao: boolean): boolean {
  return typeof valor === 'boolean' ? valor : padrao;
}

/** Arquivo de antes do SMTP não tem a chave; campo editado à mão com tipo errado volta ao padrão. */
function lerSmtp(valor: unknown): ConfiguracaoSmtp {
  if (!ehObjeto(valor)) {
    return { ...SMTP_INICIAL };
  }

  const seguranca = (SEGURANCAS_SMTP as readonly unknown[]).includes(valor.seguranca)
    ? (valor.seguranca as ConfiguracaoSmtp['seguranca'])
    : SMTP_INICIAL.seguranca;

  return {
    host: textoOuPadrao(valor.host, SMTP_INICIAL.host),
    porta: numeroOuPadrao(valor.porta, SMTP_INICIAL.porta),
    seguranca,
    usuario: textoOuPadrao(valor.usuario, SMTP_INICIAL.usuario),
    senha: textoOuPadrao(valor.senha, SMTP_INICIAL.senha),
    remetente: textoOuPadrao(valor.remetente, SMTP_INICIAL.remetente),
    destinatario: textoOuPadrao(valor.destinatario, SMTP_INICIAL.destinatario),
  };
}

/**
 * Mesmo motivo do `lerSmtp`: arquivo de antes do alerta nasce com ele desligado. O
 * `toleranciaMinutos` das versões anteriores não é lido: a regra nova não tem tolerância.
 */
function lerAlertaDaAgenda(valor: unknown): AlertaDaAgenda {
  if (!ehObjeto(valor)) {
    return { ...ALERTA_DA_AGENDA_INICIAL };
  }

  const padrao = ALERTA_DA_AGENDA_INICIAL;
  return {
    ativo: booleanoOuPadrao(valor.ativo, padrao.ativo),
    intervaloMinutos: numeroOuPadrao(valor.intervaloMinutos, padrao.intervaloMinutos),
    incluirProximoDiaUtil: booleanoOuPadrao(
      valor.incluirProximoDiaUtil,
      padrao.incluirProximoDiaUtil,
    ),
    repetirAteResolver: booleanoOuPadrao(valor.repetirAteResolver, padrao.repetirAteResolver),
    enviarEmail: booleanoOuPadrao(valor.enviarEmail, padrao.enviarEmail),
  };
}

function normalizarSmtp(smtp: ConfiguracaoSmtp): ConfiguracaoSmtp {
  return {
    host: smtp.host.trim(),
    porta: smtp.porta,
    seguranca: smtp.seguranca,
    usuario: smtp.usuario.trim(),
    senha: smtp.senha,
    remetente: smtp.remetente.trim(),
    destinatario: smtp.destinatario.trim(),
  };
}

/** Atalho recém-cadastrado chega sem id: é aqui que ele ganha um. */
function normalizarAtalho(atalho: DadosDeAtalho): Atalho {
  return {
    id: atalho.id ?? randomUUID(),
    nome: atalho.nome.trim(),
    caminhoDoExecutavel: atalho.caminhoDoExecutavel.trim(),
  };
}

/**
 * Configuração global num arquivo JSON próprio, com a mesma escrita atômica
 * usada no cadastro de clientes.
 */
export class RepositorioConfiguracaoArquivo implements RepositorioConfiguracao {
  readonly #caminhoDoArquivo: string;
  readonly #acessosIniciais: AcessosIniciais;
  #configuracao: ConfiguracaoGlobal | null = null;
  readonly #fila = new FilaDeOperacoes();

  /** `acessosIniciais` é o escolhido no instalador; só vale enquanto o arquivo não tem acessos. */
  constructor(
    diretorioDeDados: string,
    acessosIniciais: AcessosIniciais = ACESSOS_INICIAIS_PADRAO,
  ) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
    this.#acessosIniciais = acessosIniciais;
  }

  descartarCache(): void {
    this.#configuracao = null;
  }

  ler(): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() => this.#carregar());
  }

  async #carregar(): Promise<ConfiguracaoGlobal> {
    if (this.#configuracao) {
      return this.#configuracao;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#configuracao = { ...CONFIGURACAO_INICIAL, ...lerAcessos({}, this.#acessosIniciais) };
      return this.#configuracao;
    }

    const dados = (conteudo.corpo ?? {}) as Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior;
    this.#configuracao = {
      scriptPadrao: dados.scriptPadrao ?? '',
      // Arquivo de antes desta versão traz o campo com o nome antigo, ou nenhum dos dois.
      intervaloDeExecucaoAutomaticaSegundos:
        dados.intervaloDeExecucaoAutomaticaSegundos ??
        dados.intervaloDeAtualizacaoDoStatusDoBancoSegundos ??
        INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
      tempoLimiteSegundos: lerTempoLimiteSegundos(dados),
      // Arquivo de antes desta versão não tem o campo: nasce desligado.
      caminhoDoSchemaMcp: dados.caminhoDoSchemaMcp ?? '',
      // Idem: sem a chave no arquivo, o HUB SNK começa sem atalho nenhum.
      atalhos: dados.atalhos ?? [],
      destinoDosLinks: lerDestinoDosLinks(dados.destinoDosLinks),
      // Idem: arquivo de antes desta versão não tem IDE escolhida.
      caminhoDoExecutavelDaIde: dados.caminhoDoExecutavelDaIde ?? '',
      // Idem: arquivo de antes desta versão não tem o vínculo com a Experience.
      experiencePersonId: dados.experiencePersonId ?? '',
      // Idem: arquivo de antes desta versão não tem o CODUSU do SankhyaOm.
      sankhyaOmCodUsu: dados.sankhyaOmCodUsu ?? '',
      smtp: lerSmtp(dados.smtp),
      alertaDaAgenda: lerAlertaDaAgenda(dados.alertaDaAgenda),
      ...lerAcessos(dados, this.#acessosIniciais),
    };

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#configuracao,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#configuracao;
  }

  salvar(configuracao: ConfiguracaoParaSalvar): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() => this.#gravarTudo(configuracao));
  }

  async #gravarTudo(configuracao: ConfiguracaoParaSalvar): Promise<ConfiguracaoGlobal> {
    // Sem campo na tela: preserva o que já estava gravado, em vez de apagar com ''.
    const atual = await this.#carregar();

    const normalizada: ConfiguracaoGlobal = {
      scriptPadrao: configuracao.scriptPadrao.trim(),
      intervaloDeExecucaoAutomaticaSegundos: configuracao.intervaloDeExecucaoAutomaticaSegundos,
      tempoLimiteSegundos: configuracao.tempoLimiteSegundos,
      caminhoDoSchemaMcp: configuracao.caminhoDoSchemaMcp.trim(),
      atalhos: configuracao.atalhos.map(normalizarAtalho),
      destinoDosLinks: configuracao.destinoDosLinks,
      caminhoDoExecutavelDaIde: configuracao.caminhoDoExecutavelDaIde.trim(),
      experiencePersonId: atual.experiencePersonId,
      sankhyaOmCodUsu: atual.sankhyaOmCodUsu,
      perfil: configuracao.perfil ?? atual.perfil,
      funcionalidadesOcultas: normalizarFuncionalidadesOcultas(
        configuracao.funcionalidadesOcultas ?? atual.funcionalidadesOcultas,
      ),
      terceiro: configuracao.terceiro ?? atual.terceiro,
      smtp: configuracao.smtp ? normalizarSmtp(configuracao.smtp) : atual.smtp,
      alertaDaAgenda: configuracao.alertaDaAgenda ?? atual.alertaDaAgenda,
    };

    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, normalizada);

    this.#configuracao = normalizada;
    return normalizada;
  }

  definirExperiencePersonId(personId: string): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() => this.#gravarCampo({ experiencePersonId: personId.trim() }));
  }

  definirSankhyaOmCodUsu(codusu: string): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() => this.#gravarCampo({ sankhyaOmCodUsu: codusu.trim() }));
  }

  async #gravarCampo(campo: Partial<ConfiguracaoGlobal>): Promise<ConfiguracaoGlobal> {
    const atual = await this.#carregar();
    const normalizada: ConfiguracaoGlobal = { ...atual, ...campo };

    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, normalizada);

    this.#configuracao = normalizada;
    return normalizada;
  }
}
