import { useState, useMemo } from 'react';
import {
  Button, Table, Tag, Modal, Form, Input, DatePicker, Select,
  Space, message, Tabs, Descriptions, Badge, Popconfirm, Drawer,
  Divider, Row, Col, Tooltip, InputNumber, Progress,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, UserAddOutlined, LockOutlined,
  UnlockOutlined, DownloadOutlined, EditOutlined, DeleteOutlined,
  TeamOutlined, BankOutlined, CalendarOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import http from '../../../lib/http';
import { GlassCard } from '../../../components/NeonPrimitives';
import { KPICard } from '../../../components/KPICard';

// ---- Types ----
interface Site {
  id: number;
  name: string;
  location: string;
  description: string;
  cost_centre: string;
  start_date: string;
  end_date: string | null;
  status: string;
  status_display: string;
  active_employee_count: number;
}

interface SiteEmployee {
  id: number;
  site: number;
  employee: number;
  employee_name: string;
  employee_number: string;
  department: { id: number; name: string } | null;
  job_title: string;
  role_on_site: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  notes: string;
}

interface SitePeriod {
  id: number;
  site: number;
  site_name: string;
  name: string;
  period_type: string;
  period_type_display: string;
  start_date: string;
  end_date: string;
  status: string;
  status_display: string;
  notes: string;
  locked_at: string | null;
  locked_by_name: string | null;
}

interface ReconRow {
  employee_id: number;
  employee_name: string;
  employee_number: string;
  department: string;
  role_on_site: string;
  working_days: number;
  days_worked: number;
  annual_leave_days: number;
  sick_leave_days: number;
  casual_leave_days: number;
  unpaid_leave_days: number;
  sick_note_days: number;
  absent_days: number;
}

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'green', PLANNED: 'blue', CLOSED: 'default' };

