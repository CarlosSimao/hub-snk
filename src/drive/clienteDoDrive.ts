/**
 * O que o HUB SNK faz na API do Google Drive (v3): guardar, achar e baixar a cópia dos
 * dados, para o backup. Só enxerga o que ele mesmo criou (escopo `drive.file`).
 *
 * Fala HTTP direto, sem a biblioteca do Google: são meia dúzia de chamadas, e a
 * biblioteca pesaria mais no instalador do que o resto do backend inteiro.
 */
import type { FonteDeToken } from './contaDoGoogle.ts';

const API = 'https://www.googleapis.com/drive/v3';
const API_DE_ENVIO = 'https://www.googleapis.com/upload/drive/v3';
const TIPO_DE_PASTA = 'application/vnd.google-apps.folder';

const ITENS_POR_PAGINA = 200;
const TEMPO_LIMITE_DAS_CONSULTAS_MS = 20_000;
const TEMPO_LIMITE_DAS_TRANSFERENCIAS_MS = 5 * 60_000;

/**
 * Marca gravada nas pastas e arquivos que o HUB SNK cria. As `appProperties` são
 * privadas do aplicativo: procurar por ela nunca acha uma pasta "HUB SNK" que o próprio
 * usuário tenha criado, e na qual o HUB SNK não poderia gravar.
 */
const MARCA_DO_HUB = { chave: 'hubSnk', valor: 'dados' };

const ID_DO_DRIVE = /^[A-Za-z0-9_-]{10,}$/;

/** Id de arquivo do Drive: só o que não deixa uma consulta ser montada com ele. */
export function ehIdDoDrive(valor: string): boolean {
  return ID_DO_DRIVE.test(valor);
}

export class ErroDoDrive extends Error {
  readonly status: number;
  /** O `reason` do Google (`notFound`, `insufficientPermissions`...), quando veio. */
  readonly motivo: string;

  constructor(mensagem: string, status: number, motivo = '') {
    super(mensagem);
    this.name = 'ErroDoDrive';
    this.status = status;
    this.motivo = motivo;
  }
}

export interface ArquivoGuardado {
  id: string;
  nome: string;
  tamanho: number;
  modificadoEm: string;
}

