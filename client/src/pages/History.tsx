import { parseDate } from '@/lib/utils';
import { useEffect, useState, useMemo, useRef, FormEvent } from 'react';
import { usePdfWidth } from '@/hooks/usePdfWidth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Medications } from './Medications';
import { LabsVitals } from './LabsVitals';
import { Plus, Pencil, Trash2, History as HistoryIcon, FileText, Lightbulb, X, Calendar, ChevronLeft, ChevronRight, Search, ChevronDown } from 'lucide-react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '@/lib/pdfWorker';
import { api } from '@/api/client';
import { MedicalHistoryEntry, HistoryCategory, MedicalRecord, HealthInsightReport, InsightItem, LabResult, ImagingStudy } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { format } from 'date-fns';

const CATEGORY_LABELS: Record<HistoryCategory, string> = {
  CONDITION: 'Condition',
  MEDICATION: 'Medication',
  SUPPLEMENT: 'Supplement',
  ALLERGY: 'Allergy',
  SURGERY: 'Surgery',
  VACCINATION: 'Vaccination',
  FAMILY_HISTORY: 'Family History',
};

const CATEGORY_COLORS: Record<HistoryCategory, string> = {
  CONDITION:      'bg-[#e6f0fa] border-[#225380]/25',
  MEDICATION:     'bg-[#c2dcf0] border-[#0a2238]/25',
  SUPPLEMENT:     'bg-[#d4e8f7] border-[#0c2d5c]/20',
  ALLERGY:        'bg-[#fff9f9] border-[#9b2c2c]/20',
  SURGERY:        'bg-[#c2dcf0] border-[#0f3352]/20',
  VACCINATION:    'bg-[#e6f0fa] border-[#07214a]/20',
  FAMILY_HISTORY: 'bg-[#e6f0fa] border-[#102a45]/15',
};

// Dot color on the timeline line
const CATEGORY_DOT: Record<HistoryCategory, string> = {
  CONDITION: 'bg-[#96bddb]',
  MEDICATION: 'bg-[#578bb8]',
  SUPPLEMENT: 'bg-[#0c2d5c]',
  ALLERGY: 'bg-[#9b2c2c]',
  SURGERY: 'bg-[#6b9cc4]',
  VACCINATION: 'bg-[#07214a]',
  FAMILY_HISTORY: 'bg-[#245282]',
};

const CATEGORY_BADGE_VARIANTS: Record<HistoryCategory, 'destructive' | 'info' | 'warning' | 'success' | 'secondary' | 'outline' | 'medication' | 'supplement' | 'condition' | 'surgery' | 'vaccination' | 'dark'> = {
  CONDITION: 'condition',
  MEDICATION: 'medication',
  SUPPLEMENT: 'supplement',
  ALLERGY: 'warning',
  SURGERY: 'surgery',
  VACCINATION: 'vaccination',
  FAMILY_HISTORY: 'dark',
};

// Categories shown prominently on the timeline
const TIMELINE_PRIORITY: HistoryCategory[] = ['SURGERY', 'CONDITION', 'ALLERGY', 'VACCINATION', 'MEDICATION', 'FAMILY_HISTORY'];

// Verbs shown on the timeline card for start and end events
const START_VERBS: Record<HistoryCategory, string> = {
  MEDICATION:     'Started',
  SUPPLEMENT:     'Started',
  CONDITION:      'Diagnosed',
  ALLERGY:        'Identified',
  SURGERY:        'Surgery',
  VACCINATION:    'Vaccinated',
  FAMILY_HISTORY: 'Family history',
};

const END_VERBS: Record<HistoryCategory, string> = {
  MEDICATION:     'Discontinued',
  SUPPLEMENT:     'Discontinued',
  CONDITION:      'Resolved',
  ALLERGY:        'Resolved',
  SURGERY:        'Recovered',
  VACCINATION:    'Vaccination ended',
  FAMILY_HISTORY: 'Family history ended',
};

// Canonical casing for medical units keyed by their lowercase form.
// Lowercase: mg, mcg, ml, g, kg, l, dl, mmol, nmol, pmol, mcmol, mol
// Uppercase: IU, DNA, RNA
// Mixed:     mEq, mOsm, mmHg, mcg/kg, mg/dl, mg/kg
const UNIT_CANONICAL: Record<string, string> = {
  mg: 'mg', mcg: 'mcg', ml: 'ml', g: 'g', kg: 'kg',
  l: 'L', dl: 'dL', 'mg/dl': 'mg/dL', 'mg/kg': 'mg/kg', 'mcg/kg': 'mcg/kg',
  mmol: 'mmol', nmol: 'nmol', pmol: 'pmol', mcmol: 'mcmol', mol: 'mol',
  iu: 'IU', meq: 'mEq', mosm: 'mOsm', mmhg: 'mmHg',
  tab: 'tab', tabs: 'tabs', cap: 'cap', caps: 'caps',
  tablet: 'tablet', capsule: 'capsule',
  patch: 'patch', spray: 'spray', drop: 'drop', puff: 'puff',
  unit: 'unit', units: 'units',
};

// Capitalises the first letter of each space-separated word while leaving the
// rest of each word's casing untouched (preserves "ADHD", "Raynaud's", etc.)
// Words after the first that match a known unit are replaced with canonical form.
const toTitleCase = (s: string) =>
  s.split(' ').map((w, i) => {
    if (w.length === 0) return w;
    const canonical = UNIT_CANONICAL[w.toLowerCase()];
    if (i > 0 && canonical) return canonical;
    return w[0].toUpperCase() + w.slice(1);
  }).join(' ');

// Sort entries: most-recent startDate first (no date → end), then A-Z by name
function sortEntries(a: MedicalHistoryEntry, b: MedicalHistoryEntry): number {
  const ta = a.startDate ? parseDate(a.startDate).getTime() : -Infinity;
  const tb = b.startDate ? parseDate(b.startDate).getTime() : -Infinity;
  if (tb !== ta) return tb - ta;
  return a.name.localeCompare(b.name);
}

