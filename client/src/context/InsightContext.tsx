import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api } from '@/api/client';
import { HealthInsightReport } from '@/types';

export interface FocusedScope {
  entryIds: string[];
  labTestNames: string[];
  imagingIds: string[];
}

interface InsightContextValue {
  generating: boolean;
  lastReport: HealthInsightReport | null;
  generate: () => Promise<HealthInsightReport | null>;
  generateFocused: (scope: FocusedScope) => Promise<HealthInsightReport | null>;
  clearLastReport: () => void;
}

const InsightContext = createContext<InsightContextValue | null>(null);

export function InsightProvider({ children }: { children: ReactNode }) {
  const [generating, setGenerating] = useState(false);
  const [lastReport, setLastReport] = useState<HealthInsightReport | null>(null);

  const generate = useCallback(async (): Promise<HealthInsightReport | null> => {
    if (generating) return null;
    setGenerating(true);
    setLastReport(null);
    try {
      const data = await api.post<{ report: HealthInsightReport }>('/insights/generate', {});
      setLastReport(data.report);
      return data.report;
    } catch (err: any) {
      throw new Error(err?.message ?? 'Failed to generate insights. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [generating]);

  const generateFocused = useCallback(async (scope: FocusedScope): Promise<HealthInsightReport | null> => {
    if (generating) return null;
    setGenerating(true);
    setLastReport(null);
    try {
      const data = await api.post<{ report: HealthInsightReport }>('/insights/generate/focused', scope);
      setLastReport(data.report);
      return data.report;
    } catch (err: any) {
      throw new Error(err?.message ?? 'Failed to generate focused insights. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [generating]);

  const clearLastReport = useCallback(() => setLastReport(null), []);

  return (
    <InsightContext.Provider value={{ generating, lastReport, generate, generateFocused, clearLastReport }}>
      {children}
    </InsightContext.Provider>
  );
}

export function useInsight() {
  const ctx = useContext(InsightContext);
  if (!ctx) throw new Error('useInsight must be used inside InsightProvider');
  return ctx;
}
