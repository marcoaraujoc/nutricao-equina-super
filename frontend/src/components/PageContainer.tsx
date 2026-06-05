// src/components/PageContainer.tsx

import type { ReactNode } from 'react';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';

interface PageContainerProps {
  children:   ReactNode;
  maxWidth?:  MaxWidth;
  noPadding?: boolean;
  className?: string;
}

const maxWidthMap: Record<MaxWidth, string> = {
  sm:    'max-w-sm',
  md:    'max-w-md',
  lg:    'max-w-lg',
  xl:    'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full:  'max-w-full',
};

export default function PageContainer({
  children,
  maxWidth  = '7xl',
  noPadding = false,
  className = '',
}: PageContainerProps) {
  return (
    <div className={`w-full ${maxWidthMap[maxWidth]} mx-auto ${noPadding ? '' : 'px-6 py-6 md:px-10 md:py-8'} ${className}`}>
      {children}
    </div>
  );
}
