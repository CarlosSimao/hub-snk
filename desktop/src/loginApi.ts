/**
 * Login por API numa base de cliente, antes de a aba abrir — ligado por base no cadastro
 * (`loginApi`). Desligado, a aba segue o caminho de sempre: tela de login + autofill.
 *
 * Vem do cliente de exemplo `exemplo-login-sankhya/sankhya.js`: `MobileLoginSP.login` com
 * usuário e senha devolve o `jsessionid`. Aqui a chamada sai pela SESSÃO da partição da
 * aba (`link:<origin>`) e o cookie é gravado nela, então a aba já nasce logada e pode ir
 * direto à tela pedida (link direto, JSP do monitor) sem passar pela tela de login.
 *
 * Só funciona com usuário local do Sankhya. Base com SSO / Sankhya ID recusa — e aí quem
 * chama cai no autofill, sem perder nada. Medido em 2026-09-24 no corporativo: o login
 * passa, mas serviço chamado DE FORA da aba toma "Acesso negado"; por isso a sessão vai
 * para a aba e as chamadas continuam saindo de dentro dela (`chamarNaAba.ts`).
 *
 * A senha existe em claro só dentro de `logar`: não vai para log, renderer nem URL.
 */
import { session } from 'electron';
import { mensagemSankhya } from './respostaSankhya';
import { logEvento, origemSemQuery } from './log';

const TIMEOUT_MS = 20_000;

async function postar(particao: string, origin: string, servico: string, requestBody: unknown, sessao?: string) {
  const url = `${origin}/mge/service.sbr?serviceName=${servico}&outputType=json${sessao ? `&mgeSession=${sessao}` : ''}`;
  const r = await session.fromPartition(particao).fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serviceName: servico, requestBody }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // O Sankhya costuma responder em ISO-8859-1; `r.json()` leria como UTF-8.
  const cs = /charset=([^;]+)/i.exec(r.headers.get('content-type') ?? '')?.[1]?.trim().toLowerCase() || 'utf-8';
  let texto: string;
  try {
    texto = new TextDecoder(cs).decode(await r.arrayBuffer());
  } catch {
    texto = '';
  }
  return JSON.parse(texto) as { status?: unknown; statusMessage?: unknown; responseBody?: { jsessionid?: { $?: string } } };
}

/** `ok: false` = use o autofill. `erro` já vem legível e sem segredo. */
export async function logar(
  particao: string,
  origin: string,
  usuario: string,
  senha: string,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    const j = await postar(particao, origin, 'MobileLoginSP.login', {
      NOMUSU: { $: usuario },
      INTERNO: { $: senha },
      KEEPCONNECTED: { $: 'N' },
    });
    const jsessionid = j.responseBody?.jsessionid?.$ ?? '';
    if (String(j.status) !== '1' || !jsessionid) {
      const erro = mensagemSankhya(j.statusMessage).slice(0, 200) || `status ${String(j.status)}`;
      logEvento('login-api-recusado', { origem: origemSemQuery(origin), erro });
      return { ok: false, erro };
    }
    // Gravado explicitamente em vez de confiar no Set-Cookie da resposta: é o valor que o
    // Sankhya declara como sessão, e o caminho `/mge` é o do contexto que a tela usa.
    const u = new URL(origin);
    await session.fromPartition(particao).cookies.set({
      url: `${origin}/mge`,
      name: 'JSESSIONID',
      value: jsessionid,
      path: '/mge',
      secure: u.protocol === 'https:',
      httpOnly: true,
    });
    logEvento('login-api-ok', { origem: origemSemQuery(origin) });
    return { ok: true };
  } catch (err) {
    // Rede, timeout ou resposta que não é JSON (tela de login de SSO, proxy): autofill.
    logEvento('login-api-falhou', { origem: origemSemQuery(origin), erro: String(err).slice(0, 200) });
    return { ok: false, erro: 'o login pela API não respondeu' };
  }
}

/**
 * Encerra a sessão ao fechar a aba: sessão que fica aberta ocupa licença de usuário no
 * cliente até expirar. Best-effort — fechar a aba nunca espera nem falha por isto.
 */
export async function deslogar(particao: string, origin: string): Promise<void> {
  try {
    const cookies = await session.fromPartition(particao).cookies.get({ url: `${origin}/mge`, name: 'JSESSIONID' });
    const sessao = cookies[0]?.value?.split('.')[0];
    if (!sessao) return;
    await postar(particao, origin, 'MobileLoginSP.logout', {}, sessao);
    logEvento('login-api-logout', { origem: origemSemQuery(origin) });
  } catch {
    /* a sessão expira sozinha no servidor */
  }
}
