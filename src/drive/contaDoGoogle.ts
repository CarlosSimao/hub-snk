/**
 * Conta do Google conectada ao HUB SNK: a autorização OAuth e o token de acesso.
 *
 * É o fluxo de aplicativo instalado do Google: o consentimento abre no navegador padrão,
 * e o Google devolve o código para um servidor que só existe durante a autorização, numa
 * porta livre de `127.0.0.1`. O PKCE amarra o código a esta tentativa: outro programa da
 * máquina que o interceptasse não teria como trocá-lo por token.
 *
 * O token de renovação vai para o cofre; o de acesso vive uma hora e fica só em memória.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CofreDoDrive } from './cofreDoDrive.ts';

/** Só os arquivos que o próprio HUB SNK cria: é onde fica a cópia dos dados. */
export const ESCOPO_DOS_ARQUIVOS_DO_HUB = 'https://www.googleapis.com/auth/drive.file';
/*
 * Só este: é o único escopo do Drive que o Google não classifica como sensível ou restrito,
 * então a tela de consentimento não leva o aviso de app não verificado nem o teto de 100 contas.
 */
const ESCOPOS_PEDIDOS = [ESCOPO_DOS_ARQUIVOS_DO_HUB];

const ENDERECO_DE_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const ENDERECO_DE_TOKEN = 'https://oauth2.googleapis.com/token';
const ENDERECO_DE_REVOGACAO = 'https://oauth2.googleapis.com/revoke';
const ENDERECO_DA_CONTA = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';

const HOST_DO_RETORNO = '127.0.0.1';
/** Quanto a tela do Google pode ficar aberta antes de a tentativa ser abandonada. */
const TEMPO_LIMITE_DA_AUTORIZACAO_MS = 5 * 60_000;
const TEMPO_LIMITE_DAS_CHAMADAS_MS = 20_000;
/** O token é renovado um pouco antes de vencer, para não expirar no meio de um envio. */
const FOLGA_DO_TOKEN_MS = 60_000;

export class DriveNaoConfiguradoError extends Error {
  constructor() {
    super('Esta versão do HUB SNK ainda não tem a integração com o Google Drive configurada.');
    this.name = 'DriveNaoConfiguradoError';
  }
}

export class DriveNaoConectadoError extends Error {
  constructor(mensagem = 'O Google Drive não está conectado.') {
    super(mensagem);
    this.name = 'DriveNaoConectadoError';
  }
}

export class AutorizacaoDoGoogleError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AutorizacaoDoGoogleError';
  }
}

export interface CredencialDoGoogle {
  clientId: string;
  clientSecret: string;
}

export interface SituacaoDaConta {
  /** Falso quando o HUB SNK foi distribuído sem a credencial do Google Cloud. */
  configurado: boolean;
  /** Falso sem o aplicativo desktop no ar: é ele que guarda o token. */
  cofreDisponivel: boolean;
  conectado: boolean;
  email: string;
  /** O usuário pode desmarcar a permissão na tela do Google: sem ela, a cópia não é guardada. */
  podeGuardarCopia: boolean;
  /** Há uma tela de consentimento aberta, à espera do usuário. */
  autorizando: boolean;
  /** Por que a última tentativa de conectar falhou; vazio quando não houve falha. */
  erro: string;
}

/** O que o cliente da API do Drive precisa da conta. */
export interface FonteDeToken {
  tokenDeAcesso(): Promise<string>;
  /** O Google recusou o token em uso: o próximo pedido busca outro. */
  descartarTokenDeAcesso(): void;
}

interface Dependencias {
  credencial: CredencialDoGoogle;
  cofre: CofreDoDrive;
  abrirNoNavegador: (endereco: string) => Promise<void>;
  buscar?: typeof fetch;
  agora?: () => number;
}

interface RespostaDeToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TentativaDeAutorizacao {
  estado: string;
  verificador: string;
  enderecoDeRetorno: string;
  servidor: Server;
  temporizador: NodeJS.Timeout;
}

