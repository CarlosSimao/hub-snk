import type { FastifyInstance, FastifyReply } from 'fastify';
import { ehSistemaValido, type Credenciais } from '../sankhya/credenciais.ts';
import { HelperError, HelperIndisponivelError, type HubHelper } from '../sankhya/helper.ts';
import { SISTEMAS_SANKHYA } from '../tipos.ts';

/**
 * Rotas de integração com o Sankhya ERP/Experience, via `hub-helper.ps1`.
 *
 * Fase 2 do port: credenciais e captura de sessão. Agenda vem depois — ver
 * docs/port-sankhya-credenciais-agenda.md.
 */

/**
 * Helper fora do ar é situação NORMAL (o processo Windows pode não ter
 * subido), não defeito do HUB SNK — vira 503 com a mensagem original, que é o
 * que a tela mostra.
 */
function responderErroHelper(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof HelperIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message, helperIndisponivel: true });
  }
  if (erro instanceof HelperError) {
    return resposta.status(erro.status).send({ mensagem: erro.message });
  }
  throw erro;
}

export function registrarRotasDeSankhya(
  servidor: FastifyInstance,
  helper: HubHelper,
  credenciais: Credenciais,
): void {
  servidor.get('/api/sankhya/helper', async () => ({ disponivel: await helper.disponivel() }));

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
