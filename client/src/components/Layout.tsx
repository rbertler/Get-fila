import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useInsight } from '@/context/InsightContext';
import { Brain } from 'lucide-react';

function InsightGeneratingBanner() {
  const { generating } = useInsight();
  if (!generating) return null;

  return (
    <div className="fixed bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 z-50 w-80 rounded-xl border bg-white shadow-lg px-4 py-3 space-y-2">
      <p className="text-sm font-medium flex items-center gap-2" style={{ color: '#2b4257' }}>
        <Brain className="h-4 w-4 shrink-0" style={{ color: '#6da7cc' }} />
        Analyzing your health data
      </p>
      <div className="h-2 w-full rounded-full overflow-hidden bg-gray-100">
        <div
          className="h-full rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite]"
          style={{ background: 'linear-gradient(135deg, #91c5bf 0%, #6da7cc 100%)' }}
        />
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#e3ebf2]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>
      <BottomNav />
      <InsightGeneratingBanner />
    </div>
  );
}