interface ArquivoDaApi {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

interface ErroDaApi {
  error?: { message?: string; errors?: { reason?: string }[]; status?: string };
}

const MOTIVOS_DE_PERMISSAO_INSUFICIENTE = new Set([
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
]);

function paraArquivoGuardado(arquivo: ArquivoDaApi): ArquivoGuardado {
  return {
    id: arquivo.id ?? '',
    nome: arquivo.name ?? '',
    tamanho: Number(arquivo.size ?? 0),
    modificadoEm: arquivo.modifiedTime ?? '',
  };
}

/** Texto dentro de aspas simples numa consulta do Drive. */
function citar(valor: string): string {
  return `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export class ClienteDoDrive {
  readonly #conta: FonteDeToken;
  readonly #buscar: typeof fetch;

  constructor(conta: FonteDeToken, buscar: typeof fetch = fetch) {
    this.#conta = conta;
    this.#buscar = buscar;
  }

  /** Id da pasta do HUB SNK na raiz do Drive, criada na primeira vez. */
  async garantirPastaDoHub(nome: string): Promise<string> {
    const parametros = new URLSearchParams({
      q:
        `mimeType = ${citar(TIPO_DE_PASTA)} and trashed = false and ` +
        `appProperties has { key=${citar(MARCA_DO_HUB.chave)} and value=${citar(MARCA_DO_HUB.valor)} }`,
      fields: 'files(id)',
      pageSize: '1',
    });
    const existentes = await this.#lerJson<{ files?: ArquivoDaApi[] }>(
      `${API}/files?${parametros}`,
    );
    const existente = existentes.files?.[0]?.id;
    if (existente) {
      return existente;
    }

    const criada = await this.#lerJson<ArquivoDaApi>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: nome,
        mimeType: TIPO_DE_PASTA,
        appProperties: { [MARCA_DO_HUB.chave]: MARCA_DO_HUB.valor },
      }),
    });
    return criada.id ?? '';
  }

  /** Os arquivos que o HUB SNK guardou numa pasta dele, do mais recente para o mais antigo. */
  async listarArquivosGuardados(idDaPasta: string): Promise<ArquivoGuardado[]> {
    const parametros = new URLSearchParams({
      q: `${citar(idDaPasta)} in parents and trashed = false and mimeType != ${citar(TIPO_DE_PASTA)}`,
      fields: 'files(id,name,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: String(ITENS_POR_PAGINA),
    });
    const resposta = await this.#lerJson<{ files?: ArquivoDaApi[] }>(`${API}/files?${parametros}`);
    return (resposta.files ?? []).map(paraArquivoGuardado);
  }

  /**
   * Grava o arquivo no Drive e devolve o id dele. Com `idDoArquivo`, substitui o conteúdo
   * do que já existe — o Drive guarda as versões anteriores por conta própria.
   *
   * Envio retomável, em dois passos: é o único que o Drive aceita acima de 5 MB.
   */
  async enviarArquivo(parametros: {
    idDaPasta: string;
    idDoArquivo?: string;
    nome: string;
    tipo: string;
    conteudo: Buffer;
  }): Promise<string> {
    const { idDaPasta, idDoArquivo, nome, tipo, conteudo } = parametros;
    const abertura = await this.#requisitar(
      idDoArquivo
        ? `${API_DE_ENVIO}/files/${encodeURIComponent(idDoArquivo)}?uploadType=resumable`
        : `${API_DE_ENVIO}/files?uploadType=resumable`,
      {
        method: idDoArquivo ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': tipo,
          'x-upload-content-length': String(conteudo.length),
        },
        body: JSON.stringify(idDoArquivo ? {} : { name: nome, parents: [idDaPasta] }),
      },
    );
    const enderecoDoEnvio = abertura.headers.get('location');
    if (!enderecoDoEnvio) {
      throw new ErroDoDrive('O Google Drive não abriu o envio do arquivo.', 502);
    }

    // O endereço do envio já carrega a autorização: é uma sessão de uso único.
    let resposta: Response;
    try {
      resposta = await this.#buscar(enderecoDoEnvio, {
        method: 'PUT',
        headers: { 'content-type': tipo },
        body: new Uint8Array(conteudo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_DAS_TRANSFERENCIAS_MS),
      });
    } catch (erro) {
      throw this.#erroDeRede(erro);
    }
    if (!resposta.ok) {
      throw await this.#erroDaResposta(resposta);
    }
    const gravado = (await resposta.json()) as ArquivoDaApi;
    return gravado.id ?? idDoArquivo ?? '';
  }

  async baixarArquivo(idDoArquivo: string): Promise<Buffer> {
    const resposta = await this.#requisitar(
      `${API}/files/${encodeURIComponent(idDoArquivo)}?alt=media`,
      {},
      TEMPO_LIMITE_DAS_TRANSFERENCIAS_MS,
    );
    return Buffer.from(await resposta.arrayBuffer());
  }

  async #lerJson<T>(endereco: string, init: RequestInit = {}): Promise<T> {
    const resposta = await this.#requisitar(endereco, init);
    return (await resposta.json()) as T;
  }

  /**
   * Chamada autenticada. O `401` é o token de acesso que o Google deixou de aceitar antes
   * da hora: busca outro e tenta de novo, uma vez só.
   */
  async #requisitar(
    endereco: string,
    init: RequestInit = {},
    tempoLimiteMs = TEMPO_LIMITE_DAS_CONSULTAS_MS,
  ): Promise<Response> {
    const chamar = async (): Promise<Response> => {
      const token = await this.#conta.tokenDeAcesso();
      try {
        return await this.#buscar(endereco, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(tempoLimiteMs),
        });
      } catch (erro) {
        throw this.#erroDeRede(erro);
      }
    };

    let resposta = await chamar();
    if (resposta.status === 401) {
      this.#conta.descartarTokenDeAcesso();
      resposta = await chamar();
    }
    if (!resposta.ok) {
      throw await this.#erroDaResposta(resposta);
    }
    return resposta;
  }

  #erroDeRede(erro: unknown): ErroDoDrive {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    return new ErroDoDrive(`Não foi possível falar com o Google Drive: ${detalhe}.`, 503, 'rede');
  }

  async #erroDaResposta(resposta: Response): Promise<ErroDoDrive> {
    const corpo = (await resposta.json().catch(() => ({}))) as ErroDaApi;
    const motivo = corpo.error?.errors?.[0]?.reason ?? corpo.error?.status ?? '';

    if (resposta.status === 403 && MOTIVOS_DE_PERMISSAO_INSUFICIENTE.has(motivo)) {
      return new ErroDoDrive(
        'A conta conectada não deu esta permissão ao HUB SNK. Desconecte o Google Drive e ' +
          'conecte de novo, deixando a permissão marcada na tela do Google.',
        403,
        motivo,
      );
    }
    if (resposta.status === 404) {
      return new ErroDoDrive(
        'O item não existe no Google Drive ou a conta conectada não tem acesso a ele.',
        404,
        motivo,
      );
    }
    return new ErroDoDrive(
      `O Google Drive respondeu com erro (HTTP ${resposta.status})${corpo.error?.message ? `: ${corpo.error.message}` : '.'}`,
      resposta.status,
      motivo,
    );
  }
}
