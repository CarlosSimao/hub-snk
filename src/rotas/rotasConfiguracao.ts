import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import {
  gravarConfiguracaoMcp,
  lerConfiguracaoMcp,
  NOME_DO_ARQUIVO_ENV,
} from '../sistema/arquivoMcp.ts';
import { PastaNaoEncontradaError } from '../sistema/pasta.ts';
import { esquemaDeConfiguracaoMcp } from './esquemaDeConfiguracaoMcp.ts';

const TAMANHO_MAXIMO_DO_SCRIPT = 500;
const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const TAMANHO_MAXIMO_DO_NOME_DO_ATALHO = 60;
const INTERVALO_MINIMO_DE_EXECUCAO_AUTOMATICA_S = 5;
const INTERVALO_MAXIMO_DE_EXECUCAO_AUTOMATICA_S = 3600;
const TEMPO_LIMITE_MINIMO_S = 1;
const TEMPO_LIMITE_MAXIMO_S = 60;

/*
 * O id só vem nos atalhos que já estão gravados; o de um atalho novo é gerado
 * na persistência. A existência do arquivo não é checada aqui: caminho de um
 * programa ainda não instalado pode ser cadastrado, e a cobrança fica para a
 * hora de executar.
 */
const esquemaDeAtalho = z.object({
  id: z.string().optional(),
  nome: z
    .string({ error: 'Informe o nome do atalho.' })
    .trim()
    .min(1, 'Informe o nome do atalho.')
    .max(
      TAMANHO_MAXIMO_DO_NOME_DO_ATALHO,
      `O nome do atalho deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME_DO_ATALHO} caracteres.`,
    ),
  caminhoDoExecutavel: z
    .string({ error: 'Informe o caminho do executável.' })
    .trim()
    .min(1, 'Informe o caminho do executável.')
    .max(
      TAMANHO_MAXIMO_DO_CAMINHO,
      `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
    ),
});

const esquemaDeConfiguracao = z.object({
  scriptPadrao: z
    .string({ error: 'Informe o script padrão.' })
    .max(
      TAMANHO_MAXIMO_DO_SCRIPT,
      `O script deve ter no máximo ${TAMANHO_MAXIMO_DO_SCRIPT} caracteres.`,
    ),
  intervaloDeExecucaoAutomaticaSegundos: z.coerce
    .number({ error: 'O intervalo deve ser um número.' })
    .int('O intervalo deve ser um número inteiro de segundos.')
    .min(
      INTERVALO_MINIMO_DE_EXECUCAO_AUTOMATICA_S,
      `O intervalo deve ser de pelo menos ${INTERVALO_MINIMO_DE_EXECUCAO_AUTOMATICA_S} segundos.`,
    )
    .max(
      INTERVALO_MAXIMO_DE_EXECUCAO_AUTOMATICA_S,
      `O intervalo deve ser de no máximo ${INTERVALO_MAXIMO_DE_EXECUCAO_AUTOMATICA_S} segundos.`,
    ),
  tempoLimiteSegundos: z.coerce
    .number({ error: 'O tempo limite deve ser um número.' })
    .int('O tempo limite deve ser um número inteiro de segundos.')
    .min(
      TEMPO_LIMITE_MINIMO_S,
      `O tempo limite deve ser de pelo menos ${TEMPO_LIMITE_MINIMO_S} segundo.`,
    )
    .max(
      TEMPO_LIMITE_MAXIMO_S,
      `O tempo limite deve ser de no máximo ${TEMPO_LIMITE_MAXIMO_S} segundos.`,
    ),
  /*
   * Vazio desliga a gravação do `.env` do sankhya-schema-mcp. Ausente vale
   * como vazio: uma tela ainda não recarregada não manda o campo, e isso não
   * pode impedir de salvar o resto.
   */
  caminhoDoSchemaMcp: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_CAMINHO,
      `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
    )
    .default(''),
  /* Ausente vale como lista vazia, pelo mesmo motivo do caminho do MCP. */
  atalhos: z.array(esquemaDeAtalho).default([]),
});

/**
 * As credenciais não entram no `configuracao.json`: viajam à parte no corpo do
 * PUT e vão direto para o `.env` da pasta do MCP, que é de onde ele as lê.
 */
const esquemaDoCorpoDaConfiguracao = esquemaDeConfiguracao.extend({
  mcp: esquemaDeConfiguracaoMcp.optional(),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

export function registrarRotasDeConfiguracao(
  servidor: FastifyInstance,
  repositorio: RepositorioConfiguracao,
): void {
  servidor.get('/api/configuracao', async () => repositorio.ler());

  /*
   * Credenciais do MCP global: lidas do `.env` da pasta cadastrada, e não do
   * `configuracao.json`. Sem caminho cadastrado não há o que ler.
   */
  servidor.get('/api/configuracao/mcp', async (_requisicao, resposta) => {
    const { caminhoDoSchemaMcp } = await repositorio.ler();
    if (caminhoDoSchemaMcp === '') {
      return { configuracao: null, existe: false };
    }

    try {
      return await lerConfiguracaoMcp(caminhoDoSchemaMcp, NOME_DO_ARQUIVO_ENV);
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta
          .status(404)
          .send({ mensagem: `Pasta não encontrada: ${caminhoDoSchemaMcp}` });
      }
      throw erro;
    }
  });

  servidor.put('/api/configuracao', async (requisicao, resposta) => {
    const dados = esquemaDoCorpoDaConfiguracao.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    const { mcp, ...configuracao } = dados.data;

    /*
     * O `.env` é gravado antes do cadastro: se a pasta não existir, nada é
     * persistido e o caminho inválido não fica salvo.
     */
    if (configuracao.caminhoDoSchemaMcp !== '') {
      if (!mcp) {
        return resposta
          .status(400)
          .send({ mensagem: 'Informe as variáveis do MCP ou deixe o caminho em branco.' });
      }

      try {
        await gravarConfiguracaoMcp(
          configuracao.caminhoDoSchemaMcp,
          { ...mcp, SANKHYA_DB_PORT: String(mcp.SANKHYA_DB_PORT) },
          NOME_DO_ARQUIVO_ENV,
        );
      } catch (erro) {
        if (erro instanceof PastaNaoEncontradaError) {
          return resposta
            .status(404)
            .send({ mensagem: `Pasta não encontrada: ${configuracao.caminhoDoSchemaMcp}` });
        }
        throw erro;
      }
    }

    return repositorio.salvar(configuracao);
  });
}
