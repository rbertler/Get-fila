import { parseDate } from '@/lib/utils';
import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import { usePdfWidth } from '@/hooks/usePdfWidth';
import { Plus, Activity, AlertTriangle, Trash2, ChevronDown, Scan, X, ChevronLeft, ChevronRight, Pencil, SlidersHorizontal } from 'lucide-react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '@/lib/pdfWorker';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/api/client';
import { LabResult, Vital, VitalType, ImagingStudy, ImagingStudyType, MedicalRecord } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';

const VITAL_LABELS: Record<VitalType, string> = {
  WEIGHT: 'Weight',
  BLOOD_PRESSURE: 'Blood Pressure',
  HEART_RATE: 'Heart Rate',
  TEMPERATURE: 'Temperature',
  OXYGEN_SATURATION: 'Oxygen Saturation',
  BLOOD_GLUCOSE: 'Blood Glucose',
  STEPS: 'Steps',
  SLEEP_HOURS: 'Sleep',
};

const IMAGING_TYPE_LABELS: Record<ImagingStudyType, string> = {
  XRAY: 'X-Ray',
  MRI: 'MRI',
  CT_SCAN: 'CT Scan',
  ULTRASOUND: 'Ultrasound',
  PET_SCAN: 'PET Scan',
  MAMMOGRAM: 'Mammogram',
  ECHOCARDIOGRAM: 'Echocardiogram',
  OTHER: 'Other',
};

const VITAL_UNITS: Record<VitalType, string> = {
  WEIGHT: 'lbs',
  BLOOD_PRESSURE: 'mmHg',
  HEART_RATE: 'bpm',
  TEMPERATURE: '°F',
  OXYGEN_SATURATION: '%',
  BLOOD_GLUCOSE: 'mg/dL',
  STEPS: 'steps',
  SLEEP_HOURS: 'hours',
};

const toTitleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

type LabStatus = 'in-range' | 'borderline' | 'out-of-range';

function getLabStatus(value: number, min: number | null | undefined, max: number | null | undefined, isFlagged: boolean): LabStatus {
  if (min != null && max != null) {
    if (value < min || value > max) return 'out-of-range';
    const buffer = (max - min) * 0.05;
    if (value <= min + buffer || value >= max - buffer) return 'borderline';
    return 'in-range';
  }
  return isFlagged ? 'out-of-range' : 'in-range';
}

function getLabValueColor(status: LabStatus): string {
  if (status === 'out-of-range') return 'text-[#9b2c2c]';
  if (status === 'borderline') return 'text-[#9c4221]';
  return 'text-[#276749]';
}

function getLabChartColor(status: LabStatus): string {
  if (status === 'out-of-range') return '#9b2c2c';
  if (status === 'borderline') return '#9c4221';
  return '#276749';
}

function getLabCardBorder(status: LabStatus): string {
  if (status === 'out-of-range') return 'border-[#9b2c2c]';
  if (status === 'borderline') return 'border-[#9c4221]';
  return '';
}

type StatusFilter = 'all' | 'normal' | 'abnormal';
type DateRangeFilter = 'all' | '3m' | '6m' | '1y' | 'custom';

const DATE_RANGE_LABELS: Record<DateRangeFilter, string> = {
  all: 'All time',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '1y': 'Last year',
  custom: 'Specific range',
};

type DateBounds = { start: Date | null; end: Date | null };

function getDateBounds(range: DateRangeFilter, customStart: string, customEnd: string): DateBounds {
  if (range === 'all') return { start: null, end: null };
  if (range === 'custom') {
    return {
      start: customStart ? parseDate(`${customStart}T00:00:00`) : null,
      end: customEnd ? parseDate(`${customEnd}T23:59:59.999`) : null,
    };
  }
  const start = new Date();
  if (range === '3m') start.setMonth(start.getMonth() - 3);
  else if (range === '6m') start.setMonth(start.getMonth() - 6);
  else if (range === '1y') start.setFullYear(start.getFullYear() - 1);
  return { start, end: null };
}

function isWithinBounds(date: Date, bounds: DateBounds): boolean {
  if (bounds.start && date < bounds.start) return false;
  if (bounds.end && date > bounds.end) return false;
  return true;
}

// "Normal" = in-range; "Abnormal" = borderline or out-of-range
function matchesStatusFilter(lab: LabResult, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const status = getLabStatus(lab.value, lab.referenceMin, lab.referenceMax, lab.isFlagged);
  return filter === 'normal' ? status === 'in-range' : status !== 'in-range';
}

function LabStatusBadge({ status }: { status: LabStatus }) {
  if (status === 'out-of-range') {
    return <Badge className="flex items-center gap-1" style={{ backgroundColor: '#9b2c2c', color: '#ffffff', border: 'none' }}><AlertTriangle className="h-3 w-3" /> Out of range</Badge>;
  }
  if (status === 'borderline') {
    return <Badge className="flex items-center gap-1" style={{ backgroundColor: '#9c4221', color: '#ffffff', border: 'none' }}><AlertTriangle className="h-3 w-3" /> Borderline</Badge>;
  }
  return null;
}

