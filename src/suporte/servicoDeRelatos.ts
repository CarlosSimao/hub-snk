import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, release, version as versaoDoSistema } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { montarLogDeDiagnostico } from './logDeDiagnostico.ts';

export const TIPOS_DE_RELATO = ['BUG', 'SUGESTAO', 'DUVIDA', 'ELOGIO', 'OUTRO'] as const;
export type TipoDeRelato = (typeof TIPOS_DE_RELATO)[number];

export interface DadosDoRelato {
  tipo: TipoDeRelato;
  mensagem: string;
  /** Só se a pessoa quiser resposta. */
  email?: string;
  incluirLog: boolean;
}

export type SituacaoDoRelato = 'enviado' | 'enfileirado';

/** Recusa definitiva do suporte: reenviar não adianta, então o relato não vai para a fila. */
export class RelatoRecusadoError extends Error {}

interface RelatoPronto {
  externalId: string;
  installId: string;
  type: TipoDeRelato;
  message: string;
  email?: string;
  context: Record<string, string>;
  logGzipBase64?: string;
}

export interface OpcoesDoServicoDeRelatos {
  /** Endereço que recebe os relatos. */
  endereco: string;
  /** Pasta onde o shell grava `desktop.log` e `backend.log`. */
  pastaDeLog: string;
  /** Pasta local (não sincronizada) para o id da instalação e a fila. */
  pastaDeEstado: string;
  versaoDoAplicativo: string;
  /** Perfil escolhido em Configurações › Acessos, se houver. */
  lerPerfil?: () => Promise<string | undefined>;
  registrador?: { info: (mensagem: string) => void; warn: (mensagem: string) => void };
  buscar?: typeof fetch;
}

const TEMPO_LIMITE_DO_ENVIO_EM_MS = 30_000;
const ARQUIVO_DO_ID = 'instalacao-id.txt';
const PASTA_DA_FILA = 'relatos-pendentes';
/** Fila não cresce sem teto: relato antigo demais é descartado. */
const MAXIMO_NA_FILA = 20;

/**
 * Envia relatos de problema e sugestões ao suporte.
 *
 * Nada sai da máquina sem a pessoa pedir: só há envio quando ela confirma o relato na
 * tela. Se o envio falhar por rede, o relato fica guardado em disco e é reenviado
 * depois — mesmo `externalId`, então o suporte não registra duas vezes.
 */
export class ServicoDeRelatos {
  readonly #opcoes: OpcoesDoServicoDeRelatos;
  readonly #buscar: typeof fetch;

  constructor(opcoes: OpcoesDoServicoDeRelatos) {
    this.#opcoes = opcoes;
    this.#buscar = opcoes.buscar ?? fetch;
  }

