import { useState } from 'react';
import { TabBar, type Aba } from '../TabBar.tsx';
import type { Avisar } from '../../hooks/useToasts.ts';
import { useModoDesktop } from '../../hooks/useModoDesktop.ts';
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
  const modoDesktop = useModoDesktop();
  // Credenciais é o fluxo antigo (navegador externo dedicado, hub-helper.ps1 + CDP).
  // Dentro do shell desktop, login já acontece direto nas abas ERP/Experience do
  // próprio shell — "Abrir Sankhya" nessa tela abriria um terceiro navegador, sem
  // relação com as abas do shell. Some só aqui; quem abre o hub num navegador comum
  // (sem o shell) continua vendo e usando normalmente.
  const abas = modoDesktop ? ABAS.filter((a) => a.id !== 'credenciais') : ABAS;

  const [aba, setAbaBruta] = useState<SubAba>('clientes');
  const [foco, setFoco] = useState<FocoCliente | null>(null);
  const setAba = (id: SubAba) => setAbaBruta(abas.some((a) => a.id === id) ? id : 'clientes');

  const abrirCliente = (id: number) => {
    setFoco((atual) => ({ id, seq: (atual?.seq ?? 0) + 1 }));
    setAba('clientes');
  };

  return (
    <>
      <TabBar abas={abas} ativa={aba} onTrocar={setAba} variante="sub" />

      {aba === 'clientes' && <TelaClientes toast={toast} foco={foco} />}
      {aba === 'credenciais' && !modoDesktop && <TelaCredenciais toast={toast} />}
      {aba === 'agenda' && <AgendaMensal onAbrirCliente={abrirCliente} />}
      {aba === 'agenda-erp' && <TelaAgendaErp toast={toast} />}
    </>
  );
}
