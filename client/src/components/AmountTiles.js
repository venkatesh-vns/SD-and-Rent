import React from 'react';
import { AMOUNTS } from '../config/amounts';
import { formatAmount } from '../utils/format';

// Row of colour-coded totals. values: { agreement, paid, transfer, ... }.
// `lead` = optional first tile, e.g. { label: 'SD Codes', value: 12 }.
// `labels` = optional names per kind, e.g. { balance: 'SD Balance Payable' }.
export default function AmountTiles({ values, lead, labels = {} }) {
  return (
    <div className="sd-tiles">
      {lead && (
        <div className="tile">
          <span>{lead.label}</span>
          <strong>{lead.value}</strong>
          {lead.hint && <small>{lead.hint}</small>}
        </div>
      )}
      {Object.entries(AMOUNTS).map(([kind, a]) => (
        <div key={kind} className={`tile tone-${a.tone}`}>
          <span>{labels[kind] || (kind === 'repayable' ? 'SD Balance Repayable' : a.label)}</span>
          <strong>{formatAmount(values[kind])}</strong>
          <small>{a.hint}</small>
        </div>
      ))}
    </div>
  );
}