  /**
   * Identificador aleatório desta instalação. Não identifica a pessoa nem a máquina:
   * serve para o suporte ver que dois relatos vieram do mesmo lugar e para limitar
   * envios em excesso. Só viaja junto com um relato.
   */
  async identificadorDaInstalacao(): Promise<string> {
    const caminho = join(this.#opcoes.pastaDeEstado, ARQUIVO_DO_ID);
    try {
      const gravado = (await readFile(caminho, 'utf8')).trim();
      if (/^[A-Za-z0-9-]{8,64}$/.test(gravado)) return gravado;
    } catch {
      // Primeira vez: cai para a criação.
    }
    const novo = randomUUID();
    await mkdir(this.#opcoes.pastaDeEstado, { recursive: true });
    await writeFile(caminho, novo, 'utf8');
    return novo;
  }

  /** Dados técnicos que acompanham todo relato. Nada que identifique a pessoa. */
  async contexto(): Promise<Record<string, string>> {
    const contexto: Record<string, string> = {
      appVersion: this.#opcoes.versaoDoAplicativo,
      platform: process.platform,
      os: `${versaoDoSistema()} (${release()})`,
      arch: arch(),
    };
    const perfil = await this.#opcoes.lerPerfil?.().catch(() => undefined);
    if (perfil) contexto['perfil'] = perfil;
    return contexto;
  }

  /** O que a tela mostra em "ver o que será enviado": o mesmo texto que seguiria no relato. */
  async previa(): Promise<{ contexto: Record<string, string>; log: string }> {
    return {
      contexto: await this.contexto(),
      log: await montarLogDeDiagnostico(this.#opcoes.pastaDeLog),
    };
  }

  async relatar(dados: DadosDoRelato): Promise<SituacaoDoRelato> {
    const relato: RelatoPronto = {
      externalId: randomUUID(),
      installId: await this.identificadorDaInstalacao(),
      type: dados.tipo,
      message: dados.mensagem,
      context: await this.contexto(),
    };
    if (dados.email) relato.email = dados.email;
    if (dados.incluirLog) {
      const log = await montarLogDeDiagnostico(this.#opcoes.pastaDeLog);
      if (log) relato.logGzipBase64 = gzipSync(Buffer.from(log, 'utf8')).toString('base64');
    }

    if (await this.#enviar(relato)) return 'enviado';
    await this.#enfileirar(relato);
    return 'enfileirado';
  }

  /** Tenta de novo o que ficou na fila. Devolve quantos foram entregues. */
  async reenviarPendentes(): Promise<number> {
    const pasta = join(this.#opcoes.pastaDeEstado, PASTA_DA_FILA);
    let arquivos: string[];
    try {
      arquivos = (await readdir(pasta)).filter((nome) => nome.endsWith('.json')).sort();
    } catch {
      return 0;
    }

    let entregues = 0;
    for (const nome of arquivos) {
      const caminho = join(pasta, nome);
      try {
        const relato = JSON.parse(await readFile(caminho, 'utf8')) as RelatoPronto;
        if (!(await this.#enviar(relato))) break; // sem rede: não adianta insistir agora
        await rm(caminho, { force: true });
        entregues += 1;
      } catch (erro) {
        // Recusado em definitivo ou arquivo corrompido: tira da fila para não travar os demais.
        this.#opcoes.registrador?.warn(`Relato pendente descartado: ${(erro as Error).message}`);
        await rm(caminho, { force: true });
      }
    }
    if (entregues)
      this.#opcoes.registrador?.info(`${entregues} relato(s) pendente(s) entregue(s).`);
    return entregues;
  }

  /**
   * `true` = entregue; `false` = falha passageira (rede, servidor fora), vale tentar
   * depois. Recusa definitiva lança {@link RelatoRecusadoError}.
   */
  async #enviar(relato: RelatoPronto): Promise<boolean> {
    let resposta: Response;
    try {
      resposta = await this.#buscar(this.#opcoes.endereco, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(relato),
        signal: AbortSignal.timeout(TEMPO_LIMITE_DO_ENVIO_EM_MS),
      });
    } catch {
      return false;
    }

    if (resposta.ok) return true;
    if (resposta.status === 429) {
      throw new RelatoRecusadoError(
        'O limite diário de relatos desta instalação foi atingido. Tente de novo amanhã.',
      );
    }
    if (resposta.status >= 400 && resposta.status < 500) {
      throw new RelatoRecusadoError(
        'O suporte não aceitou este relato. Atualize o HUB SNK e tente de novo.',
      );
    }
    return false;
  }

  async #enfileirar(relato: RelatoPronto): Promise<void> {
    const pasta = join(this.#opcoes.pastaDeEstado, PASTA_DA_FILA);
    await mkdir(pasta, { recursive: true });
    // O prefixo de tempo mantém a ordem de chegada na listagem.
    await writeFile(
      join(pasta, `${Date.now()}-${relato.externalId}.json`),
      JSON.stringify(relato),
      'utf8',
    );

    const arquivos = (await readdir(pasta)).filter((nome) => nome.endsWith('.json')).sort();
    for (const antigo of arquivos.slice(0, Math.max(0, arquivos.length - MAXIMO_NA_FILA))) {
      await rm(join(pasta, antigo), { force: true });
    }
  }
}
