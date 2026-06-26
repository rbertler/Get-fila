import { useEffect, useState, FormEvent, useRef } from 'react';
import { usePdfWidth } from '@/hooks/usePdfWidth';
import { useSearchParams } from 'react-router-dom';
import {
  Users, Plus, Pencil, Trash2, Phone, Mail,
  MapPin, Globe, FileText, Building2, Stethoscope, Search, X, ChevronDown, ChevronLeft, ChevronRight, Archive, ArchiveRestore,
} from 'lucide-react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '@/lib/pdfWorker';
import { api } from '@/api/client';
import { Provider, MedicalRecord, RecordType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/useToast';

const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  LAB_REPORT: 'Lab Report',
  VISIT_SUMMARY: 'Visit Summary',
  IMAGING: 'Imaging',
  PRESCRIPTION: 'Prescription',
  REFERRAL: 'Referral',
  OPERATIVE_REPORT: 'Operative Report',
  AI_SUMMARY: 'AI Summary',
  OTHER: 'Other',
};

const RECORD_TYPE_VARIANTS: Record<RecordType, 'labReport' | 'visitSummary' | 'imaging' | 'prescription' | 'referral' | 'operativeReport' | 'neutral' | 'aiSummary'> = {
  LAB_REPORT: 'labReport',
  VISIT_SUMMARY: 'visitSummary',
  IMAGING: 'imaging',
  PRESCRIPTION: 'prescription',
  REFERRAL: 'referral',
  OPERATIVE_REPORT: 'operativeReport',
  AI_SUMMARY: 'aiSummary',
  OTHER: 'neutral',
};

const PROVIDER_TYPES = [
  'Medical Doctor',
  'Doctor of Osteopathy',
  'Naturopathic Doctor',
  'Nurse Practitioner',
  'Physician Assistant',
  'Registered Nurse',
  'Registered Dietitian',
  'Chiropractor',
  'Dentist',
  'Physical Therapist',
  'Occupational Therapist',
  'Mental Health Counselor',
  'Psychologist',
  'Social Worker',
  'Pharmacist',
  'Hospital / Health System',
  'Urgent Care',
  'Lab / Diagnostics',
  'Other',
];

const SPECIALTIES = [
  'Cardiology',
  'Chiropractic',
  'Dentistry',
  'Dermatology',
  'Endocrinology',
  'Family Medicine',
  'Gastroenterology',
  'Geriatrics',
  'Gynecology',
  'Hematology',
  'Immunology & Allergy',
  'Functional Medicine',
  'Internal Medicine',
  'Mental Health & Counseling',
  'Naturopathic Medicine',
  'Nephrology',
  'Neurology',
  'Nutrition & Dietetics',
  'Obstetrics',
  'Oncology',
  'Ophthalmology',
  'Orthopedics',
  'Otolaryngology (ENT)',
  'Pediatrics',
  'Pharmacy',
  'Physical Therapy',
  'Psychiatry',
  'Psychology',
  'Pulmonology',
  'Primary Care',
  'Radiology',
  'Rheumatology',
  'Occupational Therapy',
  'Sports Medicine',
  'Surgery',
  'Urology',
  'Other',
];

type ProviderForm = {
  firstName: string;
  lastName: string;
  credential: string;
  providerType: string;
  specialty: string;
  affiliation: string;
  phone: string;
  fax: string;
  address: string;
  email: string;
  website: string;
  notes: string;
};

const EMPTY_FORM: ProviderForm = {
  firstName: '', lastName: '', credential: '', providerType: '', specialty: '', affiliation: '',
  phone: '', fax: '', address: '', email: '', website: '', notes: '',
};

function isCredentialToken(s: string): boolean {
  return (
    s.length <= 12 &&
    (/^[A-Z]{2}[A-Z\-\/]*$/.test(s) ||   // MD, NP, DO, PA, RN, CRNA, RD, RDN…
     /^Ph[Dd]$/.test(s) ||               // PhD
     /^Pharm[Dd]$/.test(s) ||            // PharmD
     /^PA-C$/i.test(s) ||                // PA-C
     /^[JS]r$/.test(s))                  // Jr, Sr
  );
}

/** Parse a stored name (various formats) into firstName / lastName / credential.
 *  Handles "Last, First, Cred", "Last, Cred, First", and "First Last, Cred". */
