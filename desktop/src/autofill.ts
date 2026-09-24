/**
 * Preenche usuário/senha na tela de login de uma base de cliente, quando já guardados
 * no cartão (`cliente_bases`, ver src/sankhya/cartao.ts). Só preenche — nunca aperta o
 * botão de login: um seletor errado numa base com HTML diferente não pode disparar uma
 * tentativa de login sozinho.
 *
 * O login do Sankhya Om é em DUAS etapas (usuário, "Prosseguir", só então aparece o
 * campo de senha) — confirmado testando de verdade com uma base real. Por isso não dá
 * pra rodar o preenchimento uma vez só logo depois do carregamento: é preciso continuar
 * observando a página enquanto a aba estiver aberta, porque o campo de senha só existe
 * depois de o usuário clicar "Prosseguir" manualmente na etapa 1 (nunca clicamos por
 * ele).
 *
 * A senha só existe em texto claro entre esta função e a página de destino: nunca passa
 * pelo preload, pelo renderer da UI local, nem é logada — `logEvento` abaixo só recebe
 * booleanos/IDs.
 */
import type { WebContentsView } from 'electron';
import { HUB_URL } from './config';
import { logEvento } from './log';
import type { InfoBaseCliente } from './tabs';

async function revelarSenhaBase(clienteId: number, baseId: number): Promise<string | null> {
  try {
    const resposta = await fetch(`${HUB_URL}/api/clientes/${clienteId}/bases/${baseId}/revelar`, {
      method: 'POST',
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
function scriptAutofillTick(usuario: string, senha: string, jaPreencheuUsuario: boolean): string {
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
      const todosInputs = () => {
        const achados = [];
        const visitar = (raiz) => {
          for (const el of raiz.querySelectorAll('input')) achados.push(el);
          for (const el of raiz.querySelectorAll('*')) {
            if (el.shadowRoot) visitar(el.shadowRoot);
          }
        };
        visitar(document);
        return achados;
      };
      const ehTexto = (el) => el.tagName === 'INPUT' && (!el.type || el.type === 'text' || el.type === 'email');
      const textos = () => todosInputs().filter(ehTexto).filter(visivel);

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
        return { ok: true, etapa: 'usuario' };
      }
      return { ok: false, motivo: vazios.length > 1 ? 'ambiguo' : 'sem-campo-reconhecido' };
    } catch (e) {
      return { ok: false, motivo: String(e) };
    }
  })()`;
}

/** Observa por até esse tanto de tempo — generoso o bastante pro usuário clicar
 * "Prosseguir" na etapa 1 sem pressa, mas não roda pra sempre numa aba esquecida aberta. */
const JANELA_OBSERVACAO_MS = 90_000;
const INTERVALO_MS = 1_000;

export async function tentarAutofill(view: WebContentsView, info: InfoBaseCliente): Promise<void> {
  if (!info.usuario || !info.temSenha) {
    logEvento('autofill-sem-cadastro', { clienteId: info.clienteId, baseId: info.baseId });
    return;
  }

  const senha = await revelarSenhaBase(info.clienteId, info.baseId);
  if (!senha) {
    logEvento('autofill-sem-senha', { clienteId: info.clienteId, baseId: info.baseId });
    return;
  }

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
        logEvento('autofill-desistiu', { clienteId: info.clienteId, baseId: info.baseId, preencheuUsuario, ultimoMotivo });
        return;
      }
      try {
        const script = scriptAutofillTick(info.usuario, senha, preencheuUsuario);
        const resultado = (await view.webContents.executeJavaScript(script, true)) as { ok: boolean; etapa?: string; motivo?: string };
        if (resultado.ok && resultado.etapa === 'senha') {
          clearInterval(intervalo);
          logEvento('autofill-preencheu-senha', { clienteId: info.clienteId, baseId: info.baseId });
        } else if (resultado.ok && resultado.etapa === 'usuario' && !preencheuUsuario) {
          preencheuUsuario = true;
          logEvento('autofill-preencheu-usuario', { clienteId: info.clienteId, baseId: info.baseId });
        } else if (resultado.motivo) {
          ultimoMotivo = resultado.motivo;
        }
      } catch (err) {
        clearInterval(intervalo);
        logEvento('autofill-falhou', { clienteId: info.clienteId, baseId: info.baseId, erro: String(err) });
      }
    })();
  }, INTERVALO_MS);

  view.webContents.once('destroyed', () => clearInterval(intervalo));
}
