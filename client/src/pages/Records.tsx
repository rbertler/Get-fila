import { parseDate } from '@/lib/utils';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { usePdfWidth } from '@/hooks/usePdfWidth';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Download, Trash2, Calendar, Building2, Pencil, RefreshCw, X, Plus, CheckSquare, Square, ChevronLeft, ChevronRight, Eye, Share2, Link as LinkIcon, Copy, ExternalLink, Clock } from 'lucide-react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '@/lib/pdfWorker';
import { api } from '@/api/client';
import { MedicalRecord, RecordType, Provider, ShareToken } from '@/types';
import { useSyncContext } from '@/context/SyncContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { ToastAction } from '@/components/ui/toast';
import { format, formatDistanceToNow, isPast } from 'date-fns';

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

// Record types available for manual upload (excludes AI_SUMMARY which is system-generated)
export const UPLOADABLE_RECORD_TYPES: RecordType[] = [
  'LAB_REPORT', 'VISIT_SUMMARY', 'IMAGING', 'PRESCRIPTION', 'REFERRAL', 'OPERATIVE_REPORT', 'OTHER',
];

const RECORD_TYPE_COLORS: Record<RecordType, 'info' | 'success' | 'warning' | 'secondary' | 'default' | 'outline' | 'referral' | 'labReport' | 'imaging' | 'neutral' | 'prescription' | 'surgery' | 'dark' | 'visitSummary' | 'operativeReport' | 'aiSummary'> = {
  LAB_REPORT: 'labReport',
  VISIT_SUMMARY: 'visitSummary',
  IMAGING: 'imaging',
  PRESCRIPTION: 'prescription',
  REFERRAL: 'referral',
  OPERATIVE_REPORT: 'operativeReport',
  AI_SUMMARY: 'aiSummary',
  OTHER: 'dark',
};

function stripExtension(name: string) {
  return name.replace(/\.pdf$/i, '');
}

type FileConfig = { name: string; type: RecordType };
type EditForm = { name: string; type: RecordType; date: string; providerName: string };