function emBase64Url(dados: Buffer): string {
  return dados.toString('base64url');
}

const ENTIDADES_HTML: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** O e-mail da conta vem do Google e entra na página de retorno. */
function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"]/g, (caractere) => ENTIDADES_HTML[caractere] ?? caractere);
}

function paginaDeRetorno(titulo: string, mensagem: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>HUB SNK</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 15vh auto; max-width: 30rem; padding: 0 1.5rem; color: #1f2933; }
      h1 { font-size: 1.4rem; }
      p { line-height: 1.5; color: #52606d; }
    </style>
  </head>
  <body>
    <h1>${titulo}</h1>
    <p>${mensagem}</p>
  </body>
</html>`;
}

export class ContaDoGoogle implements FonteDeToken {
  readonly #credencial: CredencialDoGoogle;
  readonly #cofre: CofreDoDrive;
  readonly #abrirNoNavegador: (endereco: string) => Promise<void>;
  readonly #buscar: typeof fetch;
  readonly #agora: () => number;
  #tentativa: TentativaDeAutorizacao | null = null;
  #erroDaAutorizacao = '';
  #tokenDeAcesso: { valor: string; venceEm: number } | null = null;
  #renovacaoEmCurso: Promise<string> | null = null;

  constructor(dependencias: Dependencias) {
    this.#credencial = dependencias.credencial;
    this.#cofre = dependencias.cofre;
    this.#abrirNoNavegador = dependencias.abrirNoNavegador;
    this.#buscar = dependencias.buscar ?? fetch;
    this.#agora = dependencias.agora ?? Date.now;
  }

  get configurado(): boolean {
    return Boolean(this.#credencial.clientId && this.#credencial.clientSecret);
  }

  async situacao(): Promise<SituacaoDaConta> {
    const base = {
      configurado: this.configurado,
      autorizando: this.#tentativa !== null,
      erro: this.#erroDaAutorizacao,
    };

    try {
      const segredo = await this.#cofre.ler();
      const escopos = new Set(segredo?.escopos ?? []);
      return {
        ...base,
        cofreDisponivel: true,
        conectado: segredo !== null,
        email: segredo?.email ?? '',
        podeGuardarCopia: escopos.has(ESCOPO_DOS_ARQUIVOS_DO_HUB),
      };
    } catch {
      return {
        ...base,
        cofreDisponivel: false,
        conectado: false,
        email: '',
        podeGuardarCopia: false,
      };
    }
  }

  /**
   * Abre a tela de consentimento no navegador padrão e devolve o endereço dela: se o
   * navegador não abrir sozinho, a tela do HUB SNK oferece o link.
   */
  async iniciarAutorizacao(): Promise<{ url: string }> {
    if (!this.configurado) {
      throw new DriveNaoConfiguradoError();
    }
    // Antes de mandar o usuário ao Google: sem cofre, o token não teria onde ficar.
    await this.#cofre.ler();

    this.#abandonarTentativa();
    this.#erroDaAutorizacao = '';

    const estado = randomBytes(16).toString('hex');
    const verificador = emBase64Url(randomBytes(32));
    const servidor = createServer((requisicao, resposta) => {
      void this.#receberRetorno(requisicao, resposta);
    });
    await new Promise<void>((resolver, rejeitar) => {
      servidor.once('error', rejeitar);
      servidor.listen(0, HOST_DO_RETORNO, resolver);
    });

    const { port: porta } = servidor.address() as AddressInfo;
    const enderecoDeRetorno = `http://${HOST_DO_RETORNO}:${porta}`;
    const temporizador = setTimeout(() => {
      this.#abandonarTentativa();
      this.#erroDaAutorizacao = 'A autorização no Google não foi concluída a tempo. Tente de novo.';
    }, TEMPO_LIMITE_DA_AUTORIZACAO_MS);
    temporizador.unref();
    this.#tentativa = { estado, verificador, enderecoDeRetorno, servidor, temporizador };

    const url = new URL(ENDERECO_DE_AUTORIZACAO);
    url.search = new URLSearchParams({
      client_id: this.#credencial.clientId,
      redirect_uri: enderecoDeRetorno,
      response_type: 'code',
      scope: ESCOPOS_PEDIDOS.join(' '),
      state: estado,
      code_challenge: emBase64Url(createHash('sha256').update(verificador).digest()),
      code_challenge_method: 'S256',
      // `offline` e `consent` juntos são o que faz o Google entregar o token de renovação
      // também para quem já autorizou o HUB SNK antes.
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

    // Navegador que não abre não derruba a tentativa: a tela mostra o link para abrir à mão.
    await this.#abrirNoNavegador(url.toString()).catch(() => undefined);
    return { url: url.toString() };
  }

  async desconectar(): Promise<void> {
    this.#abandonarTentativa();
    this.#erroDaAutorizacao = '';
    this.#tokenDeAcesso = null;

    const segredo = await this.#cofre.ler();
    if (!segredo) {
      return;
    }

    // Revogar é cortesia: tira o HUB SNK da lista de apps da conta. Sem rede, o token
    // some daqui do mesmo jeito, e o usuário ainda pode revogar pela conta do Google.
    await this.#buscar(ENDERECO_DE_REVOGACAO, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: segredo.refreshToken }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_DAS_CHAMADAS_MS),
    }).catch(() => undefined);
    await this.#cofre.remover();
  }

  async tokenDeAcesso(): Promise<string> {
    if (this.#tokenDeAcesso && this.#tokenDeAcesso.venceEm - FOLGA_DO_TOKEN_MS > this.#agora()) {
      return this.#tokenDeAcesso.valor;
    }

    // Vários pedidos ao mesmo tempo com o token vencido renovam uma vez só.
    this.#renovacaoEmCurso ??= this.#renovarTokenDeAcesso().finally(() => {
      this.#renovacaoEmCurso = null;
    });
    return this.#renovacaoEmCurso;
  }

  descartarTokenDeAcesso(): void {
    this.#tokenDeAcesso = null;
  }

  /** Encerra o servidor de retorno de uma tentativa em aberto, no fechamento do HUB SNK. */
  encerrar(): void {
    this.#abandonarTentativa();
  }

  async #renovarTokenDeAcesso(): Promise<string> {
    if (!this.configurado) {
      throw new DriveNaoConfiguradoError();
    }
    const segredo = await this.#cofre.ler();
    if (!segredo) {
      throw new DriveNaoConectadoError();
    }

    const resposta = await this.#pedirToken({
      grant_type: 'refresh_token',
      refresh_token: segredo.refreshToken,
    });
    if (resposta.error === 'invalid_grant') {
      // Acesso revogado na conta do Google, ou token vencido por falta de uso: insistir
      // não adianta. Sem o token guardado, a tela volta a oferecer "Conectar".
      await this.#cofre.remover();
      throw new DriveNaoConectadoError(
        'O acesso ao Google Drive foi revogado ou expirou. Conecte a conta de novo.',
      );
    }
    return this.#guardarTokenDeAcesso(resposta);
  }

  #guardarTokenDeAcesso(resposta: RespostaDeToken): string {
    if (!resposta.access_token) {
      throw new AutorizacaoDoGoogleError(
        `O Google não entregou o token de acesso: ${resposta.error_description ?? resposta.error ?? 'resposta sem token'}.`,
      );
    }
    this.#tokenDeAcesso = {
      valor: resposta.access_token,
      venceEm: this.#agora() + (resposta.expires_in ?? 0) * 1000,
    };
    return resposta.access_token;
  }

  async #pedirToken(campos: Record<string, string>): Promise<RespostaDeToken> {
    let resposta: Response;
    try {
      resposta = await this.#buscar(ENDERECO_DE_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...campos,
          client_id: this.#credencial.clientId,
          client_secret: this.#credencial.clientSecret,
        }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_DAS_CHAMADAS_MS),
      });
    } catch (erro) {
      throw new AutorizacaoDoGoogleError(
        `Não foi possível falar com o Google: ${erro instanceof Error ? erro.message : String(erro)}.`,
      );
    }
    return (await resposta
      .json()
      .catch(() => ({ error: `HTTP ${resposta.status}` }))) as RespostaDeToken;
  }

  async #receberRetorno(requisicao: IncomingMessage, resposta: ServerResponse): Promise<void> {
    const tentativa = this.#tentativa;
    const endereco = new URL(requisicao.url ?? '/', `http://${HOST_DO_RETORNO}`);
    const responder = (status: number, titulo: string, mensagem: string): void => {
      resposta.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      resposta.end(paginaDeRetorno(titulo, mensagem));
    };

    // O navegador pede o favicon por conta própria; e um `state` que não é o desta
    // tentativa não veio da tela que o HUB SNK abriu.
    if (
      !tentativa ||
      endereco.pathname !== '/' ||
      endereco.searchParams.get('state') !== tentativa.estado
    ) {
      responder(404, 'Endereço desconhecido', 'Volte ao HUB SNK e conecte o Google Drive por lá.');
      return;
    }

    const codigo = endereco.searchParams.get('code');
    if (!codigo) {
      this.#abandonarTentativa();
      this.#erroDaAutorizacao = 'A autorização foi cancelada na tela do Google.';
      responder(200, 'Autorização cancelada', 'Nada foi conectado. Pode fechar esta aba.');
      return;
    }

    try {
      const email = await this.#concluirAutorizacao(codigo, tentativa);
      responder(
        200,
        'Google Drive conectado',
        email
          ? `O HUB SNK já está usando a conta ${escaparHtml(email)}. Pode fechar esta aba.`
          : 'O HUB SNK já está usando a sua conta. Pode fechar esta aba.',
      );
    } catch (erro) {
      this.#erroDaAutorizacao = erro instanceof Error ? erro.message : String(erro);
      responder(
        200,
        'Não foi possível conectar',
        'Volte ao HUB SNK para ver o motivo e tentar de novo. Pode fechar esta aba.',
      );
    } finally {
      this.#abandonarTentativa();
    }
  }

  async #concluirAutorizacao(codigo: string, tentativa: TentativaDeAutorizacao): Promise<string> {
    const resposta = await this.#pedirToken({
      grant_type: 'authorization_code',
      code: codigo,
      code_verifier: tentativa.verificador,
      redirect_uri: tentativa.enderecoDeRetorno,
    });
    const tokenDeAcesso = this.#guardarTokenDeAcesso(resposta);
    if (!resposta.refresh_token) {
      this.#tokenDeAcesso = null;
      throw new AutorizacaoDoGoogleError(
        'O Google não entregou a autorização permanente. Tente conectar de novo.',
      );
    }

    const email = await this.#lerEmailDaConta(tokenDeAcesso);
    await this.#cofre.gravar({
      refreshToken: resposta.refresh_token,
      email,
      escopos: (resposta.scope ?? '').split(' ').filter(Boolean),
    });
    return email;
  }

  /** O e-mail só serve para a tela dizer qual conta está conectada: sem ele, segue vazio. */
  async #lerEmailDaConta(tokenDeAcesso: string): Promise<string> {
    try {
      const resposta = await this.#buscar(ENDERECO_DA_CONTA, {
        headers: { authorization: `Bearer ${tokenDeAcesso}` },
        signal: AbortSignal.timeout(TEMPO_LIMITE_DAS_CHAMADAS_MS),
      });
      const corpo = (await resposta.json()) as { user?: { emailAddress?: string } };
      return corpo.user?.emailAddress ?? '';
    } catch {
      return '';
    }
  }

  #abandonarTentativa(): void {
    const tentativa = this.#tentativa;
    if (!tentativa) {
      return;
    }
    this.#tentativa = null;
    clearTimeout(tentativa.temporizador);
    // A resposta ao navegador ainda está saindo: fecha quando ela terminar.
    tentativa.servidor.close();
  }
}
