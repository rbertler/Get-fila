import { useEffect, useState, useContext, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  FileText, Calendar, Brain, Clock, ArrowRight, Pill,
  FlaskConical, AlertTriangle, ChevronRight, ClipboardList,
  Stethoscope, Upload, Share2, ExternalLink, ChevronLeft, X,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '@/lib/pdfWorker';
import { AuthContext } from '@/hooks/useAuth';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SkeletonList } from '@/components/SkeletonCard';
import { toast } from '@/hooks/useToast';
import { format, formatDistanceToNow } from 'date-fns';
import { RecordType } from '@/types';
import { usePdfWidth } from '@/hooks/usePdfWidth';

type FileConfig = { name: string; type: RecordType };

function stripExtension(name: string) {
  return name.replace(/\.pdf$/i, '');
}

interface DashboardMedication {
  id: string;
  name: string;
  details?: string;
  startDate?: string;
}

interface DashboardCondition {
  id: string;
  name: string;
  details?: string;
  startDate?: string;
}

interface DashboardAppointment {
  id: string;
  providerName: string;
  specialty?: string;
  scheduledAt: string;
  reason?: string;
  location?: string;
}

interface DashboardLabResult {
  id: string;
  testName: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isFlagged: boolean;
  recordedAt: string;
  providerName?: string;
}

interface DashboardRecord {
  id: string;
  fileName: string;
  recordType: RecordType;
  createdAt: string;
  providerName?: string;
  recordDate?: string;
}

interface InsightItem {
  title: string;
  confidence: string;
  suggestedDiscussion?: string;
}

interface DashboardData {
  recordCount: number;
  flaggedLabCount: number;
  medications: DashboardMedication[];
  conditions: DashboardCondition[];
  upcomingAppointments: DashboardAppointment[];
  recentLabResults: DashboardLabResult[];
  recentRecords: DashboardRecord[];
  providersMissingContact: { id: string; name: string }[];
  medicationsMissingDetails: { id: string; name: string }[];
  latestInsight: {
    id: string;
    summary: string;
    insights: InsightItem[];
    gaps: string[];
    generatedAt: string;
  } | null;
}

interface ActionItem {
  text: string;
  to: string;
  priority: 'high' | 'medium' | 'low';
  icon: React.ReactNode;
}

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

function getDashboardLabStatus(lab: DashboardLabResult): 'flagged' | 'borderline' | 'normal' {
  if (lab.isFlagged) return 'flagged';
  if (lab.referenceMin != null && lab.referenceMax != null) {
    const buffer = (lab.referenceMax - lab.referenceMin) * 0.05;
    if (lab.value <= lab.referenceMin + buffer || lab.value >= lab.referenceMax - buffer) return 'borderline';
  }
  return 'normal';
}

function buildActionItems(data: DashboardData): ActionItem[] {
  const items: ActionItem[] = [];

  if (data.flaggedLabCount > 0) {
    items.push({
      text: `${data.flaggedLabCount} lab result${data.flaggedLabCount > 1 ? 's are' : ' is'} outside the normal range. Bring these up at your next visit.`,
      to: '/labs',
      priority: 'high',
      icon: <AlertTriangle className="h-4 w-4" />,
    });
  }

  // One item per provider with an upcoming appointment that has no contact info
  for (const provider of data.providersMissingContact) {
    items.push({
      text: `${provider.name} has no contact information on file. Add their details before your appointment.`,
      to: `/providers?edit=${provider.id}`,
      priority: 'medium',
      icon: <Stethoscope className="h-4 w-4" />,
    });
  }

  // Medications missing dosage/frequency details — one item per medication
  for (const med of data.medicationsMissingDetails) {
    items.push({
      text: `${med.name} is missing dosage details. Add the dose and frequency.`,
      to: `/medications?edit=${med.id}`,
      priority: 'medium',
      icon: <Pill className="h-4 w-4" />,
    });
  }

  if (data.upcomingAppointments.length === 0) {
    items.push({
      text: 'No upcoming appointment scheduled. Book your next visit.',
      to: '/appointments',
      priority: 'medium',
      icon: <Calendar className="h-4 w-4" />,
    });
  }

  if (!data.latestInsight) {
    items.push({
      text: 'Run your first Health Intelligence analysis for personalized insights',
      to: '/insights',
      priority: 'medium',
      icon: <Brain className="h-4 w-4" />,
    });
  }

  if (data.recordCount === 0) {
    items.push({
      text: 'Upload your medical records to unlock the full picture of your health',
      to: '/records',
      priority: 'medium',
      icon: <Upload className="h-4 w-4" />,
    });
  }

  items.push({
    text: 'Share your records with a provider to keep your care team coordinated',
    to: '/share',
    priority: 'low',
    icon: <Share2 className="h-4 w-4" />,
  });

  return items;
}

