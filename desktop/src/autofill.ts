/**
 * Preenche usuário/senha na tela de login de uma base de cliente, quando já guardados
 * no cadastro do HUB SNK (`clientes.json`), e clica em entrar.
 *
 * O login do Sankhya Om é em DUAS etapas (usuário, "Prosseguir", só então aparece o
 * campo de senha) — confirmado testando de verdade com uma base real. Por isso, depois
 * de preencher o usuário, o próprio autofill clica no botão que avança para a etapa 2 —
 * do contrário a senha ficaria esperando um clique manual. O clique só acontece uma vez,
 * na mesma checagem que já confirmou tratar-se de tela de login (poucos campos de texto,
 * exatamente um vazio): o candidato a botão é o que tem texto de "prosseguir" (ou
 * equivalente), e só na ausência de um assim é que um botão único na tela é aceito —
 * nunca um clique às cegas em página com vários botões visíveis.
 *
 * A senha só existe em texto claro entre esta função e a página de destino: nunca passa
 * pelo preload, pelo renderer da UI local, nem é logada — `logEvento` abaixo só recebe
 * booleanos/IDs.
 */
import type { WebContents, WebContentsView } from 'electron';
import { HUB_URL } from './config';
import { logEvento } from './log';
import type { InfoBaseCliente } from './tabs';
import { garantirToken } from './tokenStore';

/**
 * A senha vem de uma rota própria, protegida pelo token do shell, e só na hora de
 * preencher: o `TabManager` guarda apenas se a base tem senha, nunca o valor.
 */
