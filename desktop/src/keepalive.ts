/**
 * Mantém viva a sessão das abas do Sankhya (ERP corporativo e bases de cliente).
 *
 * Medido em 2026-09-24: com a aba aberta, a sessão corporativa sobreviveu a 20, 40 e 60
 * minutos sem chamada do hub — a própria página já gera tráfego. O ping existe como
 * seguro contra uma mudança de configuração do servidor (timeout menor, tela sem
 * polling), não porque a sessão cai hoje.
 *
 * Só pinga a aba que o hub não chamou no último ciclo: uma busca de agenda ou leitura de
 * log já conta como atividade. E avisa UMA vez quando a sessão cai, para o usuário logar
 * de novo antes de precisar dela — não a cada ciclo.
 *
 * Não vence a expiração dura do SSO: isso pede login, e o aviso é o que resta fazer.
 */
import { Notification, type WebContentsView } from 'electron';
import { carregarRegistros, ultimaAtividade } from './chamarNaAba';
import { DOMINIOS_ERP, ICONE } from './config';
import { logEvento, origemSemQuery } from './log';

export interface AbaSankhya {
  /** Chave estável da aba: `erp` ou o origin da base. */
  chave: string;
  titulo: string;
  view: WebContentsView;
}

const MINUTOS_PADRAO = 10;

function intervaloMs(): number {
  const min = Number(process.env['SANKHYA_KEEPALIVE_MIN'] ?? MINUTOS_PADRAO);
  return (Number.isFinite(min) && min >= 1 ? min : MINUTOS_PADRAO) * 60_000;
}

function noSankhya(chave: string, url: string): boolean {
  try {
    const u = new URL(url);
    // Pelo host, não pelo origin: o logout da base redireciona para `http://…/login.jsp`
    // mesmo com a base em https, e o protocolo diferente fazia a aba ser pulada.
    if (chave !== 'erp') return u.hostname === new URL(chave).hostname;
    return DOMINIOS_ERP.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** `false` = sessão caída; `true` = qualquer resposta do servidor com sessão. */
async function pingar(view: WebContentsView): Promise<boolean> {
  // Leitura mínima: um campo de um registro. Mesmo negada por ACL (status 0), a requisição
  // passou pela sessão e a renovou — só a sessão caída (HTML/status 3) conta como falha.
  const r = await carregarRegistros(view.webContents, 'Usuario', 'CODUSU', 'this.CODUSU = 0');
  return r.ok || !r.expirou;
}

function avisarQueda(aba: AbaSankhya): void {
  if (!Notification.isSupported()) return;
  new Notification({
    title: 'Sessão do Sankhya caiu',
    body: `${aba.titulo}: faça login de novo na aba para o hub continuar buscando dados.`,
    icon: ICONE,
    silent: true,
  }).show();
}

/** Liga o ciclo. Devolve a função que o desliga. */
export function iniciarKeepalive(obterAbas: () => AbaSankhya[]): () => void {
  const intervalo = intervaloMs();
  const caidas = new Set<string>();
  /** Abas em que já houve sessão viva — só estas geram aviso de queda. */
  const jaVivas = new Set<string>();
  let rodando = false;

  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const abas = obterAbas();
      const abertas = new Set(abas.map((a) => a.chave));
      for (const chave of caidas) if (!abertas.has(chave)) caidas.delete(chave);
      for (const chave of jaVivas) if (!abertas.has(chave)) jaVivas.delete(chave);

      for (const aba of abas) {
        const wc = aba.view.webContents;
        if (wc.isDestroyed() || wc.isLoading()) continue;
        // Na página do SSO (Microsoft, Google) o `fetch` relativo sairia para o domínio do
        // provedor: só pinga quando a aba está no próprio Sankhya.
        if (!noSankhya(aba.chave, wc.getURL())) continue;
        // Folga de 10%: o ping do ciclo anterior também conta como atividade e, sem ela, o
        // ciclo seguinte pularia a aba por milissegundos — o intervalo real dobrava.
        if (Date.now() - ultimaAtividade(wc) < intervalo * 0.9) continue;
        const chaveLog = aba.chave === 'erp' ? 'erp' : origemSemQuery(aba.chave);
        let viva: boolean;
        try {
          // Na tela de login não há o que pingar: a sessão já caiu.
          viva = /\/login\.jsp$/i.test(new URL(wc.getURL()).pathname) ? false : await pingar(aba.view);
        } catch (err) {
          // Aba no meio de uma navegação: tenta no próximo ciclo, sem concluir nada.
          logEvento('keepalive-erro', { chave: chaveLog, erro: String(err) });
          continue;
        }
        logEvento('keepalive-ping', { chave: chaveLog, viva });
        if (viva) {
          jaVivas.add(aba.chave);
          if (caidas.delete(aba.chave)) logEvento('keepalive-sessao-voltou', { chave: chaveLog });
        } else if (!caidas.has(aba.chave)) {
          caidas.add(aba.chave);
          logEvento('keepalive-sessao-caiu', { chave: chaveLog });
          // Aba que nunca teve sessão (app recém-aberto, login ainda por fazer) não caiu:
          // avisar ali seria ruído a cada abertura do app.
          if (jaVivas.has(aba.chave)) avisarQueda(aba);
        }
      }
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(() => void ciclo(), intervalo);
  logEvento('keepalive-iniciado', { minutos: intervalo / 60_000 });
  return () => clearInterval(timer);
}
