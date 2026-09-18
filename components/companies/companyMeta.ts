import { CompanySize } from '../../types';

export const SIZE_META: Record<CompanySize, { label: string }> = {
  '1-10': { label: '1-10' },
  '11-50': { label: '11-50' },
  '51-200': { label: '51-200' },
  '201-1000': { label: '201-1000' },
  '1000+': { label: '1000+' },
};

export const MEMBERSHIP_META = {
  next40: { label: 'NEXT40', className: 'bg-violet-50 text-violet-700' },
  frenchTech120: { label: 'FT120', className: 'bg-blue-50 text-blue-700' },
  remoteFriendly: { label: 'Remote-friendly', className: 'bg-teal-50 text-teal-700' },
} as const;