async function revelarSenhaBase(clienteId: string, baseId: string): Promise<string | null> {
  const caminho = `/api/clientes/${encodeURIComponent(clienteId)}/bases/${encodeURIComponent(baseId)}/senha`;
  try {
    const resposta = await fetch(`${HUB_URL}${caminho}`, {
      method: 'POST',
      headers: { 'x-hub-token': garantirToken() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resposta.ok) return null;
    const corpo = (await resposta.json()) as { senha?: string };
    return corpo.senha ?? null;
  } catch {
    return null;
  }
}

/**
 * Roda a cada tick do observador. Duas situações reconhecidas, cada uma tolerante a
 * marcações diferentes entre bases (não existe um seletor único confirmado para todas
 * as instâncias de Sankhya Om):
 *  - Só campo de senha visível (etapa 2 do login em duas etapas, ou formulário de uma
 *    etapa só com senha): preenche senha e, se ainda houver um campo de texto vazio
 *    antes dela no DOM, preenche usuário também.
 *  - Nenhum campo de senha, exatamente um campo de texto/e-mail visível e vazio (etapa
 *    1): preenche só o usuário.
 * Nunca sobrescreve um campo que já tem valor (evita atropelar o que o usuário mesmo
 * digitou). Dispara `input`/`change` sintéticos porque formulários com JS por trás
 * (React/Vue) só reagem a evento, não a atribuição direta de `.value`.
 */
export function scriptAutofillTick(
  usuario: string,
  senha: string,
  jaPreencheuUsuario: boolean,
): string {
  const usuarioJson = JSON.stringify(usuario);
  const senhaJson = JSON.stringify(senha);
  return `(() => {
    try {
      const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const setar = (el, valor) => {
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, valor); else el.value = valor;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      // Design systems modernos (o do Sankhya inclusive) montam campo dentro de Web
      // Component com Shadow DOM — 'document.querySelectorAll' sozinho não enxerga
      // nada lá dentro. Desce recursivamente por qualquer shadow root ABERTA
      // (shadowRoot fechada não tem contorno possível a partir daqui).
      const todos = (seletor) => {
        const achados = [];
        const visitar = (raiz) => {
          for (const el of raiz.querySelectorAll(seletor)) achados.push(el);
          for (const el of raiz.querySelectorAll('*')) {
            if (el.shadowRoot) visitar(el.shadowRoot);
          }
        };
        visitar(document);
        return achados;
      };
      const todosInputs = () => todos('input');
      const ehTexto = (el) => el.tagName === 'INPUT' && (!el.type || el.type === 'text' || el.type === 'email');
      const textos = () => todosInputs().filter(ehTexto).filter(visivel);

      // Botão que avança para a etapa 2 (senha): o de texto "prosseguir"/"continuar"/
      // "avançar" é preferido por nome; sem um assim, só um botão visível na tela — a
      // essa altura já confirmada como tela de login pela contagem de campos de texto —
      // é aceito. Duas ou mais opções sem nome reconhecido são ambíguas demais pra clicar.
      const botaoDeProsseguir = () => {
        const candidatos = todos('button, input[type="submit"], [role="button"]').filter(visivel);
        const porTexto = candidatos.find((el) =>
          /prosseguir|continuar|avan[cç]ar/i.test((el.innerText || el.value || '').trim()),
        );
        if (porTexto) return porTexto;
        return candidatos.length === 1 ? candidatos[0] : null;
      };

      const senhaEl = todosInputs().find((el) => el.type === 'password' && visivel(el));
      if (senhaEl) {
        if (senhaEl.value) return { ok: false, motivo: 'senha-ja-preenchida' };
        const antes = textos().filter((el) => el.compareDocumentPosition(senhaEl) & Node.DOCUMENT_POSITION_FOLLOWING);
        const usuarioEl = antes[antes.length - 1];
        if (usuarioEl && !usuarioEl.value) setar(usuarioEl, ${usuarioJson});
        setar(senhaEl, ${senhaJson});
        return { ok: true, etapa: 'senha' };
      }

      // Etapa 1 (só usuário) só é tentada UMA vez por aba: depois de preenchida, a
      // mesma checagem numa tela qualquer do sistema já autenticado (um campo de busca
      // sozinho, por exemplo) não deve ser confundida com um novo formulário de login.
      if (${jaPreencheuUsuario ? 'true' : 'false'}) return { ok: false, motivo: 'usuario-ja-tentado' };

      // Guarda extra: uma tela de login de verdade tem poucos campos de texto. Uma
      // tela do sistema já logado (grid, toolbar, filtros) tem muitos — mesmo que só um
      // esteja vazio no momento, o total alto descarta a hipótese de ser login. Conta só
      // campos de TEXTO (não todo <input>: checkbox de "lembrar-me", campo oculto
      // anti-bot etc. são normais até numa tela de login real e não devem contar).
      const camposDeTexto = textos();
      if (camposDeTexto.length > 3) return { ok: false, motivo: 'muitos-campos-de-texto-nao-e-login' };

      const vazios = camposDeTexto.filter((el) => !el.value);
      if (vazios.length === 1) {
        setar(vazios[0], ${usuarioJson});
        const botao = botaoDeProsseguir();
        if (botao) botao.click();
        return { ok: true, etapa: 'usuario', clicouProsseguir: !!botao };
      }
      return { ok: false, motivo: vazios.length > 1 ? 'ambiguo' : 'sem-campo-reconhecido' };
    } catch (e) {
      return { ok: false, motivo: String(e) };
    }
  })()`;
}

/**
 * A credencial só vai para uma página do host esperado. Sem esta conferência, um redirect
 * para um SSO, uma página intermediária ou um link clicado durante a observação levariam
 * usuário e senha para outro site, e o clique em "entrar" os submeteria lá.
 */
export function paginaNoHost(wc: WebContents, hostPermitido: (host: string) => boolean): boolean {
  try {
    return hostPermitido(new URL(wc.getURL()).hostname);
  } catch {
    return false;
  }
}

/** Clica no botão de entrar depois que usuário/senha já foram preenchidos. */
export function scriptSubmeterLogin(): string {
  return `(() => {
    const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const todos = (seletor) => {
      const achados = [];
      const visitar = (raiz) => {
        for (const el of raiz.querySelectorAll(seletor)) achados.push(el);
        for (const el of raiz.querySelectorAll('*')) if (el.shadowRoot) visitar(el.shadowRoot);
      };
      visitar(document);
      return achados;
    };
    const botoes = todos('button, input[type="submit"], [role="button"]').filter(visivel);
    const porTexto = botoes.find((el) =>
      /entrar|acessar|login|conectar|continuar|prosseguir/i.test((el.innerText || el.value || '').trim()),
    );
    const alvo = porTexto || (botoes.length === 1 ? botoes[0] : null);
    if (alvo) { alvo.click(); return true; }
    return false;
  })()`;
}

/** A tela de login do Sankhya é montada por JS depois do `did-finish-load`. */
const ESPERA_CAMPO_DE_SENHA_MS = 15_000;

const SCRIPT_TEM_CAMPO_DE_SENHA = `(() => {
  const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const visitar = (raiz) => {
    for (const el of raiz.querySelectorAll('input[type="password"]')) if (visivel(el)) return true;
    for (const el of raiz.querySelectorAll('*')) if (el.shadowRoot && visitar(el.shadowRoot)) return true;
    return false;
  };
  return visitar(document);
})()`;

/**
 * A página mostra um campo de senha visível dentro do prazo? É o sinal de tela de login
 * quando a URL não denuncia — o Sankhya Om pede a senha na própria `/mge/`.
 */
export async function aguardarCampoDeSenha(wc: WebContents): Promise<boolean> {
  const inicio = Date.now();
  while (!wc.isDestroyed() && Date.now() - inicio < ESPERA_CAMPO_DE_SENHA_MS) {
    const achou = (await wc
      .executeJavaScript(SCRIPT_TEM_CAMPO_DE_SENHA, true)
      .catch(() => false)) as boolean;
    if (achou) return true;
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
  }
  return false;
}

/**
 * Observa por até esse tanto de tempo. O clique em "Prosseguir" é automático, mas a
 * página pode demorar a carregar ou, num layout sem botão reconhecível, esperar o
 * usuário clicar na mão — generoso o bastante pros dois casos, mas sem rodar pra sempre
 * numa aba esquecida aberta.
 */
const JANELA_OBSERVACAO_MS = 90_000;
const INTERVALO_MS = 1_000;

/**
 * `origin` é o da aba da base. A comparação é pelo host, não pelo origin inteiro: base
 * cadastrada em `http` que o servidor promove para `https` continua sendo a mesma base.
 */
export async function tentarAutofill(
  view: WebContentsView,
  info: InfoBaseCliente,
  origin: string,
): Promise<void> {
  if (!info.usuario || !info.temSenha) {
    logEvento('autofill-sem-cadastro', { clienteId: info.clienteId, baseId: info.baseId });
    return;
  }

  const senha = await revelarSenhaBase(info.clienteId, info.baseId);
  if (!senha) {
    logEvento('autofill-sem-senha', { clienteId: info.clienteId, baseId: info.baseId });
    return;
  }

  const hostDaBase = new URL(origin).hostname;
  const inicio = Date.now();
  let preencheuUsuario = false;
  let ultimoMotivo = '';

  const intervalo = setInterval(() => {
    void (async () => {
      if (view.webContents.isDestroyed()) {
        clearInterval(intervalo);
        return;
      }
      if (Date.now() - inicio > JANELA_OBSERVACAO_MS) {
        clearInterval(intervalo);
        logEvento('autofill-desistiu', {
          clienteId: info.clienteId,
          baseId: info.baseId,
          preencheuUsuario,
          ultimoMotivo,
        });
        return;
      }
      if (!paginaNoHost(view.webContents, (host) => host === hostDaBase)) {
        ultimoMotivo = 'pagina-fora-do-host-da-base';
        return;
      }
      try {
        const script = scriptAutofillTick(info.usuario, senha, preencheuUsuario);
        const resultado = (await view.webContents.executeJavaScript(script, true)) as {
          ok: boolean;
          etapa?: string;
          motivo?: string;
          clicouProsseguir?: boolean;
        };
        if (resultado.ok && resultado.etapa === 'senha') {
          clearInterval(intervalo);
          // Senha cadastrada = login completo sem clique. Só uma submissão por aba: com
          // a senha errada, a tela mostra o erro do Sankhya em vez de repetir a tentativa.
          const submeteu = (await view.webContents.executeJavaScript(
            scriptSubmeterLogin(),
            true,
          )) as boolean;
          logEvento('autofill-preencheu-senha', {
            clienteId: info.clienteId,
            baseId: info.baseId,
            submeteu,
          });
        } else if (resultado.ok && resultado.etapa === 'usuario' && !preencheuUsuario) {
          preencheuUsuario = true;
          logEvento('autofill-preencheu-usuario', {
            clienteId: info.clienteId,
            baseId: info.baseId,
            clicouProsseguir: resultado.clicouProsseguir ?? false,
          });
        } else if (resultado.motivo) {
          ultimoMotivo = resultado.motivo;
        }
      } catch (err) {
        clearInterval(intervalo);
        logEvento('autofill-falhou', {
          clienteId: info.clienteId,
          baseId: info.baseId,
          erro: String(err),
        });
      }
    })();
  }, INTERVALO_MS);

  view.webContents.once('destroyed', () => clearInterval(intervalo));
}