// Shared PDF expand/collapse logic
function usePdfViewer(recordId: string | undefined) {
  const [open, setOpen] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfContainerRef, pdfWidth] = usePdfWidth(24);

  useEffect(() => {
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [pdfBlobUrl]);

  const handleView = async () => {
    if (!recordId) return;
    const opening = !open;
    setOpen(opening);
    setPage(1);
    setNumPages(0);
    if (opening && !pdfBlobUrl) {
      try {
        const blob = await api.blob(`/records/${recordId}/view`);
        setPdfBlobUrl(URL.createObjectURL(blob));
      } catch {
        setPdfError('Could not load PDF.');
      }
    }
  };

  const viewer = open && recordId ? (
    <div className="mt-2 rounded-xl border border-primary/20 overflow-hidden">
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-white/60 border-b border-primary/10 text-xs text-gray-500">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>{page} / {numPages}</span>
          <button onClick={() => setPage(p => Math.min(numPages, p + 1))} disabled={page >= numPages} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div ref={pdfContainerRef} className="overflow-auto bg-gray-100 flex justify-center p-3 max-h-96">
        {pdfError ? (
          <div className="py-8 text-sm text-red-400">{pdfError}</div>
        ) : (
          <Document
            file={pdfBlobUrl}
            onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPage(1); }}
            loading={<div className="py-8 text-sm text-gray-400">Rendering…</div>}
            error={<div className="py-8 text-sm text-red-400">Could not render PDF.</div>}
          >
            <Page pageNumber={page} width={pdfWidth} renderTextLayer renderAnnotationLayer />
          </Document>
        )}
      </div>
    </div>
  ) : null;

  return { loading: false, pdfData: open, handleView, viewer };
}

