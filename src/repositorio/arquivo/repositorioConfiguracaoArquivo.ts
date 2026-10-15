import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ehPerfilProfissional,
  FUNCIONALIDADES_OCULTAS_POR_PERFIL,
  PERFIL_PADRAO,
} from '../../acessos.ts';
import {
  ESCOLHAS_DE_ASSISTENTE,
  type ConfiguracaoDoAssistenteDeIa,
  type EscolhaDeAssistente,
} from '../../kanban/tiposDoKanban.ts';
import {
  DESTINOS_DE_LINK,
  FUNCIONALIDADES,
  SEGURANCAS_SMTP,
  type AlertaDaAgenda,
  type Atalho,
  type ConfiguracaoDeBackup,
  type ConfiguracaoDoAssistenteDoRepositorio,
  type ConfiguracaoGlobal,
  type ConfiguracaoSmtp,
  type DestinoDeLink,
  type Funcionalidade,
} from '../../tipos.ts';
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
  RespostasDasBoasVindas,
} from '../repositorioConfiguracao.ts';

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
  enviarEmail: false,
};

/* `auto` funciona em qualquer máquina com algum assistente instalado, sem escolha prévia. */
const ASSISTENTE_DE_IA_INICIAL: ConfiguracaoDoAssistenteDeIa = {
  assistente: 'auto',
  modelo: '',
  raciocinio: '',
};

const INTERVALO_DO_BACKUP_PADRAO_H = 24;
const COPIAS_DE_BACKUP_MANTIDAS_PADRAO = 10;

/* Nasce desligado e sem pasta: o HUB SNK não grava fora da pasta de dados sem alguém pedir. */
export const BACKUP_INICIAL: ConfiguracaoDeBackup = {
  ativo: false,
  pasta: '',
  intervaloHoras: INTERVALO_DO_BACKUP_PADRAO_H,
  copiasMantidas: COPIAS_DE_BACKUP_MANTIDAS_PADRAO,
  espelharNoDrive: false,
};

