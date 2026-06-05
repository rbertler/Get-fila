import { useEffect, useState } from 'react';
import { Brain, Clock, AlertCircle, Lightbulb, BookOpen, Download, Share2, FileText, Copy, Check, X, SlidersHorizontal, ChevronDown, ChevronRight, Search, Trash2 } from 'lucide-react';
import { useInsight, FocusedScope } from '@/context/InsightContext';
import { api } from '@/api/client';
import { HealthInsightReport, InsightItem, MedicalHistoryEntry, LabResult, ImagingStudy } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SkeletonList } from '@/components/SkeletonCard';
import { EmptyState } from '@/components/EmptyState';
import { toast } from '@/hooks/useToast';
import { format } from 'date-fns';

const CONFIDENCE_STYLES: Record<InsightItem['confidence'], { background: string; color: string }> = {
  high:     { background: '#2b4257', color: '#ffffff' },
  moderate: { background: '#6da7cc', color: '#ffffff' },
  low:      { background: '#e3ebf2', color: '#2b4257' },
};

const CONFIDENCE_LABELS: Record<InsightItem['confidence'], string> = {
  high:     'Strong Pattern',
  moderate: 'Possible Pattern',
  low:      'Weak Pattern',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#6da7cc' }}>
      {children}
    </p>
  );
}