export function Records() {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  const { syncing, handleSync } = useSyncContext();

  // Upload staging + dialog
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  // Edit dialog
  const [editingRecord, setEditingRecord] = useState<MedicalRecord | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', type: 'OTHER', date: '', providerName: '' });
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [addingNewProvider, setAddingNewProvider] = useState(false);

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProviderDialog, setBulkProviderDialog] = useState(false);
  const [bulkProvider, setBulkProvider] = useState('');
  const [addingBulkNewProvider, setAddingBulkNewProvider] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<RecordType | 'ALL'>('ALL');
  const [filterYear, setFilterYear] = useState<string>('ALL');

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBulkIds, setDeleteBulkIds] = useState<string[] | null>(null);
  const [deleteAssociated, setDeleteAssociated] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Share with provider
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [generating, setGenerating] = useState(false);
  const [expiresIn, setExpiresIn] = useState(72);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  // PDF Preview
  const [previewRecord, setPreviewRecord] = useState<MedicalRecord | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfContainerRef, pdfWidth] = usePdfWidth(0);

  useEffect(() => {
    if (!previewRecord) {
      setPdfBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      return;
    }
    setPdfError(null);
    api.blob(`/records/${previewRecord.id}/view`)
      .then(blob => setPdfBlobUrl(URL.createObjectURL(blob)))
      .catch(() => setPdfError('Could not load PDF.'));
  }, [previewRecord?.id]);

  const openPreview = (r: MedicalRecord) => {
    setPreviewRecord(r);
    setNumPages(0);
    setPageNumber(1);
    setPdfError(null);
  };

  const fetchRecords = async () => {
    const data = await api.get<{ records: MedicalRecord[] }>('/records');
    setRecords(data.records);
  };

  const fetchTokens = async () => {
    const data = await api.get<{ tokens: ShareToken[] }>('/share/my-tokens');
    setTokens(data.tokens);
  };

  const fetchProviders = async () => {
    const data = await api.get<{ providers: Provider[] }>('/providers');
    setProviders(data.providers);
  };

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([fetchRecords(), fetchProviders(), fetchTokens()]).finally(() => setLoading(false));
  }, [location.pathname]);

  // Auto-open preview when navigated here with ?open=<id>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (!openId || records.length === 0) return;
    const target = records.find(r => r.id === openId);
    if (target) {
      openPreview(target);
      navigate('/records', { replace: true });
    }
  }, [records, location.search]);

  // Derived: unique years and filtered list
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    records.forEach(r => {
      const d = r.recordDate ?? r.createdAt;
      if (d) years.add(parseDate(d).getFullYear().toString());
    });
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filterType !== 'ALL' && r.recordType !== filterType) return false;
      if (filterYear !== 'ALL') {
        const d = r.recordDate ?? r.createdAt;
        if (!d || parseDate(d).getFullYear().toString() !== filterYear) return false;
      }
      return true;
    });
  }, [records, filterType, filterYear]);

  const hasActiveFilters = filterType !== 'ALL' || filterYear !== 'ALL';

  // ── Upload flow ──────────────────────────────────────────────────────────────
  const onDrop = useCallback((files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf');
    if (pdfs.length === 0) {
      toast({ variant: 'destructive', title: 'PDF only', description: 'Please upload PDF files only.' });
      return;
    }
    setStagedFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      return [...prev, ...pdfs.filter(f => !existingNames.has(f.name))];
    });
  }, []);

  const removeStagedFile = (index: number) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadClick = () => {
    if (stagedFiles.length === 0) return;
    setPendingFiles(stagedFiles);
    setFileConfigs(stagedFiles.map(f => ({ name: stripExtension(f.name), type: 'OTHER' as RecordType })));
    setCurrentFileIndex(0);
    setUploadDialogOpen(true);
  };

  const updateCurrentConfig = (patch: Partial<FileConfig>) => {
    setFileConfigs(prev => prev.map((c, i) => i === currentFileIndex ? { ...c, ...patch } : c));
  };

  const handleNextFile = () => {
    if (currentFileIndex < pendingFiles.length - 1) {
      setCurrentFileIndex(i => i + 1);
    }
  };

  const handlePrevFile = () => {
    if (currentFileIndex > 0) {
      setCurrentFileIndex(i => i - 1);
    } else {
      setUploadDialogOpen(false);
      setPendingFiles([]);
    }
  };

  const handleConfirmUpload = async () => {
    setUploading(true);
    setUploadProgress(0);
    setUploadDialogOpen(false);
    let uploaded = 0;
    const total = pendingFiles.length;
    const totals = { labs: 0, medications: 0, conditions: 0, imaging: 0, providers: 0 };

    for (let i = 0; i < total; i++) {
      const file = pendingFiles[i];
      const config = fileConfigs[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recordType', config.type);
      formData.append('recordName', config.name.trim() || stripExtension(file.name));
      try {
        const data = await api.upload<{ record: MedicalRecord; extracted?: { labs: number; medications: number; conditions: number; imaging: number; providers: number } }>('/records', formData);
        uploaded++;
        if (data.extracted) {
          totals.labs        += data.extracted.labs;
          totals.medications += data.extracted.medications;
          totals.conditions  += data.extracted.conditions;
          totals.imaging     += data.extracted.imaging;
          totals.providers   += data.extracted.providers;
        }
      } catch (err) {
        toast({
          variant: 'destructive',
          title: `Failed to upload ${file.name}`,
          description: err instanceof Error ? err.message : 'Upload error',
        });
      }
      // Advance progress after each file completes
      setUploadProgress(Math.round(((i + 1) / total) * 100));
    }

    if (uploaded > 0) {
      const parts: string[] = [];
      if (totals.labs)        parts.push(`${totals.labs} lab result${totals.labs !== 1 ? 's' : ''}`);
      if (totals.medications) parts.push(`${totals.medications} medication${totals.medications !== 1 ? 's' : ''}`);
      if (totals.conditions)  parts.push(`${totals.conditions} condition${totals.conditions !== 1 ? 's' : ''}`);
      if (totals.imaging)     parts.push(`${totals.imaging} imaging study${totals.imaging !== 1 ? 'ies' : ''}`);
      if (totals.providers)   parts.push(`${totals.providers} provider${totals.providers !== 1 ? 's' : ''}`);
      toast({
        variant: 'success',
        title: `${uploaded} record${uploaded > 1 ? 's' : ''} uploaded`,
        description: parts.length > 0 ? `Extracted: ${parts.join(', ')}` : 'No new entries found.',
      });
      await fetchRecords();
    }
    setPendingFiles([]);
    setStagedFiles([]);
    setFileConfigs([]);
    setCurrentFileIndex(0);
    setUploading(false);
    setUploadProgress(0);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  });

  // ── Edit flow ────────────────────────────────────────────────────────────────
  const openEdit = (r: MedicalRecord) => {
    setEditingRecord(r);
    setAddingNewProvider(false);
    setEditForm({
      name: r.fileName,
      type: r.recordType,
      date: r.recordDate ? format(parseDate(r.recordDate), 'yyyy-MM-dd') : '',
      providerName: r.providerName ?? '',
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    setSaving(true);
    const previous = {
      fileName: editingRecord.fileName,
      recordType: editingRecord.recordType,
      recordDate: editingRecord.recordDate ? format(parseDate(editingRecord.recordDate), 'yyyy-MM-dd') : undefined,
      providerName: editingRecord.providerName ?? null,
    };
    try {
      await api.patch(`/records/${editingRecord.id}`, {
        fileName: editForm.name.trim() || editingRecord.fileName,
        recordType: editForm.type,
        recordDate: editForm.date || undefined,
        providerName: editForm.providerName.trim() || undefined,
      });
      const recordId = editingRecord.id;
      toast({
        variant: 'success',
        title: 'Record updated',
        action: (
          <ToastAction
            altText="Undo update"
            onClick={async () => {
              try {
                await api.patch(`/records/${recordId}`, previous);
                await fetchRecords();
                toast({ title: 'Change undone' });
              } catch {
                toast({ variant: 'destructive', title: 'Could not undo' });
              }
            }}
          >
            Undo
          </ToastAction>
        ),
      });
      setEditDialogOpen(false);
      await fetchRecords();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Update failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredRecords.length) setSelected(new Set());
    else setSelected(new Set(filteredRecords.map(r => r.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const openBulkDeleteDialog = () => {
    setDeleteBulkIds([...selected]);
    setDeleteAssociated(true);
  };

  const handleBulkDelete = () => {
    if (!deleteBulkIds) return;
    scheduleDelete(
      deleteBulkIds,
      deleteAssociated,
      `${deleteBulkIds.length} record${deleteBulkIds.length !== 1 ? 's' : ''} deleted`
    );
    clearSelection();
    setDeleteBulkIds(null);
  };

  const handleBulkAssignProvider = async () => {
    const name = bulkProvider.trim();
    if (!name) return;
    setBulkSaving(true);
    try {
      await Promise.all([...selected].map(id => api.patch(`/records/${id}`, { providerName: name })));
      toast({ variant: 'success', title: `Provider assigned to ${selected.size} record${selected.size !== 1 ? 's' : ''}` });
      setBulkProviderDialog(false);
      setBulkProvider('');
      setAddingBulkNewProvider(false);
      clearSelection();
      await Promise.all([fetchRecords(), fetchProviders()]);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to assign provider' });
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkDownload = () => {
    filteredRecords
      .filter(r => selected.has(r.id))
      .forEach(r => handleDownload(r.id, r.fileName));
  };

  const openShareDialog = () => {
    setCreatedLink(null);
    setShareDialogOpen(true);
  };

  const handleShare = async () => {
    if (selected.size === 0) return;
    setGenerating(true);
    try {
      const data = await api.post<{ shareUrl: string; expiresAt: string }>('/share/token', {
        includeRecords: [...selected],
        expiresInHours: expiresIn,
      });
      setCreatedLink(data.shareUrl);
      await fetchTokens();
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
    setTokens(prev => prev.filter(t => t.token !== token));
    toast({ title: 'Share link revoked' });
  };

  const openDeleteDialog = (id: string, name: string) => {
    setDeleteTarget({ id, name });
    setDeleteAssociated(true);
  };

  // Deletes are deferred until the undo toast expires; Undo cancels the API call.
  const scheduleDelete = (ids: string[], associated: boolean, title: string) => {
    setRecords((prev) => prev.filter((r) => !ids.includes(r.id)));
    const timer = setTimeout(() => {
      Promise.all(ids.map((id) => api.delete(`/records/${id}?deleteAssociated=${associated}`)))
        .catch(async () => {
          toast({ variant: 'destructive', title: 'Delete failed' });
          await fetchRecords();
        });
    }, 5000);
    toast({
      variant: 'success',
      title,
      action: (
        <ToastAction
          altText="Undo delete"
          onClick={async () => {
            clearTimeout(timer);
            await fetchRecords();
            toast({ title: 'Delete undone' });
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    scheduleDelete([deleteTarget.id], deleteAssociated, 'Record deleted');
    setDeleteTarget(null);
  };

  const handleDownload = async (id: string, name: string) => {
    try {
      const blob = await api.blob(`/records/${id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not download file.' });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-3xl font-bold text-gray-900">Health Records</h1>
        <p className="mt-0.5 text-sm text-gray-500">Upload and manage your health documents</p>
      </div>

      {/* Upload area */}
      <div className="mb-6 space-y-3">
        <div
          {...getRootProps()}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 cursor-pointer transition-colors bg-white ${
            isDragActive ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/50 hover:bg-gray-50'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className={`h-7 w-7 ${isDragActive ? 'text-primary' : 'text-gray-400'}`} />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">
              {isDragActive ? 'Drop files here' : 'Drop files here or click to browse'}
            </p>
            <p className="text-base text-gray-500">PDF format only, max 20 MB</p>
          </div>
        </div>

        {/* Upload progress bar */}
        {uploading && (
          <div className="rounded-xl border bg-white px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-center" style={{ color: '#2b4257' }}>
              Uploading and extracting text
            </p>
            <div className="h-2 w-full rounded-full overflow-hidden bg-gray-100">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${uploadProgress === 0 ? 8 : uploadProgress}%`,
                  background: 'linear-gradient(135deg, #6da7cc 0%, #91c5bf 100%)',
                }}
              />
            </div>
          </div>
        )}

        {/* Staged files */}
        {stagedFiles.length > 0 && (
          <div className="rounded-xl border bg-white p-4 space-y-2">
            <p className="text-sm font-medium text-gray-600 mb-1">Ready to upload</p>
            {stagedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border bg-gray-50 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0" style={{ color: '#1a5c55' }} />
                <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button
                  onClick={() => removeStagedFile(i)}
                  className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <Button onClick={handleUploadClick} className="gap-2 text-white font-semibold">
                <Upload className="h-4 w-4" />
                Upload {stagedFiles.length === 1 ? '1 file' : `${stagedFiles.length} files`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Upload details dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={(open) => { if (!open) { setUploadDialogOpen(false); setPendingFiles([]); setFileConfigs([]); setCurrentFileIndex(0); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Record details</DialogTitle>
              {pendingFiles.length > 1 && (
                <span className="text-sm text-gray-400 font-normal pr-6">
                  {currentFileIndex + 1} of {pendingFiles.length}
                </span>
              )}
            </div>
            {pendingFiles.length > 1 && (
              <p className="text-xs text-gray-500 truncate pt-0.5">{pendingFiles[currentFileIndex]?.name}</p>
            )}
          </DialogHeader>
          {fileConfigs[currentFileIndex] && (
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="up-name">Record Name</Label>
                <Input
                  id="up-name"
                  value={fileConfigs[currentFileIndex].name}
                  onChange={(e) => updateCurrentConfig({ name: e.target.value })}
                  placeholder="e.g. Annual blood panel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-type">Record Type</Label>
                <Select value={fileConfigs[currentFileIndex].type} onValueChange={(v) => updateCurrentConfig({ type: v as RecordType })}>
                  <SelectTrigger id="up-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPLOADABLE_RECORD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{RECORD_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={handlePrevFile}>
              {currentFileIndex === 0 ? 'Cancel' : 'Back'}
            </Button>
            {currentFileIndex < pendingFiles.length - 1 ? (
              <Button onClick={handleNextFile} className="text-white font-semibold">Next</Button>
            ) : (
              <Button onClick={handleConfirmUpload} className="text-white font-semibold">
                {pendingFiles.length > 1 ? `Upload ${pendingFiles.length} files` : 'Upload'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit record dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit record</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="ed-name">Record Name</Label>
              <Input
                id="ed-name"
                value={editForm.name}
                onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-type">Record Type</Label>
              <Select value={editForm.type} onValueChange={(v) => setEditForm(f => ({ ...f, type: v as RecordType }))}>
                <SelectTrigger id="ed-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPLOADABLE_RECORD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{RECORD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-date">Record Date</Label>
              <Input
                id="ed-date"
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Provider</Label>
              {addingNewProvider ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="e.g. Dr. Smith"
                    value={editForm.providerName}
                    onChange={(e) => setEditForm(f => ({ ...f, providerName: e.target.value }))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setAddingNewProvider(false); setEditForm(f => ({ ...f, providerName: '' })); }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select
                  value={editForm.providerName}
                  onValueChange={(v) => {
                    if (v === '__new__') { setAddingNewProvider(true); setEditForm(f => ({ ...f, providerName: '' })); }
                    else setEditForm(f => ({ ...f, providerName: v }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__new__">
                      <span className="flex items-center gap-1.5 text-primary"><Plus className="h-3.5 w-3.5" /> Add new provider</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="text-white font-semibold">
              {saving ? 'Saving' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk assign provider dialog */}
      <Dialog open={bulkProviderDialog} onOpenChange={(o) => { setBulkProviderDialog(o); if (!o) { setBulkProvider(''); setAddingBulkNewProvider(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign provider to {selected.size} record{selected.size !== 1 ? 's' : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {addingBulkNewProvider ? (
              <div className="space-y-1.5">
                <Label>New provider name</Label>
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="e.g. Dr. Smith"
                    value={bulkProvider}
                    onChange={(e) => setBulkProvider(e.target.value)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => { setAddingBulkNewProvider(false); setBulkProvider(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Select provider</Label>
                <Select value={bulkProvider} onValueChange={(v) => {
                  if (v === '__new__') { setAddingBulkNewProvider(true); setBulkProvider(''); }
                  else setBulkProvider(v);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__new__">
                      <span className="flex items-center gap-1.5 text-primary"><Plus className="h-3.5 w-3.5" /> Add new provider</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setBulkProviderDialog(false)}>Cancel</Button>
            <Button onClick={handleBulkAssignProvider} disabled={bulkSaving || !bulkProvider.trim()} className="text-white font-semibold">
              {bulkSaving ? 'Saving' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Records list */}
      {loading ? (
        <SkeletonList />
      ) : records.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No records yet"
          description="Upload your lab reports, visit summaries, imaging results, prescriptions, and more. Fila extracts the text so your records can be searched and analyzed."
        />
      ) : (
        <div className="space-y-3">
          {/* Filters + select-all */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as RecordType | 'ALL')}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map((t) => (
                  <SelectItem key={t} value={t}>{RECORD_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="All years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All years</SelectItem>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <button
                onClick={() => { setFilterType('ALL'); setFilterYear('ALL'); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}

            <div className="ml-auto flex items-center gap-3">
              {filteredRecords.length > 0 && (
                <button onClick={toggleSelectAll} className="text-sm text-primary hover:underline">
                  {selected.size === filteredRecords.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-xs font-medium text-gray-700 shrink-0">{selected.size} selected</span>
              <div className="flex items-center gap-1 flex-1 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  title="Assign provider"
                  className="h-7 w-7 p-0"
                  onClick={() => { setBulkProvider(''); setAddingBulkNewProvider(false); setBulkProviderDialog(true); }}
                >
                  <Building2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="Download"
                  className="h-7 w-7 p-0"
                  onClick={handleBulkDownload}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="Share"
                  className="h-7 w-7 p-0"
                  onClick={openShareDialog}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="Delete"
                  className="h-7 w-7 p-0 text-[#9b2c2c] border-[#9b2c2c]/30 hover:bg-[#9b2c2c] hover:text-white"
                  disabled={bulkSaving}
                  onClick={openBulkDeleteDialog}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <button onClick={clearSelection} className="shrink-0 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {filteredRecords.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center">
              <p className="text-base text-gray-500">No records match the selected filters.</p>
            </div>
          ) : null}

          {filteredRecords.map((r) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 rounded-lg border bg-white p-3 hover:shadow-sm transition-shadow ${selected.has(r.id) ? 'border-primary/40 bg-primary/5' : ''}`}
            >
              <button
                onClick={() => toggleSelect(r.id)}
                className="shrink-0 text-gray-300 hover:text-primary transition-colors"
                title={selected.has(r.id) ? 'Deselect' : 'Select'}
              >
                {selected.has(r.id)
                  ? <CheckSquare className="h-4 w-4 text-primary" />
                  : <Square className="h-4 w-4" />}
              </button>
              <button
                onClick={() => openPreview(r)}
                className="rounded-lg p-1.5 shrink-0 transition-colors"
                style={{ backgroundColor: '#d4eeeb' }}
                title="Preview"
              >
                <FileText className="h-4 w-4" style={{ color: '#1a5c55' }} />
              </button>
              <button
                onClick={() => openPreview(r)}
                className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-2 min-w-0 mb-0.5">
                  <p className="text-sm font-semibold text-gray-900 truncate min-w-0">{r.fileName}</p>
                  <Badge variant={RECORD_TYPE_COLORS[r.recordType]} className="shrink-0 text-xs">{RECORD_TYPE_LABELS[r.recordType]}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
                  <span className="flex items-center gap-1 whitespace-nowrap shrink-0">
                    <Calendar className="h-3 w-3 shrink-0" />
                    {r.recordDate ? format(parseDate(r.recordDate), 'MMM d, yyyy') : <span className="text-gray-400">No date</span>}
                  </span>
                  {r.providerName && (
                    <span className="flex items-center gap-1 min-w-0">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{r.providerName}</span>
                    </span>
                  )}
                </div>
                {r.aiSummary && (
                  <p className="mt-1.5 text-xs text-gray-500 leading-relaxed line-clamp-2">{r.aiSummary}</p>
                )}
              </button>
              <div className="flex items-center shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 transition-colors">
                  <Pencil className="h-3.5 w-3.5 text-gray-400" />
                </button>
                <button onClick={() => handleDownload(r.id, r.fileName)} title="Download" className="p-1.5 rounded hover:bg-gray-100 transition-colors">
                  <Download className="h-3.5 w-3.5 text-gray-400" />
                </button>
                <button onClick={() => openDeleteDialog(r.id, r.fileName)} title="Delete" className="p-1.5 rounded hover:bg-red-50 transition-colors">
                  <Trash2 className="h-3.5 w-3.5 text-[#9b2c2c]" />
                </button>
              </div>
            </div>
          ))}
          <p className="text-sm text-gray-500 text-center pt-1">
            {filteredRecords.length} of {records.length} record{records.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* PDF Preview modal */}
      <Dialog open={!!previewRecord} onOpenChange={(open) => { if (!open) setPreviewRecord(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold truncate pr-6">
              {previewRecord?.fileName}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {previewRecord && <Badge variant={RECORD_TYPE_COLORS[previewRecord.recordType]}>{RECORD_TYPE_LABELS[previewRecord.recordType]}</Badge>}
              {previewRecord?.providerName && <span className="text-xs text-gray-500">{previewRecord.providerName}</span>}
              {previewRecord?.recordDate && <span className="text-xs text-gray-400">{format(parseDate(previewRecord.recordDate), 'MMM d, yyyy')}</span>}
            </div>
          </DialogHeader>

          <div ref={pdfContainerRef} className="flex-1 overflow-auto bg-gray-100 flex justify-center min-h-0">
            {pdfError ? (
              <div className="py-12 px-6 text-sm text-red-400 text-center">{pdfError}</div>
            ) : (
              <Document
                file={pdfBlobUrl}
                onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
                loading={<div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading preview…</div>}
                error={<div className="py-12 px-6 text-sm text-red-400 text-center">Could not render preview.</div>}
                className="py-4"
              >
                <Page pageNumber={pageNumber} width={pdfWidth} renderTextLayer renderAnnotationLayer />
              </Document>
            )}
          </div>

          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t bg-white">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              {numPages > 1 && (
                <>
                  <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span>Page {pageNumber} of {numPages}</span>
                  <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => previewRecord && handleDownload(previewRecord.id, previewRecord.fileName)}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => { if (previewRecord) { setPreviewRecord(null); openEdit(previewRecord); } }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Share with Provider dialog ── */}
      <Dialog open={shareDialogOpen} onOpenChange={(open) => { if (!open) { setShareDialogOpen(false); setCreatedLink(null); } }}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg p-2 shrink-0" style={{ backgroundColor: '#daf2ef' }}>
                <Share2 className="h-4 w-4" style={{ color: '#1a5c55' }} />
              </div>
              <div>
                <DialogTitle>Share with Provider</DialogTitle>
                <p className="text-sm text-gray-400 mt-0.5">Generate a time-limited link to your records</p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Selected records indicator */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-gray-700">
                {selected.size} record{selected.size !== 1 ? 's' : ''} selected for sharing
              </span>
            </div>

            {/* Expiry + generate */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 whitespace-nowrap shrink-0">Expires after</label>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(Number(e.target.value))}
                className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
                <option value={720}>30 days</option>
              </select>
              <Button
                onClick={handleShare}
                disabled={generating}
                className="gap-2 text-white font-semibold shrink-0"
              >
                <LinkIcon className="h-4 w-4" />
                {generating ? 'Generating…' : 'Generate link'}
              </Button>
            </div>

            {/* Created link */}
            {createdLink && (
              <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3 space-y-2">
                <p className="text-sm font-semibold text-green-800">Share link ready</p>
                <div className="rounded-md bg-white border px-3 py-2">
                  <p className="text-xs font-mono text-gray-700 break-all leading-relaxed">{createdLink}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => copyLink(createdLink)} className="flex-1 gap-1.5 text-xs h-8">
                    <Copy className="h-3 w-3" /> Copy link
                  </Button>
                  <Button size="sm" variant="outline" asChild className="gap-1.5 h-8 px-3 text-xs shrink-0">
                    <a href={createdLink} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                  </Button>
                </div>
              </div>
            )}

            {/* Active share links */}
            {tokens.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Active Share Links</p>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {tokens.map((t) => {
                    const expired = isPast(parseDate(t.expiresAt));
                    const shareUrl = `${window.location.origin}/share/${t.token}`;
                    const recordCount = Array.isArray((t.config as any)?.includeRecords) ? (t.config as any).includeRecords.length : 0;
                    return (
                      <div key={t.id} className={`rounded-lg border p-3 ${expired ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="text-xs font-medium text-gray-700 truncate">
                            {format(parseDate(t.createdAt), 'MMM d, h:mm a')}
                          </span>
                          {expired ? (
                            <Badge variant="secondary" className="text-xs shrink-0">Expired</Badge>
                          ) : (
                            <Badge variant="success" className="text-xs shrink-0">Active</Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          {expired ? 'Expired' : `Expires ${formatDistanceToNow(parseDate(t.expiresAt), { addSuffix: true })}`}
                        </p>
                        <p className="text-xs text-gray-400">
                          {recordCount > 0 ? `${recordCount} record${recordCount !== 1 ? 's' : ''} · ` : ''}{t.accessCount} view{t.accessCount !== 1 ? 's' : ''}
                        </p>
                        {!expired && (
                          <div className="mt-2 flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => copyLink(shareUrl)} className="flex-1 gap-1 text-xs h-7">
                              <Copy className="h-3 w-3" /> Copy
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => revokeToken(t.token)} className="text-[#9b2c2c] hover:text-[#9b2c2c] flex-1 gap-1 text-xs h-7">
                              <Trash2 className="h-3 w-3" /> Revoke
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Single delete confirmation ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete record</DialogTitle>
            <DialogDescription className="pt-1">
              <span className="font-medium text-gray-800">{deleteTarget?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 rounded-lg border bg-gray-50 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={deleteAssociated}
              onChange={(e) => setDeleteAssociated(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Also delete extracted data</p>
              <p className="text-xs text-gray-500 mt-0.5">Removes any labs, conditions, medications, imaging, and providers that were extracted from this record.</p>
            </div>
          </label>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-[#9b2c2c] hover:bg-[#7f2222] text-white border-0"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete confirmation ── */}
      <Dialog open={!!deleteBulkIds} onOpenChange={(open) => { if (!open) setDeleteBulkIds(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteBulkIds?.length} record{deleteBulkIds?.length !== 1 ? 's' : ''}</DialogTitle>
            <DialogDescription className="pt-1">This cannot be undone.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 rounded-lg border bg-gray-50 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={deleteAssociated}
              onChange={(e) => setDeleteAssociated(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Also delete extracted data</p>
              <p className="text-xs text-gray-500 mt-0.5">Removes any labs, conditions, medications, imaging, and providers that were extracted from these records.</p>
            </div>
          </label>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDeleteBulkIds(null)}>Cancel</Button>
            <Button
              onClick={handleBulkDelete}
              disabled={bulkSaving}
              className="bg-[#9b2c2c] hover:bg-[#7f2222] text-white border-0"
            >
              {bulkSaving ? 'Deleting…' : 'Delete all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
