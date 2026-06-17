import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './app/page';
import AbsencesPage from './app/dashboard/absences/page';
import AntiAbusePage from './app/dashboard/anti-abuse/page';
import BauPage from './app/dashboard/bau/page';
import BotVortexPage from './app/dashboard/bot-vortex/page';
import DashboardPage from './app/dashboard/page';
import LivesPage from './app/dashboard/lives/page';
import MemberProfilePage from './app/dashboard/members/[id]/page';
import MembersPage from './app/dashboard/members/page';
import OrdersPage from './app/dashboard/orders/page';
import ReportsPage from './app/dashboard/reports/page';
import SiteUsersPage from './app/dashboard/site-users/page';
import { AppVersionGuard } from './components/app-version-guard';
import { MaintenanceBanner } from './components/maintenance-banner';
import { RouterProvider, usePathname } from './lib/router';

const routes: Array<[RegExp, () => ReactElement]> = [
  [/^\/dashboard\/members\/[^/]+$/, () => <MemberProfilePage />],
  [/^\/dashboard\/members\/?$/, () => <MembersPage />],
  [/^\/dashboard\/absences\/?$/, () => <AbsencesPage />],
  [/^\/dashboard\/anti-abuse\/?$/, () => <AntiAbusePage />],
  [/^\/dashboard\/bau\/?$/, () => <BauPage />],
  [/^\/dashboard\/bot-vortex\/?$/, () => <BotVortexPage />],
  [/^\/dashboard\/lives\/?$/, () => <LivesPage />],
  [/^\/dashboard\/orders\/?$/, () => <OrdersPage />],
  [/^\/dashboard\/reports\/?$/, () => <ReportsPage />],
  [/^\/dashboard\/site-users\/?$/, () => <SiteUsersPage />],
  [/^\/dashboard\/?$/, () => <DashboardPage />],
  [/^\/(?:login)?$/, () => <LoginPage />]
];

function App() {
  const pathname = usePathname();
  const match = routes.find(([pattern]) => pattern.test(pathname));
  const Page = match?.[1] || (() => <DashboardPage />);
  return (
    <>
      <AppVersionGuard />
      <MaintenanceBanner />
      <Page />
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root nao encontrado.');

createRoot(root).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>
);
