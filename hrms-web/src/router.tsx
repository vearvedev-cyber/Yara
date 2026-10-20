import { createHashRouter, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import Overview from './views/Dashboard/Overview';
import ManagerDashboard from './views/Dashboard/ManagerDashboard';
import PortfolioDashboard from './views/Portfolio/PortfolioDashboard';
import ClientManagement from './views/Portfolio/ClientManagement';
import { SalaryManagementDashboard } from './views/SalaryManagementDashboard';
import Departments from './views/HCM/Departments';
import Demography from './views/HCM/Demography';
import EngagementsTerminations from './views/HCM/EngagementsTerminations';
import Summary from './views/HCM/Summary';
import ContractSchedule from './views/HCM/ContractSchedule';
import Medicals from './views/HCM/Medicals';
import SiteList from './views/HCM/Sites/SiteList';
import SiteManage from './views/HCM/Sites/SiteManage';
import Trainings from './views/Tracking/Trainings';
import CaseStudies from './views/Activities/CaseStudies';
import Hearings from './views/Activities/Hearings';
import Investigations from './views/Activities/Investigations';
import Charges from './views/Activities/Charges';
import Reports from './views/Activities/Reports';
import Appraisals from './views/Activities/Appraisals';
import Schedule from './views/Schedule/Schedule';
import Projects from './views/Projects/Projects';
import ATR from './views/Recruitment/ATR';
import RecruitmentSheet from './views/Recruitment/RecruitmentSheet';
import Analytics from './views/Analytics/Analytics';
import ERA from './views/Analytics/ERA';
import Login from './views/Auth/Login';
import InviteByCode from './views/Auth/InviteByCode.tsx';
import MessagingInbox from './views/Messaging/MessagingInbox';
import ProtectedRoute from './components/ProtectedRoute';
import SmartRedirect from './components/SmartRedirect';
import LeaveDashboard from './views/Leave/LeaveDashboard';
import Absenteeism from './views/Leave/Absenteeism';
import UserProfile from './views/Profile/UserProfile';
import RolesManagement from './views/Settings/RolesManagement';
import StatutorySettingsManagement from './views/Settings/StatutorySettingsManagement';
import LeaveSettings from './views/Settings/LeaveSettings';
import FinalSettlements from './views/Payroll/FinalSettlements';
import FinalSettlementDetail from './views/Payroll/FinalSettlementDetail';
import PayrollManagement from './views/Payroll/PayrollManagement';
import EmployerContributions from './views/Payroll/EmployerContributions';
import RemittanceReport from './views/Payroll/RemittanceReport';
import StatutoryReturns from './views/Payroll/StatutoryReturns';
import WorkspaceDirectory from './views/Core/WorkspaceDirectory';
import AccessRequestsManagement from './views/Core/AccessRequestsManagement';
import WorkspaceDebug from './views/Core/WorkspaceDebug';
import RouteErrorBoundary from './components/RouteErrorBoundary';

export const router = createHashRouter([
  { path: '/login', element: <Login />, errorElement: <RouteErrorBoundary /> },
  { path: '/invite', element: <InviteByCode />, errorElement: <RouteErrorBoundary /> },
  { path: '/messaging', element: <ProtectedRoute><MessagingInbox /></ProtectedRoute>, errorElement: <RouteErrorBoundary /> },
  {
    path: '/',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <SmartRedirect /> },
      { path: 'portfolio', element: <PortfolioDashboard /> },
      { path: 'portfolio/overview', element: <Navigate to="/portfolio" replace /> },
      { path: 'portfolio/clients', element: <ClientManagement /> },
      { path: 'dashboard', element: <Overview /> },
      { path: 'dashboard/manager', element: <ManagerDashboard /> },
      { path: 'projects', element: <Projects /> },
      { path: 'schedule', element: <Schedule /> },
      { path: 'hcm/departments', element: <Departments /> },
      { path: 'hcm/demography', element: <Demography /> },
      { path: 'hcm/engagements-terminations', element: <EngagementsTerminations /> },
      { path: 'hcm/summary', element: <Summary /> },
      { path: 'hcm/contract-schedule', element: <ContractSchedule /> },
      { path: 'hcm/medicals', element: <Medicals /> },
      { path: 'hcm/sites', element: <SiteList /> },
      { path: 'hcm/sites/:id/manage', element: <SiteManage /> },
      { path: 'tracking/trainings', element: <Trainings /> },
      { path: 'activities/case-studies', element: <CaseStudies /> },
      { path: 'activities/hearings', element: <Hearings /> },
      { path: 'activities/investigations', element: <Investigations /> },
      { path: 'activities/charges', element: <Charges /> },
      { path: 'activities/reports', element: <Reports /> },
      { path: 'activities/appraisals', element: <Appraisals /> },
      { path: 'recruitment/atr', element: <ATR /> },
      { path: 'recruitment/recruitment-sheet', element: <RecruitmentSheet /> },
      { path: 'payroll/salary-management', element: <SalaryManagementDashboard /> },
      { path: 'leave', element: <LeaveDashboard /> },
      { path: 'leave/absenteeism', element: <Absenteeism /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'analytics/era', element: <ERA /> },
      { path: 'settings/roles', element: <RolesManagement /> },
      { path: 'settings/statutory', element: <StatutorySettingsManagement /> },
      { path: 'settings/leave', element: <LeaveSettings /> },
      { path: 'payroll/management', element: <PayrollManagement /> },
      { path: 'payroll/employer-contributions', element: <EmployerContributions /> },
      { path: 'payroll/remittance-report', element: <RemittanceReport /> },
      { path: 'payroll/statutory-returns', element: <StatutoryReturns /> },
      { path: 'payroll/settlements', element: <FinalSettlements /> },
      { path: 'payroll/settlements/:id', element: <FinalSettlementDetail /> },
      { path: 'workspace-directory', element: <WorkspaceDirectory /> },
      { path: 'settings/access-requests', element: <AccessRequestsManagement /> },
      { path: 'debug/workspaces', element: <WorkspaceDebug /> },
      { path: 'profile', element: <UserProfile /> },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