function parseProviderName(fullName: string): { firstName: string; lastName: string; credential: string } {
  let name = fullName.replace(/^Dr\.?\s+/i, '').trim();
  let credential = '';

  // Split by commas and find the credential part (scanning from end for safety)
  const parts = name.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length >= 2) {
    // Find the first credential part (scan from last to first, skip index 0 which is always last name)
    for (let i = parts.length - 1; i >= 1; i--) {
      if (isCredentialToken(parts[i])) {
        credential = parts[i];
        name = [...parts.slice(0, i), ...parts.slice(i + 1)].join(', ');
        break;
      }
    }
  }

  // Now name is "Last, First" or "First Last"
  const commaIdx = name.indexOf(',');
  if (commaIdx !== -1) {
    const last = name.slice(0, commaIdx).trim();
    const first = name.slice(commaIdx + 1).trim();
    return { firstName: first, lastName: last, credential };
  }

  const words = name.split(/\s+/);
  if (words.length === 1) return { firstName: '', lastName: words[0], credential };
  return { firstName: words[0], lastName: words.slice(1).join(' '), credential };
}

function assembleProviderName(firstName: string, lastName: string, credential: string): string {
  const base = [lastName.trim(), firstName.trim()].filter(Boolean).join(', ');
  return credential.trim() ? `${base}, ${credential.trim()}` : base;
}

