import { useEffect, useRef, useState } from 'react';
import type { FavoritoNavegador, PerfilNavegador } from '../../types.ts';
import { enviar, requisitar } from '../../lib/api.ts';
import {
  agruparFavoritos,
  type AmbienteSugerido,
  type CandidatoCliente,
} from '../../lib/favoritos.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

/** O candidato do modulo mais o que so a tela precisa saber. */
type Candidato = CandidatoCliente & { marcado: boolean };

const ROTULO_AMBIENTE: Record<AmbienteSugerido, string> = {
  producao: 'Produção',
  teste: 'Teste',
  homologacao: 'Homologação',
};

/**
 * Importa clientes a partir dos favoritos do navegador pessoal.
 *
 * O ponto de partida do cadastro costuma já estar salvo ali: o consultor guarda a URL
 * do ERP de cada parceiro nos favoritos, normalmente numa pasta só. Ler esse arquivo
 * poupa digitar nome e endereço de dezenas de clientes; o resto do cadastro (IDs da
 * Experience, recurso da Agenda, repositório) continua sendo preenchido depois.
 *
 * Nada do navegador do usuário é alterado — o arquivo de favoritos só é lido.
 */

interface Props {
  aberto: boolean;
  /** Nomes já cadastrados, para não oferecer duplicata. */
  jaCadastrados: string[];
  toast: Avisar;
  onFechar: () => void;
  /** Chamado depois de criar — a tela recarrega a lista. */
  onImportado: () => void | Promise<unknown>;
}

