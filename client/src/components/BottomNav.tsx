import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, History, Brain, FileText, Users, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Home' },
  { to: '/appointments',  icon: Calendar,         label: 'Appts' },
  { to: '/history',       icon: History,          label: 'History' },
  { to: '/insights',      icon: Brain,            label: 'Intel' },
  { to: '/records',       icon: FileText,         label: 'Records' },
  { to: '/providers',     icon: Users,            label: 'Providers' },
];

export function BottomNav() {
  const { logout } = useAuth();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex md:hidden border-t"
      style={{ background: 'linear-gradient(135deg, #244a73 0%, #adcce6 100%)', borderColor: '#d6e6f5' }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'bg-white/30 text-[#102a45]' : 'text-[#102a45]/70 hover:bg-white/20 hover:text-[#102a45]'
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-[#102a45]' : 'text-[#102a45]/70')} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        onClick={() => logout()}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors text-[#102a45]/70 hover:bg-white/20 hover:text-[#102a45]"
      >
        <LogOut className="h-5 w-5 shrink-0" />
        <span>Sign out</span>
      </button>
    </nav>
  );
}
