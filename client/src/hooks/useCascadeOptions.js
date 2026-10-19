import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const sorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

/**
 * Landlord Name and Floor filter choices that follow the other filters
 * (Cost Center -> Landlord -> Floor), from the Master data:
 *   source 'sd' (SD Master), 'rent' (Rent Master) or 'all' (both).
 * Landlords are those of the chosen Cost Centers; Floors those of the chosen
 * Cost Centers and Landlords. Picks no longer offered are dropped from filters.
 */
export default function useCascadeOptions(source, filters, setFilters) {
  const [combos, setCombos] = useState(null);
  useEffect(() => {
    api.get('/lookups/filter-combos', { params: { source } })
      .then((res) => setCombos(res.data.data))
      .catch(() => setCombos([]));
  }, [source]);

  const ccKey = (filters.costCenterId || []).join(',');
  const llKey = (filters.landlordName || []).join('\u0001');
  const { landlords, floors } = useMemo(() => {
    const cc = new Set(ccKey ? ccKey.split(',') : []);
    const ll = new Set(llKey ? llKey.split('\u0001') : []);
    const inCc = (combos || []).filter((c) => !cc.size || cc.has(String(c.costCenterId)));
    return {
      landlords: sorted(inCc.map((c) => c.landlord)),
      floors: sorted(inCc.filter((c) => !ll.size || ll.has(c.landlord)).map((c) => c.floor)),
    };
  }, [combos, ccKey, llKey]);

  useEffect(() => {
    if (!combos) return;
    const okLl = new Set(landlords);
    const okFloor = new Set(floors);
    setFilters((f) => {
      const landlordName = (f.landlordName || []).filter((v) => okLl.has(v));
      const floor = (f.floor || []).filter((v) => okFloor.has(v));
      if (landlordName.length === (f.landlordName || []).length && floor.length === (f.floor || []).length) return f;
      return { ...f, landlordName, floor };
    });
  }, [combos, landlords, floors, setFilters]);

  return { landlords, floors };
}
