/**
 * O solicitante da DS aberta na agenda vira contato do HUB sozinho. A chave é o e-mail:
 * sem ele não há como saber se a pessoa já está nos contatos, e cada DS aberta criaria
 * uma cópia. Contato que já existe só ganha o cargo, se não tinha; nome e cargo que o
 * usuário digitou não são trocados.
 *
 * Com o organograma do Google conectado, o gestor e o gestor do gestor do solicitante
 * também viram contatos, ligados pelo `gestorId`. Aqui o diretório manda: gestor diferente
 * do gravado é trocado; sem gestor no diretório, o gravado fica.
 */
import { DriveNaoConectadoError } from '../drive/contaDoGoogle.ts';
import type { PessoaDoDiretorio } from '../drive/organogramaDoGoogle.ts';
import type { RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import type { SolicitanteDaDs } from './solicitacaoServicos.ts';

export type SituacaoDoContato = 'criado' | 'completado' | 'existente' | 'sem-email';

export interface ResultadoDoContato {
  situacao: SituacaoDoContato;
  nome: string;
  /** `null` só em `sem-email`: sem e-mail não há contato. */
  contatoId: string | null;
}

const mesmoEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function cadastrarSolicitante(
  contatos: RepositorioContatos,
  solicitante: SolicitanteDaDs | null,
): Promise<ResultadoDoContato> {
  if (!solicitante?.email) {
    return { situacao: 'sem-email', nome: solicitante?.nome ?? '', contatoId: null };
  }

  const existente = (await contatos.listar()).find((c) => mesmoEmail(c.email, solicitante.email));
  if (!existente) {
    const criado = await contatos.criar({
      nome: solicitante.nome,
      cargo: solicitante.cargo,
      email: solicitante.email,
      telefone: '',
      clienteId: null,
    });
    return { situacao: 'criado', nome: solicitante.nome, contatoId: criado.id };
  }

  if (existente.cargo || !solicitante.cargo) {
    return { situacao: 'existente', nome: existente.nome, contatoId: existente.id };
  }
  const { id, criadoEm: _criadoEm, atualizadoEm: _atualizadoEm, ...dados } = existente;
  await contatos.atualizar(id, { ...dados, cargo: solicitante.cargo });
  return { situacao: 'completado', nome: existente.nome, contatoId: id };
}

export interface FonteDeGestores {
  /** Gestor primeiro, depois o gestor do gestor. */
  gestoresDe(email: string): Promise<PessoaDoDiretorio[]>;
}

interface Registrador {
  warn(mensagem: string): void;
}

/**
 * Cadastra o solicitante e, pelo organograma, os gestores dele. Falha no organograma não
 * desfaz nem impede o solicitante: vai para o log. Organograma desconectado é o normal de
 * quem não o usa, e não vai nem para o log.
 */
export async function cadastrarSolicitanteComGestores(
  contatos: RepositorioContatos,
  solicitante: SolicitanteDaDs | null,
  organograma: FonteDeGestores,
  registrador: Registrador,
): Promise<ResultadoDoContato> {
  const resultado = await cadastrarSolicitante(contatos, solicitante);
  if (!resultado.contatoId || !solicitante?.email) {
    return resultado;
  }

  try {
    const gestores = await organograma.gestoresDe(solicitante.email);
    await vincularGestores(contatos, resultado.contatoId, gestores);
  } catch (erro) {
    if (!(erro instanceof DriveNaoConectadoError)) {
      registrador.warn(
        `Gestores de ${solicitante.email} fora dos contatos: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }
  return resultado;
}

/** Cada gestor vira o gestor do anterior na lista, a partir do contato. */
async function vincularGestores(
  contatos: RepositorioContatos,
  contatoId: string,
  gestores: PessoaDoDiretorio[],
): Promise<void> {
  let subordinadoId = contatoId;
  for (const gestor of gestores) {
    const gestorId = await contatoDoGestor(contatos, gestor);
    await definirGestor(contatos, subordinadoId, gestorId);
    subordinadoId = gestorId;
  }
}

/** Mesma regra do solicitante: acha pelo e-mail, e o existente só ganha o cargo que faltava. */
async function contatoDoGestor(
  contatos: RepositorioContatos,
  gestor: PessoaDoDiretorio,
): Promise<string> {
  const existente = (await contatos.listar()).find((c) => mesmoEmail(c.email, gestor.email));
  if (!existente) {
    const criado = await contatos.criar({
      nome: gestor.nome || gestor.email,
      cargo: gestor.cargo,
      email: gestor.email,
      telefone: '',
      clienteId: null,
    });
    return criado.id;
  }

  if (!existente.cargo && gestor.cargo) {
    const { id, criadoEm: _criadoEm, atualizadoEm: _atualizadoEm, ...dados } = existente;
    await contatos.atualizar(id, { ...dados, cargo: gestor.cargo });
  }
  return existente.id;
}

/** O repositório marca o gestor como "Gerente" ao gravar o vínculo. */
async function definirGestor(
  contatos: RepositorioContatos,
  contatoId: string,
  gestorId: string,
): Promise<void> {
  const contato = (await contatos.listar()).find((c) => c.id === contatoId);
  if (!contato || contato.gestorId === gestorId) {
    return;
  }
  const { id, criadoEm: _criadoEm, atualizadoEm: _atualizadoEm, ...dados } = contato;
  await contatos.atualizar(id, { ...dados, gestorId });
}
