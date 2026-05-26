import type { Metadata } from 'next';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vortex Frequency',
  description: 'Painel de frequencia para membros do Discord'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <MaintenanceBanner />
        {children}
      </body>
    </html>
  );
}
