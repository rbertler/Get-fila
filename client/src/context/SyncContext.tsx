/**
 * Global sync context — keeps the sync request alive across navigation.
 * The `handleSync` function fires the API call and resolves toasts in the
 * background, so users can leave the Records page while syncing proceeds.
 */

import { createContext, useContext, useRef, useState, useCallback, ReactNode } from 'react';
import { api } from '@/api/client';
import { toast } from '@/hooks/useToast';

interface SyncContextValue {
  syncing: boolean;
  handleSync: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  // Prevent double-firing if the user clicks Sync again before it finishes
  const inFlightRef = useRef(false);

  const handleSync = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSyncing(true);

    // Immediately let the user know they can navigate away
    toast({
      variant: 'default',
      title: 'Sync started',
      description: "You can leave this page. We'll notify you when it's done.",
    });

    api
      .post<{
        message: string;
        labsAdded: number;
        conditionsAdded: number;
        medicationsAdded: number;
        imagingAdded: number;
        vitalsAdded: number;
        providersAdded: number;
      }>('/records/sync')
      .then((data) => {
        const parts: string[] = [];
        if (data.labsAdded)        parts.push(`${data.labsAdded} lab result${data.labsAdded !== 1 ? 's' : ''}`);
        if (data.conditionsAdded)  parts.push(`${data.conditionsAdded} condition${data.conditionsAdded !== 1 ? 's' : ''}`);
        if (data.medicationsAdded) parts.push(`${data.medicationsAdded} medication${data.medicationsAdded !== 1 ? 's' : ''}`);
        if (data.imagingAdded)     parts.push(`${data.imagingAdded} imaging study${data.imagingAdded !== 1 ? 'ies' : ''}`);
        if (data.vitalsAdded)      parts.push(`${data.vitalsAdded} vital${data.vitalsAdded !== 1 ? 's' : ''}`);
        if (data.providersAdded)   parts.push(`${data.providersAdded} provider${data.providersAdded !== 1 ? 's' : ''}`);
        toast({
          variant: parts.length > 0 ? 'success' : 'default',
          title: parts.length > 0 ? 'Sync complete' : 'Already up to date',
          description: parts.length > 0 ? `Added: ${parts.join(', ')}` : 'No new data found in your records.',
        });
      })
      .catch((err: unknown) => {
        toast({
          variant: 'destructive',
          title: 'Sync failed',
          description: err instanceof Error ? err.message : 'An error occurred',
        });
      })
      .finally(() => {
        setSyncing(false);
        inFlightRef.current = false;
      });
  }, []);

  return (
    <SyncContext.Provider value={{ syncing, handleSync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncContext() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSyncContext must be used inside SyncProvider');
  return ctx;
}
