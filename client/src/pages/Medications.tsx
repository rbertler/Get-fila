import { useEffect, useState, useRef, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pill, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { api } from '@/api/client';
import { MedicalHistoryEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { format } from 'date-fns';

type MedForm = {
  name: string;
  dosage: string;
  details: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FORM: MedForm = { name: '', dosage: '', details: '', startDate: '', endDate: '' };

export function Medications({ embedded = false, pendingAddType, onAddHandled, scrollToEntryId }: {
  embedded?: boolean;
  pendingAddType?: 'MEDICATION' | 'SUPPLEMENT';
  onAddHandled?: () => void;
  scrollToEntryId?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<MedicalHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MedicalHistoryEntry | null>(null);
  const [entryType, setEntryType] = useState<'MEDICATION' | 'SUPPLEMENT'>('MEDICATION');
  const [form, setForm] = useState<MedForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchMeds = async () => {
    const data = await api.get<{ entries: MedicalHistoryEntry[] }>('/history');
    const filtered = data.entries.filter(e => e.category === 'MEDICATION' || e.category === 'SUPPLEMENT');
    setEntries(filtered);
    return filtered;
  };

  useEffect(() => {
    fetchMeds()
      .then((loaded) => {
        const editId = searchParams.get('edit');
        if (editId) {
          const target = loaded.find((e) => e.id === editId);
          if (target) {
            setEditing(target);
            setEntryType(target.category === 'SUPPLEMENT' ? 'SUPPLEMENT' : 'MEDICATION');
            const dosageMatch = target.name.match(/^(.*?)\s+(\d[\d.,]*\s*(?:mg|mcg|ml|g|iu|units?|tablet|capsule|tab|cap|patch|spray|drop|puff)[^\s]*)$/i);
            setForm({
              name: dosageMatch ? dosageMatch[1].trim() : target.name,
              dosage: dosageMatch ? dosageMatch[2].trim() : '',
              details: target.details ?? '',
              startDate: target.startDate ? format(new Date(target.startDate), 'yyyy-MM-dd') : '',
              endDate: target.endDate ? format(new Date(target.endDate), 'yyyy-MM-dd') : '',
            });
            setDialogOpen(true);
            setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('edit'); return next; }, { replace: true });
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const active = entries.filter(e => !e.endDate || new Date(e.endDate) >= now);
  const past = entries.filter(e => e.endDate && new Date(e.endDate) < now);

  const openAdd = (type: 'MEDICATION' | 'SUPPLEMENT') => {
    setEditing(null);
    setEntryType(type);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  useEffect(() => {
    if (pendingAddType) {
      openAdd(pendingAddType);
      onAddHandled?.();
    }
  }, [pendingAddType]);

  const prevScrollToEntryId = useRef<string | undefined>();
  useEffect(() => {
    if (!scrollToEntryId || loading) return;
    if (scrollToEntryId === prevScrollToEntryId.current) return;
    prevScrollToEntryId.current = scrollToEntryId;
    const timer = setTimeout(() => {
      const el = document.getElementById(`med-${scrollToEntryId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #6da7cc';
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollToEntryId, loading]);

  const openEdit = (entry: MedicalHistoryEntry) => {
    setEditing(entry);
    setEntryType(entry.category === 'SUPPLEMENT' ? 'SUPPLEMENT' : 'MEDICATION');
    // Split stored "Name Dosage" into name and dosage parts
    const dosageMatch = entry.name.match(/^(.*?)\s+(\d[\d.,]*\s*(?:mg|mcg|ml|g|iu|units?|tablet|capsule|tab|cap|patch|spray|drop|puff)[^\s]*)$/i);
    setForm({
      name: dosageMatch ? dosageMatch[1].trim() : entry.name,
      dosage: dosageMatch ? dosageMatch[2].trim() : '',
      details: entry.details ?? '',
      startDate: entry.startDate ? format(new Date(entry.startDate), 'yyyy-MM-dd') : '',
      endDate: entry.endDate ? format(new Date(entry.endDate), 'yyyy-MM-dd') : '',
    });
    setDialogOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const combinedName = [form.name.trim(), form.dosage.trim()].filter(Boolean).join(' ');
      const payload = {
        category: entryType,
        name: combinedName,
        details: form.details.trim() || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      };
      if (editing) {
        await api.patch(`/history/${editing.id}`, payload);
        toast({ title: 'Updated', description: `${combinedName} has been updated.` });
      } else {
        await api.post('/history', payload);
        toast({ title: 'Added', description: `${combinedName} has been added.` });
      }
      await fetchMeds();
      setDialogOpen(false);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save entry.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscontinue = async (entry: MedicalHistoryEntry) => {
    try {
      await api.patch(`/history/${entry.id}`, { endDate: format(now, 'yyyy-MM-dd') });
      toast({ title: 'Discontinued', description: `${entry.name} moved to past medications.` });
      await fetchMeds();
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update entry.' });
    }
  };

  const handleDelete = async (entry: MedicalHistoryEntry) => {
    try {
      await api.delete(`/history/${entry.id}`);
      toast({ title: 'Deleted', description: `${entry.name} has been removed.` });
      await fetchMeds();
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete entry.' });
    }
  };

  const addEntryDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2 text-white font-semibold">
          <Plus className="h-4 w-4" />
          Add Entry
          <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openAdd('MEDICATION')}>Medication</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openAdd('SUPPLEMENT')}>Supplement</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const content = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Medications &amp; Supplements</h1>
            <p className="mt-1 text-base text-gray-500">Track your current and past medications and supplements</p>
          </div>
          {addEntryDropdown}
        </div>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <Tabs defaultValue="active">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="active" className="text-xs px-1">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="inactive" className="text-xs px-1">Inactive ({past.length})</TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-1">All ({entries.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {active.length === 0 ? (
              <div className="rounded-xl border bg-white p-10 text-center space-y-3">
                <Pill className="h-10 w-10 text-gray-300 mx-auto" />
                <p className="text-base font-medium text-gray-500">No active medications and supplements on record</p>
                <p className="text-sm text-gray-400">
                  Medications and supplements are automatically detected when you upload records, or you can add them manually.
                </p>
                <Button size="sm" className="gap-1.5 mt-1" onClick={() => openAdd('MEDICATION')}>
                  <Plus className="h-3.5 w-3.5" /> Add manually
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {active.map(entry => (
                  <div key={entry.id} id={`med-${entry.id}`}>
                    <MedCard entry={entry} onEdit={openEdit} onDiscontinue={handleDiscontinue} onDelete={handleDelete} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inactive">
            {past.length === 0 ? (
              <p className="py-8 text-center text-base text-gray-500">No inactive medications</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {past.map(entry => (
                  <div key={entry.id} id={`med-${entry.id}`}>
                    <MedCard entry={entry} past onEdit={openEdit} onDiscontinue={handleDiscontinue} onDelete={handleDelete} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all">
            {entries.length === 0 ? (
              <p className="py-8 text-center text-base text-gray-500">No medications on record</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {entries.map(entry => (
                  <div key={entry.id} id={`med-${entry.id}`}>
                    <MedCard entry={entry} past={!!entry.endDate && new Date(entry.endDate) < new Date()} onEdit={openEdit} onDiscontinue={handleDiscontinue} onDelete={handleDelete} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `Edit ${entryType === 'SUPPLEMENT' ? 'Supplement' : 'Medication'}`
                : `Add ${entryType === 'SUPPLEMENT' ? 'Supplement' : 'Medication'}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="med-name">Name *</Label>
                <Input
                  id="med-name"
                  placeholder={entryType === 'SUPPLEMENT' ? 'e.g. Vitamin D' : 'e.g. Levothyroxine'}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="med-dosage">Dosage</Label>
                <Input
                  id="med-dosage"
                  placeholder={entryType === 'SUPPLEMENT' ? 'e.g. 2000 IU' : 'e.g. 50mcg'}
                  value={form.dosage}
                  onChange={e => setForm(f => ({ ...f, dosage: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="med-details">Notes</Label>
              <Textarea
                id="med-details"
                placeholder={entryType === 'SUPPLEMENT' ? 'e.g. Take with food in the morning' : 'e.g. Take once daily on empty stomach'}
                value={form.details}
                onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="med-start">Start date</Label>
                <Input
                  id="med-start"
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="med-end">End date</Label>
                <Input
                  id="med-end"
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="text-white font-semibold">
                {saving ? 'Saving' : editing ? 'Save changes' : `Add ${entryType === 'SUPPLEMENT' ? 'supplement' : 'medication'}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return content;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {content}
    </div>
  );
}

// ── Med Card ──────────────────────────────────────────────────────────────────
function MedCard({
  entry,
  past = false,
  onEdit,
  onDiscontinue,
  onDelete,
}: {
  entry: MedicalHistoryEntry;
  past?: boolean;
  onEdit: (e: MedicalHistoryEntry) => void;
  onDiscontinue: (e: MedicalHistoryEntry) => void;
  onDelete: (e: MedicalHistoryEntry) => void;
}) {
  return (
    <div className={`rounded-xl border bg-white p-3 flex flex-col min-h-[100px] ${past ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2 flex-1 grow">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="rounded-lg p-2 shrink-0 mt-0.5" style={{ backgroundColor: '#d4eeeb' }}>
            <Pill className="h-4 w-4" style={{ color: '#1a5c55' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{entry.name}</p>
            {entry.details && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{entry.details}</p>
            )}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => onEdit(entry)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(entry)}
            className="p-1.5 rounded text-[#9b2c2c] hover:bg-[#9b2c2c] hover:text-white transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap mt-auto pt-3">
        <div className="flex gap-2 flex-wrap">
          {entry.startDate && (
            <span className="text-xs text-gray-400">
              Since {format(new Date(entry.startDate), 'MMM yyyy')}
            </span>
          )}
          {entry.endDate && (
            <span className="text-xs text-gray-400">
              · Ended {format(new Date(entry.endDate), 'MMM yyyy')}
            </span>
          )}
          {entry.category === 'MEDICATION' && (
            <Badge variant="outline" className="text-xs" style={{ background: '#2b4257', color: '#c8ddf0', border: 'none' }}>Medication</Badge>
          )}
          {entry.category === 'SUPPLEMENT' && (
            <Badge variant="outline" className="text-xs" style={{ background: '#c8ddf0', color: '#2b4257', border: 'none' }}>Supplement</Badge>
          )}
          {entry.isManual ? (
            <Badge variant="manual" className="text-xs">Manual</Badge>
          ) : (
            <Badge variant="extracted" className="text-xs">Extracted</Badge>
          )}
        </div>
        {!past && (
          <button
            onClick={() => onDiscontinue(entry)}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
          >
            Discontinue
          </button>
        )}
      </div>
    </div>
  );
}
