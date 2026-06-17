import { AppVersionGuard } from '@/components/app-version-guard';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <>
    <AppVersionGuard />
    <MaintenanceBanner />
    {children}
  </>;
}
