import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg py-12 px-6 text-center">
      <div className="mx-auto w-10 h-10 rounded-lg bg-[#E9F2FF] text-[#1265C8] flex items-center justify-center mb-3">
        <Inbox className="w-5 h-5" />
      </div>
      <h3 className="typo-card-heading text-[#172B46]">{title}</h3>
      <p className="mt-1.5 typo-body text-[#75869D] max-w-md mx-auto">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