export default function SiteManage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = localStorage.getItem('workspaceId');

  // Forms
  const [allocateForm] = Form.useForm();
  const [periodForm] = Form.useForm();
  const [empRecordForm] = Form.useForm();

  // Modal state
  const [allocateVisible, setAllocateVisible] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<SiteEmployee | null>(null);
  const [periodModalVisible, setPeriodModalVisible] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<SitePeriod | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [empDrawerVisible, setEmpDrawerVisible] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<SiteEmployee | null>(null);
  const [empRecordTab, setEmpRecordTab] = useState('leave');

  // ---- Queries ----
  const { data: site } = useQuery<Site>({
    queryKey: ['site', id],
    queryFn: async () => (await http.get(`/api/v1/sites/sites/${id}/`)).data,
    enabled: !!id,
  });

  const { data: siteStats } = useQuery({
    queryKey: ['site-stats', id],
    queryFn: async () => (await http.get(`/api/v1/sites/sites/${id}/stats/`)).data,
    enabled: !!id,
  });

  const [empSearch, setEmpSearch] = useState('');
  const [empDeptFilter, setEmpDeptFilter] = useState<string | null>(null);

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<SiteEmployee[]>({
    queryKey: ['site-employees', id],
    queryFn: async () => {
      const res = await http.get(`/api/v1/sites/site-employees/`, { params: { site: id, page_size: 1000 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!id,
  });

  const { data: periods = [], isLoading: periodsLoading } = useQuery<SitePeriod[]>({
    queryKey: ['site-periods', id],
    queryFn: async () => {
      const res = await http.get(`/api/v1/sites/site-periods/?site=${id}`);
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!id,
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 500, is_active: true } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });

  // All active allocations across every site — used to prevent double-assigning
  const { data: allSiteAllocations = [] } = useQuery<{ employee: number }[]>({
    queryKey: ['all-site-employees', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/sites/site-employees/', { params: { is_active: true, page_size: 5000 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });

  const { data: reconData, isLoading: reconLoading } = useQuery({
    queryKey: ['labour-recon', selectedPeriodId],
    queryFn: async () => (await http.get(`/api/v1/sites/site-periods/${selectedPeriodId}/labour_recon/`)).data,
    enabled: !!selectedPeriodId,
  });

  // ---- Mutations ----
  const allocateMutation = useMutation({
    mutationFn: (values: any) => {
      const payload = {
        ...values,
        site: Number(id),
        start_date: values.start_date?.format('YYYY-MM-DD'),
        end_date: values.end_date?.format('YYYY-MM-DD') ?? null,
      };
      return editingAssignment
        ? http.patch(`/api/v1/sites/site-employees/${editingAssignment.id}/`, payload)
        : http.post('/api/v1/sites/site-employees/', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-employees', id] });
      queryClient.invalidateQueries({ queryKey: ['site-stats', id] });
      queryClient.invalidateQueries({ queryKey: ['site', id] });
      queryClient.invalidateQueries({ queryKey: ['all-site-employees', workspaceId] });
      message.success(editingAssignment ? 'Assignment updated' : 'Employee allocated to site');
      setAllocateVisible(false);
      setEditingAssignment(null);
      allocateForm.resetFields();
    },
    onError: (e: any) => message.error(e.response?.data?.error || e.response?.data?.non_field_errors?.[0] || 'Failed to allocate'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (assignId: number) => http.post(`/api/v1/sites/site-employees/${assignId}/deactivate/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-employees', id] });
      queryClient.invalidateQueries({ queryKey: ['site-stats', id] });
      queryClient.invalidateQueries({ queryKey: ['site', id] });
      queryClient.invalidateQueries({ queryKey: ['all-site-employees', workspaceId] });
      message.success('Employee removed from site');
    },
    onError: (e: any) => message.error(e.response?.data?.error || 'Failed to remove employee'),
  });

  const savePeriodMutation = useMutation({
    mutationFn: (values: any) => {
      const payload = {
        ...values,
        site: Number(id),
        start_date: values.start_date?.format('YYYY-MM-DD'),
        end_date: values.end_date?.format('YYYY-MM-DD'),
      };
      return editingPeriod
        ? http.patch(`/api/v1/sites/site-periods/${editingPeriod.id}/`, payload)
        : http.post('/api/v1/sites/site-periods/', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-periods', id] });
      message.success(editingPeriod ? 'Period updated' : 'Period created');
      setPeriodModalVisible(false);
      setEditingPeriod(null);
      periodForm.resetFields();
    },
    onError: (e: any) => message.error(e.response?.data?.error || 'Failed to save period'),
  });

  const lockMutation = useMutation({
    mutationFn: (periodId: number) => http.post(`/api/v1/sites/site-periods/${periodId}/lock/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-periods', id] });
      message.success('Period locked');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (periodId: number) => http.post(`/api/v1/sites/site-periods/${periodId}/unlock/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-periods', id] });
      message.success('Period unlocked');
    },
  });

  // Quick-add leave/sick/absenteeism record for an employee
  const addRecordMutation = useMutation({
    mutationFn: async (values: any) => {
      const empId = selectedEmployee?.employee;
      if (empRecordTab === 'leave') {
        return http.post('/api/v1/leave/requests/', {
          employee: empId,
          leave_type: values.leave_type,
          start_date: values.start_date?.format('YYYY-MM-DD'),
          end_date: values.end_date?.format('YYYY-MM-DD'),
          reason: values.reason || '',
        });
      } else if (empRecordTab === 'sick') {
        return http.post('/api/v1/leave/sick-notes/', {
          employee: empId,
          start_date: values.start_date?.format('YYYY-MM-DD'),
          end_date: values.end_date?.format('YYYY-MM-DD'),
          diagnosis: values.diagnosis || '',
          notes: values.notes || '',
        });
      } else {
        return http.post('/api/v1/leave/absenteeism/', {
          employee: empId,
          date: values.date?.format('YYYY-MM-DD'),
          reason_provided: values.reason_provided || '',
        });
      }
    },
    onSuccess: () => {
      message.success('Record added successfully');
      empRecordForm.resetFields();
      // Invalidate recon data
      if (selectedPeriodId) queryClient.invalidateQueries({ queryKey: ['labour-recon', selectedPeriodId] });
    },
    onError: (e: any) => message.error(e.response?.data?.error || 'Failed to add record'),
  });

  // ---- Computed ----
  const allActiveAssignments = useMemo(() => assignments.filter(a => a.is_active), [assignments]);
  const inactiveAssignments = useMemo(() => assignments.filter(a => !a.is_active), [assignments]);

  const deptOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { label: string; value: string }[] = [];
    allActiveAssignments.forEach(a => {
      const name = a.department?.name;
      if (name && !seen.has(name)) { seen.add(name); opts.push({ label: name, value: name }); }
    });
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [allActiveAssignments]);

  const activeAssignments = useMemo(() => {
    const q = empSearch.toLowerCase();
    return allActiveAssignments.filter(a => {
      const matchesSearch = !q || a.employee_name.toLowerCase().includes(q) || a.role_on_site?.toLowerCase().includes(q);
      const matchesDept = !empDeptFilter || a.department?.name === empDeptFilter;
      return matchesSearch && matchesDept;
    });
  }, [allActiveAssignments, empSearch, empDeptFilter]);

  const employeeOptions = useMemo(() => {
    // Block anyone already active on ANY site, except the employee being edited
    const globalAllocatedIds = new Set(allSiteAllocations.map(a => a.employee));
    return allEmployees
      .filter((e: any) => !globalAllocatedIds.has(e.id) || editingAssignment?.employee === e.id)
      .map((e: any) => ({
        value: e.id,
        label: `${e.full_name} (${e.employee_id || e.id})`,
      }));
  }, [allEmployees, allSiteAllocations, editingAssignment]);

  const openAllocate = (assignment?: SiteEmployee) => {
    setEditingAssignment(assignment || null);
    if (assignment) {
      allocateForm.setFieldsValue({
        employee: assignment.employee,
        role_on_site: assignment.role_on_site,
        start_date: assignment.start_date ? dayjs(assignment.start_date) : null,
        end_date: assignment.end_date ? dayjs(assignment.end_date) : null,
        is_active: assignment.is_active,
        notes: assignment.notes,
      });
    } else {
      allocateForm.resetFields();
      allocateForm.setFieldsValue({ is_active: true, start_date: dayjs() });
    }
    setAllocateVisible(true);
  };

  const openEmpDrawer = (emp: SiteEmployee) => {
    setSelectedEmployee(emp);
    empRecordForm.resetFields();
    setEmpRecordTab('leave');
    setEmpDrawerVisible(true);
  };

  const openPeriodModal = (period?: SitePeriod) => {
    setEditingPeriod(period || null);
    if (period) {
      periodForm.setFieldsValue({
        name: period.name,
        period_type: period.period_type,
        start_date: dayjs(period.start_date),
        end_date: dayjs(period.end_date),
        notes: period.notes,
      });
    } else {
      periodForm.resetFields();
      periodForm.setFieldsValue({ period_type: 'MONTHLY' });
    }
    setPeriodModalVisible(true);
  };

  // ---- Columns ----
  const assignmentColumns = [
    {
      title: 'Employee',
      key: 'emp',
      render: (_: any, r: SiteEmployee) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.employee_name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{r.employee_number} {r.job_title ? `• ${r.job_title}` : ''}</div>
        </div>
      ),
    },
    {
      title: 'Department',
      key: 'dept',
      render: (_: any, r: SiteEmployee) => r.department?.name || '—',
    },
    {
      title: 'Role on Site',
      dataIndex: 'role_on_site',
      key: 'role',
      render: (v: string) => v || <span style={{ color: '#888' }}>—</span>,
    },
    {
      title: 'Since',
      dataIndex: 'start_date',
      key: 'start',
      width: 110,
      render: (v: string) => dayjs(v).format('DD MMM YYYY'),
    },
    {
      title: 'Status',
      key: 'status',
      width: 90,
      render: (_: any, r: SiteEmployee) => (
        <Tag color={r.is_active ? 'green' : 'default'}>{r.is_active ? 'Active' : 'Inactive'}</Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: any, r: SiteEmployee) => (
        <Space size="small">
          <Button size="small" onClick={() => openEmpDrawer(r)}>Records</Button>
          <Button size="small" icon={<EditOutlined />} type="text" onClick={() => openAllocate(r)} />
          {r.is_active && (
            <Popconfirm title="Remove from site?" onConfirm={() => deactivateMutation.mutate(r.id)}>
              <Button size="small" icon={<DeleteOutlined />} type="text" danger />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const periodColumns = [
    {
      title: 'Period',
      key: 'period',
      render: (_: any, r: SitePeriod) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{r.period_type_display}</div>
        </div>
      ),
    },
    {
      title: 'Dates',
      key: 'dates',
      render: (_: any, r: SitePeriod) => (
        <span style={{ fontSize: 12 }}>
          {dayjs(r.start_date).format('DD MMM')} → {dayjs(r.end_date).format('DD MMM YYYY')}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: any, r: SitePeriod) => (
        <Tag color={r.status === 'LOCKED' ? 'red' : 'green'}>{r.status_display}</Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_: any, r: SitePeriod) => (
        <Space size="small">
          <Button
            size="small"
            type={selectedPeriodId === r.id ? 'primary' : 'default'}
            icon={<CalendarOutlined />}
            onClick={() => setSelectedPeriodId(r.id === selectedPeriodId ? null : r.id)}
          >
            {selectedPeriodId === r.id ? 'Hide Recon' : 'View Recon'}
          </Button>
          <Button
            size="small"
            href={`/api/v1/sites/site-periods/${r.id}/export_csv/`}
            target="_blank"
            icon={<DownloadOutlined />}
          >
            CSV
          </Button>
          {r.status === 'OPEN' ? (
            <Tooltip title="Lock period to prevent changes">
              <Button
                size="small"
                icon={<LockOutlined />}
                loading={lockMutation.isPending}
                onClick={() => lockMutation.mutate(r.id)}
              />
            </Tooltip>
          ) : (
            <Tooltip title="Unlock period">
              <Button
                size="small"
                icon={<UnlockOutlined />}
                loading={unlockMutation.isPending}
                onClick={() => unlockMutation.mutate(r.id)}
              />
            </Tooltip>
          )}
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openPeriodModal(r)} />
        </Space>
      ),
    },
  ];

  const reconColumns = [
    { title: 'Employee', dataIndex: 'employee_name', key: 'name', render: (v: string, r: ReconRow) => (
      <div><div style={{ fontWeight: 600 }}>{v}</div><div style={{ fontSize: 11, color: '#888' }}>{r.employee_number}</div></div>
    )},
    { title: 'Dept', dataIndex: 'department', key: 'dept', width: 120 },
    { title: 'Role', dataIndex: 'role_on_site', key: 'role', width: 120, render: (v: string) => v || '—' },
    { title: 'Work Days', dataIndex: 'working_days', key: 'wd', width: 90 },
    { title: 'Worked', dataIndex: 'days_worked', key: 'dw', width: 80,
      render: (v: number, r: ReconRow) => (
        <span style={{ color: v < r.working_days * 0.8 ? '#ff4d4f' : '#52c41a', fontWeight: 700 }}>{v}</span>
      )
    },
    { title: 'Annual', dataIndex: 'annual_leave_days', key: 'al', width: 70 },
    { title: 'Sick', dataIndex: 'sick_leave_days', key: 'sl', width: 60 },
    { title: 'Casual', dataIndex: 'casual_leave_days', key: 'cl', width: 70 },
    { title: 'Unpaid', dataIndex: 'unpaid_leave_days', key: 'ul', width: 70 },
    { title: 'Sick Notes', dataIndex: 'sick_note_days', key: 'sn', width: 90 },
    { title: 'Absent', dataIndex: 'absent_days', key: 'ab', width: 70,
      render: (v: number) => v > 0 ? <span style={{ color: '#fa8c16', fontWeight: 700 }}>{v}</span> : 0
    },
  ];

  if (!site) return null;

  const tabItems = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="Active Employees" value={site.active_employee_count} color="#7cff6b" gradient="lime" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="Departments" value={siteStats?.department_breakdown?.length ?? 0} color="#3ee7ff" gradient="cyan" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="Total Periods" value={periods.length} color="#f5c400" gradient="gold" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="Open Periods" value={periods.filter(p => p.status === 'OPEN').length} color="#ffb547" gradient="amber" />
            </Col>
          </Row>

          {/* Department Breakdown */}
          {siteStats?.department_breakdown?.length > 0 && (
            <GlassCard gradient="cyan" style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>
                <TeamOutlined style={{ marginRight: 8 }} />Department Breakdown
              </div>
              <Row gutter={[12, 12]}>
                {siteStats.department_breakdown.map((dept: any) => {
                  const pct = Math.round((dept.count / site.active_employee_count) * 100);
                  return (
                    <Col xs={24} sm={12} md={8} key={dept.department}>
                      <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 600 }}>{dept.department}</span>
                          <span style={{
                            background: '#3ee7ff',
                            color: '#0a1628',
                            fontWeight: 700,
                            fontSize: 12,
                            borderRadius: '50%',
                            minWidth: 22,
                            height: 22,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 6px',
                          }}>{dept.count}</span>
                        </div>
                        <Progress percent={pct} size="small" strokeColor="#3ee7ff" showInfo={false} />
                        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{pct}% of site workforce</div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            </GlassCard>
          )}

          {/* Site Details */}
          <GlassCard gradient="neutral" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>
              <BankOutlined style={{ marginRight: 8 }} />Site Details
            </div>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label="Name">{site.name}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={STATUS_COLOR[site.status]}>{site.status_display}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Location">{site.location || '—'}</Descriptions.Item>
              <Descriptions.Item label="Cost Centre">{site.cost_centre || '—'}</Descriptions.Item>
              <Descriptions.Item label="Start Date">{dayjs(site.start_date).format('DD MMM YYYY')}</Descriptions.Item>
              <Descriptions.Item label="End Date">
                {site.end_date ? dayjs(site.end_date).format('DD MMM YYYY') : 'Ongoing'}
              </Descriptions.Item>
              {site.description && (
                <Descriptions.Item label="Description" span={2}>{site.description}</Descriptions.Item>
              )}
            </Descriptions>
          </GlassCard>
        </div>
      ),
    },
    {
      key: 'employees',
      label: `Employees (${allActiveAssignments.length})`,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space wrap>
              <Input.Search
                placeholder="Search name or role..."
                allowClear
                style={{ width: 220 }}
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                onSearch={v => setEmpSearch(v)}
              />
              <Select
                placeholder="Filter by department"
                allowClear
                style={{ width: 200 }}
                options={deptOptions}
                value={empDeptFilter}
                onChange={v => setEmpDeptFilter(v ?? null)}
              />
            </Space>
            <Button type="primary" icon={<UserAddOutlined />} onClick={() => openAllocate()}>
              Allocate Employee
            </Button>
          </div>
          <GlassCard gradient="neutral" style={{ padding: 0 }}>
            <Table
              columns={assignmentColumns}
              dataSource={activeAssignments}
              rowKey="id"
              loading={assignmentsLoading}
              pagination={{ pageSize: 20, showTotal: (total) => `${total} employees`, showSizeChanger: false }}
              size="small"
              locale={{ emptyText: 'No employees allocated to this site yet.' }}
            />
          </GlassCard>
          {inactiveAssignments.length > 0 && (
            <>
              <Divider orientation="left" style={{ fontSize: 12, color: '#888' }}>
                Previous Employees ({inactiveAssignments.length})
              </Divider>
              <GlassCard gradient="neutral" style={{ padding: 0 }}>
                <Table
                  columns={assignmentColumns}
                  dataSource={inactiveAssignments}
                  rowKey="id"
                  pagination={false}
                  size="small"
                />
              </GlassCard>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'periods',
      label: `Periods & Recon (${periods.length})`,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openPeriodModal()}>
              Create Period
            </Button>
          </div>
          <GlassCard gradient="neutral" style={{ padding: 0 }}>
            <Table
              columns={periodColumns}
              dataSource={periods}
              rowKey="id"
              loading={periodsLoading}
              pagination={false}
              size="small"
              locale={{ emptyText: 'No periods yet. Create a period to start tracking labour reconciliation.' }}
            />
          </GlassCard>

          {/* Inline Labour Recon */}
          {selectedPeriodId && reconData && (
            <GlassCard gradient="gold" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Labour Reconciliation</div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    {reconData.period?.name} &nbsp;|&nbsp;
                    {dayjs(reconData.period?.start_date).format('DD MMM')} – {dayjs(reconData.period?.end_date).format('DD MMM YYYY')}
                  </div>
                </div>
                <Button
                  icon={<DownloadOutlined />}
                  href={`/api/v1/sites/site-periods/${selectedPeriodId}/export_csv/`}
                  target="_blank"
                >
                  Export CSV
                </Button>
              </div>

              {reconData.totals && (
                <Row gutter={[12, 8]} style={{ marginBottom: 16 }}>
                  {[
                    { label: 'Employees', value: reconData.totals.employees, color: '#f5c400' },
                    { label: 'Annual Leave Days', value: reconData.totals.total_annual_leave, color: '#3ee7ff' },
                    { label: 'Sick Leave Days', value: reconData.totals.total_sick_leave, color: '#7cff6b' },
                    { label: 'Casual Leave Days', value: reconData.totals.total_casual_leave, color: '#ffb547' },
                    { label: 'Absent Days', value: reconData.totals.total_absent, color: '#ff4d4f' },
                  ].map(item => (
                    <Col xs={12} sm={8} md={4} key={item.label}>
                      <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{item.label}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              )}

              <Table
                columns={reconColumns}
                dataSource={reconData.rows ?? []}
                rowKey="employee_id"
                loading={reconLoading}
                pagination={false}
                size="small"
                scroll={{ x: 900 }}
              />
            </GlassCard>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/hcm/sites')} />
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{site.name}</h2>
          <div style={{ fontSize: 13, color: '#888' }}>
            {site.location} &nbsp;
            <Tag color={STATUS_COLOR[site.status]} style={{ marginLeft: 4 }}>{site.status_display}</Tag>
            {site.cost_centre && <span style={{ marginLeft: 8, fontSize: 12 }}>CC: {site.cost_centre}</span>}
          </div>
        </div>
      </div>

      <Tabs items={tabItems} defaultActiveKey="overview" />

      {/* Allocate Employee Modal */}
      <Modal
        title={editingAssignment ? 'Edit Assignment' : 'Allocate Employee to Site'}
        open={allocateVisible}
        onCancel={() => { setAllocateVisible(false); setEditingAssignment(null); allocateForm.resetFields(); }}
        onOk={() => allocateForm.validateFields().then(allocateMutation.mutate)}
        confirmLoading={allocateMutation.isPending}
        width={500}
      >
        <Form form={allocateForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="Employee" name="employee" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={employeeOptions}
              placeholder="Search employee..."
              disabled={!!editingAssignment}
            />
          </Form.Item>
          <Form.Item label="Role on Site" name="role_on_site" extra="Optional — overrides their job title for this site">
            <Input placeholder="e.g. Site Foreman, Electrician" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="End Date" name="end_date" extra="Leave blank if still active">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} placeholder="Any notes about this assignment" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create/Edit Period Modal */}
      <Modal
        title={editingPeriod ? 'Edit Period' : 'Create Period'}
        open={periodModalVisible}
        onCancel={() => { setPeriodModalVisible(false); setEditingPeriod(null); periodForm.resetFields(); }}
        onOk={() => periodForm.validateFields().then(savePeriodMutation.mutate)}
        confirmLoading={savePeriodMutation.isPending}
        width={480}
      >
        <Form form={periodForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="Period Name" name="name" rules={[{ required: true }]} extra='e.g. "June 2025" or "Week 24 — 2025"'>
            <Input placeholder="e.g. June 2025" />
          </Form.Item>
          <Form.Item label="Period Type" name="period_type" rules={[{ required: true }]}>
            <Select options={[
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'CUSTOM', label: 'Custom' },
            ]} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="End Date" name="end_date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} placeholder="Any notes for this period" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Employee Records Drawer */}
      <Drawer
        title={selectedEmployee ? `${selectedEmployee.employee_name} — Site Records` : 'Employee Records'}
        open={empDrawerVisible}
        onClose={() => { setEmpDrawerVisible(false); setSelectedEmployee(null); empRecordForm.resetFields(); }}
        width={480}
        closeIcon={
          <button
            type="button"
            aria-label="Close employee site records"
            onClick={() => { setEmpDrawerVisible(false); setSelectedEmployee(null); empRecordForm.resetFields(); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ✕
          </button>
        }
        extra={
          selectedEmployee && (
            <div style={{ textAlign: 'right', fontSize: 12, color: '#888' }}>
              <div>{selectedEmployee.department?.name || ''}</div>
              <div>{selectedEmployee.role_on_site || selectedEmployee.job_title || ''}</div>
            </div>
          )
        }
      >
        {selectedEmployee && (
          <>
            <Tabs
              activeKey={empRecordTab}
              onChange={setEmpRecordTab}
              items={[
                { key: 'leave', label: 'Leave' },
                { key: 'sick', label: 'Sick Note' },
                { key: 'absent', label: 'Absenteeism' },
              ]}
            />

            <Form form={empRecordForm} layout="vertical" style={{ marginTop: 12 }}>
              {empRecordTab === 'leave' && (
                <>
                  <Form.Item label="Leave Type" name="leave_type" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'ANNUAL', label: 'Annual Leave' },
                      { value: 'SICK', label: 'Sick Leave' },
                      { value: 'CASUAL', label: 'Casual Leave' },
                      { value: 'UNPAID', label: 'Unpaid Leave' },
                    ]} />
                  </Form.Item>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item label="End Date" name="end_date" rules={[{ required: true }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </div>
                  <Form.Item label="Reason" name="reason">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </>
              )}

              {empRecordTab === 'sick' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item label="End Date" name="end_date" rules={[{ required: true }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </div>
                  <Form.Item label="Diagnosis / Reason" name="diagnosis">
                    <Input placeholder="e.g. Flu, Malaria" />
                  </Form.Item>
                  <Form.Item label="Notes" name="notes">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </>
              )}

              {empRecordTab === 'absent' && (
                <>
                  <Form.Item label="Date of Absence" name="date" rules={[{ required: true }]}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item label="Reason Provided" name="reason_provided">
                    <Input.TextArea rows={2} placeholder="Reason given by employee (if any)" />
                  </Form.Item>
                </>
              )}

              <Button
                type="primary"
                block
                loading={addRecordMutation.isPending}
                onClick={() => empRecordForm.validateFields().then(addRecordMutation.mutate)}
              >
                Add {empRecordTab === 'leave' ? 'Leave Request' : empRecordTab === 'sick' ? 'Sick Note' : 'Absence Record'}
              </Button>
            </Form>
          </>
        )}
      </Drawer>
    </div>
  );
}