// Format imaging study type for display
function formatStudyType(type: string): string {
  const map: Record<string, string> = {
    XRAY: 'X-Ray',
    MRI: 'MRI',
    CT_SCAN: 'CT Scan',
    ULTRASOUND: 'Ultrasound',
    PET_SCAN: 'PET Scan',
    MAMMOGRAM: 'Mammogram',
    ECHOCARDIOGRAM: 'Echocardiogram',
  };
  return map[type] ?? type;
}

// For OTHER type, bodyPart holds the specific study name (e.g. "ECG Stress Test").
// For all other types, show bodyPart as a subtitle.
function imagingTitle(study: ImagingStudy): string {
  if (study.description) return study.description;
  return study.studyType === 'OTHER' ? toTitleCase(study.bodyPart) : formatStudyType(study.studyType);
}
function imagingSubtitle(study: ImagingStudy): string | null {
  if (study.studyType === 'OTHER') return study.description ? toTitleCase(study.bodyPart) : null;
  return toTitleCase(study.bodyPart);
}

// Interpolates a dot color along the vertical line gradient
// #244a73 (top/newest) → #adcce6 (bottom/oldest)
function gradientDotColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  // #244a73 = rgb(36, 74, 115)
  // #adcce6 = rgb(173, 204, 230)
  const r = Math.round(36 + (173 - 36) * t);
  const g = Math.round(74 + (204 - 74) * t);
  const b = Math.round(115 + (230 - 115) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

type ResultStatus = 'abnormal' | 'borderline' | 'normal';

function getLabResultStatus(lab: LabResult): ResultStatus {
  if (lab.isFlagged) return 'abnormal';
  if (lab.referenceMin != null && lab.referenceMax != null) {
    const buffer = (lab.referenceMax - lab.referenceMin) * 0.05;
    if (lab.value <= lab.referenceMin + buffer || lab.value >= lab.referenceMax - buffer) return 'borderline';
  }
  return 'normal';
}

function getLabGroupStatus(labs: LabResult[]): ResultStatus {
  if (labs.some((l) => l.isFlagged)) return 'abnormal';
  if (labs.some((l) => getLabResultStatus(l) === 'borderline')) return 'borderline';
  return 'normal';
}

const NORMAL_PATTERN = /\b(normal|unremarkable|no evidence|within normal limits|\bwnl\b|no abnormal|no acute|no significant finding|no patholog)/i;
function getImagingStatus(study: ImagingStudy): ResultStatus | null {
  const text = [study.summary, study.notes].filter(Boolean).join(' ').trim();
  if (!text) return null;
  return NORMAL_PATTERN.test(text) ? 'normal' : 'abnormal';
}

// "Normal" = in-range only; borderline and out-of-range both read "Abnormal",
// distinguished by color (orange = borderline, red = out of range) — matches LabsVitals.
const STATUS_LABEL: Record<ResultStatus, string> = {
  abnormal: 'Abnormal',
  borderline: 'Abnormal',
  normal: 'Normal',
};

const STATUS_STYLE: Record<ResultStatus, { cardBg: string; cardBorder: string; dot: string; color: string; valueColor: string }> = {
  abnormal:  { cardBg: 'bg-[#fde8e8]', cardBorder: 'border-[#9b2c2c]', dot: 'bg-[#9b2c2c]',   color: '#9b2c2c', valueColor: 'text-[#9b2c2c]' },
  borderline:{ cardBg: 'bg-[#fdf3ec]', cardBorder: 'border-[#9c4221]', dot: 'bg-[#9c4221]',   color: '#9c4221', valueColor: 'text-[#9c4221]' },
  normal:    { cardBg: 'bg-white',    cardBorder: 'border-gray-200',  dot: 'bg-[#457aab]',   color: '#102a45', valueColor: 'text-gray-900' },
};

type EntryForm = {
  category: HistoryCategory;
  name: string;
  details: string;
  relative: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FORM: EntryForm = { category: 'CONDITION', name: '', details: '', relative: '', startDate: '', endDate: '' };

// Unified timeline item type
type TimelineItem =
  | { kind: 'entry'; subKind: 'start' | 'end'; data: MedicalHistoryEntry; date: Date | null }
  | { kind: 'labGroup'; data: LabResult[]; date: Date | null; sourceRecordId?: string }
  | { kind: 'imaging'; data: ImagingStudy; date: Date | null };

// ── Shared: Source Record card with click-to-view ─────────────────────────────
function SourceRecordCard({ record }: { record: MedicalRecord }) {
  const [open, setOpen] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pdfContainerRef, pdfWidth] = usePdfWidth(24);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [pdfBlobUrl]);

  const handleView = async () => {
    const opening = !open;
    setOpen(opening);
    setPage(1);
    setNumPages(0);
    if (opening && !pdfBlobUrl) {
      try {
        const blob = await api.blob(`/records/${record.id}/view`);
        setPdfBlobUrl(URL.createObjectURL(blob));
      } catch {
        setPdfError('Could not load PDF.');
      }
    }
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
      <button
        onClick={handleView}
        className="w-full text-left p-4 hover:bg-primary/10 transition-colors group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-medium text-gray-900 truncate">{record.fileName}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-sm text-gray-500">
              {record.providerName && <span>{record.providerName}</span>}
              {record.recordDate && <span>{format(parseDate(record.recordDate), 'MMM d, yyyy')}</span>}
              <span className="capitalize">{record.recordType.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-primary/20">
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
      )}
    </div>
  );
}

