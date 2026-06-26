import { parseDate } from '@/lib/utils';
import { useEffect, useState, FormEvent } from 'react';
import { Plus, Calendar, MapPin, Clock, RefreshCw, Mail, Pencil, Trash2, Phone, Globe, Building2, FileText, ExternalLink } from 'lucide-react';
import { api } from '@/api/client';
import { Appointment, Provider } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { format, isPast, isFuture } from 'date-fns';
import { useSearchParams } from 'react-router-dom';

const DURATION_OPTIONS = [
  { label: '15 minutes', value: '15' },
  { label: '30 minutes', value: '30' },
  { label: '45 minutes', value: '45' },
  { label: '1 hour', value: '60' },
  { label: '2 hours', value: '120' },
  { label: '3+ hours', value: '180' },
];

type ApptForm = {
  providerName: string;
  specialty: string;
  date: string;
  time: string;
  duration: string;
  reason: string;
  notes: string;
  location: string;
};

const EMPTY: ApptForm = { providerName: '', specialty: '', date: '', time: '', duration: '', reason: '', notes: '', location: '' };

export function Appointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [form, setForm] = useState<ApptForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [addingNewProvider, setAddingNewProvider] = useState(false);
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const googleStatus = searchParams.get('google');
    if (googleStatus === 'connected') toast({ variant: 'success', title: 'Google connected!', description: 'You can now sync your calendar.' });
    if (googleStatus === 'error') toast({ variant: 'destructive', title: 'Google connection failed' });
  }, []);

  const fetchAll = async () => {
    const [apptData, googleData, providerData] = await Promise.all([
      api.get<{ appointments: Appointment[] }>('/appointments'),
      api.get<{ configured: boolean; connected: boolean }>('/google/status'),
      api.get<{ providers: Provider[] }>('/providers'),
    ]);
    setAppointments(apptData.appointments);
    setGoogleConnected(googleData.connected);
    setGoogleConfigured(googleData.configured);
    setProviders(providerData.providers);
    // Auto-open detail from ?detail=<id>
    const detailId = searchParams.get('detail');
    if (detailId) {
      const match = apptData.appointments.find((a) => a.id === detailId);
      if (match) setDetailAppt(match);
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('detail'); return next; }, { replace: true });
    }
  };

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const upcoming = appointments.filter((a) => isFuture(parseDate(a.scheduledAt)));
  const past = appointments.filter((a) => isPast(parseDate(a.scheduledAt)));

  const openNew = () => { setEditing(null); setForm(EMPTY); setAddingNewProvider(false); setDialogOpen(true); };
  const openEdit = (a: Appointment) => {
    setEditing(a);
    setAddingNewProvider(false);
    setForm({
      providerName: a.providerName,
      specialty: a.specialty ?? '',
      date: format(parseDate(a.scheduledAt), 'yyyy-MM-dd'),
      time: format(parseDate(a.scheduledAt), 'HH:mm'),
      duration: a.duration ? String(a.duration) : '',
      reason: a.reason ?? '',
      notes: a.notes ?? '',
      location: a.location ?? '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        providerName: form.providerName,
        specialty: form.specialty || undefined,
        scheduledAt: form.time ? `${form.date}T${form.time}` : `${form.date}T00:00`,
        duration: form.duration ? Number(form.duration) : undefined,
        reason: form.reason || undefined,
        notes: form.notes || undefined,
        location: form.location || undefined,
      };
      if (editing) {
        await api.patch(`/appointments/${editing.id}`, payload);
        toast({ variant: 'success', title: 'Appointment updated' });
      } else {
        await api.post('/appointments', payload);
        toast({ variant: 'success', title: 'Appointment added' });
      }
      await fetchAll();
      setDialogOpen(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this appointment?')) return;
    await api.delete(`/appointments/${id}`);
    setAppointments((prev) => prev.filter((a) => a.id !== id));
    toast({ title: 'Appointment removed' });
  };

  const handleGoogleConnect = async () => {
    const data = await api.get<{ authUrl: string }>('/google/connect');
    window.location.href = data.authUrl;
  };

  const handleSync = async (source: 'google-calendar' | 'gmail') => {
    setSyncing(true);
    try {
      const data = await api.post<{ message: string }>(`/appointments/sync/${source}`);
      toast({ variant: 'success', title: 'Sync complete', description: data.message });
      await fetchAll();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Sync failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-gray-900">Appointments</h1>
          <p className="mt-1 text-sm md:text-lg text-gray-500">All your medical appointments in one place</p>
        </div>
        <Button onClick={openNew} size="sm" className="gap-1.5 text-white font-semibold shrink-0"><Plus className="h-4 w-4" /> Add</Button>
      </div>

      {loading ? (
        <SkeletonList />
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No appointments logged"
          description="Track upcoming and past appointments with your healthcare providers."
          action={<Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add appointment</Button>}
        />
      ) : (
        <Tabs defaultValue="upcoming">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="upcoming" className="text-xs px-1">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past" className="text-xs px-1">Past ({past.length})</TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-1">All ({appointments.length})</TabsTrigger>
          </TabsList>

          {['upcoming', 'past', 'all'].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <AppointmentList
                items={tab === 'upcoming' ? upcoming : tab === 'past' ? past : appointments}
                providers={providers}
                onDetail={setDetailAppt}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {detailAppt && (
        <AppointmentDetailDialog
          appointment={detailAppt}
          provider={providers.find((p) => p.name === detailAppt.providerName) ?? null}
          onClose={() => setDetailAppt(null)}
          onEdit={(a) => { setDetailAppt(null); openEdit(a); }}
          onDelete={(id) => { setDetailAppt(null); handleDelete(id); }}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Appointment' : 'Add Appointment'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Provider</Label>
                {addingNewProvider ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      required
                      placeholder="e.g. Smith, Jane, MD"
                      value={form.providerName}
                      onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setAddingNewProvider(false); setForm((f) => ({ ...f, providerName: '', specialty: '' })); }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={form.providerName}
                    onValueChange={(v) => {
                      if (v === '__new__') {
                        setAddingNewProvider(true);
                        setForm((f) => ({ ...f, providerName: '', specialty: '', location: '' }));
                      } else {
                        const match = providers.find((p) => p.name === v);
                        setForm((f) => ({ ...f, providerName: v, specialty: match?.specialty ?? '', location: match?.address ?? '' }));
                      }
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
              {/* Date · Time · Duration — one row of 3 */}
              <div className="col-span-2 flex gap-3">
                <div className="space-y-2 flex-1 min-w-0">
                  <Label htmlFor="aDate">Date</Label>
                  <Input id="aDate" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
                </div>
                <div className="space-y-2 w-32 shrink-0">
                  <Label htmlFor="aTime">Time</Label>
                  <Input id="aTime" type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
                </div>
                <div className="space-y-2 w-36 shrink-0">
                  <Label>Duration</Label>
                  <Select value={form.duration} onValueChange={(v) => setForm((f) => ({ ...f, duration: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="aReason">Reason for Visit</Label>
                <Input id="aReason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Annual physical, follow-up" />
              </div>
<div className="space-y-2 col-span-2">
                <Label htmlFor="aNotes">Notes</Label>
                <Textarea id="aNotes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Questions to ask, things to bring, prep instructions" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving' : editing ? 'Save changes' : 'Add appointment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppointmentList({
  items, providers, onDetail, onEdit, onDelete,
}: {
  items: Appointment[];
  providers: Provider[];
  onDetail: (a: Appointment) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-base text-gray-500">No appointments in this view</p>;
  }

  const SOURCE_LABELS: Record<string, string> = { MANUAL: 'Manual', GOOGLE_CALENDAR: 'Google Calendar', GMAIL: 'Gmail' };

  return (
    <div className="space-y-3">
      {items.map((a) => {
        const dirProvider = providers.find((p) => p.name === a.providerName);
        const displayType = dirProvider?.providerType;
        const displaySpecialty = dirProvider?.specialty ?? a.specialty;
        return (
        <div
          key={a.id}
          onClick={() => onDetail(a)}
          className="rounded-lg border bg-white p-3 flex items-start gap-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
        >
          <div className="rounded-lg p-1.5 mt-0.5 shrink-0" style={{ backgroundColor: '#d6e6f5' }}>
            <Calendar className="h-4 w-4" style={{ color: '#102a45' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-gray-900">{a.providerName}</p>
              {a.source !== 'MANUAL' && <Badge variant="outline">{SOURCE_LABELS[a.source]}</Badge>}
            </div>
            {(displayType || displaySpecialty) && (
              <p className="text-xs text-gray-500 mb-0.5">{[displayType, displaySpecialty].filter(Boolean).join(' · ')}</p>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(parseDate(a.scheduledAt), 'MMM d, yyyy h:mm a')}</span>
              {a.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</span>}
              {a.duration && <span>{a.duration} min</span>}
            </div>
            {a.reason && <p className="text-xs text-gray-600 mt-0.5">{a.reason}</p>}
            {a.notes && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{a.notes}</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" onClick={() => onEdit(a)} className="h-7 w-7"><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(a.id)} className="h-7 w-7 text-[#9b2c2c] hover:text-[#9b2c2c]"><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function AppointmentDetailDialog({ appointment: a, provider: p, onClose, onEdit, onDelete }: {
  appointment: Appointment;
  provider: Provider | null;
  onClose: () => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}) {
  const SOURCE_LABELS: Record<string, string> = { MANUAL: 'Manual', GOOGLE_CALENDAR: 'Google Calendar', GMAIL: 'Gmail' };
  const isPastAppt = isPast(parseDate(a.scheduledAt));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg p-2 shrink-0 mt-0.5" style={{ backgroundColor: '#daf2ef' }}>
              <Calendar className="h-5 w-5" style={{ color: '#102a45' }} />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg leading-snug">{a.providerName}</DialogTitle>
              {(p?.providerType || p?.specialty || a.specialty) && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {[p?.providerType, p?.specialty ?? a.specialty].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Appointment details */}
          <div className="rounded-lg border bg-gray-50 divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-center gap-3">
              <Clock className="h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">{format(parseDate(a.scheduledAt), 'EEEE, MMMM d, yyyy')}</p>
                <p className="text-sm text-gray-500">{format(parseDate(a.scheduledAt), 'h:mm a')}{a.duration ? ` · ${a.duration} min` : ''}</p>
              </div>
              {isPastAppt && <Badge variant="secondary" className="ml-auto text-xs shrink-0">Past</Badge>}
            </div>
            {a.location && (
              <div className="px-4 py-3 flex items-center gap-3">
                <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                <p className="text-sm text-gray-700">{a.location}</p>
              </div>
            )}
            {a.reason && (
              <div className="px-4 py-3 flex items-start gap-3">
                <FileText className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Reason</p>
                  <p className="text-sm text-gray-700">{a.reason}</p>
                </div>
              </div>
            )}
            {a.notes && (
              <div className="px-4 py-3 flex items-start gap-3">
                <FileText className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                  <p className="text-sm text-gray-700">{a.notes}</p>
                </div>
              </div>
            )}
            {a.source !== 'MANUAL' && (
              <div className="px-4 py-3 flex items-center gap-3">
                <Badge variant="outline" className="text-xs">{SOURCE_LABELS[a.source]}</Badge>
              </div>
            )}
          </div>

          {/* Provider contact info */}
          {p && (p.phone || p.address || p.fax || p.email || p.website || p.affiliation) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#244a73' }}>Provider Contact</p>
              <div className="rounded-lg border bg-gray-50 divide-y divide-gray-100">
                {p.affiliation && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                    <p className="text-sm text-gray-700">{p.affiliation}</p>
                  </div>
                )}
                {p.address && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                    <p className="text-sm text-gray-700">{p.address}</p>
                  </div>
                )}
                {p.phone && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-400 shrink-0" />
                    <a href={`tel:${p.phone}`} className="text-sm text-primary hover:underline">{p.phone}</a>
                  </div>
                )}
                {p.fax && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-400 shrink-0" />
                    <p className="text-sm text-gray-700">{p.fax} <span className="text-gray-400">(fax)</span></p>
                  </div>
                )}
                {p.email && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Mail className="h-4 w-4 text-gray-400 shrink-0" />
                    <a href={`mailto:${p.email}`} className="text-sm text-primary hover:underline">{p.email}</a>
                  </div>
                )}
                {p.website && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                    <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                      {p.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {!p && (
            <p className="text-sm text-gray-400 text-center py-1">No provider contact info on file for {a.providerName}.</p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
          <Button className="flex-1 gap-2 text-white" onClick={() => onEdit(a)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button
            variant="outline"
            className="gap-1.5 text-[#9b2c2c] border-[#9b2c2c]/30 hover:bg-[#9b2c2c] hover:text-white"
            onClick={() => onDelete(a.id)}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
