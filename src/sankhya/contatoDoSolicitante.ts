/**
 * O solicitante da DS aberta na agenda vira contato do HUB sozinho. A chave é o e-mail:
 * sem ele não há como saber se a pessoa já está nos contatos, e cada DS aberta criaria
 * uma cópia. Contato que já existe só ganha o cargo, se não tinha; nome e cargo que o
 * usuário digitou não são trocados.
 */
import type { RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import type { SolicitanteDaDs } from './solicitacaoServicos.ts';

export type SituacaoDoContato = 'criado' | 'completado' | 'existente' | 'sem-email';

export interface ResultadoDoContato {
  situacao: SituacaoDoContato;
  nome: string;
}

const mesmoEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function cadastrarSolicitante(
  contatos: RepositorioContatos,
  solicitante: SolicitanteDaDs | null,
): Promise<ResultadoDoContato> {
  if (!solicitante?.email) return { situacao: 'sem-email', nome: solicitante?.nome ?? '' };

  const existente = (await contatos.listar()).find((c) => mesmoEmail(c.email, solicitante.email));
  if (!existente) {
    await contatos.criar({
      nome: solicitante.nome,
      cargo: solicitante.cargo,
      email: solicitante.email,
      telefone: '',
      clienteId: null,
    });
    return { situacao: 'criado', nome: solicitante.nome };
  }

  if (existente.cargo || !solicitante.cargo) return { situacao: 'existente', nome: existente.nome };
  const { id, criadoEm: _criadoEm, atualizadoEm: _atualizadoEm, ...dados } = existente;
  await contatos.atualizar(id, { ...dados, cargo: solicitante.cargo });
  return { situacao: 'completado', nome: existente.nome };
}
