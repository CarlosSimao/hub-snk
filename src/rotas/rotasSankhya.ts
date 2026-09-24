import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ehSistemaValido, type Credenciais } from '../sankhya/credenciais.ts';
import { HelperError, HelperIndisponivelError } from '../sankhya/helper.ts';
import { PonteDoDesktopError, PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type { SessaoDoDesktop } from '../sankhya/sessaoDoDesktop.ts';
import { SISTEMAS_SANKHYA } from '../tipos.ts';
import { requisicaoVeioDoShell } from './autenticacaoDoShell.ts';

/** Único sistema cuja sessão o shell empurra: o ERP é consultado dentro da guia. */
const SISTEMA_COM_SESSAO_EMPURRADA = 'sankhya-experience';

/**
 * Rotas de integração com o Sankhya ERP/Experience, via shell desktop ou, na
 * retaguarda, `hub-helper.ps1`.
 */

/**
 * Helper fora do ar é situação NORMAL (o processo Windows pode não ter
 * subido), não defeito do HUB SNK — vira 503 com a mensagem original, que é o
 * que a tela mostra.
 */
function responderErroHelper(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof HelperIndisponivelError || erro instanceof PonteDoDesktopIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message, helperIndisponivel: true });
  }
  if (erro instanceof HelperError || erro instanceof PonteDoDesktopError) {
    return resposta.status(erro.status).send({ mensagem: erro.message });
  }
  throw erro;
}

const esquemaDaSessaoEmpurrada = z.object({
  usuario: z.string(),
  token: z.string().min(1),
  expira: z.string().optional().default(''),
});

/**
 * Só o shell desktop empurra sessão: sem o token dele, qualquer processo da
 * máquina poderia trocar o JWT que o backend usa na Experience.
 */
function registrarRotasDeSessaoDoDesktop(
  servidor: FastifyInstance,
  sessaoDoDesktop: SessaoDoDesktop,
  arquivoTokenDoDesktop: string,
): void {
  const caminho = '/api/sankhya/desktop/sessao/:sistema';

  servidor.post<{ Params: { sistema: string } }>(caminho, async (requisicao, resposta) => {
    if (!requisicaoVeioDoShell(requisicao, resposta, arquivoTokenDoDesktop)) {
      return resposta;
    }
    if (requisicao.params.sistema !== SISTEMA_COM_SESSAO_EMPURRADA) {
      return resposta
        .status(404)
        .send({ mensagem: `sistema "${requisicao.params.sistema}" não aceita sessão empurrada` });
    }

    const sessao = esquemaDaSessaoEmpurrada.safeParse(requisicao.body);
    if (!sessao.success) {
      return resposta.status(400).send({ mensagem: 'Envie { usuario, token, expira? }.' });
    }

    sessaoDoDesktop.definir(sessao.data);
    return { ok: true };
  });

  servidor.delete<{ Params: { sistema: string } }>(caminho, async (requisicao, resposta) => {
    if (!requisicaoVeioDoShell(requisicao, resposta, arquivoTokenDoDesktop)) {
      return resposta;
    }
    if (requisicao.params.sistema !== SISTEMA_COM_SESSAO_EMPURRADA) {
      return resposta
        .status(404)
        .send({ mensagem: `sistema "${requisicao.params.sistema}" não aceita sessão empurrada` });
    }

    sessaoDoDesktop.limpar();
    return { ok: true };
  });
}

export function registrarRotasDeSankhya(
  servidor: FastifyInstance,
  credenciais: Credenciais,
  sessaoDoDesktop: SessaoDoDesktop,
  arquivoTokenDoDesktop: string,
): void {
  registrarRotasDeSessaoDoDesktop(servidor, sessaoDoDesktop, arquivoTokenDoDesktop);

  servidor.get('/api/sankhya/helper', async () => ({ disponivel: await credenciais.disponivel() }));

  /**
   * Estado das duas credenciais. Nunca devolve senha — só o nome de usuário e
   * se há valor guardado.
   */
  servidor.get('/api/sankhya/credenciais', async (_requisicao, resposta) => {
    try {
      return { credenciais: await Promise.all(SISTEMAS_SANKHYA.map((s) => credenciais.status(s))) };
    } catch (erro) {
      return responderErroHelper(resposta, erro);
    }
  });

  servidor.post<{ Params: { sistema: string }; Body: { usuario?: unknown; senha?: unknown } }>(
    '/api/sankhya/credenciais/:sistema',
    async (requisicao, resposta) => {
      const { sistema } = requisicao.params;
      if (!ehSistemaValido(sistema)) {
        return resposta.status(404).send({ mensagem: `sistema "${sistema}" não existe` });
      }

      const { usuario, senha } = requisicao.body ?? {};
      if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha) {
        return resposta.status(400).send({ mensagem: 'Informe usuário e senha.' });
      }

      try {
        return await credenciais.gravar(sistema, usuario.trim(), senha);
      } catch (erro) {
        return responderErroHelper(resposta, erro);
      }
    },
  );

  servidor.delete<{ Params: { sistema: string } }>(
    '/api/sankhya/credenciais/:sistema',
    async (requisicao, resposta) => {
      const { sistema } = requisicao.params;
      if (!ehSistemaValido(sistema)) {
        return resposta.status(404).send({ mensagem: `sistema "${sistema}" não existe` });
      }

      try {
        return await credenciais.remover(sistema);
      } catch (erro) {
        return responderErroHelper(resposta, erro);
      }
    },
  );

  servidor.get('/api/sankhya/navegador', async (_requisicao, resposta) => {
    try {
      return await credenciais.statusNavegador();
    } catch (erro) {
      return responderErroHelper(resposta, erro);
    }
  });

  /**
   * Abre a janela do hub na tela de login, e depois lê o cookie de sessão
   * dela. Dois passos de propósito: entre um e outro, quem digita a senha é o
   * usuário — o hub nunca vê a senha, só o que sobra depois.
   */
  for (const acao of ['abrir', 'capturar'] as const) {
    servidor.post<{ Params: { sistema: string } }>(
      `/api/sankhya/navegador/${acao}/:sistema`,
      async (requisicao, resposta) => {
        const { sistema } = requisicao.params;
        if (!ehSistemaValido(sistema)) {
          return resposta.status(404).send({ mensagem: `sistema "${sistema}" não existe` });
        }

        try {
          if (acao === 'abrir') {
            return await credenciais.abrirNavegador(sistema);
          }

          const resultado = await credenciais.capturarSessao(sistema);
          if (!resultado.ok) {
            return resposta
              .status(409)
              .send({ mensagem: resultado.erro ?? 'Nenhum cookie capturado.' });
          }
          return resultado;
        } catch (erro) {
          return responderErroHelper(resposta, erro);
        }
      },
    );
  }

  servidor.post('/api/sankhya/navegador/fechar', async (_requisicao, resposta) => {
    try {
      return await credenciais.fecharNavegador();
    } catch (erro) {
      return responderErroHelper(resposta, erro);
    }
  });
}
