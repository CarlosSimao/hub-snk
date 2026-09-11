import { useMemo, useState } from 'react';
import type { CheckSnapshot, HubSnapshot } from '../types.ts';
import { useConjunto } from '../hooks/useConjunto.ts';
import type { Avisar } from '../hooks/useToasts.ts';
import { ProjectList } from './ProjectList.tsx';
import { Detail } from './Detail.tsx';
import { ConfigModal } from './ConfigModal.tsx';
import { CheckSettingsModal } from './CheckSettingsModal.tsx';

interface AlvoCheck {
  serviceId: string;
  checkId: string;
}

interface Props {
  model: HubSnapshot;
  /** Falso até o primeiro `snapshot` chegar — sem isto a tela abriria dizendo que não há serviço. */
  carregado: boolean;
  flashes: ReadonlySet<string>;
  applyCheck: (snapshot: CheckSnapshot) => void;
  selecionado: string | null;
  onSelecionar: (serviceId: string) => void;
  toast: Avisar;
}

/**
 * O painel de monitoramento — o que o hub sempre fez, agora dentro de uma aba.
 *
 * O estado de "qual painel está aberto" mora aqui, e não em App: só esta aba usa. A
 * seleção de projeto é a exceção — vem de fora porque um alerta crítico seleciona o
 * projeto que caiu, e isso acontece com qualquer aba na tela.
 */
export function PainelInfra({
  model,
  carregado,
  flashes,
  applyCheck,
  selecionado,
  onSelecionar,
  toast,
}: Props) {
  const [infoAbertas, alternarInfo] = useConjunto();
  const [acoesServicoAbertas, alternarAcoesServico] = useConjunto();
  const [acoesProjetoAbertas, alternarAcoesProjeto] = useConjunto();

  const [configServiceId, setConfigServiceId] = useState<string | null>(null);
  const [alvoSettings, setAlvoSettings] = useState<AlvoCheck | null>(null);

  const ordenados = useMemo(
    () => [...model.services].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [model.services],
  );

  // O projeto guardado pode ter sumido do YAML; nesse caso cai no primeiro da lista.
  const servico = ordenados.find((s) => s.id === selecionado) ?? ordenados[0];

  const checkEmSettings = alvoSettings
    ? model.services
        .find((s) => s.id === alvoSettings.serviceId)
        ?.checks.find((c) => c.checkId === alvoSettings.checkId)
    : undefined;

  return (
    <>
      {carregado && servico && (
        <div className="layout">
          <ProjectList services={ordenados} selecionado={servico.id} onSelecionar={onSelecionar} />
          <Detail
            service={servico}
            flashes={flashes}
            infoAbertas={infoAbertas}
            acoesServicoAbertas={acoesServicoAbertas}
            acoesProjetoAbertas={acoesProjetoAbertas}
            onToggleInfo={alternarInfo}
            onToggleAcoesServico={alternarAcoesServico}
            onToggleAcoesProjeto={alternarAcoesProjeto}
            onAbrirConfig={setConfigServiceId}
            onAbrirCheckSettings={(serviceId, checkId) => setAlvoSettings({ serviceId, checkId })}
            onCheckAtualizado={applyCheck}
            toast={toast}
          />
        </div>
      )}

      {carregado && ordenados.length === 0 && (
        <p className="empty">
          Nenhum serviço configurado em <code>services.yaml</code>.
        </p>
      )}

      <ConfigModal
        serviceId={configServiceId}
        service={model.services.find((s) => s.id === configServiceId)}
        onFechar={() => setConfigServiceId(null)}
        toast={toast}
      />
      <CheckSettingsModal
        aberto={alvoSettings !== null}
        check={checkEmSettings}
        onFechar={() => setAlvoSettings(null)}
        toast={toast}
      />
    </>
  );
}
