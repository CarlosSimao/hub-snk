/**
 * Logout da sessão de uma base de cliente ao fechar a aba — para bases marcadas
 * "Entrar automaticamente", em que o hub fez o login sozinho. Sessão que fica aberta ocupa
 * licença de usuário no cliente até expirar.
 *
 * Histórico (2026-09-25): aqui existia um login por `MobileLoginSP.login`. O Sankhya aceita
 * a sessão e carrega o `system.jsp`, mas o workspace trava (`WorkspaceSP.getStartupData`
 * sem o contexto do usuário, `isUtilizaMultiAbas` de null): a tela de login monta esse
 * contexto por DWR com usuário e senha ofuscados pela própria página. Replicar isso seria
 * engenharia reversa frágil — o login ficou com a página, e o autofill passou a enviar o
 * formulário (`autofill.ts`).
 */
import { session } from 'electron';
import { logEvento, origemSemQuery } from './log';

/** Best-effort — fechar a aba nunca espera nem falha por isto. */
export async function deslogar(particao: string, origin: string): Promise<void> {
  try {
    const ses = session.fromPartition(particao);
    const cookies = await ses.cookies.get({ url: `${origin}/mge`, name: 'JSESSIONID' });
    const sessao = cookies[0]?.value?.split('.')[0];
    if (!sessao) return;
    await ses.fetch(`${origin}/mge/service.sbr?serviceName=MobileLoginSP.logout&outputType=json&mgeSession=${sessao}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceName: 'MobileLoginSP.logout', requestBody: {} }),
      signal: AbortSignal.timeout(10_000),
    });
    logEvento('sessao-base-logout', { origem: origemSemQuery(origin) });
  } catch {
    /* a sessão expira sozinha no servidor */
  }
}
