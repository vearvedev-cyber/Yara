import { Card, Row, Col, Space, Input, Select, DatePicker, Button, Tag, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { settlementApi, settlementStatusColor } from '@/api/services/settlementApi';
import { apiErrorMessage } from '@/api/services/leaveApi';
import MobileTable from '../../components/MobileTable';
import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';

export default function EngagementsTerminations() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['employees-min'] });
      queryClient.removeQueries({ exact: false, queryKey: ['departments-min'] });
      queryClient.removeQueries({ exact: false, queryKey: ['engagements'] });
      queryClient.removeQueries({ exact: false, queryKey: ['terminations'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['employees-min'] });
    queryClient.removeQueries({ exact: false, queryKey: ['departments-min'] });
    queryClient.removeQueries({ exact: false, queryKey: ['engagements'] });
    queryClient.removeQueries({ exact: false, queryKey: ['terminations'] });
  }, [workspaceId, queryClient]);

  const [pendingDept, setPendingDept] = useState<number | null>(null);
  const [pendingRange, setPendingRange] = useState<any>(null);
  const [pendingSearch, setPendingSearch] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ dept: number | null; range: any; search: string }>({
    dept: null,
    range: null,
    search: '',
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: engagements = [], isLoading: engagementLoading } = useQuery({
    queryKey: ['engagements', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/engagements/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: terminations = [], isLoading: terminationLoading } = useQuery({
    queryKey: ['terminations', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/terminations/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const employeeMap = useMemo(() => {
    const map = new Map<number, any>();
    (employees || []).forEach((e: any) => map.set(e.id, e));
    return map;
  }, [employees]);

  const applyFilters = (items: any[], dateKey: string) => {
    return items.filter((item) => {
      const emp = employeeMap.get(item.employee);
      const departmentId = emp?.department ?? item?.department;
      if (appliedFilters.dept && departmentId !== appliedFilters.dept) return false;
      if (appliedFilters.search) {
        const term = appliedFilters.search.toLowerCase();
        const name = `${item?.first_name || emp?.first_name || ''} ${item?.last_name || emp?.last_name || ''}`.toLowerCase();
        const code = String(item?.employee_id || emp?.employee_id || '').toLowerCase();
        if (!name.includes(term) && !code.includes(term)) return false;
      }
      if (appliedFilters.range?.[0] && appliedFilters.range?.[1]) {
        const start = appliedFilters.range[0].toDate();
        const end = appliedFilters.range[1].toDate();
        const raw = item?.[dateKey];
        if (!raw) return false;
        const dt = new Date(raw);
        if (dt < start || dt > end) return false;
      }
      return true;
    });
  };

  const engagementRows = useMemo(() => {
    return applyFilters(engagements || [], 'engagement_date').map((item: any, idx: number) => {
      return {
        key: item.id || idx,
        sn: idx + 1,
        employee_id: item.employee_id || '-',
        first_name: item.first_name || '',
        surname: item.last_name || '',
        job_title: item.job_title || '-',
        gender: item.gender || '-',
        dob: item.date_of_birth || '-',
        department: item.department_name || '-',
        contract_type: item.contract_type_name || '-',
        engagement_date: item.engagement_date || '-',
        contract_duration: item.contract_duration_months ? `${item.contract_duration_months} months` : '-',
        contract_end_date: item.initial_contract_end_date || '-',
      };
    });
  }, [engagements, appliedFilters, employeeMap]);

  const navigate = useNavigate();
  const { data: settlements = [] } = useQuery({
    queryKey: ['settlements', workspaceId, 'exits'],
    queryFn: () => settlementApi.list({ kind: 'EXIT' }),
  });
  const settlementByEmployee = useMemo(() => {
    const map = new Map<number, (typeof settlements)[number]>();
    settlements.filter((s) => s.status !== 'CANCELLED').forEach((s) => map.set(s.employee, s));
    return map;
  }, [settlements]);
  const [preparing, setPreparing] = useState<number | null>(null);
  const prepareSettlement = async (employee: number) => {
    setPreparing(employee);
    try {
      const created = await settlementApi.create({ employee, kind: 'EXIT' });
      navigate(`/payroll/settlements/${created.id}`);
    } catch (err) {
      message.error(apiErrorMessage(err, 'Could not prepare the settlement'));
    } finally {
      setPreparing(null);
    }
  };

  const terminationRows = useMemo(() => {
    return applyFilters(terminations || [], 'termination_date').map((item: any, idx: number) => {
      return {
        key: item.id || idx,
        sn: idx + 1,
        employee_id: item.employee_id || '-',
        first_name: item.first_name || '',
        surname: item.last_name || '',
        job_title: item.job_title || '-',
        gender: item.gender || '-',
        dob: item.date_of_birth || '-',
        department: item.department_name || '-',
        payroll: item.payroll_final ? 'Yes' : 'No',
        employee: item.employee,
        engagement_date: item.engagement_date || '-',
        termination_date: item.termination_date || '-',
        termination_reason: item.termination_reason_name || '-',
      };
    });
  }, [terminations, appliedFilters, employeeMap]);
  const engagementCols = [
    { title: 'S/No', dataIndex: 'sn', width: 70 },
    { title: 'Employee ID', dataIndex: 'employee_id' },
    { title: 'First Name', dataIndex: 'first_name' },
    { title: 'Surname', dataIndex: 'surname' },
    { title: 'Job Title', dataIndex: 'job_title' },
    { title: 'Gender', dataIndex: 'gender' },
    { title: 'Date of Birth', dataIndex: 'dob' },
    { title: 'Department', dataIndex: 'department' },
    { title: 'Contract Type', dataIndex: 'contract_type' },
    { title: 'Engagement Date', dataIndex: 'engagement_date' },
    { title: 'Contract Duration', dataIndex: 'contract_duration' },
    { title: 'Contract End Date', dataIndex: 'contract_end_date' },
  ];

  const terminationCols = [
    { title: 'S/No', dataIndex: 'sn', width: 70 },
    { title: 'Employee ID', dataIndex: 'employee_id' },
    { title: 'First Name', dataIndex: 'first_name' },
    { title: 'Surname', dataIndex: 'surname' },
    { title: 'Job Title', dataIndex: 'job_title' },
    { title: 'Gender', dataIndex: 'gender' },
    { title: 'Date of Birth', dataIndex: 'dob' },
    { title: 'Department', dataIndex: 'department' },
    { title: 'Payroll', dataIndex: 'payroll' },
    { title: 'Engagement Date', dataIndex: 'engagement_date' },
    { title: 'Termination Date', dataIndex: 'termination_date' },
    { title: 'Termination Reason', dataIndex: 'termination_reason' },
    {
      title: 'Final Settlement',
      dataIndex: 'employee',
      render: (employee: number) => {
        const existing = settlementByEmployee.get(employee);
        if (existing) {
          return (
            <Link to={`/payroll/settlements/${existing.id}`}>
              <Tag color={settlementStatusColor[existing.status]}>{existing.status}</Tag> Open
            </Link>
          );
        }
        return (
          <Button size="small" type="primary" loading={preparing === employee} onClick={() => prepareSettlement(employee)}>
            Prepare
          </Button>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="mb-6 flex flex-col gap-2">
        <div className="text-sm uppercase tracking-[0.2em] text-[var(--text-dim)]">Human Capital</div>
        <h1 style={{ margin: 0, color: '#f7f8fb', fontSize: '32px', fontWeight: 700 }}>Engagements & Terminations</h1>
        <p style={{ margin: '8px 0 0 0', color: '#c4c8d4', fontSize: '14px' }}>Track employee onboarding and offboarding records</p>
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24}>
          <Card
            style={{
              background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
              border: '1px solid rgba(245, 196, 0, 0.15)',
              borderRadius: '12px',
              marginBottom: 8,
            }}
            bodyStyle={{ padding: '16px' }}
          >
            <Space wrap>
              <Select
                allowClear
                placeholder="Filter by department"
                style={{ width: 240 }}
                value={pendingDept}
                onChange={(val) => setPendingDept(val ?? null)}
                options={(departments || []).map((d: any) => ({ value: d.id, label: d.name }))}
              />
              <DatePicker.RangePicker value={pendingRange} onChange={setPendingRange} />
              <Input
                placeholder="Search employee"
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                style={{ width: 220 }}
                allowClear
              />
              <Space>
                <Button
                  type="primary"
                  onClick={() => setAppliedFilters({
                    dept: pendingDept,
                    range: pendingRange,
                    search: pendingSearch.trim(),
                  })}
                >
                  Search
                </Button>
                <Button
                  onClick={() => {
                    setPendingDept(null);
                    setPendingRange(null);
                    setPendingSearch('');
                    setAppliedFilters({ dept: null, range: null, search: '' });
                  }}
                >
                  Reset
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>
        <Col xs={24}>
          <Card 
            title="Engagements"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
              border: '1px solid rgba(245, 196, 0, 0.15)',
              borderRadius: '12px',
            }}
            headStyle={{
              background: 'transparent',
              borderBottom: '1px solid rgba(245, 196, 0, 0.2)',
              color: '#f7f8fb',
              fontWeight: 600,
            }}
            bodyStyle={{ padding: '16px' }}
          >
            <MobileTable 
              columns={engagementCols} 
              dataSource={engagementRows} 
              rowKey={(r: any)=>r.sn} 
              scroll={{ x: 1400 }}
              style={{ color: '#f7f8fb' }}
              loading={engagementLoading}
            />
          </Card>
        </Col>
        <Col xs={24}>
          <Card 
            title="Terminations"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
              border: '1px solid rgba(245, 196, 0, 0.15)',
              borderRadius: '12px',
            }}
            headStyle={{
              background: 'transparent',
              borderBottom: '1px solid rgba(245, 196, 0, 0.2)',
              color: '#f7f8fb',
              fontWeight: 600,
            }}
            bodyStyle={{ padding: '16px' }}
          >
            <MobileTable 
              columns={terminationCols} 
              dataSource={terminationRows} 
              rowKey={(r: any)=>r.sn} 
              scroll={{ x: 1400 }}
              style={{ color: '#f7f8fb' }}
              loading={terminationLoading}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