export function ImportarFavoritos({ aberto, jaCadastrados, toast, onFechar, onImportado }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [perfis, setPerfis] = useState<PerfilNavegador[]>([]);
  const [perfil, setPerfil] = useState('');
  const [favoritos, setFavoritos] = useState<FavoritoNavegador[]>([]);
  const [pasta, setPasta] = useState('');
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    if (aberto) ref.current?.showModal();
    else ref.current?.close();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    void requisitar<{ perfis: PerfilNavegador[] }>('/api/sankhya/navegador').then(({ ok, body }) => {
      if (!ok) return;
      const lista = body.perfis ?? [];
      setPerfis(lista);
      const primeiro = lista[0];
      if (primeiro) setPerfil(`${primeiro.navegador}|${primeiro.pasta}`);
    });
  }, [aberto]);

  // Uma leitura por perfil. A pasta filtra o que ja esta em memoria: refazer a
  // requisicao a cada troca de pasta pagaria o disco de novo pelo mesmo arquivo.
  useEffect(() => {
    if (!aberto || !perfil) return;

    const [navegador, pastaPerfil] = perfil.split('|');
    setCarregando(true);
    const busca = new URLSearchParams({ navegador: navegador ?? '', perfil: pastaPerfil ?? '' });

    void requisitar<{ favoritos: FavoritoNavegador[] }>(
      `/api/sankhya/navegador/favoritos?${busca}`,
    ).then(({ ok, body }) => {
      setCarregando(false);
      if (!ok) {
        toast('Não consegui ler os favoritos.', 'err', body.error);
        setFavoritos([]);
        return;
      }

      const lidos = body.favoritos ?? [];
      setFavoritos(lidos);

      // Quem separa clientes numa pasta já fez a curadoria; começar por ela evita
      // oferecer o Portal RH e o GitLab como se fossem parceiros.
      const disponiveis = [...new Set(lidos.map((f) => f.pasta))];
      setPasta(disponiveis.find((p) => /cliente|parceiro|sankhya/i.test(p)) ?? '');
    });
  }, [aberto, perfil, toast]);

  const pastas = [...new Set(favoritos.map((f) => f.pasta))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  useEffect(() => {
    const naPasta = favoritos.filter((f) => !pasta || f.pasta === pasta);
    setCandidatos(
      agruparFavoritos(naPasta).map((candidato) => ({
        ...candidato,
        // Só vem marcado quando há uma pasta escolhida: ali alguém já separou os
        // clientes à mão. Em "todas as pastas" a lista traz o WhatsApp e o GitLab junto,
        // e marcar tudo faria um clique criar dezenas de cadastros que não são clientes.
        //
        // Já cadastrado nunca vem marcado, mas continua aparecendo: o nome pode ter sido
        // escrito de outro jeito, e esconder daria a impressão de que o favorito sumiu.
        marcado:
          Boolean(pasta) &&
          !jaCadastrados.some((nome) => nome.toLowerCase() === candidato.nome.toLowerCase()),
      })),
    );
  }, [favoritos, pasta, jaCadastrados]);

  const marcados = candidatos.filter((c) => c.marcado);

  const importar = async () => {
    setImportando(true);
    let criados = 0;
    const falhas: string[] = [];

    try {
      for (const candidato of marcados) {
        const { ok, body } = await enviar<{ id: number }>('/api/clientes', {
          nome: candidato.nome,
          experienceProjetoId: null,
          experiencePersonId: null,
          agendaRecursoUsuario: '',
          agendaCodparc: null,
          agendaDemandaId: '',
          sankhyaUrl: candidato.bases[0]?.url ?? '',
          repositorioLocal: '',
          repositorioRemoto: '',
          anotacoes: '',
        });

        if (!ok || !body.id) {
          falhas.push(`${candidato.nome}: ${body.error ?? 'falhou'}`);
          continue;
        }

        // Uma base por favorito do parceiro. Monitorar fica desligado: base recém
        // importada não tem credencial, e medir sem ela só produziria vermelho.
        for (const base of candidato.bases) {
          await enviar(`/api/clientes/${body.id}/bases`, {
            ambiente: base.ambiente,
            url: base.url,
            usuario: '',
            monitorar: false,
            ordem: 0,
          });
        }
        criados++;
      }
    } finally {
      setImportando(false);
    }

    await onImportado();
    if (falhas.length) toast(`${criados} cliente(s) criado(s), ${falhas.length} falhou`, 'err', falhas.join('\n'));
    else toast(`${criados} cliente(s) criado(s) a partir dos favoritos.`, 'ok');
    onFechar();
  };

  const marcarTodos = (marcado: boolean) =>
    setCandidatos((atuais) => atuais.map((c) => ({ ...c, marcado })));

  const alternar = (chave: string) =>
    setCandidatos((atuais) =>
      atuais.map((c) => (c.chave === chave ? { ...c, marcado: !c.marcado } : c)),
    );

  const renomear = (chave: string, nome: string) =>
    setCandidatos((atuais) => atuais.map((c) => (c.chave === chave ? { ...c, nome } : c)));

  return (
    <dialog className="modal importar-favoritos" ref={ref} onClose={onFechar}>
      <div className="modal-head">
        <h2>Importar clientes dos favoritos</h2>
        <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>✕</button>
      </div>

      <div className="modal-body">
        <p className="campo-dica">
          Lê os favoritos do seu navegador, sem alterar nada neles. O nome e a URL viram
          o começo do cadastro; o resto você completa depois.
        </p>

        <div className="favoritos-filtros">
          <label className="campo">
            <span className="campo-nome">Perfil</span>
            <select value={perfil} onChange={(event) => setPerfil(event.target.value)}>
              {perfis.length === 0 && <option value="">nenhum perfil encontrado</option>}
              {perfis.map((item) => (
                <option value={`${item.navegador}|${item.pasta}`} key={`${item.navegador}|${item.pasta}`}>
                  {item.navegador} — {item.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            <span className="campo-nome">Pasta dos favoritos</span>
            <select value={pasta} onChange={(event) => setPasta(event.target.value)}>
              <option value="">Todas as pastas</option>
              {pastas.map((item) => (
                <option value={item} key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>

        {carregando && <p className="detail-empty">Lendo os favoritos…</p>}

        {!carregando && candidatos.length === 0 && (
          <p className="detail-empty">Nenhum favorito com endereço http(s) nesta pasta.</p>
        )}

        {!carregando && candidatos.length > 0 && (
          <div className="favoritos-selecao">
            <span>{marcados.length} de {candidatos.length} selecionados</span>
            <button className="btn tiny ghost" type="button" onClick={() => marcarTodos(true)}>Marcar todos</button>
            <button className="btn tiny ghost" type="button" onClick={() => marcarTodos(false)}>Limpar</button>
          </div>
        )}

        {!carregando && candidatos.length > 0 && (
          <ul className="favoritos-lista">
            {candidatos.map((candidato) => (
              <li key={candidato.chave}>
                <input
                  type="checkbox"
                  checked={candidato.marcado}
                  aria-label={`Importar ${candidato.nome}`}
                  onChange={() => alternar(candidato.chave)}
                />
                <div className="favorito-dados">
                  <input
                    className="favorito-nome"
                    value={candidato.nome}
                    aria-label={`Nome do cliente para ${candidato.chave}`}
                    onChange={(event) => renomear(candidato.chave, event.target.value)}
                  />
                  <div className="favorito-bases">
                    {candidato.bases.map((base) => (
                      <span key={base.url}>
                        <span className={`ambiente ambiente-${base.ambiente}`}>{ROTULO_AMBIENTE[base.ambiente]}</span>
                        <code>{base.url}</code>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="modal-foot">
        <div className="modal-acoes">
          <button className="btn tiny ghost" type="button" onClick={onFechar}>Cancelar</button>
          <button
            className="btn tiny"
            type="button"
            disabled={importando || marcados.length === 0}
            onClick={() => void importar()}
          >
            {importando ? 'Importando…' : `Importar ${marcados.length} cliente(s)`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
