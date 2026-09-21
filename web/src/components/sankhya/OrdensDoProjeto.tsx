import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Cliente, OrdemExperience } from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { requisitar } from '../../lib/api.ts';
import { deslocarMes, mesAtual, nomeDoMes } from '../../lib/calendario.ts';

/** Último dia do mês `YYYY-MM`. Dia 0 do seguinte evita tabela e ano bissexto. */
function ultimoDia(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number);
  const dia = new Date(Date.UTC(ano!, numero!, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, '0')}`;
}

/** `297:07` -> 297.12 horas. Vazio e formato inesperado viram 0. */
function paraHoras(valor: string): number {
  const partes = /^(\d+):(\d{1,2})$/.exec(valor.trim());
  if (!partes) return Number(valor.replace(',', '.')) || 0;
  return Number(partes[1]) + Number(partes[2]) / 60;
}

function formatarHoras(total: number): string {
  const horas = Math.floor(total);
  const minutos = Math.round((total - horas) * 60);
  return `${horas}:${String(minutos).padStart(2, '0')}`;
}

/**
 * As OS lançadas num projeto do Experience.
 *
 * Abre já filtrada nas próprias ("Só as minhas" ligado por padrão) — mas, diferente da
 * Agenda, o toggle deixa ver o projeto inteiro, inclusive o que os outros lançaram, sem
 * precisar de mais nada além do ID do projeto.
 */
export function OrdensDoProjeto({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const [mes, setMes] = useState(mesAtual);
  // Padrão é só as próprias — ver as OS de todo mundo continua um clique de distância.
  const [soMinhas, setSoMinhas] = useState(true);
  const [ordens, setOrdens] = useState<OrdemExperience[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const projetoId = cliente.experienceProjetoId;

  const buscar = useCallback(async () => {
    if (projetoId === null) return;

    setCarregando(true);
    const busca = new URLSearchParams({
      projetoId: String(projetoId),
      de: `${mes}-01`,
      ate: ultimoDia(mes),
      ...(soMinhas ? { soMinhas: '1' } : {}),
    });

    const { ok, body } = await requisitar<{ ordens: OrdemExperience[] }>(
      `/api/experience/ordens?${busca}`,
    );
    setOrdens(ok ? (body.ordens ?? []) : []);
    setErro(ok ? null : (body.error ?? 'não consegui carregar as OS'));
    setCarregando(false);
  }, [projetoId, mes, soMinhas]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  // Quem lançou quanto, para ver de relance como o trabalho se divide no projeto.
  const porPessoa = useMemo(() => {
    const mapa = new Map<string, { ordens: number; horas: number }>();
    for (const o of ordens) {
      const atual = mapa.get(o.pessoa) ?? { ordens: 0, horas: 0 };
      atual.ordens += 1;
      atual.horas += paraHoras(o.horasFeitas);
      mapa.set(o.pessoa, atual);
    }
    return [...mapa.entries()].sort((a, b) => b[1].ordens - a[1].ordens);
  }, [ordens]);

  const horasDoMes = useMemo(
    () => ordens.reduce((soma, o) => soma + paraHoras(o.horasFeitas), 0),
    [ordens],
  );


  if (projetoId === null) {
    return (
      <div className="warning">
        <span>⚠</span>
        <span>
          Preencha o <strong>ID do projeto (Experience)</strong> no cadastro para acompanhar as
          OS deste cliente.
        </span>
      </div>
    );
  }

  return (
    <article className="card detail-card">
      <div className="detail-head">
        <div className="card-title">
          <h2>{nomeDoMes(mes)}</h2>
          <p>
            {carregando
              ? 'carregando…'
              : `${ordens.length} OS · projeto ${projetoId}${soMinhas ? ' · só as suas' : ' · todo o projeto'}`}
          </p>
        </div>
        <div className="detail-actions">
          <label className="campo-inline">
            <input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} />
            Só as minhas
          </label>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, -1))}>‹</button>
          <button className="btn tiny ghost" onClick={() => setMes(mesAtual())}>Hoje</button>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, 1))}>›</button>
        </div>
      </div>

      {erro && (
        <div className="warning">
          <span>⚠</span>
          <span>{erro}</span>
        </div>
      )}

      {!erro && !carregando && ordens.length === 0 && (
        <p className="detail-empty">Nenhuma OS lançada neste mês.</p>
      )}

      {ordens.length > 0 && (
        <div className="pills mensal-pills">
          {/*
            `total_done` e `total_expected` não entram na tela. Vêm repetidos em toda
            linha (60:00 e 03:30 no projeto 10269), então são do projeto e não da OS —
            mas o que cada um mede não ficou claro, e "60:00 de 03:30" lido como
            feito/previsto anuncia um estouro que pode não existir. Número que não sei
            interpretar é pior que número nenhum.
          */}
          <span className="pill">
            no mês <b>{formatarHoras(horasDoMes)}</b>
          </span>
          {!soMinhas &&
            porPessoa.map(([pessoa, soma]) => (
              <span className="pill" key={pessoa}>
                {pessoa.split(' ')[0]} <b>{soma.ordens}</b> · {formatarHoras(soma.horas)}
              </span>
            ))}
        </div>
      )}

      <div className="lista-os">
        {ordens.map((o) => (
          <LinhaOs key={o.id} ordem={o} mostrarPessoa={!soMinhas} onAviso={toast} />
        ))}
      </div>
    </article>
  );
}

function LinhaOs({
  ordem,
  mostrarPessoa,
  onAviso,
}: {
  ordem: OrdemExperience;
  mostrarPessoa: boolean;
  onAviso: Avisar;
}) {
  // Só a ausência de aceite é pendência de verdade; `Gerado` e `Concluído` são desfecho.
  const semAceite = ordem.statusAceite.trim() === '';

  return (
    <div className={`linha-os${ordem.erro ? ' com-erro' : ''}`}>
      <div className="linha-os-topo">
        <span className="linha-os-dia">{ordem.dia.slice(8)}/{ordem.dia.slice(5, 7)}</span>
        <span className="linha-titulo" title={ordem.descricao}>
          {ordem.descricao || '(sem descrição)'}
        </span>
        {ordem.numeroSankhya ? (
          <button
            className="selo ok"
            type="button"
            title="Copiar o número da OS no ERP"
            onClick={() => {
              void navigator.clipboard
                .writeText(ordem.numeroSankhya)
                .then(() => onAviso(`OS ${ordem.numeroSankhya} copiada.`))
                .catch(() => onAviso('O navegador bloqueou a cópia.', 'err'));
            }}
          >
            OS {ordem.numeroSankhya}
          </button>
        ) : (
          <span className="selo falta">sem OS no ERP</span>
        )}
      </div>

      <div className="linha-os-meta">
        {mostrarPessoa && <span className="linha-os-pessoa">{ordem.pessoa}</span>}
        <span>{ordem.tipo}</span>
        {ordem.etapa && <span>{ordem.etapa}</span>}
        <span className={ordem.horasExcedidas ? 'horas-excedidas' : undefined}>
          {ordem.horasFeitas || '—'}
          {ordem.horasExcedidas && ' · estourou o volume'}
        </span>
        <span className={semAceite ? 'selo falta' : 'selo ok'}>
          {ordem.statusAceite || 'sem aceite'}
        </span>
      </div>

      {/* Erro da integração com o ERP: é o que explica uma OS sem número do outro lado. */}
      {ordem.erro && <p className="linha-os-erro">{ordem.erro}</p>}
    </div>
  );
}