/** Convert stored "Last, First, Credential" to display "First Last, Credential" */
function displayProviderName(storedName: string): string {
  const { firstName, lastName, credential } = parseProviderName(storedName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return credential ? `${fullName}, ${credential}` : fullName || storedName;
}

/** Keywords suggesting an organization/medical-group rather than an individual clinician.
 *  Loosely mirrors the server's ORGANIZATION_NAME_RE — used here so org-style providers
 *  display/sort by their natural name (e.g., "Function Health") rather than being run
 *  through "Last, First" person-name parsing, which would mangle them into "Health, Function". */
const ORG_NAME_RE = /\b(?:hospital|clinic|medical\s+(?:center|group)|health(?:care|\s+system)?|physicians?|associates?|imaging|radiology|patholog(?:y|ists)|laborator(?:y|ies)|labs?|diagnostics?|wellness|institute|network|partners|group|functional\s+medicine)\b/i;

/** Returns true when a provider represents a medical group/organization rather than an
 *  individual clinician — used to skip "Last, First" person-name formatting for orgs. */
function isOrgProvider(p: Provider): boolean {
  const affiliation = (p.affiliation ?? '').trim();
  if (!affiliation) return false;
  const { firstName, lastName, credential } = parseProviderName(p.name);
  const reordered = [firstName, lastName].filter(Boolean).join(' ').trim();
  // Name looks like a mangled version of the affiliation (e.g. stored "Health, Function" ↔ "Function Health")
  if (!credential && reordered.toLowerCase() === affiliation.toLowerCase()) return true;
  // Both name and affiliation contain org-style keywords
  if (ORG_NAME_RE.test(affiliation) && ORG_NAME_RE.test(p.name)) return true;
  return false;
}

/** Name to use in the directory LIST and for sorting: "Last, First, Cred" for individuals
 *  (the stored format), natural group name for organizations. */
function resolveListName(p: Provider): string {
  return isOrgProvider(p) ? (p.affiliation ?? p.name) : p.name;
}

/** Name to use in the detail HEADER: "First Last, Cred" for individuals (human-readable),
 *  natural group name for organizations. */
function resolveDisplayName(p: Provider): string {
  return isOrgProvider(p) ? (p.affiliation ?? p.name) : displayProviderName(p.name);
}

function formFromProvider(p: Provider): ProviderForm {
  const { firstName, lastName, credential } = parseProviderName(p.name);
  return {
    firstName,
    lastName,
    credential,
    providerType: p.providerType ?? '',
    specialty: p.specialty ?? '',
    affiliation: p.affiliation ?? '',
    phone: p.phone ?? '',
    fax: p.fax ?? '',
    address: p.address ?? '',
    email: p.email ?? '',
    website: p.website ?? '',
    notes: p.notes ?? '',
  };
}

function SearchableSelect({
  value, onChange, options, placeholder, required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const displayValue = value || '';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 pr-8"
          value={open ? query : displayValue}
          placeholder={open ? 'Type to search' : (placeholder ?? '')}
          required={required && !value}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && filtered.length === 1) { onChange(filtered[0]); setOpen(false); e.preventDefault(); }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-white shadow-md text-sm">
          {filtered.map((o) => (
            <li
              key={o}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setQuery(''); setOpen(false); }}
              className={`px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground ${o === value ? 'bg-accent/60 font-medium' : ''}`}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProviderDirectory() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'archived'>('active');
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterType, setFilterType] = useState('all');
  const [filterSpecialty, setFilterSpecialty] = useState('all');
  const [selected, setSelected] = useState<Provider | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Linked records viewer
  const [showRecordViewer, setShowRecordViewer] = useState(false);
  const [linkedRecords, setLinkedRecords] = useState<MedicalRecord[]>([]);
  const [activeRecordIdx, setActiveRecordIdx] = useState(0);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfContainerRef, pdfWidth] = usePdfWidth(32);

  useEffect(() => {
    const activeId = linkedRecords[activeRecordIdx]?.id;
    if (!activeId || !showRecordViewer) return;
    setPdfBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPdfError(null);
    api.blob(`/records/${activeId}/view`)
      .then(blob => setPdfBlobUrl(URL.createObjectURL(blob)))
      .catch(() => setPdfError('Could not load PDF.'));
  }, [linkedRecords[activeRecordIdx]?.id, showRecordViewer]);

  const loadLinkedRecords = async (provider: Provider) => {
    if (!provider.sourceRecordIds.length) return;
    setLoadingRecords(true);
    setNumPages(0);
    setPageNumber(1);
    try {
      const data = await api.get<{ records: MedicalRecord[] }>('/records');
      const linked = data.records.filter(r => provider.sourceRecordIds.includes(r.id));
      setLinkedRecords(linked);
      setActiveRecordIdx(0);
    } catch (e) {
      console.error('Failed to load linked records', e);
    } finally {
      setLoadingRecords(false);
    }
  };

  const switchRecord = (idx: number) => {
    setActiveRecordIdx(idx);
    setPageNumber(1);
    setNumPages(0);
  };



  const fetchProviders = async () => {
    const data = await api.get<{ providers: Provider[] }>('/providers');
    setProviders(data.providers);
    if (data.providers.length > 0 && !selected) setSelected(data.providers[0]);
    return data.providers;
  };

  useEffect(() => {
    fetchProviders()
      .then((loadedProviders) => {
        const editId = searchParams.get('edit');
        if (editId) {
          const target = loadedProviders.find((p) => p.id === editId);
          if (target) {
            setSelected(target);
            setEditing(target);
            setForm(formFromProvider(target));
            setDialogOpen(true);
            setSearchParams({}, { replace: true });
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Reset viewer and auto-load records when selected provider changes
  useEffect(() => {
    setShowRecordViewer(false);
    setLinkedRecords([]);
    setActiveRecordIdx(0);

    setNumPages(0);
    setPageNumber(1);
    if (selected && selected.sourceRecordIds.length > 0) {
      loadLinkedRecords(selected);
    }
  }, [selected?.id]);

  const activeCount = providers.filter(p => !p.isArchived).length;
  const archivedCount = providers.filter(p => p.isArchived).length;

  // Filtered list
  const filtered = providers
    .filter((p) => {
      const matchesStatus = filterStatus === 'active' ? !p.isArchived : p.isArchived;
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.specialty?.toLowerCase().includes(search.toLowerCase()) ||
        p.affiliation?.toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === 'all' || p.providerType === filterType;
      const matchesSpecialty = filterSpecialty === 'all' || p.specialty === filterSpecialty;
      return matchesStatus && matchesSearch && matchesType && matchesSpecialty;
    })
    .sort((a, b) => resolveListName(a).localeCompare(resolveListName(b)));

  // Unique types + specialties for filters
  const types = Array.from(new Set(providers.map((p) => p.providerType).filter(Boolean))).sort() as string[];
  const specialties = Array.from(new Set(providers.map((p) => p.specialty).filter(Boolean))).sort() as string[];

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: Provider) => {
    setEditing(p);
    setForm(formFromProvider(p));
    setDialogOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.providerType) {
      toast({ variant: 'destructive', title: 'Provider Type is required' });
      return;
    }
    setSaving(true);
    // Assemble name and build payload (exclude split name fields)
    const { firstName, lastName, credential, ...rest } = form;
    const assembled = assembleProviderName(firstName, lastName, credential);
    const payload = Object.fromEntries(
      Object.entries({ ...rest, name: assembled }).map(([k, v]) => [k, v === '' ? undefined : v])
    );
    try {
      if (editing) {
        const res = await api.patch<{ provider: Provider }>(`/providers/${editing.id}`, payload);
        setProviders((prev) => prev.map((p) => (p.id === editing.id ? res.provider : p)));
        if (selected?.id === editing.id) setSelected(res.provider);
        toast({ variant: 'success', title: 'Provider updated' });
      } else {
        const res = await api.post<{ provider: Provider }>('/providers', payload);
        setProviders((prev) => [...prev, res.provider].sort((a, b) => resolveListName(a).localeCompare(resolveListName(b))));
        setSelected(res.provider);
        toast({ variant: 'success', title: 'Provider added' });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast({ variant: 'destructive', title: 'Save failed', description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Provider) => {
    if (!confirm(`Remove ${p.name} from your directory?`)) return;
    await api.delete(`/providers/${p.id}`);
    const next = providers.filter((x) => x.id !== p.id);
    setProviders(next);
    setSelected(next[0] ?? null);
    toast({ title: 'Provider removed' });
  };

  const handleArchive = async (p: Provider) => {
    const archiving = !p.isArchived;
    const res = await api.patch<{ provider: Provider }>(`/providers/${p.id}`, { isArchived: archiving });
    const updated = res.provider;
    setProviders(prev => prev.map(x => x.id === p.id ? updated : x));
    setSelected(updated);
    toast({ variant: 'success', title: archiving ? 'Provider archived' : 'Provider reactivated' });
  };

  const f = (s: string) => s || undefined;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: list ── */}
        <div className={`${mobileShowDetail ? 'hidden' : 'flex'} md:flex w-full md:w-80 shrink-0 flex-col border-r bg-white overflow-hidden`}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-gray-900">Provider Directory</h1>
              <p className="mt-0.5 text-sm md:text-base text-gray-500">
                Your care team, compiled from records and appointments
              </p>
            </div>
            <Button onClick={openNew} size="sm" className="gap-1.5 text-white font-semibold shrink-0">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          {/* Active / Archived tabs */}
          <div className="flex border-b">
            <button
              onClick={() => { setFilterStatus('active'); setSelected(providers.find(p => !p.isArchived) ?? null); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${filterStatus === 'active' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => { setFilterStatus('archived'); setSelected(providers.find(p => p.isArchived) ?? null); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${filterStatus === 'archived' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Archived ({archivedCount})
            </button>
          </div>

          {/* Search + filter */}
          <div className="px-4 py-3 space-y-2 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search providers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              )}
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All provider types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All provider types</SelectItem>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSpecialty} onValueChange={setFilterSpecialty}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All specialties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All specialties</SelectItem>
                {specialties.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4"><SkeletonList count={4} /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-base text-gray-400">
                {providers.length === 0 ? 'No providers yet. Add one manually.' : 'No matches'}
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setMobileShowDetail(true); }}
                  className={`w-full text-left px-4 py-3 border-b transition-colors hover:bg-gray-50 ${selected?.id === p.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                >
                  <div className="flex items-center">
                    <p className="text-sm font-semibold text-gray-900 leading-snug">{resolveListName(p)}</p>
                  </div>
                  {(p.providerType || p.specialty) && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      {[p.providerType, p.specialty].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {p.affiliation && (
                    <p className="text-sm text-gray-400 mt-0.5 truncate">{p.affiliation}</p>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t bg-gray-50">
            <p className="text-sm text-gray-400">{filtered.length} provider{filtered.length !== 1 ? 's' : ''} · {providers.length} total</p>
          </div>
        </div>

        {/* ── Right: detail ── */}
        <div className={`${mobileShowDetail ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-[#d6e6f5]`}>
          {!selected ? (
            <EmptyState
              icon={Users}
              title="No provider selected"
              description="Select a provider from the list, or add one manually. Providers are automatically added when you upload records."
              action={<Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Add your first provider</Button>}
            />
          ) : (
            <div className="w-full max-w-2xl mx-auto p-4 md:p-6 space-y-6">
              {/* Mobile back button */}
              <button
                onClick={() => setMobileShowDetail(false)}
                className="flex md:hidden items-center gap-1.5 text-sm font-medium mb-2"
                style={{ color: '#102a45' }}
              >
                <ChevronLeft className="h-4 w-4" /> All Providers
              </button>
              {/* Title bar */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 md:h-14 md:w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Stethoscope className="h-5 w-5 md:h-7 md:w-7 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg md:text-2xl font-bold text-gray-900 leading-tight">{resolveDisplayName(selected)}</h2>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {[selected.providerType, selected.specialty].filter(Boolean).join(' · ')}
                        {selected.isManual && <span className="ml-2 text-gray-400">· Manually added</span>}
                        {selected.isArchived && <span className="ml-2 text-gray-400">· Archived</span>}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => openEdit(selected)} className="gap-1.5">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => handleArchive(selected)}
                    className={`gap-1.5 ${selected.isArchived ? 'text-[#276749] border-[#276749]/30 hover:bg-[#276749] hover:text-white' : 'text-[#244a73] border-[#244a73] hover:bg-[#244a73] hover:text-white'}`}
                  >
                    {selected.isArchived
                      ? <><ArchiveRestore className="h-3.5 w-3.5" /> Reactivate</>
                      : <><Archive className="h-3.5 w-3.5" /> Archive</>
                    }
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => handleDelete(selected)}
                    className="gap-1.5 text-[#9b2c2c] border-[#9b2c2c]/30 hover:bg-[#9b2c2c] hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>

              {/* Contact & details card */}
              <div className="rounded-lg border bg-white divide-y">
                {selected.affiliation && (
                  <InfoRow icon={<Building2 className="h-4 w-4 text-gray-400" />} label="Affiliation">
                    {selected.affiliation}
                  </InfoRow>
                )}
                {selected.phone && (
                  <InfoRow icon={<Phone className="h-4 w-4 text-gray-400" />} label="Phone">
                    <a href={`tel:${selected.phone}`} className="text-primary hover:underline">
                      {selected.phone}
                    </a>
                  </InfoRow>
                )}
                {selected.fax && (
                  <InfoRow icon={<Phone className="h-4 w-4 text-gray-400" />} label="Fax">
                    {selected.fax}
                  </InfoRow>
                )}
                {selected.email && (
                  <InfoRow icon={<Mail className="h-4 w-4 text-gray-400" />} label="Email">
                    <a href={`mailto:${selected.email}`} className="text-primary hover:underline">
                      {selected.email}
                    </a>
                  </InfoRow>
                )}
                {selected.address && (
                  <InfoRow icon={<MapPin className="h-4 w-4 text-gray-400" />} label="Address">
                    <span className="whitespace-pre-line">{selected.address}</span>
                  </InfoRow>
                )}
                {selected.website && (
                  <InfoRow icon={<Globe className="h-4 w-4 text-gray-400" />} label="Website">
                    <a
                      href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {selected.website}
                    </a>
                  </InfoRow>
                )}

                {!selected.affiliation && !selected.phone && !selected.fax &&
                 !selected.email && !selected.address && !selected.website && (
                  <div className="px-4 py-4 text-base text-gray-400 italic">
                    No contact details have been added yet. Click Edit to add them.
                  </div>
                )}
              </div>

              {selected.notes && (
                <div className="rounded-lg border bg-white p-4">
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</p>
                  <p className="text-base text-gray-700 whitespace-pre-line">{selected.notes}</p>
                </div>
              )}

              {/* Associated Records section */}
              {selected.sourceRecordIds.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Associated Records</p>
                  {loadingRecords ? (
                    <div className="text-sm text-gray-400 px-1">Loading records</div>
                  ) : (
                    <div className="space-y-2">
                      {linkedRecords.map((r, i) => (
                        <div key={r.id} className="rounded-lg border bg-white p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-md bg-[#d6e6f5] flex items-center justify-center shrink-0">
                              <FileText className="h-4 w-4 text-[#102a45]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{r.fileName}</p>
                              {r.recordType && (
                                <div className="mt-1">
                                  <Badge variant={RECORD_TYPE_VARIANTS[r.recordType]} className="text-xs">
                                    {RECORD_TYPE_LABELS[r.recordType]}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="outline" size="sm"
                            onClick={() => {
                              setActiveRecordIdx(i);
                              setShowRecordViewer(i === activeRecordIdx ? !showRecordViewer : true);
                              switchRecord(i);
                            }}
                          >
                            {showRecordViewer && i === activeRecordIdx ? 'Close' : 'View'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Linked record PDF viewer */}
              {showRecordViewer && !selected.isManual && (
                <div className="rounded-lg border bg-white overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 gap-2">
                    <p className="text-sm font-semibold text-gray-700 truncate min-w-0">
                      {loadingRecords ? 'Loading…' : (linkedRecords[activeRecordIdx]?.fileName ?? 'Associated record')}
                    </p>
                    {numPages > 1 && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                        <button
                          onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                          disabled={pageNumber <= 1}
                          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span>{pageNumber} / {numPages}</span>
                        <button
                          onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
                          disabled={pageNumber >= numPages}
                          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* PDF canvas */}
                  {loadingRecords && (
                    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading</div>
                  )}
                  {!loadingRecords && linkedRecords[activeRecordIdx] && (
                    <div ref={pdfContainerRef} className="overflow-auto bg-gray-100 flex justify-center p-4">
                      {pdfError ? (
                        <div className="py-12 text-sm text-red-400">{pdfError}</div>
                      ) : (
                        <Document
                          file={pdfBlobUrl}
                          onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
                          loading={<div className="py-12 text-sm text-gray-400">Rendering PDF</div>}
                          error={<div className="py-12 text-sm text-red-400">Could not render PDF.</div>}
                        >
                          <Page
                            pageNumber={pageNumber}
                            width={pdfWidth}
                            renderTextLayer
                            renderAnnotationLayer
                          />
                        </Document>
                      )}
                    </div>
                  )}
                  {!loadingRecords && linkedRecords.length === 0 && (
                    <div className="p-6 text-center text-sm text-gray-400">Record file not found.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Provider Information */}
            <p className="text-sm font-semibold text-gray-600">Provider Information</p>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pFirstName">First Name *</Label>
                <Input
                  id="pFirstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pLastName">Last Name *</Label>
                <Input
                  id="pLastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                  placeholder="Smith"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pCredential">Credential</Label>
                <Input
                  id="pCredential"
                  value={form.credential}
                  onChange={(e) => setForm((f) => ({ ...f, credential: e.target.value }))}
                  placeholder="MD, ND, NP"
                />
              </div>
            </div>

            {/* Type + specialty */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Provider Type *</Label>
                <SearchableSelect
                  value={form.providerType}
                  onChange={(v) => setForm((f) => ({ ...f, providerType: v }))}
                  options={PROVIDER_TYPES}
                  placeholder="Select or type"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Specialty</Label>
                <SearchableSelect
                  value={form.specialty}
                  onChange={(v) => setForm((f) => ({ ...f, specialty: v }))}
                  options={SPECIALTIES}
                  placeholder="Select or type"
                />
              </div>
            </div>

            {/* Affiliation */}
            <div className="space-y-2">
              <Label htmlFor="pAff">Provider Affiliation</Label>
              <p className="text-sm text-gray-400 -mt-1">Enter the provider group, private practice, or hospital system associated with the provider.</p>
              <Input
                id="pAff"
                value={form.affiliation}
                onChange={(e) => setForm((f) => ({ ...f, affiliation: e.target.value }))}
                placeholder="General Hospital Medical Group"
              />
            </div>

            <Separator />

            {/* Contact */}
            <p className="text-sm font-semibold text-gray-600">Contact Information</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pPhone">Phone</Label>
                <Input id="pPhone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="(555) 123-4567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pFax">Fax</Label>
                <Input id="pFax" type="tel" value={form.fax} onChange={(e) => setForm((f) => ({ ...f, fax: e.target.value }))} placeholder="(555) 123-4568" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pEmail">Email</Label>
              <Input id="pEmail" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="office@provider.com" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pAddress">Address</Label>
              <Textarea id="pAddress" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} placeholder="123 Medical Blvd, Suite 4&#10;Boston, MA 02101" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pWeb">Website</Label>
              <Input id="pWeb" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="www.providersite.com" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pNotes">Notes</Label>
              <Textarea id="pNotes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="e.g. Accepts new patients, telehealth available, in-network with Blue Cross" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving' : editing ? 'Save changes' : 'Add provider'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-400 mb-0.5">{label}</p>
        <div className="text-base text-gray-800">{children}</div>
      </div>
    </div>
  );
}
