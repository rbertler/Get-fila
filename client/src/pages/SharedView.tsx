import { parseDate } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { FilaLogo } from '@/components/FilaLogo';
import { format } from 'date-fns';

interface SharedViewData {
  patientName: string;
  config: Record<string, unknown>;
  expiresAt: string;
  accessCount: number;
}

export function SharedView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/share/view/${token}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Not found' }));
          throw new Error(body.error);
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-lg">Loading health summary</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Link unavailable</h1>
          <p className="text-gray-500 text-lg">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <FilaLogo size="sm" />
        <span className="text-sm text-gray-400">Shared health summary</span>
      </header>

      <div className="max-w-4xl mx-auto p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-base text-amber-800">
            This is a patient-shared health summary. It is <strong>not a medical diagnosis</strong> and should be reviewed in the context of a clinical consultation.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Health Summary for {data?.patientName}</h1>
          <p className="text-gray-500">Shared link · Expires {data ? format(parseDate(data.expiresAt), 'MMMM d, yyyy') : ''}</p>
        </div>

        <div className="rounded-lg border bg-white p-6">
          <p className="text-base text-gray-700 mb-4">This summary was generated using Fila, a patient-controlled health records platform.</p>
          <p className="text-base text-gray-600">
            The full PDF report is available at:
          </p>
          <a
            href={`/api/share/view/${token}/report`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 text-primary font-medium hover:underline"
          >
            <ExternalLink className="h-4 w-4" /> Download PDF Report
          </a>
        </div>
      </div>
    </div>
  );
}