export function Dashboard() {
  const auth = useContext(AuthContext);
  const userName = auth?.user?.name ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullInsight, setShowFullInsight] = useState(false);

  // Upload state
  const [uploadDropOpen, setUploadDropOpen] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploading, setUploading] = useState(false);

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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  });

  const handleUploadClick = () => {
    if (stagedFiles.length === 0) return;
    setPendingFiles(stagedFiles);
    setFileConfigs(stagedFiles.map(f => ({ name: stripExtension(f.name), type: 'OTHER' as RecordType })));
    setCurrentFileIndex(0);
    setUploadDropOpen(false);
    setUploadConfirmOpen(true);
  };

  const updateCurrentConfig = (patch: Partial<FileConfig>) => {
    setFileConfigs(prev => prev.map((c, i) => i === currentFileIndex ? { ...c, ...patch } : c));
  };

  const handleNextFile = () => {
    if (currentFileIndex < pendingFiles.length - 1) setCurrentFileIndex(i => i + 1);
  };

  const handlePrevFile = () => {
    if (currentFileIndex > 0) {
      setCurrentFileIndex(i => i - 1);
    } else {
      setUploadConfirmOpen(false);
      setUploadDropOpen(true);
    }
  };

  const handleConfirmUpload = async () => {
    setUploading(true);
    setUploadConfirmOpen(false);
    let uploaded = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i];
      const config = fileConfigs[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recordType', config.type);
      formData.append('recordName', config.name.trim() || stripExtension(file.name));
      try {
        await api.upload('/records', formData);
        uploaded++;
      } catch (err) {
        toast({ variant: 'destructive', title: `Failed to upload ${file.name}`, description: err instanceof Error ? err.message : 'Upload error' });
      }
    }
    if (uploaded > 0) {
      toast({ variant: 'success', title: `${uploaded} record${uploaded > 1 ? 's' : ''} uploaded`, description: 'Text has been extracted from your PDF.' });
      const refreshed = await api.get<DashboardData>('/dashboard');
      setData(refreshed);
    }
    setPendingFiles([]);
    setStagedFiles([]);
    setFileConfigs([]);
    setCurrentFileIndex(0);
    setUploading(false);
  };

  // Record preview
  const [previewRecord, setPreviewRecord] = useState<DashboardRecord | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfContainerRef, pdfWidth] = usePdfWidth(0);

  const openPreview = (r: DashboardRecord) => {
    setPreviewRecord(r);
    setNumPages(0);
    setPageNumber(1);
    setPdfError(null);
  };

  useEffect(() => {
    setLoading(true);
    api.get<DashboardData>('/dashboard')
      .then(setData)
      .finally(() => setLoading(false));
  }, [location.pathname]);

  const actionItems = data ? buildActionItems(data) : [];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-6 md:mb-8">
        <div className="flex items-start justify-between gap-3 mb-0.5">
          <h1 className="text-xl md:text-3xl font-bold text-gray-900">
            Good {getTimeOfDay()}, {userName.split(' ')[0]}!
          </h1>
          <Button
            onClick={() => { setStagedFiles([]); setUploadDropOpen(true); }}
            disabled={uploading}
            size="sm"
            className="gap-1.5 shrink-0"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
        <p className="text-sm md:text-lg text-gray-500">Here's a summary of your health</p>
      </div>

      {loading ? (
        <SkeletonList count={6} />
      ) : data ? (
        <div className="space-y-6">

          {/* Action Items */}
          <Card
            className="border-transparent"
            style={{
              background: 'linear-gradient(white, white) padding-box, linear-gradient(to right, #6da7cc, #91c5bf) border-box',
              border: '3px solid transparent',
            }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0" style={{ color: '#2b4257' }}>
                <ClipboardList className="h-5 w-5" style={{ color: '#2b4257' }} />
                Action Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actionItems.length === 0 ? (
                <p className="text-sm text-gray-500 py-2 text-center">You're all caught up — no action items right now.</p>
              ) : (
                <ul className="space-y-1">
                  {actionItems.map((item, i) => (
                    <li key={i}>
                      <Link
                        to={item.to}
                        className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-white/50 transition-colors group"
                      >
                        <span
                          className="mt-0.5 shrink-0"
                          style={{ color: item.priority === 'high' ? '#9b2c2c' : '#374151' }}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`text-sm flex-1 ${item.priority === 'high' ? 'font-medium' : ''}`}
                          style={{ color: item.priority === 'high' ? '#9b2c2c' : '#374151' }}
                        >
                          {item.text}
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Row 1: Upcoming Appointments + Active Medications */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Upcoming Appointments */}
            <Card className="flex flex-col h-[300px]">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0">
                  <Calendar className="h-5 w-5 shrink-0" style={{ color: '#2b4257' }} />
                  Upcoming Appointments
                </CardTitle>
                <Link to="/appointments" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                {data.upcomingAppointments.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <p className="text-sm text-gray-500">No upcoming appointments</p>
                    <Link to="/appointments">
                      <Button variant="outline" size="sm">Schedule a visit</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-0">
                    {data.upcomingAppointments.map((a) => (
                      <Link
                        key={a.id}
                        to={`/appointments?detail=${a.id}`}
                        className="flex items-start gap-3 py-3 border-b last:border-0 hover:bg-gray-50 rounded transition-colors"
                      >
                        <div className="rounded-lg p-1.5 mt-0.5 shrink-0" style={{ backgroundColor: '#d4eeeb' }}>
                          <Calendar className="h-3.5 w-3.5" style={{ color: '#1a5c55' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.providerName}</p>
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3 shrink-0" />
                            <span className="truncate">{format(new Date(a.scheduledAt), 'MMM d · h:mm a')}{a.specialty ? ` · ${a.specialty}` : ''}</span>
                          </p>
                          {a.reason && <p className="text-xs text-gray-500 mt-0.5 truncate">{a.reason}</p>}
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0 mt-1" />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Medications */}
            <Card className="flex flex-col h-[300px]">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0">
                  <Pill className="h-5 w-5 shrink-0" style={{ color: '#2b4257' }} />
                  Active Medications
                </CardTitle>
                <Link to="/medications" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                {data.medications.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <p className="text-sm text-gray-500">No medications on record</p>
                    <Link to="/medications">
                      <Button variant="outline" size="sm">Add medication</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-0">
                    {data.medications.map((m) => (
                      <div key={m.id} className="flex items-start gap-3 py-3 border-b last:border-0">
                        <div className="rounded-lg p-1.5 mt-0.5 shrink-0" style={{ backgroundColor: '#d4eeeb' }}>
                          <Pill className="h-3.5 w-3.5" style={{ color: '#1a5c55' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{m.name}</p>
                          {m.details && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{m.details}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Health Conditions + Recent Test Results */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Health Conditions */}
            <Card className="flex flex-col h-[300px]">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0">
                  <Stethoscope className="h-5 w-5 shrink-0" style={{ color: '#2b4257' }} />
                  Health Conditions
                </CardTitle>
                <Link to="/history" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                {data.conditions.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-gray-500">No active conditions on record</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-0">
                    {data.conditions.map((c) => (
                      <div key={c.id} className="flex items-start gap-3 py-3 border-b last:border-0">
                        <div className="rounded-lg p-1.5 mt-0.5 shrink-0" style={{ backgroundColor: '#d4eeeb' }}>
                          <Stethoscope className="h-3.5 w-3.5" style={{ color: '#1a5c55' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                          {c.details && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.details}</p>}
                          {c.startDate && (
                            <p className="text-xs text-gray-400 mt-0.5">Since {format(new Date(c.startDate), 'MMM yyyy')}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Test Results */}
            <Card className="flex flex-col h-[300px]">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0">
                  <FlaskConical className="h-5 w-5 shrink-0" style={{ color: '#2b4257' }} />
                  Recent Test Results
                </CardTitle>
                <Link to="/labs" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                {data.recentLabResults.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-gray-500">No test results logged yet</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-0">
                    {data.recentLabResults.map((lab) => {
                      const status = getDashboardLabStatus(lab);
                      const iconBg = status === 'flagged' ? '#fde8e8' : status === 'borderline' ? '#fef3e2' : '#e6f4ea';
                      const iconColor = status === 'flagged' ? '#9b2c2c' : status === 'borderline' ? '#9c4221' : '#276749';
                      const valueColor = status === 'flagged' ? '#9b2c2c' : status === 'borderline' ? '#9c4221' : '#276749';
                      return (
                        <div key={lab.id} className="flex items-center gap-3 py-3 border-b last:border-0">
                          <div className="rounded-lg p-1.5 shrink-0" style={{ backgroundColor: iconBg }}>
                            <FlaskConical className="h-3.5 w-3.5" style={{ color: iconColor }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-900 truncate">{lab.testName}</p>
                              <span className="text-sm font-semibold shrink-0" style={{ color: valueColor }}>
                                {lab.value} {lab.unit}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {status === 'flagged' && <Badge className="text-xs" style={{ backgroundColor: '#9b2c2c', color: '#ffffff', border: 'none' }}>Flagged</Badge>}
                              {status === 'borderline' && <Badge className="text-xs" style={{ backgroundColor: '#9c4221', color: '#ffffff', border: 'none' }}>Flagged</Badge>}
                              {lab.referenceMin !== undefined && lab.referenceMax !== undefined && (
                                <span className="text-xs text-gray-400">Ref: {lab.referenceMin}–{lab.referenceMax} {lab.unit}</span>
                              )}
                              <span className="text-xs text-gray-400">{format(new Date(lab.recordedAt), 'MMM d, yyyy')}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Health Intelligence + Recent Records side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Health Intelligence Excerpt */}
          <Card className="flex flex-col h-[300px]">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0" style={{ color: '#2b4257' }}>
                <Brain className="h-5 w-5" style={{ color: '#2b4257' }} />
                Health Intelligence Report
              </CardTitle>
              <Link to="/insights" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              {!data.latestInsight ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <p className="text-sm text-gray-500">No analysis run yet</p>
                  <Link to="/insights">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Brain className="h-4 w-4" />
                      Generate health analysis
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-2">
                      Generated {formatDistanceToNow(new Date(data.latestInsight.generatedAt), { addSuffix: true })}
                    </p>
                    <p className={`text-sm text-gray-700 leading-relaxed ${!showFullInsight ? 'line-clamp-3' : ''}`}>
                      {data.latestInsight.summary}
                    </p>
                    {data.latestInsight.summary.length > 200 && (
                      <button
                        onClick={() => setShowFullInsight((v) => !v)}
                        className="text-sm text-primary hover:underline mt-1.5"
                      >
                        {showFullInsight ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>

                  {(data.latestInsight.insights as InsightItem[]).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Key Insights</p>
                      {(data.latestInsight.insights as InsightItem[]).slice(0, 2).map((insight, i) => {
                        const confidenceStyles: Record<string, { bg: string; text: string; dot: string }> = {
                          high:     { bg: '#d4eeeb', text: '#2b4257', dot: '#5ba8a0' },
                          moderate: { bg: '#d4eeeb', text: '#2b4257', dot: '#5ba8a0' },
                          low:      { bg: '#d4eeeb', text: '#2b4257', dot: '#5ba8a0' },
                        };
                        const style = confidenceStyles[insight.confidence] ?? confidenceStyles.low;
                        return (
                          <div key={i} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5" style={{ background: style.bg }}>
                            <span className="mt-0.5 text-base leading-none" style={{ color: style.dot }}>•</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium" style={{ color: style.text }}>{insight.title}</p>
                              {insight.suggestedDiscussion && (
                                <p className="text-xs mt-0.5" style={{ color: style.text, opacity: 0.8 }}>{insight.suggestedDiscussion}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {data.latestInsight.insights.length > 2 && (
                        <Link to="/insights" className="text-sm text-primary hover:underline block text-center pt-1">
                          View {data.latestInsight.insights.length - 2} more insight{data.latestInsight.insights.length - 2 > 1 ? 's' : ''} →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Records */}
          <Card className="flex flex-col h-[300px]">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm md:text-base flex items-center gap-2 min-w-0">
                <FileText className="h-5 w-5 shrink-0" style={{ color: '#2b4257' }} />
                Recent Records
              </CardTitle>
              <Link to="/records" className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0 whitespace-nowrap">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              {data.recentRecords.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <p className="text-sm text-gray-500">No records from the past year</p>
                  <Link to="/records">
                    <Button variant="outline" className="gap-2">
                      <Upload className="h-4 w-4" />
                      Upload records
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                  {data.recentRecords.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => openPreview(r)}
                      className="w-full flex items-center gap-3 rounded-lg border bg-gray-50/50 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="rounded-lg p-1.5 shrink-0" style={{ backgroundColor: '#d4eeeb' }}>
                        <FileText className="h-3.5 w-3.5" style={{ color: '#1a5c55' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">{r.fileName}</p>
                        {r.providerName && <p className="text-xs text-gray-500 truncate">{r.providerName}</p>}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <Badge variant={RECORD_TYPE_COLORS[r.recordType]} className="text-xs">{RECORD_TYPE_LABELS[r.recordType]}</Badge>
                        <p className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </div>{/* end side-by-side grid */}

        </div>
      ) : null}

      {/* Upload drop zone dialog */}
      <Dialog open={uploadDropOpen} onOpenChange={(open) => { if (!open) setUploadDropOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload records</DialogTitle>
          </DialogHeader>
          <div
            {...getRootProps()}
            className={`mt-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 cursor-pointer transition-colors ${isDragActive ? 'border-primary bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-primary hover:bg-blue-50/40'}`}
          >
            <input {...getInputProps()} />
            <Upload className="h-8 w-8 text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-700">Drop files here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">PDF format only, max 20 MB</p>
          </div>
          {stagedFiles.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {stagedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2">
                  <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-700 flex-1 truncate">{f.name}</span>
                  <button onClick={() => setStagedFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setUploadDropOpen(false)}>Cancel</Button>
            <Button onClick={handleUploadClick} disabled={stagedFiles.length === 0}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload confirm dialog */}
      <Dialog open={uploadConfirmOpen} onOpenChange={(open) => { if (!open) { setUploadConfirmOpen(false); setPendingFiles([]); setFileConfigs([]); setCurrentFileIndex(0); } }}>
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
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label>Record Name</Label>
                <Input
                  value={fileConfigs[currentFileIndex].name}
                  onChange={(e) => updateCurrentConfig({ name: e.target.value })}
                  placeholder="e.g. Annual Lab Results"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Record Type</Label>
                <Select value={fileConfigs[currentFileIndex].type} onValueChange={(v) => updateCurrentConfig({ type: v as RecordType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RECORD_TYPE_LABELS) as RecordType[]).map((t) => (
                      <SelectItem key={t} value={t}>{RECORD_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={handlePrevFile}>
              {currentFileIndex === 0 ? 'Back' : 'Back'}
            </Button>
            {currentFileIndex < pendingFiles.length - 1 ? (
              <Button onClick={handleNextFile}>Next</Button>
            ) : (
              <Button onClick={handleConfirmUpload}>
                {pendingFiles.length > 1 ? `Upload ${pendingFiles.length} files` : 'Upload'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record preview modal */}
      <Dialog open={!!previewRecord} onOpenChange={(open) => { if (!open) setPreviewRecord(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="text-base font-semibold truncate pr-6">
              {previewRecord?.fileName}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {previewRecord && <Badge variant={RECORD_TYPE_COLORS[previewRecord.recordType]} className="text-xs">{RECORD_TYPE_LABELS[previewRecord.recordType]}</Badge>}
              {previewRecord?.providerName && <span className="text-xs text-gray-500">{previewRecord.providerName}</span>}
            </div>
          </DialogHeader>

          {/* PDF preview area */}
          <div ref={pdfContainerRef} className="flex-1 overflow-auto bg-gray-100 flex justify-center min-h-0">
            {previewRecord && (
              <Document
                file={`/api/records/${previewRecord.id}/view`}
                onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); setPdfError(null); }}
                onLoadError={(err) => setPdfError(err.message)}
                loading={<div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading preview…</div>}
                error={<div className="py-12 px-6 text-sm text-red-400 text-center">{pdfError ?? 'Could not render preview.'}</div>}
                className="py-4"
              >
                <Page pageNumber={pageNumber} width={pdfWidth} renderTextLayer renderAnnotationLayer />
              </Document>
            )}
          </div>

          {/* Footer: pagination + actions */}
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
            <Button
              size="sm"
              className="gap-2"
              onClick={() => { const id = previewRecord?.id; setPreviewRecord(null); navigate(`/records?open=${id}`); }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View in Records
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