const CONFIGURACAO_INICIAL: ConfiguracaoGlobal = {
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
  assistenteDeIa: ASSISTENTE_DE_IA_INICIAL,
  assistenteDoRepositorio: { ...ASSISTENTE_DE_IA_INICIAL, opcoes: '' },
  nomeDoUsuario: '',
  empresaDoUsuario: '',
  timeDoUsuario: '',
  emailDoUsuario: '',
  backup: BACKUP_INICIAL,
  perfil: PERFIL_PADRAO,
  funcionalidadesOcultas: [...FUNCIONALIDADES_OCULTAS_POR_PERFIL[PERFIL_PADRAO]],
  terceiro: false,
  /* Instalação nova: o assistente de boas-vindas abre na primeira vez. */
  boasVindasConcluidas: false,
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

/**
 * Arquivo de antes dos acessos não tem perfil: vale o padrão, com tudo visível. Com o
 * perfil gravado e sem a lista, vale o preset desse perfil.
 */
function lerAcessos(
  dados: Partial<Record<keyof ConfiguracaoGlobal, unknown>>,
): Pick<ConfiguracaoGlobal, 'perfil' | 'funcionalidadesOcultas' | 'terceiro'> {
  const perfil = ehPerfilProfissional(dados.perfil) ? dados.perfil : PERFIL_PADRAO;
  const ocultas = Array.isArray(dados.funcionalidadesOcultas)
    ? dados.funcionalidadesOcultas
    : FUNCIONALIDADES_OCULTAS_POR_PERFIL[perfil];

  return {
    perfil,
    funcionalidadesOcultas: normalizarFuncionalidadesOcultas(ocultas),
    terceiro: booleanoOuPadrao(dados.terceiro, false),
  };
}

/**
 * Arquivo de antes do assistente: quem já tem perfil gravado escolheu no instalador ou
 * na aba Acessos e não é incomodado; quem não tem nunca escolheu, e o assistente abre.
 */
function lerBoasVindasConcluidas(
  dados: Partial<Record<keyof ConfiguracaoGlobal, unknown>>,
): boolean {
  return booleanoOuPadrao(dados.boasVindasConcluidas, ehPerfilProfissional(dados.perfil));
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

/** Arquivo de antes do kanban não tem a chave; assistente desconhecido volta ao `auto`. */
function lerAssistenteDeIa(valor: unknown): ConfiguracaoDoAssistenteDeIa {
  if (!ehObjeto(valor)) {
    return { ...ASSISTENTE_DE_IA_INICIAL };
  }

  const assistente = (ESCOLHAS_DE_ASSISTENTE as readonly unknown[]).includes(valor.assistente)
    ? (valor.assistente as EscolhaDeAssistente)
    : ASSISTENTE_DE_IA_INICIAL.assistente;

  return {
    assistente,
    modelo: textoOuPadrao(valor.modelo, '').trim(),
    raciocinio: textoOuPadrao(valor.raciocinio, '').trim(),
  };
}

function lerAssistenteDoRepositorio(valor: unknown): ConfiguracaoDoAssistenteDoRepositorio {
  return {
    ...lerAssistenteDeIa(valor),
    opcoes: ehObjeto(valor) ? textoOuPadrao(valor.opcoes, '').trim() : '',
  };
}

/** Arquivo de antes do backup não tem a chave: nasce desligado. Número fora do aceito volta ao padrão. */
function lerBackup(valor: unknown): ConfiguracaoDeBackup {
  if (!ehObjeto(valor)) {
    return { ...BACKUP_INICIAL };
  }

  const inteiroPositivo = (bruto: unknown, padrao: number): number => {
    const numero = numeroOuPadrao(bruto, padrao);
    return Number.isInteger(numero) && numero >= 1 ? numero : padrao;
  };

  return {
    ativo: booleanoOuPadrao(valor.ativo, BACKUP_INICIAL.ativo),
    pasta: textoOuPadrao(valor.pasta, BACKUP_INICIAL.pasta).trim(),
    intervaloHoras: inteiroPositivo(valor.intervaloHoras, BACKUP_INICIAL.intervaloHoras),
    copiasMantidas: inteiroPositivo(valor.copiasMantidas, BACKUP_INICIAL.copiasMantidas),
    espelharNoDrive: booleanoOuPadrao(valor.espelharNoDrive, BACKUP_INICIAL.espelharNoDrive),
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
  #configuracao: ConfiguracaoGlobal | null = null;
  readonly #fila = new FilaDeOperacoes();

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
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
      this.#configuracao = structuredClone(CONFIGURACAO_INICIAL);
      return this.#configuracao;
    }

    const dados = (conteudo.corpo ?? {}) as Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior;
    this.#configuracao = {
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
      assistenteDeIa: lerAssistenteDeIa(dados.assistenteDeIa),
      assistenteDoRepositorio: lerAssistenteDoRepositorio(dados.assistenteDoRepositorio),
      // Idem: arquivo de antes desta versão não tem quem usa o aplicativo.
      nomeDoUsuario: textoOuPadrao(dados.nomeDoUsuario, '').trim(),
      empresaDoUsuario: textoOuPadrao(dados.empresaDoUsuario, '').trim(),
      timeDoUsuario: textoOuPadrao(dados.timeDoUsuario, '').trim(),
      emailDoUsuario: textoOuPadrao(dados.emailDoUsuario, '').trim(),
      backup: lerBackup(dados.backup),
      ...lerAcessos(dados),
      boasVindasConcluidas: lerBoasVindasConcluidas(dados),
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
      assistenteDeIa: configuracao.assistenteDeIa
        ? lerAssistenteDeIa(configuracao.assistenteDeIa)
        : atual.assistenteDeIa,
      assistenteDoRepositorio: configuracao.assistenteDoRepositorio
        ? lerAssistenteDoRepositorio(configuracao.assistenteDoRepositorio)
        : atual.assistenteDoRepositorio,
      nomeDoUsuario: configuracao.nomeDoUsuario?.trim() ?? atual.nomeDoUsuario,
      empresaDoUsuario: configuracao.empresaDoUsuario?.trim() ?? atual.empresaDoUsuario,
      timeDoUsuario: configuracao.timeDoUsuario?.trim() ?? atual.timeDoUsuario,
      emailDoUsuario: configuracao.emailDoUsuario?.trim() ?? atual.emailDoUsuario,
      backup: atual.backup,
      boasVindasConcluidas: atual.boasVindasConcluidas,
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

  definirBackup(backup: ConfiguracaoDeBackup): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() => this.#gravarCampo({ backup: lerBackup(backup) }));
  }

  concluirBoasVindas(respostas: RespostasDasBoasVindas): Promise<ConfiguracaoGlobal> {
    return this.#fila.enfileirar(() =>
      this.#gravarCampo({
        nomeDoUsuario: respostas.nomeDoUsuario.trim(),
        empresaDoUsuario: respostas.empresaDoUsuario.trim(),
        timeDoUsuario: respostas.timeDoUsuario.trim(),
        emailDoUsuario: respostas.emailDoUsuario.trim(),
        perfil: respostas.perfil,
        funcionalidadesOcultas: [...FUNCIONALIDADES_OCULTAS_POR_PERFIL[respostas.perfil]],
        terceiro: respostas.terceiro,
        boasVindasConcluidas: true,
      }),
    );
  }

  async #gravarCampo(campo: Partial<ConfiguracaoGlobal>): Promise<ConfiguracaoGlobal> {
    const atual = await this.#carregar();
    const normalizada: ConfiguracaoGlobal = { ...atual, ...campo };

    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, normalizada);

    this.#configuracao = normalizada;
    return normalizada;
  }
}
