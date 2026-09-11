import { useState } from 'react';
import { TabBar, type Aba } from '../TabBar.tsx';
import type { Avisar } from '../../hooks/useToasts.ts';
import { TelaClientes } from './TelaClientes.tsx';
import { TelaCredenciais } from './TelaCredenciais.tsx';
import { AgendaMensal } from './AgendaMensal.tsx';
import { TelaAgendaErp } from './TelaAgendaErp.tsx';

type SubAba = 'clientes' | 'credenciais' | 'agenda' | 'agenda-erp';

const ABAS: Aba<SubAba>[] = [
  { id: 'clientes', rotulo: 'Clientes', titulo: 'Cadastro dos clientes acompanhados' },
  { id: 'credenciais', rotulo: 'Credenciais', titulo: 'Login do hub no Sankhya ERP e Experience' },
  { id: 'agenda', rotulo: 'Agenda Mensal', titulo: 'Resumo consolidado do mês' },
  { id: 'agenda-erp', rotulo: 'Agenda de Recursos', titulo: 'Snapshot da agenda do Sankhya ERP' },
];

/**
 * `seq` sobe a cada pedido. Sem ele, abrir o mesmo cliente duas vezes seguidas a partir
 * da Agenda Mensal não faria nada na segunda: o valor não teria mudado.
 */
export interface FocoCliente {
  id: number;
  seq: number;
}

export function PainelSankhya({ toast }: { toast: Avisar }) {
  const [aba, setAba] = useState<SubAba>('clientes');
  const [foco, setFoco] = useState<FocoCliente | null>(null);

  const abrirCliente = (id: number) => {
    setFoco((atual) => ({ id, seq: (atual?.seq ?? 0) + 1 }));
    setAba('clientes');
  };

  return (
    <>
      <TabBar abas={ABAS} ativa={aba} onTrocar={setAba} variante="sub" />

      {aba === 'clientes' && <TelaClientes toast={toast} foco={foco} />}
      {aba === 'credenciais' && <TelaCredenciais toast={toast} />}
      {aba === 'agenda' && <AgendaMensal onAbrirCliente={abrirCliente} />}
      {aba === 'agenda-erp' && <TelaAgendaErp toast={toast} />}
    </>
  );
}
