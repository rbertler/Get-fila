import { parseDate } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { Share2, Link as LinkIcon, Copy, Trash2, ExternalLink, Clock } from 'lucide-react';
import { api } from '@/api/client';
import { MedicalRecord, LabResult, Vital, MedicalHistoryEntry, ShareToken } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { format, formatDistanceToNow, isPast } from 'date-fns';

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export function Share() {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [historyEntries, setHistoryEntries] = useState<MedicalHistoryEntry[]>([]);
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(new Set());
  const [selectedVitals, setSelectedVitals] = useState<Set<string>>(new Set());
  const [selectedHistory, setSelectedHistory] = useState<Set<string>>(new Set());
  const [expiresIn, setExpiresIn] = useState(72);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const fetchAll = async () => {
    const [r, l, v, h, t] = await Promise.all([
      api.get<{ records: MedicalRecord[] }>('/records'),
      api.get<{ results: LabResult[] }>('/labs/results'),
      api.get<{ vitals: Vital[] }>('/labs/vitals'),
      api.get<{ entries: MedicalHistoryEntry[] }>('/history'),
      api.get<{ tokens: ShareToken[] }>('/share/my-tokens'),
    ]);
    setRecords(r.records);
    setLabs(l.results);
    setVitals(v.vitals);
    setHistoryEntries(h.entries);
    setTokens(t.tokens);
  };

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, []);

  const toggle = (set: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setFn(next);
  };

  const selectAll = (ids: string[], setFn: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setFn(new Set(ids));
  };

  const hasSelection = selectedRecords.size > 0 || selectedLabs.size > 0 || selectedVitals.size > 0 || selectedHistory.size > 0;

  const handleGenerate = async () => {
    if (!hasSelection) { toast({ variant: 'destructive', title: 'Select at least one item to share' }); return; }
    setGenerating(true);
    try {
      const data = await api.post<{ shareUrl: string; expiresAt: string }>('/share/token', {
        includeRecords: [...selectedRecords],
        includeLabResults: [...selectedLabs],
        includeVitals: [...selectedVitals],
        includeHistoryEntries: [...selectedHistory],
        expiresInHours: expiresIn,
      });
      setCreatedLink(data.shareUrl);
      await fetchAll();
      toast({ variant: 'success', title: 'Share link created!', description: `Expires ${formatDistanceToNow(parseDate(data.expiresAt), { addSuffix: true })}` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to generate link', description: err instanceof Error ? err.message : '' });
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: 'Link copied to clipboard' });
  };

  const revokeToken = async (token: string) => {
    if (!confirm('Revoke this share link? Anyone with the link will lose access.')) return;
    await api.delete(`/share/token/${token}`);
    setTokens((prev) => prev.filter((t) => t.token !== token));
    toast({ title: 'Share link revoked' });
  };

  const clientUrl = window.location.origin;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Share with Your Provider</h1>
        <p className="mt-1 text-lg text-gray-500">Create a time-limited summary to share with your doctor</p>
      </div>

      {createdLink && (
        <div className="mb-6 rounded-lg border-2 border-green-300 bg-green-50 p-4">
          <p className="text-base font-semibold text-green-800 mb-2">Your share link is ready</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white border px-3 py-2 text-sm font-mono text-gray-700 truncate">{createdLink}</code>
            <Button size="sm" onClick={() => copyLink(createdLink)} className="gap-1.5 shrink-0"><Copy className="h-3.5 w-3.5" /> Copy</Button>
            <Button size="sm" variant="outline" asChild className="shrink-0">
              <a href={createdLink} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Selection panel */}
          <div className="lg:col-span-2">
            <div className="space-y-6">
              <SelectSection title="Medical Records" count={selectedRecords.size} total={records.length} onSelectAll={() => selectAll(records.map(r => r.id), setSelectedRecords)}>
                {records.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No records uploaded yet</p>
                ) : records.map((r) => (
                  <CheckItem
                    key={r.id} id={r.id} checked={selectedRecords.has(r.id)}
                    onChange={() => toggle(selectedRecords, setSelectedRecords, r.id)}
                    label={r.fileName} sub={toTitleCase(r.recordType)}
                  />
                ))}
              </SelectSection>

              <SelectSection title="Lab Results" count={selectedLabs.size} total={labs.length} onSelectAll={() => selectAll(labs.map(l => l.id), setSelectedLabs)}>
                {labs.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No lab results yet</p>
                ) : labs.map((l) => (
                  <CheckItem
                    key={l.id} id={l.id} checked={selectedLabs.has(l.id)}
                    onChange={() => toggle(selectedLabs, setSelectedLabs, l.id)}
                    label={`${l.testName}: ${l.value} ${l.unit}`}
                    sub={format(parseDate(l.recordedAt), 'MMM d, yyyy')}
                    flagged={l.isFlagged}
                  />
                ))}
              </SelectSection>

              <SelectSection title="Vitals" count={selectedVitals.size} total={vitals.length} onSelectAll={() => selectAll(vitals.map(v => v.id), setSelectedVitals)}>
                {vitals.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No vitals recorded yet</p>
                ) : vitals.slice(0, 10).map((v) => (
                  <CheckItem
                    key={v.id} id={v.id} checked={selectedVitals.has(v.id)}
                    onChange={() => toggle(selectedVitals, setSelectedVitals, v.id)}
                    label={`${toTitleCase(v.type)}: ${v.value}${v.value2 ? `/${v.value2}` : ''} ${v.unit}`}
                    sub={format(parseDate(v.recordedAt), 'MMM d, yyyy')}
                  />
                ))}
              </SelectSection>

              <SelectSection title="Health History" count={selectedHistory.size} total={historyEntries.length} onSelectAll={() => selectAll(historyEntries.map(h => h.id), setSelectedHistory)}>
                {historyEntries.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No history entries yet</p>
                ) : historyEntries.map((h) => (
                  <CheckItem
                    key={h.id} id={h.id} checked={selectedHistory.has(h.id)}
                    onChange={() => toggle(selectedHistory, setSelectedHistory, h.id)}
                    label={h.name} sub={toTitleCase(h.category)}
                  />
                ))}
              </SelectSection>
            </div>
          </div>

          {/* Active links sidebar */}
          <div>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Active Share Links</CardTitle>
              </CardHeader>
              <CardContent>
                {tokens.length === 0 ? (
                  <p className="text-base text-gray-500">No active links</p>
                ) : (
                  <div className="space-y-3">
                    {tokens.map((t) => {
                      const expired = isPast(parseDate(t.expiresAt));
                      const shareUrl = `${clientUrl}/share/${t.token}`;
                      return (
                        <div key={t.id} className={`rounded-lg border p-3 ${expired ? 'opacity-60' : ''}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">
                              {format(parseDate(t.createdAt), 'MMM d, h:mm a')}
                            </span>
                            {expired ? (
                              <Badge variant="secondary">Expired</Badge>
                            ) : (
                              <Badge variant="success">Active</Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 flex items-center gap-1 mb-2">
                            <Clock className="h-3 w-3" />
                            {expired ? 'Expired' : `Expires ${formatDistanceToNow(parseDate(t.expiresAt), { addSuffix: true })}`}
                          </p>
                          <p className="text-sm text-gray-400">{t.accessCount} view{t.accessCount !== 1 ? 's' : ''}</p>
                          {!expired && (
                            <div className="mt-2 flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => copyLink(shareUrl)} className="flex-1 gap-1 text-xs">
                                <Copy className="h-3 w-3" /> Copy
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => revokeToken(t.token)} className="text-[#9b2c2c] hover:text-[#9b2c2c] flex-1 gap-1 text-xs">
                                <Trash2 className="h-3 w-3" /> Revoke
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expiry + Generate */}
            <div className="mt-4 rounded-lg border bg-white p-5 space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-base font-medium text-gray-700">Link expires after:</label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                >
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>1 week</option>
                  <option value={720}>30 days</option>
                </select>
              </div>
              <Button onClick={handleGenerate} disabled={generating || !hasSelection} className="gap-2 w-full text-white font-semibold disabled:opacity-100">
                <LinkIcon className="h-4 w-4" />
                {generating ? 'Generating' : 'Generate share link'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectSection({ title, count, total, onSelectAll, children }: {
  title: string; count: number; total: number;
  onSelectAll: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center gap-2">
          {count > 0 && <Badge variant="info">{count} selected</Badge>}
          {total > 0 && <button type="button" onClick={onSelectAll} className="text-sm text-primary hover:underline">Select all</button>}
        </div>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">{children}</div>
    </div>
  );
}

function CheckItem({ id, checked, onChange, label, sub, flagged }: {
  id: string; checked: boolean; onChange: () => void;
  label: string; sub?: string; flagged?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 cursor-pointer py-1 hover:bg-gray-50 rounded px-1 -mx-1">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary" />
      <div className="flex-1 min-w-0">
        <span className="text-base text-gray-800 leading-snug truncate block">{label}</span>
        {sub && <span className="text-sm text-gray-400">{sub}</span>}
      </div>
      {flagged && <Badge className="shrink-0 text-xs" style={{ backgroundColor: '#9b2c2c', color: '#ffffff', border: 'none' }}>Flagged</Badge>}
    </label>
  );
}
