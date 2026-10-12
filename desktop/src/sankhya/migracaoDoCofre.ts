/**
 * Conversão do cofre de antes do Sankhya ID, que guardava um usuário e uma senha para o
 * SankhyaOm e outros para a Experience, no login único.
 *
 * Fica fora do `cofreCredenciais.ts` porque aquele módulo depende do Electron: esta
 * função é pura, e é o que os testes exercitam.
 */

/** O login único do Sankhya, como vai para o disco: a senha já cifrada. */
export interface IdentificacaoGravada {
  usuario: string;
  senha: string;
  /** Vazio, ou o que o usuário precisa saber depois de uma migração com perda. */
  aviso: string;
}

/** Uma entrada do cofre antigo; só os campos de login interessam aqui. */
export interface EntradaAntiga {
  usuario?: string;
  senha?: string;
}

export const AVISO_DE_USUARIOS_DIFERENTES =
  'O SankhyaOm e a Experience tinham usuários diferentes salvos. Ficou o do SankhyaOm; ' +
  'se a Experience não entrar sozinha, salve o Sankhya ID de novo.';

function mesmoUsuario(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Vale o login do SankhyaOm; sem ele, o da Experience. Sem senha em nenhum dos dois não há
 * o que migrar (`null`). Usuários diferentes migram com aviso: a Experience perde o dela.
 */
export function identificacaoDoCofreAntigo(
  erp: EntradaAntiga | undefined,
  experience: EntradaAntiga | undefined,
): IdentificacaoGravada | null {
  const escolhida = erp?.senha ? erp : experience?.senha ? experience : null;
  if (!escolhida) return null;

  const divergentes =
    Boolean(erp?.senha && experience?.senha) &&
    !mesmoUsuario(erp?.usuario ?? '', experience?.usuario ?? '');
  return {
    usuario: escolhida.usuario ?? '',
    senha: escolhida.senha ?? '',
    aviso: divergentes ? AVISO_DE_USUARIOS_DIFERENTES : '',
  };
}
