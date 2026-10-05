import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface HeaderProps {
  onOpenTestsModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTestsModal: _onOpenTestsModal }) => {
  const { activeRole } = useApp();

  return (
    <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between text-slate-800 select-none z-20 shadow-xs">
      {/* Brand & Module Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-emerald-700 flex items-center justify-center font-bold text-white tracking-widest text-sm shadow-sm">
          CFT
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-tight text-slate-900 text-sm">
              CICOR FLOW TECHNOLOGIES
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono font-semibold border border-emerald-200">
              Role & Milestone Tracker
            </span>
          </div>
          <p className="text-[10px] text-slate-500 leading-none mt-0.5">Strict Sequential Workflow & Date Milestone Control</p>
        </div>
      </div>

      {/* Right Controls: Active Role Badge */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 bg-emerald-50/80 border border-emerald-200 rounded-lg px-3.5 py-1.5 text-emerald-900 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Role:</span>
              <span className="text-xs font-bold text-emerald-950">{activeRole}</span>
            </div>
            <span className="text-[9px] text-emerald-700 font-mono leading-none mt-0.5">
              Strict Single-Role Exclusive Milestone Completion
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

