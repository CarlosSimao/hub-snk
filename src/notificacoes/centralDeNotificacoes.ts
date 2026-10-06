import { randomUUID } from 'node:crypto';
import type { RepositorioNotificacoes } from '../repositorio/repositorioNotificacoes.ts';
import type { Notificacao, OrigemDeNotificacao, TagDeNotificacao } from '../tipos.ts';
import type { MensagemDeEmail } from './enviadorDeEmail.ts';

const PREFIXO_DO_ASSUNTO = '[HUB SNK]';

/** O mínimo que a central precisa para registrar o que houve. Evita depender do logger do Fastify. */
export interface RegistradorDeNotificacoes {
  info(mensagem: string): void;
  warn(mensagem: string): void;
}

/** Quem entrega o e-mail. Interface para os testes não dependerem de um SMTP no ar. */
export interface EntregadorDeEmail {
  enviarPeloSmtpGravado(mensagem: MensagemDeEmail): Promise<void>;
}

export interface DadosDeNotificacao {
  origem: OrigemDeNotificacao;
  /** Sem ela, a notificação sai como `padrão`. */
  tag?: TagDeNotificacao;
  chave: string;
  titulo: string;
  mensagem: string;
  enviarEmail: boolean;
  /** E-mail próprio de quem gerou; sem ele, sai o padrão com o título e a mensagem. */
  email?: MensagemDeEmail;
}

export type OuvinteDeNotificacao = (notificacao: Notificacao) => void;

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Ponto único por onde toda notificação passa: descarta a repetida, envia o e-mail,
 * grava e avisa quem está ouvindo (o painel, pelo fluxo SSE).
 */
export class CentralDeNotificacoes {
  readonly #repositorio: RepositorioNotificacoes;
  readonly #email: EntregadorDeEmail;
  readonly #registrador: RegistradorDeNotificacoes;
  readonly #ouvintes = new Set<OuvinteDeNotificacao>();
  /*
   * O e-mail é enviado antes de a chave ser gravada; sem isto, duas emissões da mesma
   * chave durante o envio passariam as duas pela checagem de repetida.
   */
  readonly #chavesEmAndamento = new Set<string>();

  constructor(
    repositorio: RepositorioNotificacoes,
    email: EntregadorDeEmail,
    registrador: RegistradorDeNotificacoes,
  ) {
    this.#repositorio = repositorio;
    this.#email = email;
    this.#registrador = registrador;
  }

  /** Devolve `null` quando a chave já foi emitida: o fato já foi notificado. */
  async emitir(dados: DadosDeNotificacao): Promise<Notificacao | null> {
    if (this.#chavesEmAndamento.has(dados.chave)) {
      return null;
    }

    this.#chavesEmAndamento.add(dados.chave);
    try {
      if (await this.#repositorio.chaveJaEmitida(dados.chave)) {
        return null;
      }

      const notificacao: Notificacao = {
        id: randomUUID(),
        origem: dados.origem,
        tag: dados.tag ?? 'padrão',
        chave: dados.chave,
        titulo: dados.titulo,
        mensagem: dados.mensagem,
        criadaEm: new Date().toISOString(),
        lida: false,
        erroDoEmail: dados.enviarEmail ? await this.#tentarEnviarEmail(dados) : '',
      };

      await this.#repositorio.adicionar(notificacao);
      this.#avisarOuvintes(notificacao);
      return notificacao;
    } finally {
      this.#chavesEmAndamento.delete(dados.chave);
    }
  }

  /** Para quem gera a notificação poupar uma consulta cara quando o fato já foi notificado. */
  jaEmitida(chave: string): Promise<boolean> {
    return this.#repositorio.chaveJaEmitida(chave);
  }

  listar(): Promise<Notificacao[]> {
    return this.#repositorio.listar();
  }

  marcarComoLidas(ids?: readonly string[]): Promise<Notificacao[]> {
    return this.#repositorio.marcarComoLidas(ids);
  }

  limpar(): Promise<void> {
    return this.#repositorio.limpar();
  }

  /** Devolve a função que cancela a assinatura. */
  assinar(ouvinte: OuvinteDeNotificacao): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  /** Falha no e-mail não impede a notificação: ela vai para o painel com o motivo. */
  async #tentarEnviarEmail(dados: DadosDeNotificacao): Promise<string> {
    try {
      await this.#email.enviarPeloSmtpGravado(
        dados.email ?? {
          assunto: `${PREFIXO_DO_ASSUNTO} ${dados.titulo}`,
          texto: dados.mensagem,
        },
      );
      return '';
    } catch (erro) {
      const motivo = descreverErro(erro);
      this.#registrador.warn(`E-mail da notificação "${dados.chave}" não foi enviado: ${motivo}`);
      return motivo;
    }
  }

  #avisarOuvintes(notificacao: Notificacao): void {
    for (const ouvinte of this.#ouvintes) {
      try {
        ouvinte(notificacao);
      } catch (erro) {
        this.#registrador.warn(`Ouvinte de notificação falhou: ${descreverErro(erro)}`);
      }
    }
  }
}
