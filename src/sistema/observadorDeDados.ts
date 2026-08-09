import { watch, type FSWatcher } from 'node:fs';

/** O mínimo que o registrador precisa ter. Evita depender do logger do Fastify. */
export interface RegistradorDeObservacao {
  info(mensagem: string): void;
  warn(mensagem: string): void;
}

/** Quem guarda leitura em memória e sabe jogá-la fora. */
export interface CacheDescartavel {
  descartarCache(): void;
}

/**
 * Vigia os arquivos de dados e descarta o cache de quem foi alterado no disco.
 *
 * Existe por causa da pasta sincronizada com a nuvem: quando outra máquina
 * grava o `clientes.json`, o HUB SNK aberto aqui continuaria servindo a cópia
 * que tem em memória e a apagaria na próxima gravação. Descartar o cache faz a
 * leitura seguinte voltar ao disco e enxergar o que chegou.
 *
 * O descarte também acontece nas gravações do próprio HUB SNK, que não há como
 * distinguir das externas. O custo é uma releitura do arquivo que acabou de ser
 * escrito — barato, e a alternativa seria adivinhar.
 */
export function observarAlteracoesNosDados(parametros: {
  diretorioDeDados: string;
  cachesPorArquivo: Map<string, CacheDescartavel>;
  registrador: RegistradorDeObservacao;
}): FSWatcher | null {
  const { diretorioDeDados, cachesPorArquivo, registrador } = parametros;

  let observador: FSWatcher;
  try {
    observador = watch(diretorioDeDados, { persistent: false });
  } catch (erro) {
    /*
     * Sistema de arquivos sem notificação — pasta de rede, alguns pontos de
     * montagem, Drive em modo de transmissão. O HUB SNK segue funcionando; só
     * volta a depender de reinício para enxergar alteração vinda de fora.
     */
    registrador.warn(
      `Alterações externas em ${diretorioDeDados} não serão detectadas: ` +
        `${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return null;
  }

  observador.on('change', (_evento, nomeDoArquivo) => {
    if (typeof nomeDoArquivo !== 'string') {
      return;
    }

    cachesPorArquivo.get(nomeDoArquivo)?.descartarCache();
  });

  observador.on('error', (erro) => {
    registrador.warn(`A vigilância de ${diretorioDeDados} parou: ${erro.message}`);
  });

  registrador.info(`Vigiando alterações externas em ${diretorioDeDados}`);
  return observador;
}
