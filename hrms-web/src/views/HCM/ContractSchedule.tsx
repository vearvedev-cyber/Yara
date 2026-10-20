import { Card, Tag, Space, Input, Select, Button, Form, message, DatePicker } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import dayjs from 'dayjs';
import { HeroBanner } from '../../components/HeroBanner';
import { gratuityApi, gratuityStatusColor, gratuityStatusLabel } from '@/api/services/gratuityApi';
import type { ContractGratuity } from '@/api/services/gratuityApi';
import GratuityBreakdown from '../Payroll/GratuityBreakdown';

export default function ContractSchedule() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();
  const [pendingFilters, setPendingFilters] = useState<{ employee?: string; status?: string; dept?: number }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ employee?: string; status?: string; dept?: number }>({});
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [viewModal, setViewModal] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);
  const [workspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  // Fetch contracts
  const { data: contracts = [], isLoading: contractsLoading, refetch: refetchContracts } = useQuery({
    queryKey: ['contracts', workspaceId, appliedFilters],
    queryFn: async () => {
      const params: any = {};
      if (appliedFilters.employee) params.search = appliedFilters.employee;
      if (appliedFilters.status) params.status = appliedFilters.status;
      if (appliedFilters.dept) params.department_id = appliedFilters.dept;

      const res = await http.get('/api/v1/hcm/contracts/', { params: { page_size: 500, ...params } });
      return res.data?.results || res.data || [];
    },
  });

  // Fetch employees for enrichment
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Fetch departments for filter
  const { data: departments = [] } = useQuery({
    queryKey: ['departments-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await http.delete(`/api/v1/hcm/contracts/${id}/`);
    },
    onSuccess: () => {
      message.success('Contract deleted');
      refetchContracts();
    },
    onError: () => message.error('Failed to delete contract'),
  });

  // Edit/update mutation
  const editMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      await http.patch(`/api/v1/hcm/contracts/${id}/`, data);
    },
    onSuccess: () => {
      message.success('Contract updated');
      setEditingContract(null);
      editForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['contracts', workspaceId] });
    },
    onError: () => message.error('Failed to update contract'),
  });

  // Gratuity for fixed-term contracts (calculated from payslips by the backend)
  const [gratuityContract, setGratuityContract] = useState<number | null>(null);
  const { data: gratuityData } = useQuery({
    queryKey: ['gratuity', 'list', workspaceId],
    queryFn: () => gratuityApi.list(),
    enabled: !!workspaceId,
  });
  const gratuityByContract = useMemo(() => {
    const map = new Map<number, ContractGratuity>();
    (gratuityData?.results ?? []).forEach((g) => map.set(g.contract, g));
    return map;
  }, [gratuityData]);

  // Employee map for enrichment
  const employeeMap = useMemo(() => {
    const map = new Map<number, any>();
    (employees || []).forEach((e: any) => map.set(e.id, e));
    return map;
  }, [employees]);

  // Enrich contracts with employee data
  const rows = useMemo(() => {
    return (contracts || []).map((c: any, idx: number) => {
      const emp = employeeMap.get(c.employee) || {};
      return {
        key: c.id || idx,
        sn: idx + 1,
        id: c.id,
        contract_number: c.contract_number || '-',
        employee_id: emp.employee_id || '-',
        employee_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '-',
        department: emp.department_name || '-',
        contract_type: c.contract_type_name || '-',
        start_date: c.start_date ? dayjs(c.start_date).format('YYYY-MM-DD') : '-',
        end_date: c.end_date ? dayjs(c.end_date).format('YYYY-MM-DD') : '-',
        status: c.status || 'ACTIVE',
        basic_salary: c.basic_salary ? `${c.basic_salary} ${c.salary_currency}` : '-',
      };
    });
  }, [contracts, employeeMap]);

  const columns = [
    {
      title: 'Actions',
      dataIndex: 'id',
      width: 120,
      fixed: 'left' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <EyeOutlined
            style={{ cursor: 'pointer', color: '#1890ff' }}
            onClick={() => {
              setSelectedContract(record);
              setViewModal(true);
            }}
          />
          <EditOutlined
            style={{ cursor: 'pointer', color: '#52c41a' }}
            onClick={() => {
              setEditingContract(record);
              editForm.setFieldsValue({
                status: record.status,
                end_date: record.end_date && record.end_date !== '-' ? dayjs(record.end_date) : null,
              });
            }}
          />
          <DeleteOutlined
            style={{ cursor: 'pointer', color: '#ff4d4f' }}
            onClick={() => {
              Modal.confirm({
                title: 'Delete Contract',
                content: `Delete contract ${record.contract_number}?`,
                okText: 'Delete',
                okType: 'danger',
                onOk: () => deleteMut.mutate(record.id),
              });
            }}
          />
        </Space>
      ),
    },
    { title: 'S/No', dataIndex: 'sn', width: 70 },
    { title: 'Contract #', dataIndex: 'contract_number' },
    { title: 'Employee ID', dataIndex: 'employee_id' },
    { title: 'Employee Name', dataIndex: 'employee_name' },
    { title: 'Department', dataIndex: 'department' },
    { title: 'Type', dataIndex: 'contract_type' },
    { title: 'Start Date', dataIndex: 'start_date' },
    { title: 'End Date', dataIndex: 'end_date' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: string) => {
        const colors: Record<string, string> = {
          ACTIVE: 'green',
          EXPIRED: 'red',
          RENEWED: 'blue',
          TERMINATED: 'volcano',
          PENDING_RENEWAL: 'gold',
        };
        return <Tag color={colors[s] || 'default'}>{s}</Tag>;
      },
    },
    { title: 'Salary', dataIndex: 'basic_salary' },
    {
      title: 'Gratuity',
      dataIndex: 'id',
      key: 'gratuity',
      render: (id: number) => {
        const g = gratuityByContract.get(id);
        if (!g || !g.eligible) return '-';
        const amount = g.status === 'ACCRUING' ? g.gratuity_earned : g.outstanding;
        return (
          <Space size={4} style={{ cursor: 'pointer' }} onClick={() => setGratuityContract(id)}>
            <span>K {Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2 })}</span>
            <Tag color={gratuityStatusColor[g.status]}>{gratuityStatusLabel[g.status]}</Tag>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Human Capital"
        title="Contract Schedule"
        description="Track contract lifecycles, renewals, expiries, and department-level obligations in one view."
        gradient="neutral"
        tags={[
          { label: 'Renewals', variant: 'neutral' },
          { label: 'Expiry Watchlist', variant: 'cyan' },
          { label: 'Department Scope', variant: 'lime' },
        ]}
      />

      {/* Filters */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
          marginBottom: 16,
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <Space wrap>
          <Input
            placeholder="Search by employee name"
            value={pendingFilters.employee || ''}
            onChange={(e) => setPendingFilters({ ...pendingFilters, employee: e.target.value })}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            allowClear
            placeholder="Filter by status"
            style={{ width: 180 }}
            value={pendingFilters.status || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, status: val })}
          >
            <Select.Option value="ACTIVE">Active</Select.Option>
            <Select.Option value="EXPIRED">Expired</Select.Option>
            <Select.Option value="RENEWED">Renewed</Select.Option>
            <Select.Option value="TERMINATED">Terminated</Select.Option>
            <Select.Option value="PENDING_RENEWAL">Pending Renewal</Select.Option>
          </Select>
          <Select
            allowClear
            placeholder="Filter by department"
            style={{ width: 220 }}
            value={pendingFilters.dept || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, dept: val })}
            options={(departments || []).map((d: any) => ({ value: d.id, label: d.name }))}
          />
          <Button
            type="primary"
            onClick={() => setAppliedFilters(pendingFilters)}
          >
            Search
          </Button>
          <Button
            onClick={() => {
              setPendingFilters({});
              setAppliedFilters({});
            }}
          >
            Reset
          </Button>
        </Space>
      </Card>

      {/* Contracts Table */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <MobileTable
          columns={columns}
          dataSource={rows}
          rowKey={(r: any) => r.sn}
          scroll={{ x: 1600 }}
          style={{ color: '#f7f8fb' }}
          loading={contractsLoading}
        />
      </Card>

      {/* Edit Contract Modal */}
      <Modal
        title={`Edit Contract — ${editingContract?.contract_number || ''}`}
        open={!!editingContract}
        onCancel={() => { setEditingContract(null); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        confirmLoading={editMut.isPending}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => {
            editMut.mutate({
              id: editingContract.id,
              data: {
                status: values.status,
                end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : null,
              },
            });
          }}
        >
          <Form.Item name="status" label="Status" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="ACTIVE">Active</Select.Option>
              <Select.Option value="EXPIRED">Expired</Select.Option>
              <Select.Option value="RENEWED">Renewed</Select.Option>
              <Select.Option value="TERMINATED">Terminated</Select.Option>
              <Select.Option value="PENDING_RENEWAL">Pending Renewal</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="end_date" label="End Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <GratuityBreakdown contractId={gratuityContract} onClose={() => setGratuityContract(null)} />

      {/* View Contract Modal */}
      <Modal
        title="Contract Details"
        open={viewModal}
        onCancel={() => setViewModal(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {selectedContract && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><strong>Contract #:</strong> {selectedContract.contract_number}</div>
            <div><strong>Employee:</strong> {selectedContract.employee_name}</div>
            <div><strong>Employee ID:</strong> {selectedContract.employee_id}</div>
            <div><strong>Department:</strong> {selectedContract.department}</div>
            <div><strong>Contract Type:</strong> {selectedContract.contract_type}</div>
            <div><strong>Start Date:</strong> {selectedContract.start_date}</div>
            <div><strong>End Date:</strong> {selectedContract.end_date}</div>
            <div><strong>Status:</strong> {selectedContract.status}</div>
            <div><strong>Salary:</strong> {selectedContract.basic_salary}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
