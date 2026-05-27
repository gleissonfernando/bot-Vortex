import type { Metadata } from 'next';
import { AppVersionGuard } from '@/components/app-version-guard';
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
        <AppVersionGuard />
        <MaintenanceBanner />
        {children}
      </body>
    </html>
  );
}
