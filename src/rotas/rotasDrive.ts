import type { FastifyInstance } from 'fastify';
import {
  AutorizacaoDoGoogleError,
  DriveNaoConfiguradoError,
  type ContaDoGoogle,
} from '../drive/contaDoGoogle.ts';
import { responderErroDoShell } from './comum/respostasDoShell.ts';

/**
 * Conexão do HUB SNK com a conta do Google Drive do usuário.
 *
 * `aoDesconectar` avisa quem guardava algo da conta — o backup, que lembra o que já
 * enviou a ela.
 */
export function registrarRotasDeDrive(
  servidor: FastifyInstance,
  conta: ContaDoGoogle,
  aoDesconectar: () => Promise<void> = async () => {},
): void {
  /* A tela consulta esta rota em intervalos curtos enquanto o consentimento está aberto. */
  servidor.get('/api/drive', async () => conta.situacao());

  /*
   * Abre o consentimento do Google no navegador padrão. A resposta sai logo, com o
   * endereço da tela: a conexão em si termina depois, quando o usuário autoriza, e
   * aparece em `GET /api/drive`.
   */
  servidor.post('/api/drive/conectar', async (_requisicao, resposta) => {
    try {
      return await conta.iniciarAutorizacao();
    } catch (erro) {
      if (erro instanceof DriveNaoConfiguradoError) {
        return resposta.status(409).send({ mensagem: erro.message });
      }
      if (erro instanceof AutorizacaoDoGoogleError) {
        return resposta.status(502).send({ mensagem: erro.message });
      }
      // Sem o aplicativo desktop não há cofre onde guardar o token.
      return responderErroDoShell(resposta, erro);
    }
  });

  servidor.delete('/api/drive', async (_requisicao, resposta) => {
    try {
      await conta.desconectar();
      await aoDesconectar();
      return await conta.situacao();
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
    }
  });
}
