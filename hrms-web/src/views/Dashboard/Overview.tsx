import { Select, DatePicker, Tag, Spin, Row, Col, Button, Input, Progress, Badge, Modal, List, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import http from '../../lib/http';
import ReactECharts from 'echarts-for-react';
import { Filter, Users, BriefcaseBusiness, Activity, Stethoscope, RefreshCw, Search } from 'lucide-react';
import { GlassCard } from '../../components/NeonPrimitives';
import { KPICard } from '../../components/KPICard';
import { HeroBanner } from '../../components/HeroBanner';
import { useTheme } from '../../contexts/ThemeContext';
import { FileProtectOutlined } from '@ant-design/icons';

export default function Overview() {
  const DASHBOARD_REFRESH_MS = 120000;
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const hasToken = !!localStorage.getItem('access');
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [complianceFilter, setComplianceFilter] = useState<string | null>(null);
  const [pendingDepartment, setPendingDepartment] = useState<number | null>(null);
  const [pendingRange, setPendingRange] = useState<any>(null);
  const [pendingSearch, setPendingSearch] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ department: number | null; range: any; search: string }>({
    department: null,
    range: null,
    search: '',
  });

  useEffect(() => {
    const handleWorkspaceChange = () => {
      queryClient.removeQueries({ exact: false, queryKey: ['hcm-summary'] });
      queryClient.removeQueries({ exact: false, queryKey: ['departments-min'] });
      queryClient.removeQueries({ exact: false, queryKey: ['project-stats'] });
      queryClient.removeQueries({ exact: false, queryKey: ['salary-ranges'] });
      queryClient.removeQueries({ exact: false, queryKey: ['medicals-overview'] });
      setWorkspaceId(localStorage.getItem('workspaceId'));
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange as EventListener);
    window.addEventListener('storage', handleWorkspaceChange);
    return () => {
      window.removeEventListener('workspaceChanged', handleWorkspaceChange as EventListener);
      window.removeEventListener('storage', handleWorkspaceChange);
    };
  }, [queryClient]);

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: hasToken,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const departmentOptions = useMemo(
    () => (departments || []).map((d: any) => ({ value: d.id, label: d.name })),
    [departments],
  );

  const { data: hcmSummary } = useQuery({
    queryKey: ['hcm-summary', workspaceId, appliedFilters.department, appliedFilters.range, appliedFilters.search],
    queryFn: async () => {
      const params: any = {};
      if (appliedFilters.department) params.department = appliedFilters.department;
      if (appliedFilters.search) params.search = appliedFilters.search;
      if (appliedFilters.range?.[0] && appliedFilters.range?.[1]) {
        params.date_from = appliedFilters.range[0].format('YYYY-MM-DD');
        params.date_to = appliedFilters.range[1].format('YYYY-MM-DD');
      }
      return (await http.get('/api/v1/hcm/employees/summary/', { params })).data;
    },
    enabled: hasToken,
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const { data: projectStats } = useQuery({
    queryKey: ['project-stats', workspaceId],
    queryFn: async () => (await http.get('/api/v1/core/projects/stats/')).data?.results,
    enabled: hasToken,
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const { data: salaryRanges = [] } = useQuery({
    queryKey: ['salary-ranges', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/payroll/salary-ranges/');
      const data = res.data?.results || res.data || [];
      return Array.isArray(data) ? data : [];
    },
    enabled: hasToken,
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const { data: medicals = [] } = useQuery({
    queryKey: ['medicals-overview', workspaceId, appliedFilters.search],
    queryFn: async () => {
      const params: any = { page_size: 5, ordering: 'expiry_date' };
      if (appliedFilters.search) params.search = appliedFilters.search;
      const res = await http.get('/api/v1/tracking/medicals/', { params });
      const data = res.data?.results || res.data || [];
      return Array.isArray(data) ? data : [];
    },
    enabled: hasToken,
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const { data: complianceSummary } = useQuery({
    queryKey: ['compliance-summary', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;
      const res = await http.get(`/api/v1/payroll/compliance-documents/summary/?workspace=${workspaceId}`);
      return res.data;
    },
    enabled: hasToken && !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });

  // Only show charts if there's actual data
  const hasProjectData = projectStats && (projectStats.PLANNING > 0 || projectStats.ACTIVE > 0 || projectStats.ON_HOLD > 0 || projectStats.COMPLETED > 0);
  const sectionTitleColor = isLight ? '#352c46' : '#c4c8d4';
  const helperTextColor = isLight ? '#635a74' : '#c4c8d4';
  const chartLabelColor = isLight ? '#4d465c' : '#c4c8d4';
  const chartAxisColor = isLight ? '#706881' : '#c4c8d4';
  const chartAxisLine = isLight ? 'rgba(53, 44, 70, 0.2)' : 'rgba(245, 196, 0, 0.3)';
  const tooltipBackground = isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(5, 6, 10, 0.95)';
  const tooltipBorder = isLight ? '1px solid rgba(53, 44, 70, 0.16)' : '1px solid rgba(245, 196, 0, 0.25)';
  const tooltipLabel = isLight ? '#2e2640' : '#f7f8fb';

  const projectChartOpts = hasProjectData ? {
    backgroundColor: 'transparent',
    title: { text: 'Project Statistics', left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: isLight ? '#352c46' : '#f7f8fb' } },
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: chartLabelColor } },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        label: { show: false },
        data: [
          { value: projectStats?.PLANNING ?? 0, name: 'Planning', itemStyle: { color: '#ffb547' } },
          { value: projectStats?.ACTIVE ?? 0, name: 'Active', itemStyle: { color: '#3ee7ff' } },
          { value: projectStats?.ON_HOLD ?? 0, name: 'On Hold', itemStyle: { color: '#ff4fd8' } },
          { value: projectStats?.COMPLETED ?? 0, name: 'Completed', itemStyle: { color: '#7cff6b' } },
        ],
      },
    ],
  } : null;

  if (!hcmSummary) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GlassCard gradient="gold" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <Spin size="large" />
          <div style={{ color: '#c4c8d4', marginTop: 12 }}>Loading dashboard...</div>
        </GlassCard>
      </div>
    );
  }

  const statCards = [
    { label: 'Active Employees', value: hcmSummary?.employees?.active ?? 0, delta: (hcmSummary?.employees?.active ?? 0) === 0 ? undefined : 8, up: true, icon: <Users className="h-4 w-4" />, color: '#7cff6b' },
    { label: 'Absentism', value: hcmSummary?.employees?.on_leave ?? 0, delta: (hcmSummary?.employees?.on_leave ?? 0) === 0 ? undefined : -2, up: false, icon: <BriefcaseBusiness className="h-4 w-4" />, color: '#ff4fd8' },
    { label: 'Leaves', value: hcmSummary?.leave?.total_requests ?? 0, delta: (hcmSummary?.leave?.total_requests ?? 0) === 0 ? undefined : 2, up: true, icon: <Activity className="h-4 w-4" />, color: '#f5c400' },
    { label: 'Sick Notes', value: hcmSummary?.sick_notes?.total ?? 0, delta: (hcmSummary?.sick_notes?.total ?? 0) === 0 ? undefined : -1, up: false, icon: <Stethoscope className="h-4 w-4" />, color: '#3ee7ff' },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <HeroBanner
        eyebrow="Dashboard"
        title="Workforce Health & Compliance"
        description="Real-time snapshot of workforce health, active projects, and organizational compliance across your workspace."
        icon={<Activity className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
        gradient="neutral"
        tags={[
          { label: 'Workspace Overview', variant: 'neutral' },
          { label: `Employees ${hcmSummary?.employees?.active ?? 0}`, variant: 'cyan' },
          { label: `Projects ${projectStats?.ACTIVE ?? 0}`, variant: 'amber' },
        ]}
      />

      {/* Filters */}
      <GlassCard gradient="neutral" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-center gap-3" style={{ rowGap: 6 }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: isLight ? 'rgba(74, 63, 207, 0.07)' : 'rgba(245, 196, 0, 0.08)', border: isLight ? '1px solid rgba(74, 63, 207, 0.16)' : '1px solid rgba(245, 196, 0, 0.18)' }}>
            <Filter className="h-4 w-4" style={{ color: isLight ? '#4a3fcf' : '#f5c400' }} />
            <span className="text-sm" style={{ color: isLight ? '#352c46' : '#f7f8fb', fontWeight: 700 }}>Filters</span>
          </div>
          <Select
            allowClear
            placeholder="All Departments"
            style={{ width: 220 }}
            value={pendingDepartment}
            onChange={(val) => setPendingDepartment(val ?? null)}
            options={departmentOptions}
          />
          <DatePicker.RangePicker value={pendingRange} onChange={setPendingRange} />
          <Input
            placeholder="Search employee"
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
            style={{ width: 200 }}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button
              type="primary"
              icon={<Search size={14} />}
              onClick={() => setAppliedFilters({
                department: pendingDepartment,
                range: pendingRange,
                search: pendingSearch.trim(),
              })}
            >
              Search
            </Button>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => {
                setPendingDepartment(null);
                setPendingRange(null);
                setPendingSearch('');
                setAppliedFilters({ department: null, range: null, search: '' });
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Stat cards */}
      <Row gutter={[18, 18]}>
        {statCards.map((card) => (
          <Col xs={24} sm={12} xl={6} key={card.label}>
            <KPICard
              title={card.label}
              value={card.value}
              color={card.color}
              gradient={card.color === '#7cff6b' ? 'lime' : card.color === '#ff4fd8' ? 'pink' : card.color === '#3ee7ff' ? 'cyan' : 'amber'}
              delta={card.delta}
            />
          </Col>
        ))}
      </Row>

      {/* Salary + Situations */}
      <Row gutter={[18, 18]}>
        <Col xs={24} xl={12}>
          <GlassCard gradient="cyan" style={{ height: '100%', padding: 16 }}>
            <div className="text-sm" style={{ color: sectionTitleColor, fontWeight: 700, marginBottom: 8 }}>Salary Statistics Performance</div>
            {!salaryRanges || salaryRanges.length === 0 ? (
              <div className="text-center" style={{ color: helperTextColor, padding: '24px 0' }}>No salary data available</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {salaryRanges.map((item: any) => (
                  <div key={item.label} className="flex items-center justify-between" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <span style={{ color: helperTextColor }}>{item.label}</span>
                    <Tag color="cyan">{item.employee_count} employees</Tag>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </Col>
        <Col xs={24} xl={12}>
          <GlassCard gradient="amber" style={{ height: '100%', padding: 16 }}>
            <div className="text-sm" style={{ color: sectionTitleColor, fontWeight: 700, marginBottom: 8 }}>Current Situations</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'Contracts expiring (30d)', value: hcmSummary?.situations?.contracts_expiring_30d ?? 0, color: 'blue' },
                { label: 'Active hearings', value: hcmSummary?.situations?.hearings_active ?? 0, color: 'orange' },
                { label: 'Active investigations', value: hcmSummary?.situations?.investigations_active ?? 0, color: 'magenta' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span style={{ color: helperTextColor }}>{item.label}</span>
                  <Tag color={item.color}>{item.value}</Tag>
                </div>
              ))}
            </div>
          </GlassCard>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={[18, 18]}>
        <Col xs={24} xl={12}>
          <GlassCard gradient="gold" style={{ height: '100%', padding: 16 }}>
            <div className="text-sm" style={{ color: sectionTitleColor, fontWeight: 700, marginBottom: 8 }}>Project Statistics</div>
            {!projectChartOpts ? (
              <div className="text-center" style={{ color: helperTextColor, padding: '24px 0' }}>No project data available</div>
            ) : (
              <ReactECharts option={projectChartOpts} style={{ height: 320, width: '100%' }} />
            )}
          </GlassCard>
        </Col>
        <Col xs={24} xl={12}>
          <GlassCard gradient="cyan" style={{ height: '100%', padding: 16 }}>
            <div className="text-sm" style={{ color: sectionTitleColor, fontWeight: 700, marginBottom: 8 }}>Medical Examinations</div>
            {!medicals || medicals.length === 0 ? (
              <div className="text-center" style={{ color: helperTextColor, padding: '24px 0' }}>No medical examination data available</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {[...medicals]
                  .sort((a: any, b: any) => {
                    // Sort: expired first → expiring soon → scheduled → rest
                    const urgency = (item: any) => {
                      if (!item.expiry_date) return 3;
                      const days = dayjs(item.expiry_date).diff(dayjs(), 'day');
                      if (days < 0) return 0;
                      if (days <= 30) return 1;
                      return 2;
                    };
                    return urgency(a) - urgency(b);
                  })
                  .slice(0, 5)
                  .map((item: any) => {
                    const hasExpiry = !!item.expiry_date;
                    const daysLeft = hasExpiry ? dayjs(item.expiry_date).diff(dayjs(), 'day') : null;
                    const isExpired = daysLeft !== null && daysLeft < 0;
                    const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;

                    let expiryLabel = null;
                    let expiryColor = '';
                    if (hasExpiry) {
                      if (isExpired) {
                        expiryLabel = `Expired ${Math.abs(daysLeft!)} day${Math.abs(daysLeft!) !== 1 ? 's' : ''} ago`;
                        expiryColor = '#ff4d4f';
                      } else if (isExpiringSoon) {
                        expiryLabel = `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
                        expiryColor = '#fa8c16';
                      } else {
                        expiryLabel = `Expires in ${daysLeft} days`;
                        expiryColor = '#52c41a';
                      }
                    } else if (item.scheduled_date) {
                      const daysToSchedule = dayjs(item.scheduled_date).diff(dayjs(), 'day');
                      expiryLabel = daysToSchedule >= 0
                        ? `Scheduled in ${daysToSchedule} day${daysToSchedule !== 1 ? 's' : ''}`
                        : `Scheduled ${dayjs(item.scheduled_date).format('DD MMM YYYY')}`;
                      expiryColor = '#1890ff';
                    }

                    return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: helperTextColor, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.employee_name || 'Unknown'}
                            <span style={{ opacity: 0.6 }}> • {item.medical_type_name || item.medical_type || 'Medical'}</span>
                          </div>
                          {expiryLabel && (
                            <div style={{ fontSize: 11, color: expiryColor, marginTop: 2 }}>
                              {expiryLabel}
                            </div>
                          )}
                        </div>
                        <Tag color={item.status === 'CLEARED' ? 'green' : item.status === 'COMPLETED' ? 'blue' : item.status === 'RESTRICTED' || item.status === 'NOT_CLEARED' ? 'red' : 'orange'} style={{ flexShrink: 0 }}>
                          {item.status || 'SCHEDULED'}
                        </Tag>
                      </div>
                    );
                  })}
              </div>
            )}
          </GlassCard>
        </Col>
      </Row>

      {/* Compliance Widget */}
      <Row gutter={[18, 18]}>
        <Col xs={24}>
          <GlassCard gradient="gold" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <FileProtectOutlined style={{ color: isLight ? '#7a4d00' : '#f5c400', fontSize: 16 }} />
              <span className="text-sm" style={{ color: sectionTitleColor, fontWeight: 700 }}>Government Compliance Documents</span>
              {complianceSummary && (
                <Tag color={complianceSummary.compliance_pct >= 75 ? 'green' : complianceSummary.compliance_pct >= 50 ? 'orange' : 'red'} style={{ marginLeft: 'auto' }}>
                  {complianceSummary.compliance_pct}% Compliant
                </Tag>
              )}
            </div>
            {!complianceSummary || complianceSummary.total === 0 ? (
              <div className="text-center" style={{ color: helperTextColor, padding: '16px 0' }}>
                No compliance documents tracked yet.{' '}
                <a href="/#/settings/statutory" style={{ color: isLight ? '#7a4d00' : '#f5c400' }}>Add documents in Statutory Settings</a>
              </div>
            ) : (
              <Row gutter={[16, 12]} align="middle">
                <Col xs={24} sm={6} style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={complianceSummary.compliance_pct}
                    size={90}
                    strokeColor={{ '0%': '#f5c400', '100%': '#7cff6b' }}
                    format={(p) => `${p}%`}
                  />
                  <div style={{ fontSize: 11, color: helperTextColor, marginTop: 6 }}>Overall</div>
                </Col>
                <Col xs={24} sm={18}>
                  <Row gutter={[12, 8]}>
                    {[
                      { label: 'Active', count: complianceSummary.active, color: '#52c41a', status: 'Active' },
                      { label: 'Permanent', count: complianceSummary.permanent, color: '#1677ff', status: 'Permanent' },
                      { label: 'Expiring Soon', count: complianceSummary.expiring_soon, color: '#fa8c16', status: 'Expiring Soon' },
                      { label: 'Expired', count: complianceSummary.expired, color: '#ff4d4f', status: 'Expired' },
                    ].map((item) => (
                      <Col xs={12} sm={6} key={item.label}>
                        <div
                          onClick={() => setComplianceFilter(item.status)}
                          style={{
                            padding: '10px',
                            background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                            borderRadius: 8,
                            textAlign: 'center',
                            cursor: 'pointer',
                            border: '1px solid transparent',
                            transition: 'border-color 0.2s, background 0.2s',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLDivElement).style.borderColor = item.color;
                            (e.currentTarget as HTMLDivElement).style.background = `${item.color}18`;
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
                            (e.currentTarget as HTMLDivElement).style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
                          }}
                        >
                          <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.count}</div>
                          <div style={{ fontSize: 11, color: helperTextColor }}>{item.label}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                  {complianceSummary.documents?.filter((d: any) => d.computed_status === 'Expired' || d.computed_status === 'Expiring Soon').length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {complianceSummary.documents
                        .filter((d: any) => d.computed_status === 'Expired' || d.computed_status === 'Expiring Soon')
                        .map((d: any) => (
                          <Badge
                            key={d.id}
                            color={d.computed_status === 'Expired' ? 'red' : 'orange'}
                            text={
                              <span style={{ fontSize: 11, color: helperTextColor }}>
                                {d.document_type_display || d.document_type}
                                {d.days_until_expiry !== null && d.days_until_expiry > 0
                                  ? ` — ${d.days_until_expiry}d`
                                  : ' — Expired'}
                              </span>
                            }
                          />
                        ))}
                    </div>
                  )}
                </Col>
              </Row>
            )}
          </GlassCard>
        </Col>
      </Row>

      {/* Compliance document drill-down modal */}
      <Modal
        open={!!complianceFilter}
        onCancel={() => setComplianceFilter(null)}
        footer={null}
        title={
          <span>
            <FileProtectOutlined style={{ marginRight: 8 }} />
            {complianceFilter} Documents
          </span>
        }
        width={620}
      >
        {complianceFilter && complianceSummary?.documents && (() => {
          const filtered = complianceSummary.documents.filter(
            (d: any) => d.computed_status === complianceFilter
          );
          const colorMap: Record<string, string> = {
            Active: '#52c41a',
            Permanent: '#1677ff',
            'Expiring Soon': '#fa8c16',
            Expired: '#ff4d4f',
          };
          const color = colorMap[complianceFilter] || '#888';
          if (filtered.length === 0) {
            return (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#888' }}>
                No {complianceFilter.toLowerCase()} documents.
              </div>
            );
          }
          return (
            <List
              dataSource={filtered}
              renderItem={(doc: any) => (
                <List.Item
                  style={{ padding: '12px 0', borderBottom: '1px solid rgba(128,128,128,0.15)' }}
                  extra={
                    <Tag color={
                      doc.computed_status === 'Active' ? 'green'
                        : doc.computed_status === 'Permanent' ? 'blue'
                        : doc.computed_status === 'Expiring Soon' ? 'orange'
                        : 'red'
                    }>
                      {doc.computed_status}
                    </Tag>
                  }
                >
                  <List.Item.Meta
                    title={
                      <Typography.Text strong style={{ color }}>
                        {doc.document_name || doc.document_type_display || doc.document_type}
                      </Typography.Text>
                    }
                    description={
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        {doc.issued_by && <span>Issued by: {doc.issued_by} &nbsp;·&nbsp; </span>}
                        {doc.reference_number && <span>Ref: {doc.reference_number} &nbsp;·&nbsp; </span>}
                        {doc.issue_date && <span>Issued: {doc.issue_date} &nbsp;·&nbsp; </span>}
                        {doc.expiry_date
                          ? <span style={{ color: doc.computed_status === 'Expired' ? '#ff4d4f' : doc.computed_status === 'Expiring Soon' ? '#fa8c16' : undefined }}>
                              Expires: {doc.expiry_date}
                              {doc.days_until_expiry !== null && doc.days_until_expiry >= 0
                                ? ` (${doc.days_until_expiry}d remaining)`
                                : doc.days_until_expiry !== null ? ` (${Math.abs(doc.days_until_expiry)}d ago)` : ''}
                            </span>
                          : <span>No expiry date</span>
                        }
                        {doc.notes && <div style={{ marginTop: 4 }}>{doc.notes}</div>}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          );
        })()}
      </Modal>
    </div>
  );
}