// ── Lab Report modal ─────────────────────────────────────────────────────────
function LabReportModal({
  labs,
  record,
  onClose,
}: {
  labs: LabResult[];
  record: MedicalRecord | null;
  onClose: () => void;
}) {
  const status = getLabGroupStatus(labs);
  const style = STATUS_STYLE[status];
  const date = labs[0]?.recordedAt ? parseDate(labs[0].recordedAt) : null;
  const provider = labs[0]?.providerName ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#d6e6f5] bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-heading font-semibold text-gray-900 leading-tight">
                Lab Tests
                <span className="font-normal" style={{ color: style.color }}>, {STATUS_LABEL[status]}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-gray-500">
                {date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(date, 'MMMM d, yyyy')}
                  </span>
                )}
                {provider && <span>{provider}</span>}
                <span>{labs.length} test{labs.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Results list — notable first, then normal */}
        {(() => {
          const statusOrder: Record<ResultStatus, number> = { abnormal: 0, borderline: 1, normal: 2 };
          const sorted = [...labs].sort((a, b) => statusOrder[getLabResultStatus(a)] - statusOrder[getLabResultStatus(b)]);
          const notable = sorted.filter((l) => getLabResultStatus(l) !== 'normal');
          const normal = sorted.filter((l) => getLabResultStatus(l) === 'normal');

          const renderLab = (lab: LabResult) => {
            const status = getLabResultStatus(lab);
            const style = STATUS_STYLE[status];
            return (
              <div
                key={lab.id}
                className={`rounded-xl border p-3.5 ${style.cardBorder} ${style.cardBg}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900 leading-snug">{lab.testName}</p>
                  <p className={`text-sm font-semibold shrink-0 ${style.valueColor}`}>
                    {lab.value} {lab.unit}
                  </p>
                </div>
                {(lab.referenceMin != null || lab.referenceMax != null) && (
                  <p className="text-xs text-gray-400 mt-1">
                    Ref: {lab.referenceMin ?? '—'} – {lab.referenceMax ?? '—'} {lab.unit}
                  </p>
                )}
                {lab.notes && <p className="text-xs text-gray-500 mt-0.5">{lab.notes}</p>}
              </div>
            );
          };

          return (
            <div className="px-6 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {notable.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-0.5">Notable Findings</p>
                  {notable.map(renderLab)}
                </>
              )}
              {normal.length > 0 && (
                <>
                  {notable.length > 0 && <div className="border-t border-gray-100 my-1" />}
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pb-0.5">Within Range</p>
                  {normal.map(renderLab)}
                </>
              )}
            </div>
          );
        })()}

        {/* Source record */}
        {record && (
          <div className="px-6 pb-4">
            <SourceRecordCard record={record} />
          </div>
        )}

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ── Imaging detail modal ──────────────────────────────────────────────────────
function ImagingDetailModal({
  study,
  record,
  onClose,
}: {
  study: ImagingStudy;
  record: MedicalRecord | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        {(() => {
          const imgStatus = getImagingStatus(study);
          const imgStyle = imgStatus ? STATUS_STYLE[imgStatus] : STATUS_STYLE.normal;
          return (
            <div className={`px-6 pt-6 pb-4 border-b ${imgStyle.cardBorder} ${imgStyle.cardBg}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-heading font-semibold text-gray-900 leading-tight">
                    {imagingTitle(study)}
                    {imgStatus && (
                      <span className="font-normal" style={{ color: imgStyle.color }}>, {STATUS_LABEL[imgStatus]}</span>
                    )}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-gray-500">
                    {imagingSubtitle(study) && <span>{imagingSubtitle(study)}</span>}
                    {study.studyDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(parseDate(study.studyDate), 'MMMM d, yyyy')}
                      </span>
                    )}
                    {study.facility && <span>{study.facility}</span>}
                    {study.providerName && <span>{study.providerName}</span>}
                    {study.radiologist && <span>Radiologist: {study.radiologist}</span>}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1.5 text-gray-400 hover:bg-white/60 hover:text-gray-700 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          );
        })()}

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {study.summary && (
            <p className="text-base text-gray-700 leading-relaxed">{study.summary}</p>
          )}
          {study.notes && (
            <p className="text-sm text-gray-500 leading-relaxed">{study.notes}</p>
          )}
          {!study.summary && !study.notes && (
            <p className="text-base text-gray-400 italic">No additional details recorded.</p>
          )}
        </div>

        {/* Source record */}
        {record && (
          <div className="px-6 pb-4">
            <SourceRecordCard record={record} />
          </div>
        )}

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ── Event detail modal ────────────────────────────────────────────────────────
function EventDetailModal({
  entry,
  record,
  insight,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: MedicalHistoryEntry;
  record: MedicalRecord | null;
  insight: InsightItem | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header band */}
        <div className={`px-6 pt-6 pb-4 border-b ${CATEGORY_COLORS[entry.category]}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Badge variant={CATEGORY_BADGE_VARIANTS[entry.category]} className="mb-2">
                {CATEGORY_LABELS[entry.category]}
              </Badge>
              <h2 className="text-xl font-heading font-semibold text-gray-900 leading-tight">{toTitleCase(entry.name)}</h2>
              {(entry.startDate || entry.endDate) && (
                <div className="flex items-center gap-1.5 mt-1.5 text-sm text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {entry.startDate ? format(parseDate(entry.startDate), 'MMMM d, yyyy') : 'Unknown start'}
                    {entry.endDate && ` — ${format(parseDate(entry.endDate), 'MMMM d, yyyy')}`}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-gray-400 hover:bg-white/60 hover:text-gray-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Details */}
          {entry.details && (
            <p className="text-base text-gray-700 leading-relaxed">{entry.details}</p>
          )}

          {/* Linked record */}
          {record && <SourceRecordCard record={record} />}

          {/* Related insight */}
          {insight && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold text-accent uppercase tracking-wide">Health Intelligence Insight</span>
              </div>
              <p
                className="text-xs italic mb-1"
                style={{ color: insight.confidence === 'high' ? '#9b2c2c' : insight.confidence === 'moderate' ? '#9c4221' : '#276749' }}
              >
                {insight.confidence === 'high' ? 'Confidence: Strong pattern' : insight.confidence === 'moderate' ? 'Confidence: Possible pattern' : 'Confidence: Weak signal'}
              </p>
              <p className="text-base font-medium text-gray-900 mb-1">{insight.title}</p>
              {insight.description && <p className="text-sm text-gray-600 leading-relaxed">{insight.description}</p>}
              {insight.supportingEvidence.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {insight.supportingEvidence.slice(0, 2).map((ev, i) => (
                    <div key={i} className="text-xs text-gray-500 bg-white/70 rounded-lg px-3 py-2 border border-accent/10">
                      {ev.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!record && !insight && !entry.details && (
            <p className="text-base text-gray-400 italic">No additional details recorded.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-2">
          <Button
            variant="outline" size="sm"
            onClick={onDelete}
            className="text-[#9b2c2c] border-[#9b2c2c]/30 hover:bg-[#9b2c2c] hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
function HealthTimeline({
  entries,
  records,
  insightReport,
  onEditEntry,
  onDeleteEntry,
  labs,
  imaging,
}: {
  entries: MedicalHistoryEntry[];
  records: MedicalRecord[];
  insightReport: HealthInsightReport | null;
  onEditEntry: (e: MedicalHistoryEntry) => void;
  onDeleteEntry: (id: string, name: string) => void;
  labs: LabResult[];
  imaging: ImagingStudy[];
}) {
  const [selected, setSelected] = useState<MedicalHistoryEntry | null>(null);
  const [selectedLabGroup, setSelectedLabGroup] = useState<LabResult[] | null>(null);
  const [selectedImaging, setSelectedImaging] = useState<ImagingStudy | null>(null);

  // Group labs by sourceRecordId so all results from the same panel become one card
  const labGroups: LabResult[][] = (() => {
    const map = new Map<string, LabResult[]>();
    for (const lab of labs) {
      const key = lab.sourceRecordId ?? `solo-${lab.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(lab);
    }
    return Array.from(map.values());
  })();

  // Build unified timeline items — entries with an endDate get two cards (start + end)
  const entryItems: TimelineItem[] = [];
  for (const e of entries) {
    entryItems.push({ kind: 'entry', subKind: 'start', data: e, date: e.startDate ? parseDate(e.startDate) : null });
    if (e.endDate) {
      entryItems.push({ kind: 'entry', subKind: 'end', data: e, date: parseDate(e.endDate) });
    }
  }

  const allItems: TimelineItem[] = [
    ...entryItems,
    ...labGroups.map((group): TimelineItem => ({
      kind: 'labGroup',
      data: group,
      date: group[0]?.recordedAt ? parseDate(group[0].recordedAt) : null,
      sourceRecordId: group[0]?.sourceRecordId,
    })),
    ...imaging.map((i): TimelineItem => ({
      kind: 'imaging',
      data: i,
      date: i.studyDate ? parseDate(i.studyDate) : null,
    })),
  ];

  // Sort descending by date; undated at end; then A-Z by name/title within same date
  const sorted = allItems.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    const diff = b.date.getTime() - a.date.getTime();
    if (diff !== 0) return diff;
    // Tiebreak: alphabetical by display name
    const nameA = a.kind === 'entry' ? a.data.name : a.kind === 'imaging' ? a.data.bodyPart : (a.data[0]?.testName ?? '');
    const nameB = b.kind === 'entry' ? b.data.name : b.kind === 'imaging' ? b.data.bodyPart : (b.data[0]?.testName ?? '');
    return nameA.localeCompare(nameB);
  });

  // Build a lookup: unique item key → global index in sorted order (for gradient dot coloring)
  const dotIndexMap = new Map<string, number>();
  sorted.forEach((item, i) => {
    const key =
      item.kind === 'entry'
        ? `entry-${item.data.id}-${item.subKind}`
        : item.kind === 'labGroup'
        ? `labGroup-${item.data[0]?.id}`
        : `imaging-${item.data.id}`;
    dotIndexMap.set(key, i);
  });
  const totalTimelineItems = sorted.length;

  // Group by year
  const groups: { year: string; items: TimelineItem[] }[] = [];
  for (const item of sorted) {
    const year = item.date ? String(item.date.getFullYear()) : 'Undated';
    const last = groups[groups.length - 1];
    if (last?.year === year) {
      last.items.push(item);
    } else {
      groups.push({ year, items: [item] });
    }
  }

  // Find linked record and insight for the selected entry
  const linkedRecord = selected?.sourceRecordId
    ? (records.find((r) => r.id === selected.sourceRecordId) ?? null)
    : null;

  const linkedInsight: InsightItem | null = (() => {
    if (!selected || !insightReport) return null;
    const needle = selected.name.toLowerCase();
    return (
      insightReport.insights.find(
        (ins) =>
          ins.title.toLowerCase().includes(needle) ||
          ins.relatedConditions.some((c) => c.toLowerCase().includes(needle)) ||
          needle.split(' ').some((w) => w.length > 3 && ins.title.toLowerCase().includes(w))
      ) ?? null
    );
  })();

  if (allItems.length === 0) return null;

  return (
    <>
      <div className="relative pl-8 space-y-0">
        {/* Continuous vertical line */}
        <div className="absolute left-3 top-3 bottom-3 w-0.5 bg-gradient-to-b from-[#244a73] via-[#adcce6] to-transparent rounded-full" />

        {groups.map((group) => (
          <div key={group.year}>
            {/* Year label */}
            <div className="relative flex items-center mb-4 mt-2">
              <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-b from-[#244a73] to-[#adcce6] shadow-sm">
                <Calendar className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-2xl font-heading font-semibold text-primary ml-2 leading-none">
                {group.year}
              </span>
            </div>

            {/* Events in this year */}
            <div className="space-y-3 mb-6">
              {group.items.map((item, ei) => {
                if (item.kind === 'entry') {
                  const entry = item.data;
                  const isEnd = item.subKind === 'end';
                  const dotKey = `entry-${entry.id}-${item.subKind}`;
                  const verb = isEnd ? END_VERBS[entry.category] : START_VERBS[entry.category];
                  return (
                    <div
                      key={dotKey}
                      id={!isEnd ? `condition-${entry.id}` : undefined}
                      className="relative flex items-start gap-4"
                    >
                      {/* Dot */}
                      <div
                        className="absolute -left-6 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full z-10 shrink-0"
                        style={{ backgroundColor: gradientDotColor(dotIndexMap.get(dotKey) ?? 0, totalTimelineItems) }}
                      />

                      {/* Card */}
                      <button
                        onClick={() => setSelected(entry)}
                        className="w-full text-left rounded-lg border border-gray-200 bg-white shadow-sm p-3 flex items-start gap-3 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <Badge
                            variant={entry.category === 'SUPPLEMENT' ? 'medication' : CATEGORY_BADGE_VARIANTS[entry.category]}
                            className="text-xs mb-1"
                          >
                            {entry.category === 'SUPPLEMENT' ? 'Medication' : CATEGORY_LABELS[entry.category]}
                          </Badge>
                          <p className="text-sm font-semibold text-gray-900">
                            <span className="text-gray-500 font-normal">{verb} </span>
                            {toTitleCase(entry.name)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {item.date && (
                            <p className="text-xs text-gray-500">{format(item.date, 'MMM d, yyyy')}</p>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                }

                if (item.kind === 'labGroup') {
                  const group = item.data;
                  const labStatus = getLabGroupStatus(group);
                  const labStyle = STATUS_STYLE[labStatus];
                  const provider = group[0]?.providerName;
                  const linkedRecord = item.sourceRecordId
                    ? (records.find((r) => r.id === item.sourceRecordId) ?? null)
                    : null;
                  return (
                    <div key={`labgroup-${group[0]?.id}`} className="relative flex items-start gap-4">
                      {/* Dot */}
                      <div
                        className="absolute -left-6 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full z-10 shrink-0"
                        style={{ backgroundColor: gradientDotColor(dotIndexMap.get(`labGroup-${group[0]?.id}`) ?? 0, totalTimelineItems) }}
                      />

                      {/* Card */}
                      <button
                        onClick={() => setSelectedLabGroup(group)}
                        className="w-full text-left rounded-lg border border-gray-200 bg-white p-3 flex items-start gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <Badge variant="testResults" className="text-xs mb-1">Test Result</Badge>
                          <p className="text-sm font-semibold text-gray-900">
                            Lab Tests<span className="font-normal" style={{ color: labStyle.color }}>, {STATUS_LABEL[labStatus]}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {group.length} test{group.length !== 1 ? 's' : ''}
                            {provider && ` · ${provider}`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {group[0]?.recordedAt && (
                            <p className="text-xs text-gray-500">{format(parseDate(group[0].recordedAt), 'MMM d, yyyy')}</p>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                }

                if (item.kind === 'imaging') {
                  const study = item.data;
                  const imgStatus = getImagingStatus(study);
                  const imgStyle = imgStatus ? STATUS_STYLE[imgStatus] : { cardBg: 'bg-[#d6e6f5]', cardBorder: 'border-[#457aab]', dot: 'bg-[#457aab]', color: '#244a73' };
                  return (
                    <div key={`imaging-${study.id}`} className="relative flex items-start gap-4">
                      {/* Dot */}
                      <div
                        className="absolute -left-6 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full z-10 shrink-0"
                        style={{ backgroundColor: gradientDotColor(dotIndexMap.get(`imaging-${study.id}`) ?? 0, totalTimelineItems) }}
                      />

                      {/* Card */}
                      <button
                        onClick={() => setSelectedImaging(study)}
                        className="w-full text-left rounded-lg border border-gray-200 bg-white p-3 flex items-start gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <Badge variant="testResults" className="text-xs mb-1">Test Result</Badge>
                          <p className="text-sm font-semibold text-gray-900">
                            {imagingTitle(study)}
                            {imgStatus && <span className="font-normal" style={{ color: imgStyle.color }}>, {STATUS_LABEL[imgStatus]}</span>}
                          </p>
                          {(imagingSubtitle(study) || study.facility || study.providerName) && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {[imagingSubtitle(study), study.facility ?? study.providerName].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {study.studyDate && <p className="text-xs text-gray-500">{format(parseDate(study.studyDate), 'MMM d, yyyy')}</p>}
                        </div>
                      </button>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Event detail popup */}
      {selected && (
        <EventDetailModal
          entry={selected}
          record={linkedRecord}
          insight={linkedInsight}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setSelected(null);
            onEditEntry(selected);
          }}
          onDelete={() => {
            onDeleteEntry(selected.id, selected.name);
            setSelected(null);
          }}
        />
      )}

      {/* Lab report popup */}
      {selectedLabGroup && (
        <LabReportModal
          labs={selectedLabGroup}
          record={
            selectedLabGroup[0]?.sourceRecordId
              ? (records.find((r) => r.id === selectedLabGroup[0].sourceRecordId) ?? null)
              : null
          }
          onClose={() => setSelectedLabGroup(null)}
        />
      )}

      {/* Imaging popup */}
      {selectedImaging && (
        <ImagingDetailModal
          study={selectedImaging}
          record={
            selectedImaging.sourceRecordId
              ? (records.find((r) => r.id === selectedImaging.sourceRecordId) ?? null)
              : null
          }
          onClose={() => setSelectedImaging(null)}
        />
      )}
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export function History() {
  const [entries, setEntries] = useState<MedicalHistoryEntry[]>([]);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [insightReport, setInsightReport] = useState<HealthInsightReport | null>(null);
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [imaging, setImaging] = useState<ImagingStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLabGroup, setSelectedLabGroup] = useState<LabResult[] | null>(null);
  const [selectedImaging, setSelectedImaging] = useState<ImagingStudy | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalHistoryEntry | null>(null);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchEntries = async () => {
    const data = await api.get<{ entries: MedicalHistoryEntry[] }>('/history');
    setEntries(data.entries);
  };

  useEffect(() => {
    Promise.all([
      api.get<{ entries: MedicalHistoryEntry[] }>('/history').then((d) => setEntries(d.entries)),
      api.get<{ records: MedicalRecord[] }>('/records').then((d) => setRecords(d.records)),
      api.get<{ reports: HealthInsightReport[] }>('/insights').then((d) => {
        if (d.reports.length > 0) setInsightReport(d.reports[0]);
      }),
      api.get<{ results: LabResult[] }>('/labs/results').then((d) => setLabs(d.results)),
      api.get<{ studies: ImagingStudy[] }>('/labs/imaging').then((d) => setImaging(d.studies)),
    ]).finally(() => setLoading(false));
  }, []);

  const conditions = entries.filter(e => e.category === 'CONDITION');
  const familyHistory = entries.filter(e => e.category === 'FAMILY_HISTORY');
  const [selectedCondition, setSelectedCondition] = useState<MedicalHistoryEntry | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrollToLabTestName, setScrollToLabTestName] = useState<string | null>(null);
  const [scrollToImagingId, setScrollToImagingId] = useState<string | null>(null);
  const [scrollToMedId, setScrollToMedId] = useState<string | null>(null);
  const [scrollToConditionId, setScrollToConditionId] = useState<string | null>(null);
  const [pendingMedAdd, setPendingMedAdd] = useState<'MEDICATION' | 'SUPPLEMENT' | null>(null);
  const [pendingLabsAdd, setPendingLabsAdd] = useState<'lab' | 'vital' | 'imaging' | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'timeline') as 'timeline' | 'conditions' | 'medications' | 'test-results' | 'family-history';

  const switchTab = (tab: 'timeline' | 'conditions' | 'medications' | 'test-results' | 'family-history') => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('tab', tab); return next; }, { replace: true });
  };

  const openNewWithCategory = (category: HistoryCategory) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category });
    setDialogOpen(true);
  };

  // Categories that have a dedicated edit page: redirect there.
  // Categories without one (Condition, Allergy, etc.) use the inline dialog.
  const CATEGORY_EDIT_ROUTES: Partial<Record<HistoryCategory, (id: string) => string>> = {
    MEDICATION: (id) => `/history?tab=medications&edit=${id}`,
  };

  const openEdit = (e: MedicalHistoryEntry) => {
    const routeFn = CATEGORY_EDIT_ROUTES[e.category];
    if (routeFn) {
      navigate(routeFn(e.id));
      return;
    }
    setEditing(e);
    setForm({
      category: e.category,
      name: e.name,
      details: e.details ?? '',
      relative: e.relative ?? '',
      startDate: e.startDate ? format(parseDate(e.startDate), 'yyyy-MM-dd') : '',
      endDate: e.endDate ? format(parseDate(e.endDate), 'yyyy-MM-dd') : '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        // When editing, send null for cleared optional fields so Prisma clears them
        const payload = {
          ...form,
          details: form.details || null,
          relative: form.relative || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        };
        await api.patch(`/history/${editing.id}`, payload);
        toast({ variant: 'success', title: 'Entry updated' });
      } else {
        const payload = {
          ...form,
          details: form.details || undefined,
          relative: form.relative || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        };
        await api.post('/history', payload);
        toast({ variant: 'success', title: 'Entry added' });
      }
      await fetchEntries();
      setDialogOpen(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from your history?`)) return;
    await api.delete(`/history/${id}`);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast({ title: 'Entry removed' });
  };

  useEffect(() => {
    if (!scrollToConditionId) return;
    const entry = conditions.find(e => e.id === scrollToConditionId);
    if (!entry) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`condition-${scrollToConditionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #adcce6';
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
      }
      setSelectedCondition(entry);
      setScrollToConditionId(null);
    }, 200);
    return () => clearTimeout(timer);
  }, [scrollToConditionId]);

  const hasAnyData = entries.length > 0 || labs.length > 0 || imaging.length > 0;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  type SearchResult = {
    id: string;
    label: string;
    sublabel?: string;
    tab: 'timeline' | 'conditions' | 'medications' | 'test-results' | 'family-history';
    badgeVariant: string;
    badgeLabel: string;
    // Deep-link fields
    scrollElementId: string;
    labTestName?: string;
    imagingEntryId?: string;
    medEntryId?: string;
    conditionEntryId?: string;
  };

  const searchResults = useMemo((): SearchResult[] => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    entries.forEach(e => {
      if (e.name.toLowerCase().includes(q) || e.details?.toLowerCase().includes(q)) {
        const isMed = e.category === 'MEDICATION' || e.category === 'SUPPLEMENT';
        const tab: SearchResult['tab'] = e.category === 'CONDITION' ? 'conditions'
          : isMed ? 'medications'
          : e.category === 'FAMILY_HISTORY' ? 'family-history'
          : 'timeline';
        const elementId = e.category === 'CONDITION' ? `condition-${e.id}` : `med-${e.id}`;
        results.push({
          id: e.id,
          label: toTitleCase(e.name),
          sublabel: e.startDate ? format(parseDate(e.startDate), 'MMM yyyy') : undefined,
          tab,
          badgeVariant: CATEGORY_BADGE_VARIANTS[e.category] as string,
          badgeLabel: CATEGORY_LABELS[e.category],
          scrollElementId: elementId,
          medEntryId: isMed ? e.id : undefined,
          conditionEntryId: e.category === 'CONDITION' ? e.id : undefined,
        });
      }
    });

    const seenLabNames = new Set<string>();
    labs.forEach(l => {
      if (!seenLabNames.has(l.testName) && l.testName.toLowerCase().includes(q)) {
        seenLabNames.add(l.testName);
        const slug = l.testName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        results.push({
          id: `lab-${l.testName}`,
          label: l.testName,
          sublabel: format(parseDate(l.recordedAt), 'MMM d, yyyy'),
          tab: 'test-results',
          badgeVariant: 'labReport',
          badgeLabel: 'Lab Result',
          scrollElementId: `lab-${slug}`,
          labTestName: l.testName,
        });
      }
    });

    imaging.forEach(s => {
      const title = imagingTitle(s);
      if (title.toLowerCase().includes(q) || s.bodyPart.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q)) {
        results.push({
          id: s.id,
          label: title,
          sublabel: s.studyDate ? format(parseDate(s.studyDate), 'MMM d, yyyy') : undefined,
          tab: 'test-results',
          badgeVariant: 'imaging',
          badgeLabel: 'Imaging',
          scrollElementId: `imaging-${s.id}`,
          imagingEntryId: s.id,
        });
      }
    });

    return results.slice(0, 8);
  }, [searchQuery, entries, labs, imaging]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Page header — row 1: title + add button */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-gray-900">Health History</h1>
          <p className="text-sm text-gray-500">Your complete medical background in one place</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-1.5 text-white font-semibold shrink-0" size="sm">
              <Plus className="h-4 w-4" /> Add <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => openNewWithCategory('CONDITION')}>Condition</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openNewWithCategory('ALLERGY')}>Allergy</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openNewWithCategory('SURGERY')}>Surgery</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openNewWithCategory('VACCINATION')}>Vaccination</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { switchTab('family-history'); openNewWithCategory('FAMILY_HISTORY'); }}>Family History</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { switchTab('medications'); setPendingMedAdd('MEDICATION'); }}>Medication</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { switchTab('medications'); setPendingMedAdd('SUPPLEMENT'); }}>Supplement</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { switchTab('test-results'); setPendingLabsAdd('lab'); }}>Lab Result</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { switchTab('test-results'); setPendingLabsAdd('vital'); }}>Vital</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { switchTab('test-results'); setPendingLabsAdd('imaging'); }}>Imaging</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2: search + section picker side by side */}
      <div className="flex gap-2 mb-5" ref={searchRef}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search history"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            className="pl-9 pr-9 h-10"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg border bg-white shadow-lg overflow-hidden">
              {searchResults.map(result => (
                <button
                  key={result.id}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    switchTab(result.tab);
                    setSearchQuery('');
                    setSearchOpen(false);
                    if (result.labTestName) {
                      setScrollToLabTestName(result.labTestName);
                    } else if (result.imagingEntryId) {
                      setScrollToImagingId(result.imagingEntryId);
                    } else if (result.medEntryId) {
                      setScrollToMedId(result.medEntryId);
                    } else if (result.conditionEntryId) {
                      setScrollToConditionId(result.conditionEntryId);
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3 border-b last:border-0 transition-colors"
                >
                  <Badge variant={result.badgeVariant as any} className="text-xs shrink-0">{result.badgeLabel}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{result.label}</p>
                    {result.sublabel && <p className="text-xs text-gray-400">{result.sublabel}</p>}
                  </div>
                  <span className="text-xs text-gray-300 shrink-0">
                    {({ timeline: 'Timeline', conditions: 'Conditions', medications: 'Medications', 'test-results': 'Test Results', 'family-history': 'Family History' } as Record<string,string>)[result.tab]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Section picker — inline with search */}
        {(() => {
          const TAB_LABELS: Record<string, string> = { timeline: 'Timeline', conditions: 'Conditions', medications: 'Medications', 'test-results': 'Test Results', 'family-history': 'Family History' };
          const tabs = ['timeline', 'conditions', 'medications', 'test-results', 'family-history'] as const;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-[#102a45] hover:bg-gray-50 transition-colors shrink-0 whitespace-nowrap">
                  <span>{TAB_LABELS[activeTab]}</span>
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {tabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab}
                    onClick={() => switchTab(tab)}
                    className={`text-sm ${activeTab === tab ? 'font-semibold text-[#102a45]' : 'text-gray-700'}`}
                  >
                    {activeTab === tab && <span className="mr-2 text-[#457aab]">✓</span>}
                    {TAB_LABELS[tab]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}
      </div>

      {/* Timeline tab */}
      {activeTab === 'timeline' && (
        <>
          {loading ? (
            <SkeletonList />
          ) : !hasAnyData ? (
            <EmptyState
              icon={HistoryIcon}
              title="No health history yet"
              description="Add your conditions, medications, allergies, surgeries, vaccinations, and family history. This helps Fila provide more accurate insights."
              action={
                <Button onClick={() => openNewWithCategory('CONDITION')} className="gap-2">
                  <Plus className="h-4 w-4" /> Add your first entry
                </Button>
              }
            />
          ) : (
            <HealthTimeline
              entries={entries.filter(e => e.category !== 'FAMILY_HISTORY')}
              records={records}
              insightReport={insightReport}
              onEditEntry={e => openEdit(e)}
              onDeleteEntry={(id, name) => handleDelete(id, name)}
              labs={labs}
              imaging={imaging}
            />
          )}
        </>
      )}

      {/* Conditions tab */}
      {activeTab === 'conditions' && (
        <div className="space-y-3">
          {loading ? (
            <SkeletonList />
          ) : conditions.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title="No conditions recorded"
              description="Add conditions to track your diagnoses over time."
              action={
                <Button onClick={() => openNewWithCategory('CONDITION')} className="gap-2">
                  <Plus className="h-4 w-4" /> Add a condition
                </Button>
              }
            />
          ) : (
            conditions.sort(sortEntries).map(entry => (
              <div
                key={entry.id}
                id={`condition-${entry.id}`}
                className="rounded-lg border border-gray-200 bg-white shadow-sm p-3 flex items-start gap-3 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              >
                <button
                  onClick={() => setSelectedCondition(entry)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm font-semibold text-gray-900">{toTitleCase(entry.name)}</p>
                  {entry.details && <p className="text-xs text-gray-500 mt-0.5">{entry.details}</p>}
                  {entry.startDate && (
                    <p className="text-xs text-gray-400 mt-0.5">Since {format(parseDate(entry.startDate), 'MMM d, yyyy')}</p>
                  )}
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(entry)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id, entry.name)}
                    className="p-1.5 rounded text-[#9b2c2c] hover:bg-[#9b2c2c] hover:text-white transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Medications tab */}
      {activeTab === 'medications' && (
        <Medications
          embedded
          pendingAddType={pendingMedAdd ?? undefined}
          onAddHandled={() => setPendingMedAdd(null)}
          scrollToEntryId={scrollToMedId ?? undefined}
        />
      )}

      {/* Test Results tab */}
      {activeTab === 'test-results' && (
        <LabsVitals
          embedded
          pendingAddType={pendingLabsAdd ?? undefined}
          onAddHandled={() => setPendingLabsAdd(null)}
          scrollToTestName={scrollToLabTestName ?? undefined}
          scrollToImagingId={scrollToImagingId ?? undefined}
        />
      )}

      {/* Family History tab */}
      {activeTab === 'family-history' && (
        <div className="space-y-3">
          {loading ? (
            <SkeletonList />
          ) : familyHistory.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title="No family history recorded"
              description="Add family history to help identify hereditary health patterns."
              action={
                <Button onClick={() => openNewWithCategory('FAMILY_HISTORY')} className="gap-2">
                  <Plus className="h-4 w-4" /> Add family history
                </Button>
              }
            />
          ) : (
            familyHistory.sort(sortEntries).map(entry => (
              <div
                key={entry.id}
                className="rounded-lg border border-gray-200 bg-white shadow-sm p-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{toTitleCase(entry.name)}</p>
                  <p className="text-xs mt-0.5">
                    <span className="text-gray-400">Relative: </span>
                    <span className="text-gray-600">{entry.relative ?? '—'}</span>
                  </p>
                  {entry.details && <p className="text-xs text-gray-500 mt-0.5">{entry.details}</p>}
                  {entry.startDate && (
                    <p className="text-xs text-gray-400 mt-0.5">{format(parseDate(entry.startDate), 'MMM d, yyyy')}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(entry)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id, entry.name)}
                    className="p-1.5 rounded text-[#9b2c2c] hover:bg-[#9b2c2c] hover:text-white transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Entry' : 'Add Health History Entry'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as HistoryCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as HistoryCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ename">{form.category === 'FAMILY_HISTORY' ? 'Condition' : 'Name'}</Label>
              <Input id="ename" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder={form.category === 'FAMILY_HISTORY' ? 'e.g. Heart Disease, Diabetes' : 'e.g. Hypertension, Aspirin 81mg'} />
            </div>
            {form.category === 'FAMILY_HISTORY' && (
              <div className="space-y-2">
                <Label htmlFor="erelative">Relative</Label>
                <Select value={form.relative} onValueChange={(v) => setForm((f) => ({ ...f, relative: v }))}>
                  <SelectTrigger id="erelative"><SelectValue placeholder="Select relative" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Father">Father</SelectItem>
                    <SelectItem value="Mother">Mother</SelectItem>
                    <SelectItem value="Brother">Brother</SelectItem>
                    <SelectItem value="Sister">Sister</SelectItem>
                    <SelectItem value="Paternal Grandfather">Paternal Grandfather</SelectItem>
                    <SelectItem value="Paternal Grandmother">Paternal Grandmother</SelectItem>
                    <SelectItem value="Maternal Grandfather">Maternal Grandfather</SelectItem>
                    <SelectItem value="Maternal Grandmother">Maternal Grandmother</SelectItem>
                    <SelectItem value="Son">Son</SelectItem>
                    <SelectItem value="Daughter">Daughter</SelectItem>
                    <SelectItem value="Uncle">Uncle</SelectItem>
                    <SelectItem value="Aunt">Aunt</SelectItem>
                    <SelectItem value="Cousin">Cousin</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edetails">Details</Label>
              <Textarea id="edetails" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} placeholder="Dosage, severity, notes" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="estart">Start Date</Label>
                <Input id="estart" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eend">End Date</Label>
                <Input id="eend" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving' : editing ? 'Save changes' : 'Add entry'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Lab report modal */}
      {selectedLabGroup && (
        <LabReportModal
          labs={selectedLabGroup}
          record={
            selectedLabGroup[0]?.sourceRecordId
              ? (records.find((r) => r.id === selectedLabGroup[0].sourceRecordId) ?? null)
              : null
          }
          onClose={() => setSelectedLabGroup(null)}
        />
      )}

      {/* Imaging modal */}
      {selectedImaging && (
        <ImagingDetailModal
          study={selectedImaging}
          record={
            selectedImaging.sourceRecordId
              ? (records.find((r) => r.id === selectedImaging.sourceRecordId) ?? null)
              : null
          }
          onClose={() => setSelectedImaging(null)}
        />
      )}

      {/* Condition detail modal */}
      {selectedCondition && (
        <EventDetailModal
          entry={selectedCondition}
          record={records.find((r) => r.id === selectedCondition.sourceRecordId) ?? null}
          insight={
            insightReport?.insights.find((ins) => {
              const needle = selectedCondition.name.toLowerCase();
              return (
                ins.title.toLowerCase().includes(needle) ||
                ins.relatedConditions.some((c) => c.toLowerCase().includes(needle))
              );
            }) ?? null
          }
          onClose={() => setSelectedCondition(null)}
          onEdit={() => { setSelectedCondition(null); openEdit(selectedCondition); }}
          onDelete={() => { handleDelete(selectedCondition.id, selectedCondition.name); setSelectedCondition(null); }}
        />
      )}
    </div>
  );
}
