import { isAbsolute } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PacoteInvalidoError } from '../backup/pacoteDeDados.ts';
import {
  BackupSemPastaError,
  CopiaDoDriveNaoEncontradaError,
  type ServicoDeBackup,
} from '../backup/servicoDeBackup.ts';
import { ZipGrandeDemaisError } from '../backup/zip.ts';
import { ehIdDoDrive, ErroDoDrive } from '../drive/clienteDoDrive.ts';
import {
  AutorizacaoDoGoogleError,
  DriveNaoConectadoError,
  DriveNaoConfiguradoError,
} from '../drive/contaDoGoogle.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { SeletorDeArquivoIndisponivelError } from '../sistema/processos/selecionarArquivo.ts';
import { responderErroDoShell } from './comum/respostasDoShell.ts';

const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const INTERVALO_MAXIMO_H = 24 * 30;
const MAXIMO_DE_COPIAS_MANTIDAS = 365;

const esquemaDoBackup = z
  .object({
    ativo: z.boolean({ error: 'Informe se o backup está ligado.' }),
    pasta: z
      .string({ error: 'Informe a pasta do backup.' })
      .trim()
      .max(
        TAMANHO_MAXIMO_DO_CAMINHO,
        `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
      )
      .refine((pasta) => pasta === '' || isAbsolute(pasta), 'Informe o caminho completo da pasta.'),
    intervaloHoras: z.coerce
      .number({ error: 'O intervalo deve ser um número de horas.' })
      .int('O intervalo deve ser um número inteiro de horas.')
      .min(1, 'O intervalo deve ser de pelo menos 1 hora.')
      .max(INTERVALO_MAXIMO_H, `O intervalo deve ser de no máximo ${INTERVALO_MAXIMO_H} horas.`),
    copiasMantidas: z.coerce
      .number({ error: 'A quantidade de cópias deve ser um número.' })
      .int('A quantidade de cópias deve ser um número inteiro.')
      .min(1, 'Mantenha pelo menos 1 cópia.')
      .max(MAXIMO_DE_COPIAS_MANTIDAS, `Mantenha no máximo ${MAXIMO_DE_COPIAS_MANTIDAS} cópias.`),
    espelharNoDrive: z.boolean({ error: 'Informe se a cópia no Google Drive está ligada.' }),
  })
  // Ligado e sem pasta não faria backup nenhum, e a tela diria que está tudo certo.
  .refine((backup) => !backup.ativo || backup.pasta !== '', {
    message: 'Escolha a pasta do backup antes de ligá-lo.',
  });

/* Do Drive, o id de uma das cópias listadas; do computador, o arquivo é escolhido no seletor do sistema. */
const esquemaDaRestauracao = z.discriminatedUnion('origem', [
  z.object({
    origem: z.literal('drive'),
    idDoArquivo: z.string().refine(ehIdDoDrive, 'Cópia inválida.'),
  }),
  z.object({ origem: z.literal('arquivo') }),
]);

interface Dependencias {
  backup: ServicoDeBackup;
  configuracao: RepositorioConfiguracao;
  /** Abre o seletor de arquivo do sistema; `null` quando o usuário cancela. */
  selecionarArquivoDeBackup: () => Promise<string | null>;
  /** Pede ao aplicativo desktop que feche e abra de novo, para a restauração ser aplicada. */
  reiniciarAplicativo: () => Promise<void>;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Traduz o que o backup e o Drive lançam; o que sobra é falha de disco ou de rede, com a mensagem crua. */
function responderErro(resposta: FastifyReply, erro: unknown, contexto: string): FastifyReply {
  if (
    erro instanceof BackupSemPastaError ||
    erro instanceof PacoteInvalidoError ||
    erro instanceof ZipGrandeDemaisError
  ) {
    return resposta.status(400).send({ mensagem: erro.message });
  }
  if (erro instanceof CopiaDoDriveNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: erro.message });
  }
  if (erro instanceof DriveNaoConectadoError || erro instanceof DriveNaoConfiguradoError) {
    return resposta.status(409).send({ mensagem: erro.message });
  }
  if (erro instanceof ErroDoDrive || erro instanceof AutorizacaoDoGoogleError) {
    return resposta.status(502).send({ mensagem: erro.message });
  }
  if (erro instanceof SeletorDeArquivoIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message });
  }
  return resposta.status(500).send({ mensagem: `${contexto}: ${descreverErro(erro)}` });
}

export function registrarRotasDeBackup(
  servidor: FastifyInstance,
  dependencias: Dependencias,
): void {
  const { backup, configuracao, selecionarArquivoDeBackup, reiniciarAplicativo } = dependencias;

  servidor.get('/api/backup', async () => backup.situacao());

  /*
   * Rota própria, fora do `PUT /api/configuracao`: o backup é ajustado na janela dele,
   * campo a campo, e não no formulário das configurações.
   */
  servidor.put('/api/backup/configuracao', async (requisicao, resposta) => {
    const dados = esquemaDoBackup.safeParse(requisicao.body);
    if (!dados.success) {
      const mensagem = dados.error.issues[0]?.message ?? 'Dados inválidos.';
      return resposta.status(400).send({ mensagem });
    }

    await configuracao.definirBackup(dados.data);
    return backup.situacao();
  });

  servidor.post('/api/backup/local', async (_requisicao, resposta) => {
    try {
      await backup.fazerBackupLocal();
      return await backup.situacao();
    } catch (erro) {
      return responderErro(resposta, erro, 'Não foi possível gravar o backup');
    }
  });

  servidor.post('/api/backup/drive', async (_requisicao, resposta) => {
    try {
      await backup.enviarAoDrive();
      return await backup.situacao();
    } catch (erro) {
      return responderErro(resposta, erro, 'Não foi possível enviar a cópia ao Google Drive');
    }
  });

  servidor.get('/api/backup/drive/copias', async (_requisicao, resposta) => {
    try {
      return { copias: await backup.copiasNoDrive() };
    } catch (erro) {
      return responderErro(resposta, erro, 'Não foi possível consultar o Google Drive');
    }
  });

  /*
   * Só prepara: o backup escolhido fica guardado e é aplicado na próxima abertura do
   * HUB SNK. Cancelar o seletor de arquivo responde 204.
   */
  servidor.post('/api/backup/restauracao', async (requisicao, resposta) => {
    const dados = esquemaDaRestauracao.safeParse(requisicao.body);
    if (!dados.success) {
      return resposta.status(400).send({ mensagem: 'Escolha de onde restaurar.' });
    }

    try {
      if (dados.data.origem === 'drive') {
        await backup.prepararRestauracaoDoDrive(dados.data.idDoArquivo);
      } else {
        const caminho = await selecionarArquivoDeBackup();
        if (caminho === null) {
          return await resposta.status(204).send();
        }
        await backup.prepararRestauracaoDoArquivo(caminho);
      }
      return await backup.situacao();
    } catch (erro) {
      return responderErro(resposta, erro, 'Não foi possível preparar a restauração');
    }
  });

  servidor.delete('/api/backup/restauracao', async () => {
    await backup.cancelarRestauracao();
    return backup.situacao();
  });

  servidor.post('/api/backup/reiniciar', async (_requisicao, resposta) => {
    try {
      await reiniciarAplicativo();
      return await resposta.status(202).send({ ok: true });
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
    }
  });
}
