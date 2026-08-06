import { Row, Col, Typography, Button, Space, Progress } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import http from '../../lib/http';
import { TeamOutlined, FileTextOutlined, AlertOutlined } from '@ant-design/icons';
import { GlassCard, TagPill } from '../../components/NeonPrimitives';
import { KPICard } from '../../components/KPICard';
import { HeroBanner } from '../../components/HeroBanner';

const { Text } = Typography;

export default function PortfolioDashboard() {
  const nav = useNavigate();
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'good' | 'attention'>('all');
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('light-mode');

  const textPrimary = isLight ? '#1f192c' : '#f7f8fb';
  const textSecondary = isLight ? '#3c3550' : '#c4c8d4';
  const textMuted = isLight ? '#55506a' : '#c4c8d4';
  const softPanelBg = isLight ? 'rgba(31, 25, 44, 0.06)' : 'rgba(255, 255, 255, 0.02)';
  const softPanelBorder = isLight ? '1px solid rgba(60, 53, 80, 0.22)' : '1px dashed rgba(245, 196, 0, 0.16)';
  const goldAccent = isLight ? '#7a4d00' : '#f5c400';
  const cyanAccent = isLight ? '#005b74' : '#3ee7ff';
  const limeAccent = isLight ? '#1f6f2d' : '#7cff6b';
  const amberAccent = isLight ? '#8e4d00' : '#ffb547';

  useEffect(() => {
    const handleWorkspaceChange = () => {
      setWorkspaceId(localStorage.getItem('workspaceId'));
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange as EventListener);
    window.addEventListener('storage', handleWorkspaceChange);
    return () => {
      window.removeEventListener('workspaceChanged', handleWorkspaceChange as EventListener);
      window.removeEventListener('storage', handleWorkspaceChange);
    };
  }, []);

  const { data: portfolioData } = useQuery({
    queryKey: ['portfolio-stats', workspaceId],
    queryFn: async () => (await http.get('/api/v1/core/workspaces/portfolio_stats/')).data,
    refetchOnMount: true,
    refetchInterval: 2000,
    staleTime: 0,
  });

  const workspaces = portfolioData?.clients || [];

  // Aggregate compliance doc stats across all portfolio workspaces from portfolio_stats
  const complianceSummary = workspaces.length > 0 ? (() => {
    const totals = workspaces.reduce(
      (acc: any, w: any) => {
        const d = w.stats?.doc_compliance || {};
        acc.total += d.total || 0;
        acc.active += d.active || 0;
        acc.permanent += d.permanent || 0;
        acc.expiring_soon += d.expiring_soon || 0;
        acc.expired += d.expired || 0;
        return acc;
      },
      { total: 0, active: 0, permanent: 0, expiring_soon: 0, expired: 0 }
    );
    const valid = totals.active + totals.permanent;
    totals.compliance_pct = totals.total > 0 ? Math.round((valid / totals.total) * 100) : 0;
    return totals;
  })() : null;
  const totalEmployees = portfolioData?.total_employees_across_all || 0;
  const totalProjects = portfolioData?.total_active_projects || 0;
  const totalCases = portfolioData?.total_cases || 0;
  const totalClients = portfolioData?.total_clients || 0;
  const totalContractors = portfolioData?.total_contractors || 0;

  const goodComplianceCount = workspaces.filter((w: any) => w.stats?.compliance_level === 'Good').length;

  // Calculate aggregate active ATRs and compliance
  const totalOpenRoles = workspaces.reduce((sum: number, w: any) => sum + (w.stats?.active_atrs || 0), 0);
  // Workspace compliance: % of workspaces that have all their docs active/permanent
  const avgCompliance = workspaces.length > 0
    ? Math.round(
        (workspaces.filter((w: any) => {
          const d = w.stats?.doc_compliance;
          return d && d.total > 0 && d.compliance_pct === 100;
        }).length / workspaces.length) * 100
      )
    : 0;

  // Filter workspaces based on selected compliance filter
  const filteredWorkspaces = workspaces.filter((item: any) => {
    const level = (item.stats?.compliance_level || 'Unknown').toLowerCase();
    if (complianceFilter === 'all') return true;
    if (complianceFilter === 'good') return level === 'good';
    if (complianceFilter === 'attention') return level === 'medium' || level === 'poor' || level === 'unknown';
    return true;
  });

  return (
    <div className="portfolio-dashboard" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <HeroBanner
        eyebrow="Portfolio"
        title="Portfolio Overview"
        description={`Manage ${workspaces.length} client workspace${workspaces.length !== 1 ? 's' : ''} with compliance, roles, and cases at a glance.`}
        gradient="neutral"
        tags={[
          { label: 'Consultant View', variant: 'neutral' },
          { label: `Clients: ${totalClients}`, variant: 'gold' },
          { label: `Projects: ${totalProjects}`, variant: 'cyan' },
          { label: `Compliance: ${avgCompliance}%`, variant: 'lime' },
        ]}
        actions={(
          <>
            <Button type="primary">Add Client</Button>
            <Button>View Reports</Button>
            <Button>Export Snapshot</Button>
          </>
        )}
      />

      {/* Summary Stats Row */}
      <Row gutter={[24, 24]}>
        <Col xs={24} sm={12} lg={6}>
          <KPICard
            title="Total Companies"
            value={totalClients}
            prefix={<TeamOutlined />}
            color={goldAccent}
            gradient="gold"
            delta={14.2}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard
            title="Total Employees"
            value={totalEmployees}
            prefix={<TeamOutlined />}
            color={cyanAccent}
            gradient="cyan"
            delta={8.7}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard
            title="Total Cases"
            value={totalCases}
            prefix={<FileTextOutlined />}
            color={limeAccent}
            gradient="lime"
            delta={-3.5}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard
            title="Active ATR"
            value={totalOpenRoles}
            prefix={<AlertOutlined />}
            color={amberAccent}
            gradient="amber"
            delta={22.3}
          />
        </Col>
      </Row>

      {/* Compliance Graph */}
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <GlassCard title="Overall Compliance Status" gradient="gold">
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, color: textSecondary, fontWeight: isLight ? 600 : 500 }}>
                Document Compliance: {complianceSummary?.compliance_pct ?? 0}% &nbsp;|&nbsp; Workspace Compliance: {avgCompliance}%
              </Text>
              <Space size={24} align="start">
                <div style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={complianceSummary?.compliance_pct ?? 0}
                    size={110}
                    strokeColor={{ '0%': '#f5c400', '100%': '#7cff6b' }}
                    format={(percent) => `${percent}%`}
                  />
                  <div style={{ fontSize: 11, color: textMuted, marginTop: 6 }}>Doc Compliance</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={avgCompliance}
                    size={110}
                    strokeColor={{ '0%': '#3ee7ff', '100%': '#7cff6b' }}
                    format={(percent) => `${percent}%`}
                  />
                  <div style={{ fontSize: 11, color: textMuted, marginTop: 6 }}>Workspace</div>
                </div>
              </Space>
            </div>
            {complianceSummary && (
              <Space size={8} wrap style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, color: '#52c41a' }}>✓ {complianceSummary.active} Active</span>
                <span style={{ fontSize: 12, color: '#3ee7ff' }}>♾ {complianceSummary.permanent} Permanent</span>
                <span style={{ fontSize: 12, color: '#fa8c16' }}>⚠ {complianceSummary.expiring_soon} Expiring</span>
                <span style={{ fontSize: 12, color: '#ff4d4f' }}>✕ {complianceSummary.expired} Expired</span>
              </Space>
            )}
            <Text style={{ fontSize: 12, color: textMuted, fontWeight: isLight ? 600 : 500, display: 'block', marginTop: 8 }}>
              {workspaces.filter((w: any) => w.stats?.compliance_level === 'Good').length} of {workspaces.length} companies at target compliance
            </Text>
          </GlassCard>
        </Col>
        <Col xs={24} lg={12}>
          <GlassCard title="Key Metrics" gradient="gold">
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: textPrimary }}>
                <Text style={{ color: textSecondary, fontWeight: isLight ? 600 : 500 }}>Active Projects</Text>
                <Text strong style={{ color: goldAccent, fontWeight: 700 }}>{totalProjects}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: textPrimary }}>
                <Text style={{ color: textSecondary, fontWeight: isLight ? 600 : 500 }}>Contractors</Text>
                <Text strong style={{ color: goldAccent, fontWeight: 700 }}>{totalContractors}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: textPrimary }}>
                <Text style={{ color: textSecondary, fontWeight: isLight ? 600 : 500 }}>Compliant Companies</Text>
                <Text strong style={{ color: limeAccent, fontWeight: 700 }}>{goodComplianceCount}</Text>
              </div>
            </Space>
          </GlassCard>
        </Col>
      </Row>

      {/* Client Workspace Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="flex flex-wrap items-center gap-3">
          <h3 style={{ margin: 0, color: textPrimary, fontSize: '18px', fontWeight: 700 }}>Client Workspaces</h3>
          <TagPill variant="gold">{filteredWorkspaces.length} Active</TagPill>
          <Text style={{ margin: 0, color: textSecondary, fontSize: '13px', fontWeight: isLight ? 600 : 500 }}>Tap a card to open the workspace</Text>
        </div>
        <div className="flex flex-wrap gap-2" style={{ gap: 10 }}>
          <TagPill
            variant="gold"
            onClick={() => setComplianceFilter('all')}
            style={{
              cursor: 'pointer',
              opacity: complianceFilter === 'all' ? 1 : 0.6,
              transform: complianceFilter === 'all' ? 'scale(1.05)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
          >
            All
          </TagPill>
          <TagPill
            variant="lime"
            onClick={() => setComplianceFilter('good')}
            style={{
              cursor: 'pointer',
              opacity: complianceFilter === 'good' ? 1 : 0.6,
              transform: complianceFilter === 'good' ? 'scale(1.05)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
          >
            Good
          </TagPill>
          <TagPill
            variant="amber"
            onClick={() => setComplianceFilter('attention')}
            style={{
              cursor: 'pointer',
              opacity: complianceFilter === 'attention' ? 1 : 0.6,
              transform: complianceFilter === 'attention' ? 'scale(1.05)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
          >
            Needs Attention
          </TagPill>
        </div>
        <Row gutter={[24, 24]}>
          {filteredWorkspaces.map((item: any) => {
            const ws = item.workspace;
            const stats = item.stats || {};
            const employeeCount = stats.total_employees ?? 0;
            const activeProjects = stats.active_projects ?? 0;
            const contractors = stats.contractors_count ?? 0;
            const complianceLevel = stats.compliance_level || 'Unknown';
            const complianceTone = complianceLevel.toLowerCase() === 'good'
              ? (isLight ? '#2f8f2f' : '#7cff6b')
              : complianceLevel.toLowerCase() === 'medium'
                ? (isLight ? '#a56000' : '#ffb547')
                : (isLight ? '#b33f64' : '#ff6b9d');

            return (
              <Col xs={24} sm={12} md={12} lg={6} key={ws.id}>
                <GlassCard
                  hoverable
                  onClick={() => {
                    console.log('🔄 Switching to workspace:', ws.id, ws.name);
                    localStorage.setItem('workspaceId', String(ws.id));
                    localStorage.setItem('workspaceName', ws.name);
                    localStorage.setItem('workspaceRole', item.role || 'VIEWER');
                    console.log('✅ localStorage set:', {
                      workspaceId: localStorage.getItem('workspaceId'),
                      workspaceName: localStorage.getItem('workspaceName')
                    });
                    window.dispatchEvent(new Event('workspaceChanged'));
                    nav('/dashboard');
                  }}
                  gradient="gold"
                  style={{ height: '100%', cursor: 'pointer', transition: 'all 0.3s ease' }}
                >
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', color: textPrimary, fontSize: '16px', fontWeight: 800 }}>
                        {ws.name}
                      </h4>
                      <span style={{ fontSize: 12, color: textSecondary, fontWeight: isLight ? 700 : 500 }}>
                        {ws.industry || 'General'}
                      </span>
                    </div>
                    <TagPill
                      variant="cyan"
                      style={{
                        alignSelf: 'flex-start',
                        color: isLight ? '#07566a' : '#3ee7ff',
                        borderColor: isLight ? 'rgba(7, 86, 106, 0.3)' : undefined,
                        background: isLight ? 'rgba(7, 86, 106, 0.08)' : undefined,
                        fontWeight: isLight ? 700 : 600,
                      }}
                    >
                      {item.role}
                    </TagPill>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: softPanelBg, borderRadius: 10, border: softPanelBorder, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: textSecondary, fontWeight: isLight ? 700 : 500 }}>Compliance</span>
                    <TagPill style={{ background: `${complianceTone}20`, color: complianceTone, borderColor: `${complianceTone}40`, margin: 0 }}>
                      {complianceLevel}
                    </TagPill>
                  </div>

                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <Row gutter={[8, 8]}>
                      <Col span={12}>
                        <div>
                          <div style={{ fontSize: 11, color: textSecondary, marginBottom: 4, fontWeight: isLight ? 700 : 500 }}>Employees</div>
                          <div style={{ fontSize: 16, color: goldAccent, fontWeight: 800 }}>{employeeCount}</div>
                        </div>
                      </Col>
                      <Col span={12}>
                        <div>
                          <div style={{ fontSize: 11, color: textSecondary, marginBottom: 4, fontWeight: isLight ? 700 : 500 }}>Projects</div>
                          <div style={{ fontSize: 16, color: cyanAccent, fontWeight: 800 }}>{activeProjects}</div>
                        </div>
                      </Col>
                    </Row>
                    <Row gutter={[8, 8]}>
                      <Col span={12}>
                        <div>
                          <div style={{ fontSize: 11, color: textSecondary, marginBottom: 4, fontWeight: isLight ? 700 : 500 }}>Contractors</div>
                          <div style={{ fontSize: 16, color: limeAccent, fontWeight: 800 }}>{contractors}</div>
                        </div>
                      </Col>
                      <Col span={12}>
                        <div>
                          <div style={{ fontSize: 11, color: textSecondary, marginBottom: 4, fontWeight: isLight ? 700 : 500 }}>Cases</div>
                          <div style={{ fontSize: 16, color: amberAccent, fontWeight: 800 }}>{stats.case_count ?? 0}</div>
                        </div>
                      </Col>
                    </Row>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: softPanelBg, borderRadius: 10, border: softPanelBorder }}>
                      <span style={{ fontSize: 11, color: textSecondary, fontWeight: isLight ? 700 : 500 }}>Active ATR</span>
                      <strong style={{ color: goldAccent, fontWeight: 800 }}>{stats.active_atrs ?? 0}</strong>
                    </div>
                  </Space>

                  <div style={{ marginTop: 12 }}>
                    <Button type="primary" block size="small" style={{ background: '#f5c400', borderColor: '#f5c400', color: '#05060a', fontWeight: 600 }}>
                      Manage
                    </Button>
                  </div>
                </GlassCard>
              </Col>
            );
          })}
        </Row>

        {workspaces.length === 0 && (
          <GlassCard style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Text style={{ color: textSecondary, fontWeight: isLight ? 600 : 500 }}>No workspaces assigned</Text>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
