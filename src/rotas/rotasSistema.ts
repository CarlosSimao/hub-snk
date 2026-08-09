import type { FastifyInstance } from 'fastify';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import pacote from '../../package.json' with { type: 'json' };
import { PastaNaoEncontradaError } from '../sistema/pasta.ts';
import {
  selecionarPastaNoSistema,
  SeletorDePastaIndisponivelError,
} from '../sistema/selecionarPasta.ts';
import { varrerRepositoriosLocais } from '../sistema/varreduraDeRepositorios.ts';

const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const QUANTIDADE_MAXIMA_DE_PASTAS_VARRIDAS = 20;

const esquemaDeVarreduraDeRepositorios = z.object({
  pastas: z
    .array(
      z
        .string({ required_error: 'Informe a pasta a varrer.' })
        .trim()
        .min(1, 'Informe a pasta a varrer.')
        .max(
          TAMANHO_MAXIMO_DO_CAMINHO,
          `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
        )
        .refine(isAbsolute, 'Informe o caminho absoluto da pasta.'),
    )
    .min(1, 'Selecione ao menos uma pasta.')
    .max(
      QUANTIDADE_MAXIMA_DE_PASTAS_VARRIDAS,
      `Varra no máximo ${QUANTIDADE_MAXIMA_DE_PASTAS_VARRIDAS} pastas por vez.`,
    ),
});

/**
 * Recursos do sistema operacional que não pertencem a nenhum cadastro.
 *
 * A seleção de pasta serve a qualquer campo de caminho do HUB SNK — repositório,
 * WildFly, sankhya-schema-mcp —, por isso não mora nas rotas de cliente.
 */
export function registrarRotasDeSistema(servidor: FastifyInstance): void {
  /*
   * A versão vem do package.json, fonte única também para o `npm version`. O
   * rodapé a exibe para que um relato de problema já diga qual versão está
   * rodando, sem o usuário ir procurar.
   */
  servidor.get('/api/sistema/versao', async () => ({ versao: pacote.version }));

  /*
   * O diálogo é aberto no servidor porque só ele enxerga o caminho absoluto: o
   * navegador entrega apenas nomes relativos. Cancelar responde 204, sem caminho.
   */
  servidor.post('/api/sistema/selecionar-pasta', async (_requisicao, resposta) => {
    try {
      const caminho = await selecionarPastaNoSistema();
      return caminho === null ? resposta.status(204).send() : { caminho };
    } catch (erro) {
      if (erro instanceof SeletorDePastaIndisponivelError) {
        return resposta.status(503).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });

  /*
   * Varredura das pastas escolhidas na importação de repositórios locais. É
   * leitura de disco, sem gravar nada — o cadastro só acontece quando o usuário
   * conclui o assistente.
   */
  servidor.post('/api/sistema/repositorios-locais', async (requisicao, resposta) => {
    const dados = esquemaDeVarreduraDeRepositorios.safeParse(requisicao.body);
    if (!dados.success) {
      const primeiraMensagem = dados.error.errors[0]?.message ?? 'Dados inválidos.';
      return resposta.status(400).send({ mensagem: primeiraMensagem });
    }

    try {
      return { repositorios: await varrerRepositoriosLocais(dados.data.pastas) };
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta.status(404).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });
}
