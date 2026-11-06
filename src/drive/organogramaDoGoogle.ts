/**
 * Gestores de uma pessoa no diretório do Google Workspace (People API), subindo pelo campo
 * "gestor" (`relations` do tipo `manager`) que o admin do Workspace preenche.
 *
 * A cadeia de cada e-mail fica um dia em memória: abrir a mesma DS de novo, ou o alerta da
 * agenda repetir, não volta ao Google; mudança no organograma aparece em até um dia.
 */
import { CacheComValidade } from '../sankhya/cacheComValidade.ts';
import type { FonteDeToken } from './contaDoGoogle.ts';

/** Leitura do diretório do domínio: escopo sensível, pedido numa conexão só dele. */
export const ESCOPO_DO_DIRETORIO = 'https://www.googleapis.com/auth/directory.readonly';
/** O e-mail da conta conectada, que a tela mostra. */
export const ENDERECO_DA_CONTA_OPENID = 'https://openidconnect.googleapis.com/v1/userinfo';

const ENDERECO_DA_BUSCA = 'https://people.googleapis.com/v1/people:searchDirectoryPeople';
/** O gestor e o gestor do gestor. */
const GRAUS_DE_GESTAO = 2;
const VALIDADE_DA_CADEIA_MS = 24 * 60 * 60_000;
const TEMPO_LIMITE_DA_CONSULTA_MS = 20_000;
const HTTP_NAO_AUTORIZADO = 401;

export interface PessoaDoDiretorio {
  nome: string;
  email: string;
  cargo: string;
}

interface PessoaNaApi {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { title?: string }[];
  relations?: { person?: string; type?: string }[];
}

const mesmoEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export class OrganogramaDoGoogle {
  readonly #conta: FonteDeToken;
  readonly #buscar: typeof fetch;
  readonly #cadeias: CacheComValidade<string, PessoaDoDiretorio[]>;

  constructor(conta: FonteDeToken, buscar: typeof fetch = fetch, agora: () => number = Date.now) {
    this.#conta = conta;
    this.#buscar = buscar;
    this.#cadeias = new CacheComValidade(VALIDADE_DA_CADEIA_MS, agora);
  }

  /**
   * Gestor primeiro, depois o gestor do gestor. Vazia quando a pessoa não está no
   * diretório ou não tem gestor; a cadeia para onde o diretório não tem o próximo.
   */
  gestoresDe(email: string): Promise<PessoaDoDiretorio[]> {
    const chave = email.trim().toLowerCase();
    return this.#cadeias.obter(chave, () => this.#subirCadeia(chave));
  }

  async #subirCadeia(email: string): Promise<PessoaDoDiretorio[]> {
    const gestores: PessoaDoDiretorio[] = [];
    let proximo = (await this.#pessoa(email))?.emailDoGestor ?? '';
    while (proximo && gestores.length < GRAUS_DE_GESTAO) {
      const gestor = await this.#pessoa(proximo);
      if (!gestor) {
        break;
      }
      gestores.push(gestor.pessoa);
      proximo = gestor.emailDoGestor;
    }
    return gestores;
  }

  async #pessoa(
    email: string,
  ): Promise<{ pessoa: PessoaDoDiretorio; emailDoGestor: string } | null> {
    const endereco = new URL(ENDERECO_DA_BUSCA);
    endereco.search = new URLSearchParams({
      query: email,
      readMask: 'names,emailAddresses,organizations,relations',
      sources: 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
    }).toString();

    const resposta = await this.#buscar(endereco, {
      headers: { authorization: `Bearer ${await this.#conta.tokenDeAcesso()}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_DA_CONSULTA_MS),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as {
      people?: PessoaNaApi[];
      error?: { message?: string };
    };
    if (!resposta.ok) {
      if (resposta.status === HTTP_NAO_AUTORIZADO) {
        this.#conta.descartarTokenDeAcesso();
      }
      throw new Error(
        `O diretório do Google respondeu com erro (HTTP ${resposta.status})${corpo.error?.message ? `: ${corpo.error.message}` : '.'}`,
      );
    }

    // A busca é por texto: só vale quem tem exatamente este e-mail.
    const achada = (corpo.people ?? []).find((pessoa) =>
      (pessoa.emailAddresses ?? []).some((item) => mesmoEmail(item.value ?? '', email)),
    );
    if (!achada) {
      return null;
    }
    return {
      pessoa: {
        nome: achada.names?.[0]?.displayName?.trim() ?? '',
        email: email,
        cargo: achada.organizations?.[0]?.title?.trim() ?? '',
      },
      emailDoGestor: achada.relations?.find((relacao) => relacao.type === 'manager')?.person ?? '',
    };
  }
}
