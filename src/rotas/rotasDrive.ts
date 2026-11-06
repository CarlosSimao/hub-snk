import type { FastifyInstance } from 'fastify';
import {
  AutorizacaoDoGoogleError,
  DriveNaoConfiguradoError,
  type ContaDoGoogle,
} from '../drive/contaDoGoogle.ts';
import { responderErroDoShell } from './comum/respostasDoShell.ts';

/**
 * Conexão do HUB SNK com uma conta do Google — a do Drive (`/api/drive`) ou a do
 * organograma (`/api/organograma`), cada uma com o seu caminho.
 *
 * `aoDesconectar` avisa quem guardava algo da conta — o backup, que lembra o que já
 * enviou a ela.
 */
export function registrarRotasDaContaDoGoogle(
  servidor: FastifyInstance,
  caminho: string,
  conta: ContaDoGoogle,
  aoDesconectar: () => Promise<void> = async () => {},
): void {
  /* A tela consulta esta rota em intervalos curtos enquanto o consentimento está aberto. */
  servidor.get(caminho, async () => conta.situacao());

  /*
   * Abre o consentimento do Google no navegador padrão. A resposta sai logo, com o
   * endereço da tela: a conexão em si termina depois, quando o usuário autoriza, e
   * aparece no `GET` do caminho.
   */
  servidor.post(`${caminho}/conectar`, async (_requisicao, resposta) => {
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

  servidor.delete(caminho, async (_requisicao, resposta) => {
    try {
      await conta.desconectar();
      await aoDesconectar();
      return await conta.situacao();
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
    }
  });
}
