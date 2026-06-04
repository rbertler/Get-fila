import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  History,
  Calendar,
  Brain,
  LogOut,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';
import { FilaLogo } from '@/components/FilaLogo';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/appointments', icon: Calendar, label: 'Appointments' },
  { to: '/history', icon: History, label: 'Health History' },
  { to: '/insights', icon: Brain, label: 'Health Intelligence' },
  { to: '/records', icon: FileText, label: 'Records' },
  { to: '/providers', icon: Users, label: 'Provider Directory' },
];

const BRAND_TEXT = '#2b4257';

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast({ title: 'Signed out', description: 'See you next time.' });
    navigate('/login');
  };

  return (
    <aside
      className="flex h-screen w-64 flex-col"
      style={{ background: 'linear-gradient(135deg, #6da7cc 0%, #91c5bf 100%)' }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center px-6 py-5 border-b border-[#e3ebf2]">
        <FilaLogo size="sm" variant="light" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors min-h-[44px]',
                isActive
                  ? 'bg-white/30 text-[#2b4257]'
                  : 'hover:bg-white/20'
              )
            }
            style={{ color: BRAND_TEXT }}
          >
            {({ isActive }) => (
              <>
                <Icon className="h-5 w-5 shrink-0" style={{ color: BRAND_TEXT }} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-[#e3ebf2] px-3 py-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="mb-2 px-3 py-1">
          <p className="text-base font-medium truncate" style={{ color: BRAND_TEXT }}>{user?.name}</p>
          <p className="text-sm truncate" style={{ color: BRAND_TEXT, opacity: 0.7 }}>{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors min-h-[44px] hover:bg-white/20"
          style={{ color: BRAND_TEXT, fontFamily: 'Inter, system-ui, sans-serif' }}
        >
          <LogOut className="h-5 w-5 shrink-0" style={{ color: BRAND_TEXT }} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
