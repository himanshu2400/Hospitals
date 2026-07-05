import { Activity } from 'lucide-react';
import type { Clinic } from '../lib/types';

type Props = {
  clinic: Pick<Clinic, 'name' | 'logo_url'> | null | undefined;
  subtitle?: string;
  right?: React.ReactNode;
};

export function BrandHeader({ clinic, subtitle, right }: Props) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-white/80 border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {clinic?.logo_url ? (
            <img
              src={clinic.logo_url}
              alt={clinic.name}
              className="w-10 h-10 rounded-xl object-cover bg-white ring-1 ring-slate-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl brand-bg flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5" strokeWidth={2.5} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-semibold text-slate-900 truncate leading-tight">
              {clinic?.name ?? 'QueueFlow'}
            </h1>
            {subtitle && (
              <p className="text-xs text-slate-500 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </header>
  );
}
