import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import {
  abrirExecutavelNoSistema,
  ExecutavelNaoEncontradoError,
} from '../sistema/abrirExecutavel.ts';
import {
  selecionarArquivoNoSistema,
  SeletorDeArquivoIndisponivelError,
} from '../sistema/selecionarArquivo.ts';

const esquemaDeParametros = z.object({ id: z.string().min(1) });

/**
 * Disparo dos atalhos cadastrados na configuração global.
 *
 * O corpo não carrega caminho nenhum: o HUB SNK manda só o id, e o caminho sai
 * do cadastro. Assim nenhuma requisição consegue executar um programa que o
 * usuário não cadastrou.
 */
export function registrarRotasDeAtalhos(
  servidor: FastifyInstance,
  repositorio: RepositorioConfiguracao,
): void {
  /*
   * O caminho do executável é escolhido no seletor do próprio sistema: o
   * navegador não entrega o caminho absoluto do arquivo, e é dele que a
   * execução depende. Cancelar responde 204, sem caminho.
   */
  servidor.post('/api/atalhos/selecionar-executavel', async (_requisicao, resposta) => {
    try {
      const caminho = await selecionarArquivoNoSistema();
      return caminho === null ? resposta.status(204).send() : { caminho };
    } catch (erro) {
      if (erro instanceof SeletorDeArquivoIndisponivelError) {
        return resposta.status(503).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });

  servidor.post('/api/atalhos/:id/abrir', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ mensagem: 'Atalho inválido.' });
    }

    const { atalhos } = await repositorio.ler();
    const atalho = atalhos.find((candidato) => candidato.id === parametros.data.id);
    if (!atalho) {
      return resposta.status(404).send({ mensagem: 'Atalho não encontrado.' });
    }

    try {
      await abrirExecutavelNoSistema(atalho.caminhoDoExecutavel);
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof ExecutavelNaoEncontradoError) {
        return resposta.status(404).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });
}
