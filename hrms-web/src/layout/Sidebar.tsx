import { Menu, ConfigProvider } from 'antd';
import { Link } from 'react-router-dom';
import {
  DashboardOutlined,
  TeamOutlined,
  FolderOutlined,
  SafetyOutlined,
  FileTextOutlined,
  ProjectOutlined,
  CalendarOutlined,
  BarChartOutlined,
  MoneyCollectOutlined,
  HeartOutlined,
  GlobalOutlined,
  ShopOutlined,
  SettingOutlined,
  LinkOutlined
} from '@ant-design/icons';
import { useTheme } from '../contexts/ThemeContext';

export default function Sidebar({ activePath, onNavClick }: { activePath: string; onNavClick?: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isPortfolioView = activePath.startsWith('/portfolio');

  // Portfolio-only items
  const portfolioItems = [
    {
      key: 'portfolio',
      icon: <GlobalOutlined />,
      label: 'Portfolio',
      children: [
        { key: '/portfolio', label: <Link to="/portfolio">Overview Dashboard</Link> },
        { key: '/portfolio/clients', label: <Link to="/portfolio/clients">Client Management</Link> },
      ]
    },
  ];

  // Workspace items (only show when NOT in portfolio view)
  const workspaceItems = [
    {
      key: 'hcm',
      icon: <TeamOutlined />,
      label: 'Human Capital',
      children: [
        { key: '/hcm/departments', label: <Link to="/hcm/departments">Departments</Link> },
        { key: '/hcm/demography', label: <Link to="/hcm/demography">Demography</Link> },
        { key: '/hcm/engagements-terminations', label: <Link to="/hcm/engagements-terminations">Engagements & Terminations</Link> },
        { key: '/hcm/summary', label: <Link to="/hcm/summary">Summary</Link> },
        { key: '/hcm/contract-schedule', label: <Link to="/hcm/contract-schedule">Contract Schedule</Link> },
        { key: '/hcm/medicals', label: <Link to="/hcm/medicals">Medical Management</Link> },
        { key: '/hcm/sites', label: <Link to="/hcm/sites">Site Management</Link> },
      ]
    },
    { key: '/tracking/trainings', icon: <SafetyOutlined />, label: <Link to="/tracking/trainings">Trainings</Link> },
    {
      key: 'activities',
      icon: <FileTextOutlined />,
      label: 'Activities',
      children: [
        { key: '/activities/case-studies', label: <Link to="/activities/case-studies">Case Studies</Link> },
        { key: '/activities/hearings', label: <Link to="/activities/hearings">Hearings</Link> },
        { key: '/activities/investigations', label: <Link to="/activities/investigations">Investigations</Link> },
        { key: '/activities/charges', label: <Link to="/activities/charges">Charges</Link> },
        { key: '/activities/reports', label: <Link to="/activities/reports">Reports</Link> },
        { key: '/activities/appraisals', label: <Link to="/activities/appraisals">Appraisals</Link> },
      ]
    },
    {
      key: 'recruitment',
      icon: <FolderOutlined />,
      label: 'Recruitment',
      children: [
        { key: '/recruitment/atr', label: <Link to="/recruitment/atr">ATR</Link> },
        { key: '/recruitment/recruitment-sheet', label: <Link to="/recruitment/recruitment-sheet">Data Sheet</Link> },
      ]
    },
    {
      key: 'payroll',
      icon: <MoneyCollectOutlined />,
      label: 'Salary Management',
      children: [
        { key: '/payroll/salary-management', label: <Link to="/payroll/salary-management">Dashboard</Link> },
        { key: '/payroll/management', label: <Link to="/payroll/management">Payroll</Link> },
        { key: '/payroll/employer-contributions', label: <Link to="/payroll/employer-contributions">Employer Costs</Link> },
        { key: '/payroll/remittance-report', label: <Link to="/payroll/remittance-report">Remittance Report</Link> },
        { key: '/payroll/statutory-returns', label: <Link to="/payroll/statutory-returns">Statutory Returns</Link> },
        { key: '/payroll/settlements', label: <Link to="/payroll/settlements">Final Settlements</Link> },
      ]
    },
    {
      key: 'leave',
      icon: <HeartOutlined />,
      label: 'Leave Management',
      children: [
        { key: '/leave', label: <Link to="/leave">Leave & Sick Notes</Link> },
        { key: '/leave/absenteeism', label: <Link to="/leave/absenteeism">Absenteeism</Link> },
      ]
    },
    {
      key: 'analytics',
      icon: <BarChartOutlined />,
      label: 'Analytics',
      children: [
        { key: '/analytics', label: <Link to="/analytics">General Analytics</Link> },
        { key: '/analytics/era', label: <Link to="/analytics/era">ERA</Link> },
      ]
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      children: [
        { key: '/settings/roles', label: <Link to="/settings/roles">Roles Management</Link> },
        { key: '/settings/statutory', label: <Link to="/settings/statutory">Statutory Settings</Link> },
        { key: '/settings/leave', label: <Link to="/settings/leave">Leave, Holidays & Gratuity</Link> },
        { key: '/settings/access-requests', label: <Link to="/settings/access-requests">Access Requests</Link> },
        { key: '/debug/workspaces', label: <Link to="/debug/workspaces">Debug Workspace Access</Link> },
      ]
    },
  ];

  // Determine which items to show
  const isConsultant = localStorage.getItem('isConsultant') === '1';
  const baseWorkspaceItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Workspace Dashboard</Link> },
    { key: '/schedule', icon: <CalendarOutlined />, label: <Link to="/schedule">Schedule</Link> },
    { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">Projects</Link> },
    ...workspaceItems,
  ];

  const items = isPortfolioView ? portfolioItems : [
    ...(isConsultant ? [
      { key: '/portfolio', icon: <GlobalOutlined />, label: <Link to="/portfolio">Portfolio Overview</Link> },
      { key: '/workspace-directory', icon: <LinkOutlined />, label: <Link to="/workspace-directory">Workspace Directory</Link> },
    ] : []),
    ...baseWorkspaceItems,
  ];

  const findSelected = (path: string): string[] => {
    const allItems = [...portfolioItems,
    { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Workspace Dashboard</Link> },
    { key: '/schedule', icon: <CalendarOutlined />, label: <Link to="/schedule">Schedule</Link> },
    { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">Projects</Link> },
    ...workspaceItems,
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      children: [
        { key: '/settings/roles', label: <Link to="/settings/roles">Roles Management</Link> },
        { key: '/settings/access-requests', label: <Link to="/settings/access-requests">Access Requests</Link> },
        { key: '/debug/workspaces', label: <Link to="/debug/workspaces">Debug Workspace Access</Link> },
      ]
    }
    ];
    for (const item of allItems) {
      if (item.children) {
        const child = item.children.find((c: any) => path.startsWith(c.key));
        if (child) return [child.key];
      } else if (path.startsWith(item.key)) {
        return [item.key];
      }
    }
    return [];
  };

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: isDark ? '#f5c400' : '#f3effa',
        colorBgBase: 'transparent',
        colorBgContainer: 'transparent',
        colorBorder: isDark ? 'rgba(245, 196, 0, 0.18)' : 'rgba(255, 255, 255, 0.22)',
        colorText: isDark ? '#f7f8fb' : '#f3effa',
        colorTextSecondary: isDark ? '#c4c8d4' : '#d0c5e4',
        colorBgElevated: 'rgba(15, 22, 40, 0.5)',
        borderRadius: 8,
      },
      components: {
        Menu: {
          colorBgBase: 'transparent',
          itemBg: 'transparent',
          itemHoverBg: isDark ? 'rgba(245, 196, 0, 0.08)' : 'rgba(255, 255, 255, 0.045)',
          itemSelectedBg: isDark ? 'rgba(245, 196, 0, 0.12)' : 'rgba(255, 255, 255, 0.11)',
          horizontalItemSelectedBg: isDark ? 'rgba(245, 196, 0, 0.12)' : 'rgba(255, 255, 255, 0.11)',
          colorPrimaryBorder: isDark ? 'rgba(245, 196, 0, 0.2)' : 'rgba(255, 255, 255, 0.24)',
          itemColor: isDark ? '#f7f8fb' : '#f3effa',
          itemSelectedColor: isDark ? '#f7f8fb' : '#f8f5ff',
          subMenuItemBg: 'transparent',
        },
      },
    }}>
      <Menu
        theme="dark"
        mode="inline"
        items={items}
        selectedKeys={findSelected(activePath)}
        className="app-sidebar-menu"
        style={{ background: 'transparent', border: 'none' }}
        onClick={onNavClick ? () => onNavClick() : undefined}
      />
    </ConfigProvider>
  );
}