function ReportCard({ report }: { report: HealthInsightReport }) {
  const insights = report.insights as InsightItem[];
  const gaps = report.gaps as string[];

  return (
    <div className="rounded-xl border bg-white divide-y divide-gray-100">

      {/* Summary */}
      <div className="px-4 md:px-6 py-4 md:py-5">
        <SectionLabel>Summary</SectionLabel>
        <p className="text-base text-gray-700 leading-relaxed">{report.summary}</p>
      </div>

      {/* Patterns */}
      {insights.length > 0 && (
        <div className="px-4 md:px-6 py-4 md:py-5">
          <SectionLabel>Patterns</SectionLabel>
          <div className="space-y-6">
            {insights.map((insight, i) => (
              <div key={i} className={i > 0 ? 'pt-6 border-t border-gray-100' : ''}>
                {/* Title + badge + conditions */}
                <div className="flex items-start gap-2 mb-3">
                  <Lightbulb className="h-4 w-4 text-amber-500 mt-1 shrink-0" />
                  <div>
                    <p className="text-base font-semibold text-gray-900 leading-snug">{insight.title}</p>
                    <div className="mt-1.5">
                      <Badge variant="outline" style={{ ...CONFIDENCE_STYLES[insight.confidence], border: 'none' }}>
                        {CONFIDENCE_LABELS[insight.confidence]}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Description */}
                {insight.description && (
                  <p className="text-sm text-gray-700 leading-relaxed mb-3 pl-6">{insight.description}</p>
                )}

                {/* Related Conditions */}
                {insight.relatedConditions.length > 0 && (
                  <div className="mb-3 pl-6">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Related Conditions</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {insight.relatedConditions.map((c, idx) => (
                        <span key={c} className="flex items-center gap-x-3">
                          {idx > 0 && <span className="h-1 w-1 rounded-full bg-gray-300 shrink-0" />}
                          <span className="text-sm text-gray-600">{c}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Supporting Evidence */}
                {insight.supportingEvidence.length > 0 && (
                  <div className="pl-6">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Supporting Evidence</p>
                    <ul className="space-y-1">
                      {insight.supportingEvidence.map((e, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                          <span>{e.text} <span className="text-gray-400">— {e.source}, {e.date}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Information Gaps */}
      {gaps.length > 0 && (
        <div className="px-4 md:px-6 py-4 md:py-5">
          <SectionLabel>Information Gaps</SectionLabel>
          <ul className="space-y-2">
            {gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Talking Points for Provider */}
      {insights.length > 0 && (
        <div className="px-4 md:px-6 py-4 md:py-5">
          <SectionLabel>Talking Points for Provider</SectionLabel>
          <div className="rounded-lg border overflow-hidden" style={{ background: '#c8ddf0', borderColor: '#2b4257' }}>
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: i > 0 ? '1px solid #2b4257' : 'none' }}>
                <BookOpen className="h-4 w-4 shrink-0 mt-[3px]" style={{ color: '#2b4257' }} />
                <p className="text-sm leading-relaxed" style={{ color: '#2b4257' }}>{insight.suggestedDiscussion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Share Dialog ──────────────────────────────────────────────────────────────

function ShareDialog({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.post<{ shareUrl: string }>(`/insights/${reportId}/share`, {})
      .then((d) => setShareUrl(d.shareUrl))
      .catch(() => toast({ variant: 'destructive', title: 'Failed to create share link' }))
      .finally(() => setLoading(false));
  }, [reportId]);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Report</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-gray-500 py-4 text-center">Generating share link…</p>
        ) : shareUrl ? (
          <div className="space-y-3 pt-1">
            <p className="text-sm text-gray-600">
              This link gives anyone read-only access to a PDF of this report for <strong>7 days</strong>. No login required.
            </p>
            <div className="rounded-lg border bg-gray-50 px-3 py-2.5">
              <p className="text-sm text-gray-700 break-all leading-relaxed">{shareUrl}</p>
            </div>
            <Button
              variant={copied ? 'default' : 'outline'}
              className="w-full gap-2"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Link Copied!' : 'Copy Link'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-red-500 py-4 text-center">Could not create share link. Please try again.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Focused Analysis Dialog ───────────────────────────────────────────────────

type SelectionGroup = { label: string; items: { id: string; name: string; sublabel?: string }[] };

function FocusedAnalysisDialog({ onClose, onRun }: { onClose: () => void; onRun: (scope: FocusedScope) => void }) {
  const [entries, setEntries] = useState<MedicalHistoryEntry[]>([]);
  const [labs, setLabs] = useState<{ testName: string; latestDate: string }[]>([]);
  const [imaging, setImaging] = useState<ImagingStudy[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(new Set());
  const [selectedImaging, setSelectedImaging] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['history', 'labs', 'imaging']));
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<{ entries: MedicalHistoryEntry[] }>('/history'),
      api.get<{ results: LabResult[] }>('/labs/results'),
      api.get<{ studies: ImagingStudy[] }>('/labs/imaging'),
    ]).then(([histData, labData, imgData]) => {
      setEntries(histData.entries.filter(e => e.category !== 'FAMILY_HISTORY'));
      // Deduplicate labs by test name, keep latest date
      const byTest: Record<string, string> = {};
      for (const l of labData.results) {
        if (!byTest[l.testName] || l.recordedAt > byTest[l.testName]) byTest[l.testName] = l.recordedAt;
      }
      setLabs(Object.entries(byTest).map(([testName, latestDate]) => ({ testName, latestDate })).sort((a, b) => a.testName.localeCompare(b.testName)));
      setImaging(imgData.studies);
    }).finally(() => setLoadingData(false));
  }, []);

  const toggleEntry = (id: string) => setSelectedEntries(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleLab = (name: string) => setSelectedLabs(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleImaging = (id: string) => setSelectedImaging(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSection = (key: string) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const totalSelected = selectedEntries.size + selectedLabs.size + selectedImaging.size;

  const handleRun = () => {
    if (totalSelected === 0) { toast({ variant: 'destructive', title: 'Select at least one item' }); return; }
    onRun({ entryIds: [...selectedEntries], labTestNames: [...selectedLabs], imagingIds: [...selectedImaging] });
  };

  const CATEGORY_LABELS: Record<string, string> = {
    CONDITION: 'Condition', MEDICATION: 'Medication', SUPPLEMENT: 'Supplement',
    ALLERGY: 'Allergy', SURGERY: 'Surgery', VACCINATION: 'Vaccination',
  };

  const searchLower = search.toLowerCase();
  const filteredEntries = search ? entries.filter(e => e.name.toLowerCase().includes(searchLower)) : entries;
  const filteredLabs = search ? labs.filter(l => l.testName.toLowerCase().includes(searchLower)) : labs;
  const filteredImaging = search ? imaging.filter(s => (s.description ?? `${s.studyType} – ${s.bodyPart}`).toLowerCase().includes(searchLower)) : imaging;

  const entriesByCategory: Record<string, MedicalHistoryEntry[]> = {};
  for (const e of filteredEntries) (entriesByCategory[e.category] ??= []).push(e);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" style={{ color: '#6da7cc' }} />
            Focused Analysis
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-0.5">Select the specific entries to analyze.</p>
        </DialogHeader>

        {!loadingData && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search conditions, labs, imaging"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#6da7cc]/40"
            />
          </div>
        )}

        {loadingData ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <p className="text-sm text-gray-400">Loading your health data…</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">

            {/* Health History */}
            {filteredEntries.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleSection('history')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-semibold text-gray-700">Health History</span>
                  <div className="flex items-center gap-2">
                    {selectedEntries.size > 0 && <span className="text-xs text-[#6da7cc] font-medium">{selectedEntries.size} selected</span>}
                    {expanded.has('history') ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>
                {expanded.has('history') && (
                  <div className="divide-y divide-gray-100">
                    {Object.entries(entriesByCategory).map(([cat, items]) => (
                      <div key={cat}>
                        <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">{CATEGORY_LABELS[cat] ?? cat}</p>
                        {items.map(e => (
                          <label key={e.id} className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-blue-50/40 cursor-pointer transition-colors">
                            <input type="checkbox" checked={selectedEntries.has(e.id)} onChange={() => toggleEntry(e.id)} className="h-4 w-4 rounded accent-[#2b4257]" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-900">{e.name}</p>
                              {e.startDate && <p className="text-xs text-gray-400">{format(new Date(e.startDate), 'MMM yyyy')}{e.endDate ? ` – ${format(new Date(e.endDate), 'MMM yyyy')}` : ''}</p>}
                            </div>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Lab Tests */}
            {filteredLabs.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleSection('labs')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-semibold text-gray-700">Lab Tests</span>
                  <div className="flex items-center gap-2">
                    {selectedLabs.size > 0 && <span className="text-xs text-[#6da7cc] font-medium">{selectedLabs.size} selected</span>}
                    {expanded.has('labs') ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>
                {expanded.has('labs') && (
                  <div className="divide-y divide-gray-100">
                    {filteredLabs.map(l => (
                      <label key={l.testName} className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <input type="checkbox" checked={selectedLabs.has(l.testName)} onChange={() => toggleLab(l.testName)} className="h-4 w-4 rounded accent-[#2b4257]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900">{l.testName}</p>
                          <p className="text-xs text-gray-400">Latest: {format(new Date(l.latestDate), 'MMM d, yyyy')}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Imaging */}
            {filteredImaging.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleSection('imaging')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-semibold text-gray-700">Imaging Studies</span>
                  <div className="flex items-center gap-2">
                    {selectedImaging.size > 0 && <span className="text-xs text-[#6da7cc] font-medium">{selectedImaging.size} selected</span>}
                    {expanded.has('imaging') ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>
                {expanded.has('imaging') && (
                  <div className="divide-y divide-gray-100">
                    {filteredImaging.map(s => (
                      <label key={s.id} className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <input type="checkbox" checked={selectedImaging.has(s.id)} onChange={() => toggleImaging(s.id)} className="h-4 w-4 rounded accent-[#2b4257]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900">{s.description ?? `${s.studyType} – ${s.bodyPart}`}</p>
                          {s.studyDate && <p className="text-xs text-gray-400">{format(new Date(s.studyDate), 'MMM d, yyyy')}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {filteredEntries.length === 0 && filteredLabs.length === 0 && filteredImaging.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">
                {search ? `No results for "${search}"` : 'No health data available to select.'}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-3 border-t mt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 gap-2 text-white"
            disabled={totalSelected === 0 || loadingData}
            onClick={handleRun}
          >
            <Brain className="h-4 w-4" />
            Analyze {totalSelected > 0 ? `${totalSelected} item${totalSelected !== 1 ? 's' : ''}` : 'Selected'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function HealthIntelligence() {
  const [reports, setReports] = useState<HealthInsightReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HealthInsightReport | null>(null);
  const [canGenerate, setCanGenerate] = useState(true);
  const [shareDialogId, setShareDialogId] = useState<string | null>(null);
  const [savingToRecords, setSavingToRecords] = useState(false);
  const [savedReportIds, setSavedReportIds] = useState<Set<string>>(new Set());
  const [focusedDialogOpen, setFocusedDialogOpen] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { generating, lastReport, generate, generateFocused, clearLastReport } = useInsight();

  useEffect(() => {
    api.get<{ reports: HealthInsightReport[]; canGenerate: boolean }>('/insights')
      .then((d) => {
        setReports(d.reports);
        setCanGenerate(d.canGenerate);
        if (d.reports.length > 0) setSelected(d.reports[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  // When a report finishes (from any page), prepend it and select it
  useEffect(() => {
    if (!lastReport) return;
    setReports((prev) => [lastReport, ...prev.filter((r) => r.id !== lastReport.id)]);
    setSelected(lastReport);
    if (lastReport.reportType === 'general') setCanGenerate(false);
    clearLastReport();
  }, [lastReport, clearLastReport]);

  const handleGenerate = async () => {
    try {
      await generate();
    } catch (err: any) {
      const msg = err?.message ?? 'Failed to generate insights. Please try again.';
      toast({ variant: 'destructive', title: 'Analysis failed', description: msg });
    }
  };

  const handleGenerateFocused = async (scope: FocusedScope) => {
    setFocusedDialogOpen(false);
    try {
      await generateFocused(scope);
    } catch (err: any) {
      const msg = err?.message ?? 'Failed to generate focused insights. Please try again.';
      toast({ variant: 'destructive', title: 'Analysis failed', description: msg });
    }
  };

  const handleDownload = async (report: HealthInsightReport) => {
    try {
      const res = await fetch(`/api/insights/${report.id}/pdf`, { credentials: 'include' });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-intelligence-${format(new Date(report.generatedAt), 'yyyy-MM-dd')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: 'destructive', title: 'Download failed', description: 'Could not generate PDF. Please try again.' });
    }
  };

  const handleSaveToRecords = async (report: HealthInsightReport) => {
    setSavingToRecords(true);
    try {
      await api.post(`/insights/${report.id}/save-to-records`, {});
      setSavedReportIds((prev) => new Set([...prev, report.id]));
      toast({ title: 'Saved to Records', description: 'The AI Summary has been added to your Records.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: err?.message ?? 'Could not save to records.' });
    } finally {
      setSavingToRecords(false);
    }
  };

  const handleDeleteReport = async (report: HealthInsightReport) => {
    setDeletingReportId(report.id);
    try {
      await api.delete(`/insights/${report.id}`);
      const remaining = reports.filter((r) => r.id !== report.id);
      setReports(remaining);
      if (selected?.id === report.id) setSelected(remaining[0] ?? null);
      if (report.reportType === 'general') setCanGenerate(true);
      toast({ title: 'Report deleted' });
    } catch {
      toast({ variant: 'destructive', title: 'Delete failed', description: 'Could not delete the report. Please try again.' });
    } finally {
      setDeletingReportId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-gray-900">Health Intelligence</h1>
          <p className="mt-1 text-sm md:text-lg text-gray-500">Pattern analysis across all your health records</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="default"
            onClick={() => setFocusedDialogOpen(true)}
            disabled={generating}
            className="gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Focused Analysis
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating || !canGenerate}
            title={!canGenerate ? 'Add new records before generating a new report' : undefined}
            className="gap-2 text-white"
          >
            <Brain className="h-4 w-4" />
            {generating ? 'Analyzing' : canGenerate ? 'Full Analysis' : 'Up to Date'}
          </Button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-900 mt-0.5 shrink-0" />
        <p className="text-base text-amber-900">
          <strong>These insights are not a diagnosis.</strong> They identify patterns in your data to help you have more informed conversations with your healthcare provider. Always discuss findings with a qualified healthcare professional.
        </p>
      </div>

      {loading ? (
        <SkeletonList />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No insights generated yet"
          description="Once you have records, lab results, and vitals uploaded, AI analysis will identify patterns across your fragmented health data."
        />
      ) : (
        <div className="space-y-6">
          {/* Past Reports — horizontal scroll row */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Past Reports</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={`shrink-0 text-left rounded-lg border p-3 w-44 flex flex-col justify-between transition-colors ${selected?.id === r.id ? 'bg-primary/10 border-primary/30' : 'bg-white hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1.5">
                    <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5 truncate">
                      <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="truncate">{format(new Date(r.generatedAt), 'MMM d, yyyy')}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{(r.insights as InsightItem[]).length} insights</p>
                    <Badge
                      variant="outline"
                      className="text-xs shrink-0"
                      style={r.reportType === 'focused'
                        ? { background: '#e3ebf2', color: '#2b4257', border: 'none' }
                        : { background: '#2b4257', color: '#fff', border: 'none' }}
                    >
                      {r.reportType === 'focused' ? 'Focused' : 'Full'}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Selected report */}
          {selected && (
            <div>
              {/* Header row: date label + action buttons */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    {selected.reportType === 'focused' ? 'Focused Analysis · ' : ''}{format(new Date(selected.generatedAt), 'MMMM d, yyyy')}
                  </p>
                  {selected.scopeLabel && (
                    <p className="text-xs text-gray-400 mt-0.5">{selected.scopeLabel}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 px-2.5 text-xs" onClick={() => handleDownload(selected)}>
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 px-2.5 text-xs" onClick={() => setShareDialogId(selected.id)}>
                    <Share2 className="h-3.5 w-3.5" /> Share
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 px-2.5 text-xs"
                    disabled={savingToRecords || savedReportIds.has(selected.id)}
                    onClick={() => handleSaveToRecords(selected)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {savedReportIds.has(selected.id) ? 'Saved' : 'Save to Records'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 px-2.5 text-xs text-[#9b2c2c] border-[#9b2c2c]/30 transition-colors hover:bg-[#9b2c2c] hover:text-white hover:border-[#9b2c2c]"
                    onClick={() => setConfirmDeleteId(selected.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
              <ReportCard report={selected} />
            </div>
          )}
        </div>
      )}

      {confirmDeleteId && (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete report?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-500">This report will be permanently deleted and cannot be recovered.</p>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button
                className="text-[#9b2c2c] border-[#9b2c2c] hover:bg-[#9b2c2c] hover:text-white transition-colors"
                variant="outline"
                disabled={deletingReportId === confirmDeleteId}
                onClick={() => {
                  const report = reports.find(r => r.id === confirmDeleteId);
                  if (report) { setConfirmDeleteId(null); handleDeleteReport(report); }
                }}
              >
                {deletingReportId === confirmDeleteId ? 'Deleting' : 'Yes, delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {shareDialogId && (
        <ShareDialog reportId={shareDialogId} onClose={() => setShareDialogId(null)} />
      )}

      {focusedDialogOpen && (
        <FocusedAnalysisDialog
          onClose={() => setFocusedDialogOpen(false)}
          onRun={handleGenerateFocused}
        />
      )}
    </div>
  );
}