// Lab result row — "View record →" inline with provider/date
function LabResultRow({ lab, record, onDelete, onEdit }: { lab: LabResult; record: MedicalRecord | null; onDelete?: (id: string) => void; onEdit?: (lab: LabResult) => void }) {
  const { loading, pdfData, handleView, viewer } = usePdfViewer(record?.id);
  const status = getLabStatus(lab.value, lab.referenceMin, lab.referenceMax, lab.isFlagged);
  const color = getLabValueColor(status);

  return (
    <div className="py-1 border-b last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className={`text-base font-semibold ${color}`}>
          {lab.value} {lab.unit}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {onEdit && <button type="button" onClick={() => onEdit(lab)} className="p-1 rounded text-gray-400 hover:text-gray-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>}
          {onDelete && <button type="button" onClick={() => onDelete(lab.id)} className="p-1 rounded text-[#9b2c2c] hover:text-[#7a1f1f] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>}
          {lab.providerName && <span className="text-sm text-gray-400 hidden sm:inline">{lab.providerName}</span>}
          <span className="text-sm text-gray-400">{format(parseDate(lab.recordedAt), 'MMM d, yyyy')}</span>
          {record && (
            <button onClick={handleView} disabled={loading} className="text-xs text-gray-400 hover:text-primary transition-colors whitespace-nowrap">
              {loading ? 'Loading…' : pdfData ? 'Hide record ↑' : 'View record →'}
            </button>
          )}
        </div>
      </div>
      {viewer}
    </div>
  );
}

// Imaging "View record →" link (standalone, used below imaging cards)
function ViewRecordLink({ record }: { record: MedicalRecord }) {
  const { loading, pdfData, handleView, viewer } = usePdfViewer(record.id);
  return (
    <div>
      <button onClick={handleView} disabled={loading} className="text-xs text-gray-400 hover:text-primary transition-colors">
        {loading ? 'Loading…' : pdfData ? 'Hide record ↑' : 'View record →'}
      </button>
      {viewer}
    </div>
  );
}

export function LabsVitals({ embedded = false, pendingAddType, onAddHandled, scrollToTestName, scrollToImagingId }: {
  embedded?: boolean;
  pendingAddType?: 'lab' | 'vital' | 'imaging';
  onAddHandled?: () => void;
  scrollToTestName?: string;
  scrollToImagingId?: string;
}) {
  const { user } = useAuth();
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [imaging, setImaging] = useState<ImagingStudy[]>([]);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [labDialog, setLabDialog] = useState(false);
  const [vitalDialog, setVitalDialog] = useState(false);
  const [imagingDialog, setImagingDialog] = useState(false);
  const [appleDialog, setAppleDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  const [labTab, setLabTab] = useState('all');

  // Result filter (status + date range)
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const filterRef = useRef<HTMLDivElement>(null);
  const dateBounds = getDateBounds(dateFilter, customStart, customEnd);
  const filtersActive = statusFilter !== 'all' || dateFilter !== 'all';
  const clearFilters = () => { setStatusFilter('all'); setDateFilter('all'); setCustomStart(''); setCustomEnd(''); };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Edit mode — stores the id of the item being edited (null = adding new)
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  const [editingVitalId, setEditingVitalId] = useState<string | null>(null);
  const [editingImagingId, setEditingImagingId] = useState<string | null>(null);


  const [labForm, setLabForm] = useState({ testName: '', value: '', unit: '', referenceMin: '', referenceMax: '', recordedAt: '', providerName: '', notes: '' });
  const [vitalForm, setVitalForm] = useState({ type: 'WEIGHT' as VitalType, value: '', value2: '', unit: 'lbs', recordedAt: '', notes: '' });
  const [imagingForm, setImagingForm] = useState({ studyType: 'XRAY' as ImagingStudyType, bodyPart: '', studyDate: '', facility: '', radiologist: '', providerName: '', summary: '', notes: '' });
  const [appleJson, setAppleJson] = useState('');
  // Persisted acknowledgement: stores the last fingerprint the user dismissed
  const [acknowledgedFingerprint, setAcknowledgedFingerprint] = useState<string | null>(null);

  // Load stored acknowledgement once user is known
  useEffect(() => {
    if (user?.id) {
      const stored = localStorage.getItem(`fila-flagged-ack-${user.id}`);
      setAcknowledgedFingerprint(stored);
    }
  }, [user?.id]);

  const dismissWarning = useCallback((fingerprint: string) => {
    if (user?.id) {
      localStorage.setItem(`fila-flagged-ack-${user.id}`, fingerprint);
    }
    setAcknowledgedFingerprint(fingerprint);
  }, [user?.id]);

  const fetchAll = async () => {
    const [labData, vitalData, imagingData, recordData] = await Promise.all([
      api.get<{ results: LabResult[] }>('/labs/results'),
      api.get<{ vitals: Vital[] }>('/labs/vitals'),
      api.get<{ studies: ImagingStudy[] }>('/labs/imaging'),
      api.get<{ records: MedicalRecord[] }>('/records'),
    ]);
    setLabs(labData.results);
    setVitals(vitalData.vitals);
    setImaging(imagingData.studies);
    setRecords(recordData.records);
  };

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, []);

  useEffect(() => {
    if (pendingAddType) {
      if (pendingAddType === 'lab') setLabDialog(true);
      else if (pendingAddType === 'vital') setVitalDialog(true);
      else if (pendingAddType === 'imaging') setImagingDialog(true);
      onAddHandled?.();
    }
  }, [pendingAddType]);

  // Scroll to a specific lab test name
  const prevScrollToTestName = useRef<string | undefined>();
  useEffect(() => {
    if (!scrollToTestName || loading) return;
    if (scrollToTestName === prevScrollToTestName.current) return;
    prevScrollToTestName.current = scrollToTestName;
    setLabTab('labs');
    const slug = scrollToTestName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const timer = setTimeout(() => {
      const el = document.getElementById(`lab-${slug}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #244a73';
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollToTestName, loading]);

  // Scroll to a specific imaging study
  const prevScrollToImagingId = useRef<string | undefined>();
  useEffect(() => {
    if (!scrollToImagingId || loading) return;
    if (scrollToImagingId === prevScrollToImagingId.current) return;
    prevScrollToImagingId.current = scrollToImagingId;
    setLabTab('imaging');
    const timer = setTimeout(() => {
      const el = document.getElementById(`imaging-${scrollToImagingId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #244a73';
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollToImagingId, loading]);

  const flaggedLabs = labs.filter((l) => l.isFlagged);

  const submitLab = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = {
      testName: labForm.testName,
      value: Number(labForm.value),
      unit: labForm.unit,
      referenceMin: labForm.referenceMin ? Number(labForm.referenceMin) : undefined,
      referenceMax: labForm.referenceMax ? Number(labForm.referenceMax) : undefined,
      recordedAt: labForm.recordedAt,
      providerName: labForm.providerName || undefined,
      notes: labForm.notes || undefined,
    };
    try {
      if (editingLabId) {
        await api.put(`/labs/results/${editingLabId}`, payload);
        toast({ variant: 'success', title: 'Lab result updated' });
      } else {
        await api.post('/labs/results', payload);
        toast({ variant: 'success', title: 'Lab result added' });
      }
      await fetchAll();
      setLabDialog(false); setEditingLabId(null);
      setLabForm({ testName: '', value: '', unit: '', referenceMin: '', referenceMax: '', recordedAt: '', providerName: '', notes: '' });
    } catch (err) { toast({ variant: 'destructive', title: 'Failed', description: err instanceof Error ? err.message : '' }); }
    finally { setSaving(false); }
  };

  const submitVital = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = {
      type: vitalForm.type,
      value: Number(vitalForm.value),
      value2: vitalForm.value2 ? Number(vitalForm.value2) : undefined,
      unit: vitalForm.unit,
      recordedAt: vitalForm.recordedAt,
      notes: vitalForm.notes || undefined,
    };
    try {
      if (editingVitalId) {
        await api.put(`/labs/vitals/${editingVitalId}`, payload);
        toast({ variant: 'success', title: 'Vital updated' });
      } else {
        await api.post('/labs/vitals', payload);
        toast({ variant: 'success', title: 'Vital recorded' });
      }
      await fetchAll();
      setVitalDialog(false); setEditingVitalId(null);
      setVitalForm({ type: 'WEIGHT', value: '', value2: '', unit: 'lbs', recordedAt: '', notes: '' });
    } catch (err) { toast({ variant: 'destructive', title: 'Failed', description: err instanceof Error ? err.message : '' }); }
    finally { setSaving(false); }
  };

  const submitAppleHealth = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const parsed = JSON.parse(appleJson);
      const result = await api.post<{ message: string }>('/labs/apple-health', parsed);
      toast({ variant: 'success', title: 'Imported', description: result.message });
      await fetchAll(); setAppleDialog(false); setAppleJson('');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Import failed', description: err instanceof Error ? err.message : 'Invalid JSON format' });
    } finally { setSaving(false); }
  };

  const deleteLab = async (id: string) => {
    await api.delete(`/labs/results/${id}`);
    setLabs((prev) => prev.filter((l) => l.id !== id));
    toast({ title: 'Deleted' });
  };

  const deleteVital = async (id: string) => {
    await api.delete(`/labs/vitals/${id}`);
    setVitals((prev) => prev.filter((v) => v.id !== id));
    toast({ title: 'Deleted' });
  };

  const submitImaging = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = {
      studyType: imagingForm.studyType,
      bodyPart: imagingForm.bodyPart,
      studyDate: imagingForm.studyDate,
      facility: imagingForm.facility || undefined,
      radiologist: imagingForm.radiologist || undefined,
      providerName: imagingForm.providerName || undefined,
      summary: imagingForm.summary,
      notes: imagingForm.notes || undefined,
    };
    try {
      if (editingImagingId) {
        await api.put(`/labs/imaging/${editingImagingId}`, payload);
        toast({ variant: 'success', title: 'Imaging study updated' });
      } else {
        await api.post('/labs/imaging', payload);
        toast({ variant: 'success', title: 'Imaging study added' });
      }
      await fetchAll();
      setImagingDialog(false); setEditingImagingId(null);
      setImagingForm({ studyType: 'XRAY', bodyPart: '', studyDate: '', facility: '', radiologist: '', providerName: '', summary: '', notes: '' });
    } catch (err) { toast({ variant: 'destructive', title: 'Failed', description: err instanceof Error ? err.message : '' }); }
    finally { setSaving(false); }
  };

  const deleteImaging = async (id: string) => {
    await api.delete(`/labs/imaging/${id}`);
    setImaging((prev) => prev.filter((s) => s.id !== id));
    toast({ title: 'Deleted' });
  };

  const openEditLab = (lab: LabResult) => {
    setEditingLabId(lab.id);
    setLabForm({
      testName: lab.testName,
      value: String(lab.value),
      unit: lab.unit,
      referenceMin: lab.referenceMin != null ? String(lab.referenceMin) : '',
      referenceMax: lab.referenceMax != null ? String(lab.referenceMax) : '',
      recordedAt: format(parseDate(lab.recordedAt), 'yyyy-MM-dd'),
      providerName: lab.providerName ?? '',
      notes: lab.notes ?? '',
    });
    setLabDialog(true);
  };

  const openEditVital = (vital: Vital) => {
    setEditingVitalId(vital.id);
    setVitalForm({
      type: vital.type,
      value: String(vital.value),
      value2: vital.value2 != null ? String(vital.value2) : '',
      unit: vital.unit,
      recordedAt: format(parseDate(vital.recordedAt), 'yyyy-MM-dd'),
      notes: vital.notes ?? '',
    });
    setVitalDialog(true);
  };

  const openEditImaging = (study: ImagingStudy) => {
    setEditingImagingId(study.id);
    setImagingForm({
      studyType: study.studyType,
      bodyPart: study.bodyPart,
      studyDate: format(parseDate(study.studyDate), 'yyyy-MM-dd'),
      facility: study.facility ?? '',
      radiologist: study.radiologist ?? '',
      providerName: study.providerName ?? '',
      summary: study.summary,
      notes: study.notes ?? '',
    });
    setImagingDialog(true);
  };

  // Apply the result filter (status applies to labs only; date range applies to all three)
  const filteredLabs = labs.filter((l) => isWithinBounds(parseDate(l.recordedAt), dateBounds) && matchesStatusFilter(l, statusFilter));
  const filteredVitals = vitals.filter((v) => isWithinBounds(parseDate(v.recordedAt), dateBounds));
  const filteredImaging = imaging.filter((s) => isWithinBounds(parseDate(s.studyDate), dateBounds));

  // Group vitals by type for trend charts
  const vitalGroups = filteredVitals.reduce<Partial<Record<VitalType, Vital[]>>>((acc, v) => {
    (acc[v.type] ??= []).push(v);
    return acc;
  }, {});

  // Group labs by test name, sorted alphabetically
  const labGroups = filteredLabs.reduce<Record<string, LabResult[]>>((acc, l) => {
    (acc[l.testName] ??= []).push(l);
    return acc;
  }, {});
  const sortedLabEntries = Object.entries(labGroups)
    .sort(([a], [b]) => a.localeCompare(b));

  // Flagged test names (based on all labs, independent of the active filter): groups whose latest result is flagged
  const allLabGroups = labs.reduce<Record<string, LabResult[]>>((acc, l) => {
    (acc[l.testName] ??= []).push(l);
    return acc;
  }, {});
  const flaggedTestNames = Object.entries(allLabGroups)
    .filter(([, items]) => {
      const latest = items.reduce((a, b) => parseDate(a.recordedAt) > parseDate(b.recordedAt) ? a : b);
      return latest.isFlagged;
    })
    .map(([testName]) => testName)
    .sort((a, b) => a.localeCompare(b));

  // Fingerprint of current flagged set — banner re-appears when this changes
  const flaggedFingerprint = flaggedTestNames.join('|');
  const warningVisible = flaggedTestNames.length > 0 && flaggedFingerprint !== acknowledgedFingerprint;

  const addEntryDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2 text-white font-semibold disabled:opacity-100">
          <Plus className="h-4 w-4" /> Add Entry <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => setLabDialog(true)}>Lab Result</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setVitalDialog(true)}>Vital</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setImagingDialog(true)}>Imaging</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const noFilterMatchesNotice = (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
      <p className="text-sm font-medium text-gray-600">No results match your filters</p>
      <p className="text-xs text-gray-400 mt-1">Try adjusting the result status or date range.</p>
      <button type="button" onClick={clearFilters} className="mt-3 text-xs font-semibold text-[#457aab] hover:text-[#102a45] transition-colors">Clear filters</button>
    </div>
  );

  const innerContent = (
    <>
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-3xl font-bold text-gray-900">Test Results</h1>
            <p className="mt-1 text-sm md:text-lg text-gray-500">Track and visualize your health measurements over time</p>
          </div>
          <div className="flex gap-2 shrink-0">{addEntryDropdown}</div>
        </div>
      )}

      {warningVisible && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-base font-semibold text-amber-800">
              {flaggedTestNames.length} lab value{flaggedTestNames.length !== 1 ? 's' : ''} outside the normal range
            </p>
            <p className="text-sm text-amber-700 mt-1">
              {flaggedTestNames.join(' · ')}
            </p>
            <p className="text-sm text-amber-600 mt-1">These are flagged for your awareness. They are not a cause for alarm. Discuss them with your doctor.</p>
          </div>
          <button onClick={() => dismissWarning(flaggedFingerprint)} className="text-amber-500 hover:text-amber-700 shrink-0 mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}


      {loading ? (
        <SkeletonList />
      ) : (
        <Tabs value={labTab} onValueChange={setLabTab}>
          <div className="flex items-center gap-2 mb-6">
            <TabsList className="flex-1 grid grid-cols-4">
              <TabsTrigger value="all" className="text-xs px-1">All ({filteredVitals.length + filteredLabs.length + filteredImaging.length})</TabsTrigger>
              <TabsTrigger value="vitals" className="text-xs px-1">Vitals ({filteredVitals.length})</TabsTrigger>
              <TabsTrigger value="labs" className="text-xs px-1">Labs ({filteredLabs.length})</TabsTrigger>
              <TabsTrigger value="imaging" className="text-xs px-1">Imaging ({filteredImaging.length})</TabsTrigger>
            </TabsList>
            <div className="relative shrink-0" ref={filterRef}>
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                className={`relative h-10 w-10 flex items-center justify-center rounded-lg border transition-colors ${filtersActive ? 'border-[#457aab] bg-[#457aab]/10 text-[#102a45]' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                aria-label="Filter results"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {filtersActive && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#457aab]" />}
              </button>
              {filterOpen && (
                <div className="absolute top-full mt-1 right-0 z-50 w-64 rounded-lg border bg-white shadow-lg p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Result status</p>
                    <div className="flex gap-1.5">
                      {(['all', 'normal', 'abnormal'] as StatusFilter[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStatusFilter(s)}
                          className={`flex-1 text-xs font-medium px-2 py-1.5 rounded-md border transition-colors ${statusFilter === s ? 'border-[#457aab] bg-[#457aab]/10 text-[#102a45]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          {s === 'all' ? 'All' : s === 'normal' ? 'Normal' : 'Abnormal'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">Applies to lab results. "Abnormal" includes out-of-range and borderline values.</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date range</p>
                    <div className="space-y-1">
                      {(['all', '3m', '6m', '1y', 'custom'] as DateRangeFilter[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDateFilter(d)}
                          className={`w-full text-left text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${dateFilter === d ? 'border-[#457aab] bg-[#457aab]/10 text-[#102a45]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          {DATE_RANGE_LABELS[d]}
                        </button>
                      ))}
                    </div>
                    {dateFilter === 'custom' && (
                      <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">From</Label>
                          <Input
                            type="date"
                            value={customStart}
                            max={customEnd || undefined}
                            onChange={(e) => setCustomStart(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">To</Label>
                          <Input
                            type="date"
                            value={customEnd}
                            min={customStart || undefined}
                            onChange={(e) => setCustomEnd(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {filtersActive && (
                    <button type="button" onClick={clearFilters} className="text-xs font-medium text-[#457aab] hover:text-[#102a45] transition-colors">
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <TabsContent value="vitals">
            {vitals.length === 0 ? (
              <EmptyState icon={Activity} title="No vitals recorded" description="Track your weight, blood pressure, heart rate, and more. See trends over time to spot changes early." action={<Button onClick={() => setVitalDialog(true)} className="gap-2"><Plus className="h-4 w-4" />Record a vital</Button>} />
            ) : filteredVitals.length === 0 ? (
              noFilterMatchesNotice
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(Object.keys(vitalGroups) as VitalType[]).map((type) => {
                  const items = vitalGroups[type]!.sort((a, b) => parseDate(a.recordedAt).getTime() - parseDate(b.recordedAt).getTime());
                  const chartData = items.map((v) => ({ date: format(parseDate(v.recordedAt), 'MMM d'), value: v.value, value2: v.value2 }));

                  return (
                    <div key={type} className="rounded-lg border bg-white p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-gray-900">{VITAL_LABELS[type]}</h3>
                        <span className="text-xs text-gray-400">{items.length} result{items.length !== 1 ? 's' : ''}</span>
                      </div>
                      {items.length >= 2 && (
                        <div className="mb-3 h-28">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} width={30} />
                              <Tooltip
                                formatter={(v: number) => [`${v} ${VITAL_UNITS[type]}`, 'Value']}
                                separator=": "
                                itemStyle={{ color: '#102a45' }}
                              />
                              <Line type="monotone" dataKey="value" stroke="#102a45" strokeWidth={2} dot={{ r: 3, fill: '#102a45' }} />
                              {type === 'BLOOD_PRESSURE' && <Line type="monotone" dataKey="value2" stroke="#244a73" strokeWidth={2} dot={{ r: 3, fill: '#244a73' }} />}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <div className="space-y-1">
                        {items.slice().reverse().map((v) => (
                          <div key={v.id} className="flex items-center justify-between py-1 border-b last:border-0">
                            <span className="text-sm font-medium text-gray-900">
                              {type === 'BLOOD_PRESSURE' && v.value2 ? `${v.value}/${v.value2}` : v.value} {v.unit}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">{format(parseDate(v.recordedAt), 'MMM d, yyyy')}</span>
                              <button type="button" onClick={() => openEditVital(v)} className="p-1 rounded text-gray-400 hover:text-gray-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                              <button type="button" onClick={() => deleteVital(v.id)} className="p-1 rounded text-[#9b2c2c] hover:text-[#7a1f1f] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="labs">
            {labs.length === 0 ? (
              <EmptyState icon={Activity} title="No lab results yet" description="Add lab results manually, or upload PDF lab reports in the Records section. Values are extracted automatically." action={<Button onClick={() => setLabDialog(true)} className="gap-2"><Plus className="h-4 w-4" />Add lab result</Button>} />
            ) : filteredLabs.length === 0 ? (
              noFilterMatchesNotice
            ) : (
              <div className="space-y-4">
                {sortedLabEntries.map(([testName, items]) => {
                  const sorted = items.sort((a, b) => parseDate(a.recordedAt).getTime() - parseDate(b.recordedAt).getTime());
                  const chartData = sorted.map((l) => ({ date: format(parseDate(l.recordedAt), 'MMM d'), value: l.value }));
                  const latest = sorted[sorted.length - 1];
                  const latestStatus = getLabStatus(latest.value, latest.referenceMin, latest.referenceMax, latest.isFlagged);
                  return (
                    <div key={testName} id={`lab-${testName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className={`rounded-lg border bg-white p-3 ${getLabCardBorder(latestStatus)}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="labReport" className="text-xs">Lab Report</Badge>
                          <h3 className="text-sm font-semibold text-gray-900">{testName}</h3>
                          <LabStatusBadge status={latestStatus} />
                        </div>
                        <span className="text-xs text-gray-400">{items.length} result{items.length !== 1 ? 's' : ''}</span>
                      </div>
                      {latest.referenceMin != null && latest.referenceMax != null ? (
                        <p className="text-xs text-gray-500 mb-2">Reference range: <span className="font-medium">{latest.referenceMin} – {latest.referenceMax} {latest.unit}</span></p>
                      ) : (
                        <p className="text-xs text-gray-400 mb-2">No reference range on file</p>
                      )}
                      {sorted.length >= 2 && (
                        <div className="mb-3 h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                              <YAxis tick={{ fontSize: 12 }} />
                              <Tooltip formatter={(v: number) => [`${v} ${latest.unit}`, testName]} separator=": " />
                              <Line type="monotone" dataKey="value" stroke={getLabChartColor(latestStatus)} strokeWidth={2} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <div>
                        {sorted.slice().reverse().map((l) => (
                          <LabResultRow
                            key={l.id}
                            lab={l}
                            record={l.sourceRecordId ? (records.find(r => r.id === l.sourceRecordId) ?? null) : null}
                            onDelete={!l.sourceRecordId ? deleteLab : undefined}
                            onEdit={!l.sourceRecordId ? openEditLab : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="imaging">
            {imaging.length === 0 ? (
              <EmptyState icon={Scan} title="No imaging studies" description="Add radiology reports, ultrasounds, MRIs, and other imaging studies. A summary of findings is stored for each." action={<Button onClick={() => setImagingDialog(true)} className="gap-2"><Plus className="h-4 w-4" />Add imaging study</Button>} />
            ) : filteredImaging.length === 0 ? (
              noFilterMatchesNotice
            ) : (
              <div className="space-y-4">
                {filteredImaging.map((study) => {
                  const sourceRecord = study.sourceRecordId ? records.find(r => r.id === study.sourceRecordId) : null;
                  return (
                    <div key={study.id} id={`imaging-${study.id}`} className="rounded-lg border bg-white p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <Badge variant="imaging" className="text-xs">Imaging</Badge>
                            <h3 className="text-sm font-semibold text-gray-900">
                              {study.description ?? IMAGING_TYPE_LABELS[study.studyType]}
                            </h3>
                            <span className="text-xs text-gray-500">— {toTitleCase(study.bodyPart)}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                            <span>{format(parseDate(study.studyDate), 'MMM d, yyyy')}</span>
                            {study.facility && <span>{study.facility}</span>}
                            {study.radiologist && <span>Read by {study.radiologist}</span>}
                            {study.providerName && <span>Ordered by {study.providerName}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!study.sourceRecordId && <button type="button" onClick={() => openEditImaging(study)} className="p-1.5 rounded text-gray-400 hover:text-gray-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>}
                          <button type="button" onClick={() => deleteImaging(study.id)} className="p-1.5 rounded text-[#9b2c2c] hover:text-[#7a1f1f] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <div className="rounded-md bg-gray-50 border p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Summary of Findings</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{study.summary}</p>
                      </div>
                      {study.notes && <p className="mt-1.5 text-xs text-gray-400">{study.notes}</p>}
                      {sourceRecord && <div className="mt-2"><ViewRecordLink record={sourceRecord} /></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all">
            {vitals.length === 0 && labs.length === 0 && imaging.length === 0 ? (
              <EmptyState icon={Activity} title="No entries yet" description="Add vitals, lab results, or imaging studies to see them here." action={<Button onClick={() => setLabDialog(true)} className="gap-2"><Plus className="h-4 w-4" />Add entry</Button>} />
            ) : filteredVitals.length === 0 && filteredLabs.length === 0 && filteredImaging.length === 0 ? (
              noFilterMatchesNotice
            ) : (
              <div className="space-y-6">
                {filteredVitals.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold text-gray-500 uppercase tracking-wide mb-3">Vitals</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {(Object.keys(vitalGroups) as VitalType[]).map((type) => {
                        const items = vitalGroups[type]!.sort((a, b) => parseDate(a.recordedAt).getTime() - parseDate(b.recordedAt).getTime());
                        const chartData = items.map((v) => ({ date: format(parseDate(v.recordedAt), 'MMM d'), value: v.value, value2: v.value2 }));
                        return (
                          <div key={type} className="rounded-lg border bg-white p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="text-base font-semibold text-gray-900">{VITAL_LABELS[type]}</h3>
                              <span className="text-xs text-gray-400">{items.length} result{items.length !== 1 ? 's' : ''}</span>
                            </div>
                            {items.length >= 2 && (
                              <div className="mb-3 h-28">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} width={30} />
                                    <Tooltip
                                      formatter={(v: number) => [`${v} ${VITAL_UNITS[type]}`, 'Value']}
                                      separator=": "
                                      itemStyle={{ color: '#102a45' }}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="#102a45" strokeWidth={2} dot={{ r: 3, fill: '#102a45' }} />
                                    {type === 'BLOOD_PRESSURE' && <Line type="monotone" dataKey="value2" stroke="#244a73" strokeWidth={2} dot={{ r: 3, fill: '#244a73' }} />}
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                            <div className="space-y-1">
                              {items.slice().reverse().map((v) => (
                                <div key={v.id} className="flex items-center justify-between py-1 border-b last:border-0">
                                  <span className="text-sm font-medium text-gray-900">
                                    {type === 'BLOOD_PRESSURE' && v.value2 ? `${v.value}/${v.value2}` : v.value} {v.unit}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">{format(parseDate(v.recordedAt), 'MMM d, yyyy')}</span>
                                    <button type="button" onClick={() => openEditVital(v)} className="p-1 rounded text-gray-400 hover:text-gray-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                                    <button type="button" onClick={() => deleteVital(v.id)} className="p-1 rounded text-[#9b2c2c] hover:text-[#7a1f1f] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filteredLabs.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold text-gray-500 uppercase tracking-wide mb-3">Lab Results</h2>
                    <div className="space-y-4">
                      {sortedLabEntries.map(([testName, items]) => {
                        const sorted = items.sort((a, b) => parseDate(a.recordedAt).getTime() - parseDate(b.recordedAt).getTime());
                        const chartData = sorted.map((l) => ({ date: format(parseDate(l.recordedAt), 'MMM d'), value: l.value }));
                        const latest = sorted[sorted.length - 1];
                        const latestStatus = getLabStatus(latest.value, latest.referenceMin, latest.referenceMax, latest.isFlagged);
                        return (
                          <div key={testName} className={`rounded-lg border bg-white p-4 ${getLabCardBorder(latestStatus)}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-lg font-semibold text-gray-900">{testName}</h3>
                                <LabStatusBadge status={latestStatus} />
                              </div>
                              <span className="text-sm text-gray-400">{items.length} result{items.length !== 1 ? 's' : ''}</span>
                            </div>
                            {latest.referenceMin != null && latest.referenceMax != null ? (
                              <p className="text-sm text-gray-500 mb-2">Reference range: <span className="font-medium">{latest.referenceMin} – {latest.referenceMax} {latest.unit}</span></p>
                            ) : (
                              <p className="text-sm text-gray-400 mb-2">No reference range on file</p>
                            )}
                            {sorted.length >= 2 && (
                              <div className="mb-3 h-40">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 12 }} />
                                    <Tooltip formatter={(v: number) => [`${v} ${latest.unit}`, testName]} separator=": " />
                                    <Line type="monotone" dataKey="value" stroke={getLabChartColor(latestStatus)} strokeWidth={2} dot={{ r: 4 }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                            <div>
                              {sorted.slice().reverse().map((l) => (
                                <LabResultRow
                                  key={l.id}
                                  lab={l}
                                  record={l.sourceRecordId ? (records.find(r => r.id === l.sourceRecordId) ?? null) : null}
                                  onDelete={!l.sourceRecordId ? deleteLab : undefined}
                                  onEdit={!l.sourceRecordId ? openEditLab : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filteredImaging.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold text-gray-500 uppercase tracking-wide mb-3">Imaging</h2>
                    <div className="space-y-4">
                      {filteredImaging.map((study) => {
                        const sourceRecord = study.sourceRecordId ? records.find(r => r.id === study.sourceRecordId) : null;
                        return (
                          <div key={study.id} className="rounded-lg border bg-white p-3">
                            <div className="flex items-start justify-between mb-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                  <Badge variant="imaging" className="text-xs">Imaging</Badge>
                                  <h3 className="text-sm font-semibold text-gray-900">
                                    {study.description ?? IMAGING_TYPE_LABELS[study.studyType]}
                                  </h3>
                                  <span className="text-xs text-gray-500">— {toTitleCase(study.bodyPart)}</span>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                                  <span>{format(parseDate(study.studyDate), 'MMM d, yyyy')}</span>
                                  {study.facility && <span>{study.facility}</span>}
                                  {study.radiologist && <span>Read by {study.radiologist}</span>}
                                  {study.providerName && <span>Ordered by {study.providerName}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {!study.sourceRecordId && <button type="button" onClick={() => openEditImaging(study)} className="p-1.5 rounded text-gray-400 hover:text-gray-600 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>}
                                <button type="button" onClick={() => deleteImaging(study.id)} className="p-1.5 rounded text-[#9b2c2c] hover:text-[#7a1f1f] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </div>
                            <div className="rounded-md bg-gray-50 border p-3">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Summary of Findings</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{study.summary}</p>
                            </div>
                            {study.notes && <p className="mt-1.5 text-xs text-gray-400">{study.notes}</p>}
                            {sourceRecord && <div className="mt-2"><ViewRecordLink record={sourceRecord} /></div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Lab Dialog */}
      <Dialog open={labDialog} onOpenChange={(open) => { setLabDialog(open); if (!open) { setEditingLabId(null); setLabForm({ testName: '', value: '', unit: '', referenceMin: '', referenceMax: '', recordedAt: '', providerName: '', notes: '' }); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingLabId ? 'Edit Lab Result' : 'Add Lab Result'}</DialogTitle></DialogHeader>
          <form onSubmit={submitLab} className="space-y-4">
            <div className="space-y-2"><Label>Test Name</Label><Input value={labForm.testName} onChange={(e) => setLabForm((f) => ({ ...f, testName: e.target.value }))} required placeholder="Ferritin, TSH, HbA1c" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Value</Label><Input type="number" step="any" value={labForm.value} onChange={(e) => setLabForm((f) => ({ ...f, value: e.target.value }))} required placeholder="12.4" /></div>
              <div className="space-y-2"><Label>Unit</Label><Input value={labForm.unit} onChange={(e) => setLabForm((f) => ({ ...f, unit: e.target.value }))} required placeholder="ng/mL" /></div>
              <div className="space-y-2"><Label>Normal Min</Label><Input type="number" step="any" value={labForm.referenceMin} onChange={(e) => setLabForm((f) => ({ ...f, referenceMin: e.target.value }))} placeholder="12" /></div>
              <div className="space-y-2"><Label>Normal Max</Label><Input type="number" step="any" value={labForm.referenceMax} onChange={(e) => setLabForm((f) => ({ ...f, referenceMax: e.target.value }))} placeholder="150" /></div>
            </div>
            <div className="space-y-2"><Label>Date Tested</Label><Input type="date" value={labForm.recordedAt} onChange={(e) => setLabForm((f) => ({ ...f, recordedAt: e.target.value }))} required /></div>
            <div className="space-y-2"><Label>Provider</Label><Input value={labForm.providerName} onChange={(e) => setLabForm((f) => ({ ...f, providerName: e.target.value }))} placeholder="Dr. Smith" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setLabDialog(false); setEditingLabId(null); setLabForm({ testName: '', value: '', unit: '', referenceMin: '', referenceMax: '', recordedAt: '', providerName: '', notes: '' }); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingLabId ? 'Save changes' : 'Add result'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Vital Dialog */}
      <Dialog open={vitalDialog} onOpenChange={(open) => { setVitalDialog(open); if (!open) { setEditingVitalId(null); setVitalForm({ type: 'WEIGHT', value: '', value2: '', unit: 'lbs', recordedAt: '', notes: '' }); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingVitalId ? 'Edit Vital' : 'Record a Vital'}</DialogTitle></DialogHeader>
          <form onSubmit={submitVital} className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={vitalForm.type} onValueChange={(v) => setVitalForm((f) => ({ ...f, type: v as VitalType, unit: VITAL_UNITS[v as VitalType] }))} disabled={!!editingVitalId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(VITAL_LABELS) as VitalType[]).map((t) => <SelectItem key={t} value={t}>{VITAL_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{vitalForm.type === 'BLOOD_PRESSURE' ? 'Systolic' : 'Value'}</Label><Input type="number" step="any" value={vitalForm.value} onChange={(e) => setVitalForm((f) => ({ ...f, value: e.target.value }))} required /></div>
              {vitalForm.type === 'BLOOD_PRESSURE' ? (
                <div className="space-y-2"><Label>Diastolic</Label><Input type="number" step="any" value={vitalForm.value2} onChange={(e) => setVitalForm((f) => ({ ...f, value2: e.target.value }))} /></div>
              ) : (
                <div className="space-y-2"><Label>Unit</Label><Input value={vitalForm.unit} onChange={(e) => setVitalForm((f) => ({ ...f, unit: e.target.value }))} required /></div>
              )}
            </div>
            <div className="space-y-2"><Label>Date Recorded</Label><Input type="date" value={vitalForm.recordedAt} onChange={(e) => setVitalForm((f) => ({ ...f, recordedAt: e.target.value }))} required /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={vitalForm.notes} onChange={(e) => setVitalForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Fasting, resting" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setVitalDialog(false); setEditingVitalId(null); setVitalForm({ type: 'WEIGHT', value: '', value2: '', unit: 'lbs', recordedAt: '', notes: '' }); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingVitalId ? 'Save changes' : 'Record vital'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Imaging Dialog */}
      <Dialog open={imagingDialog} onOpenChange={(open) => { setImagingDialog(open); if (!open) { setEditingImagingId(null); setImagingForm({ studyType: 'XRAY', bodyPart: '', studyDate: '', facility: '', radiologist: '', providerName: '', summary: '', notes: '' }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingImagingId ? 'Edit Imaging Study' : 'Add Imaging Study'}</DialogTitle></DialogHeader>
          <form onSubmit={submitImaging} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Study Type</Label>
                <Select value={imagingForm.studyType} onValueChange={(v) => setImagingForm((f) => ({ ...f, studyType: v as ImagingStudyType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(IMAGING_TYPE_LABELS) as ImagingStudyType[]).map((t) => <SelectItem key={t} value={t}>{IMAGING_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Body Part / Region</Label><Input value={imagingForm.bodyPart} onChange={(e) => setImagingForm((f) => ({ ...f, bodyPart: e.target.value }))} required placeholder="Chest, Left knee" /></div>
            </div>
            <div className="space-y-2"><Label>Study Date</Label><Input type="date" value={imagingForm.studyDate} onChange={(e) => setImagingForm((f) => ({ ...f, studyDate: e.target.value }))} required /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Facility</Label><Input value={imagingForm.facility} onChange={(e) => setImagingForm((f) => ({ ...f, facility: e.target.value }))} placeholder="City Imaging Center" /></div>
              <div className="space-y-2"><Label>Radiologist</Label><Input value={imagingForm.radiologist} onChange={(e) => setImagingForm((f) => ({ ...f, radiologist: e.target.value }))} placeholder="Dr. Name" /></div>
            </div>
            <div className="space-y-2"><Label>Ordering Provider</Label><Input value={imagingForm.providerName} onChange={(e) => setImagingForm((f) => ({ ...f, providerName: e.target.value }))} placeholder="Dr. Name" /></div>
            <div className="space-y-2"><Label>Summary of Findings</Label><Textarea value={imagingForm.summary} onChange={(e) => setImagingForm((f) => ({ ...f, summary: e.target.value }))} required rows={4} placeholder="Paste or type the radiologist's summary of findings" /></div>
            <div className="space-y-2"><Label>Additional Notes</Label><Input value={imagingForm.notes} onChange={(e) => setImagingForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Any additional context" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setImagingDialog(false); setEditingImagingId(null); setImagingForm({ studyType: 'XRAY', bodyPart: '', studyDate: '', facility: '', radiologist: '', providerName: '', summary: '', notes: '' }); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingImagingId ? 'Save changes' : 'Add study'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Apple Health Dialog */}
      <Dialog open={appleDialog} onOpenChange={setAppleDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import Apple Health Data</DialogTitle></DialogHeader>
          <form onSubmit={submitAppleHealth} className="space-y-4">
            <p className="text-base text-gray-600">Paste your Apple Health export JSON. Expected format:</p>
            <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto">{`{ "data": [
  { "type": "heart_rate", "value": 72, "unit": "bpm", "startDate": "2024-01-15" },
  { "type": "weight", "value": 165, "unit": "lbs", "startDate": "2024-01-15" }
]}`}</pre>
            <div className="space-y-2"><Label>JSON data</Label><Textarea value={appleJson} onChange={(e) => setAppleJson(e.target.value)} rows={6} placeholder="Paste your Apple Health export JSON here" required /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAppleDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Importing' : 'Import data'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return innerContent;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {innerContent}
    </div>
  );
}
