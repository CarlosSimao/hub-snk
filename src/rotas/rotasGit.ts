import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultarRemotoDosRepositorios } from '../git/consultaDoRemoto.ts';
import { coletarSituacoes, type RepositorioParaVerificar } from '../git/cacheDeSituacao.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';

const esquemaDaConsulta = z.object({
  forcar: z.string().optional(),
  /** Id do cliente cujos repositórios passam por `git fetch` antes da leitura. */
  consultarRemotoDoCliente: z.string().optional(),
});

/**
 * Situação Git de todos os repositórios com pasta local, indexada pelo id do
 * repositório.
 *
 * Fica fora de `/api/clientes` de propósito: são cinco processos `git` por
 * repositório, e a lista de clientes precisa continuar respondendo na hora. O
 * HUB SNK desenha primeiro e preenche os indicadores quando esta rota responde.
 */
export function registrarRotasDeGit(
  servidor: FastifyInstance,
  repositorio: RepositorioClientes,
  repositorioDeConfiguracao: RepositorioConfiguracao,
): void {
  servidor.get('/api/situacao-git', async (requisicao) => {
    const consulta = esquemaDaConsulta.safeParse(requisicao.query);
    const forcar = consulta.success && consulta.data.forcar === 'true';
    const idDoClienteParaConsultar = consulta.success
      ? consulta.data.consultarRemotoDoCliente
      : undefined;

    const [clientes, configuracao] = await Promise.all([
      repositorio.listar(),
      repositorioDeConfiguracao.ler(),
    ]);

    const repositorios = clientes.flatMap((cliente) =>
      cliente.repositorios.flatMap<RepositorioParaVerificar>((repositorioGit) =>
        repositorioGit.caminhoLocal
          ? [
              {
                id: repositorioGit.id,
                caminhoLocal: repositorioGit.caminhoLocal,
                urlCadastrada: repositorioGit.url,
                branchPrincipal: repositorioGit.branchPrincipal,
              },
            ]
          : [],
      ),
    );

    const idsDoCliente = new Set(
      clientes
        .find((cliente) => cliente.id === idDoClienteParaConsultar)
        ?.repositorios.map((repositorioGit) => repositorioGit.id),
    );
    const doCliente = repositorios.filter((candidato) => idsDoCliente.has(candidato.id));
    await consultarRemotoDosRepositorios(doCliente, configuracao.tempoLimiteSegundos);

    return coletarSituacoes(repositorios, configuracao, forcar, idsDoCliente);
  });
}
