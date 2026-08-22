// components/home/Reveal.tsx
// Animação de entrada ao rolar a página — usada por todas as seções da Home.
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export const easeOut = [0.22, 1, 0.36, 1] as const;

interface Props {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}

export default function Reveal({ children, delay = 0, y = 24, className }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 1.1, ease: easeOut, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
