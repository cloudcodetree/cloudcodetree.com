'use client';

import { useEffect } from 'react';
import { READ_DWELL_MS, createDwell, readLedger } from './readDwell';
import { sendEngagement } from './engagement';

/** Send `read +1` for this item once per browser, after 10 visible seconds. */
export function useReadDwell(itemId: string | null): void {
  useEffect(() => {
    if (!itemId) return;
    const ledger = readLedger();
    if (ledger.has(itemId)) return;
    const dwell = createDwell(READ_DWELL_MS, () => {
      if (readLedger().has(itemId)) return;   // another tab got there first
      readLedger().add(itemId);
      void sendEngagement(itemId, [{ event: 'read', delta: 1 }]);
    });
    const sync = () => (document.visibilityState === 'visible' ? dwell.show() : dwell.hide());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      dwell.dispose();
    };
  }, [itemId]);
}
