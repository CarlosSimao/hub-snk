import type { FastifyInstance } from 'fastify';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import {
  ExecutavelNaoEncontradoError,
  FalhaAoIniciarExecutavelError,
} from '../sistema/processos/abrirExecutavel.ts';
import {
  selecionarArquivoNoSistema,
  SeletorDeArquivoIndisponivelError,
} from '../sistema/processos/selecionarArquivo.ts';
import {
  caminhoDoExecutavel,
  consultarWebConnection,
  encerrarCopiasPresas,
  iniciarExecutavel,
  type SituacaoDoWebConnection,
} from '../sistema/webConnection.ts';

/** O que toca a máquina, separado para os testes não abrirem programa nem janela. */
export interface DependenciasDoWebConnection {
  consultar(): Promise<SituacaoDoWebConnection>;
  encerrarCopiasPresas(caminho: string): Promise<void>;
  abrirExecutavel(caminho: string): Promise<void>;
  selecionarArquivo(): Promise<string | null>;
}

const DEPENDENCIAS_PADRAO: DependenciasDoWebConnection = {
  consultar: () => consultarWebConnection(),
  encerrarCopiasPresas,
  abrirExecutavel: iniciarExecutavel,
  selecionarArquivo: () => selecionarArquivoNoSistema(),
};

const MENSAGEM_SEM_EXECUTAVEL =
  'Não encontrei o Sankhya Web Connection. Escolha o executável que o inicia.';

/**
 * Indicador do Sankhya Web Connection no topo: se está no ar e, desligado, o atalho para
 * iniciá-lo. O programa continua separado do HUB SNK; aqui ele só é consultado e aberto.
 */
export function registrarRotasDeWebConnection(
  servidor: FastifyInstance,
  repositorio: RepositorioConfiguracao,
  dependencias: DependenciasDoWebConnection = DEPENDENCIAS_PADRAO,
): void {
  servidor.get('/api/web-connection/situacao', () => dependencias.consultar());

  /*
   * Já ligado, não abre outro: uma segunda instância disputaria as portas da primeira.
   * Desligado, encerra antes o iniciador que tenha ficado preso, senão o novo sai sem abrir
   * nada. Sem executável conhecido, `caminhoPendente` faz a tela oferecer o seletor.
   */
  servidor.post('/api/web-connection/iniciar', async (_requisicao, resposta) => {
    if ((await dependencias.consultar()).ligado) {
      return resposta.status(204).send();
    }

    const { caminhoDoWebConnection } = await repositorio.ler();
    const caminho = await caminhoDoExecutavel(caminhoDoWebConnection);
    if (caminho === null) {
      return resposta
        .status(409)
        .send({ mensagem: MENSAGEM_SEM_EXECUTAVEL, caminhoPendente: true });
    }

    try {
      await dependencias.encerrarCopiasPresas(caminho);
      await dependencias.abrirExecutavel(caminho);
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof ExecutavelNaoEncontradoError) {
        return resposta.status(409).send({ mensagem: erro.message, caminhoPendente: true });
      }
      if (erro instanceof FalhaAoIniciarExecutavelError) {
        return resposta.status(503).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });

  /* Mesmo seletor dos atalhos: o navegador não entrega o caminho absoluto. Cancelar: 204. */
  servidor.post('/api/web-connection/localizar', async (_requisicao, resposta) => {
    try {
      const caminho = await dependencias.selecionarArquivo();
      if (caminho === null) {
        return resposta.status(204).send();
      }
      await repositorio.definirCaminhoDoWebConnection(caminho);
      return { caminho };
    } catch (erro) {
      if (erro instanceof SeletorDeArquivoIndisponivelError) {
        return resposta.status(503).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });
}
