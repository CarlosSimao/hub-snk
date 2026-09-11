import type { Status } from '../types.ts';
import { STATUS_LABEL } from '../lib/format.ts';

export function Semaphore({ status, extra = '' }: { status: Status; extra?: string }) {
  return (
    <span className={`semaphore ${extra}`} data-status={status} title={STATUS_LABEL[status]}>
      <i className="lamp red" />
      <i className="lamp amber" />
      <i className="lamp green" />
    </span>
  );
}
