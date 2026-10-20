import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, DatePicker, Empty, Form, Input, Select, Space, Tag, message } from 'antd';
import { Modal } from '@/components/overlays';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dayjs } from 'dayjs';
import MobileTable from '../../components/MobileTable';
import PriorRedundancyCard from './PriorRedundancyCard';
import http from '../../lib/http';
import { apiErrorMessage } from '@/api/services/leaveApi';
import { kwacha, settlementApi, settlementStatusColor } from '@/api/services/settlementApi';
import type { FinalSettlement, SettlementStatus } from '@/api/services/settlementApi';

interface TerminationRow {
  id: number;
  employee: number;
  employee_name: string;
  employee_id: string;
  termination_date: string;
  termination_reason_name: string;
}

export default function FinalSettlements() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = localStorage.getItem('workspaceId');
  const [status, setStatus] = useState<SettlementStatus | undefined>();
  const [newOpen, setNewOpen] = useState(false);
  const [form] = Form.useForm<{ employee: number; last_working_day?: Dayjs; payee_name?: string }>();

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['settlements', workspaceId, status],
    queryFn: () => settlementApi.list(status ? { status } : {}),
    enabled: !!workspaceId,
  });

  const { data: terminations = [] } = useQuery({
    queryKey: ['terminations', workspaceId, 'for-settlement'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/terminations/', { params: { page_size: 500 } });
      return (res.data?.results || res.data || []) as TerminationRow[];
    },
    enabled: newOpen,
  });

  const openExitEmployees = useMemo(
    () => new Set(settlements.filter((s) => s.kind === 'EXIT' && s.status !== 'CANCELLED').map((s) => s.employee)),
    [settlements],
  );

  const create = useMutation({
    mutationFn: settlementApi.create,
    onSuccess: (settlement) => {
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      navigate(`/payroll/settlements/${settlement.id}`);
    },
  });

  const onCreate = async (values: { employee: number; last_working_day?: Dayjs; payee_name?: string }) => {
    try {
      await create.mutateAsync({
        employee: values.employee,
        kind: 'EXIT',
        last_working_day: values.last_working_day?.format('YYYY-MM-DD'),
        payee_name: values.payee_name || undefined,
      });
      setNewOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(apiErrorMessage(err, 'Could not prepare the settlement'));
    }
  };

  const columns: ColumnsType<FinalSettlement> = [
    { title: 'Employee #', dataIndex: 'employee_code', key: 'code', width: 110 },
    {
      title: 'Name', dataIndex: 'employee_name', key: 'name', width: 180,
      render: (name, s) => <Link to={`/payroll/settlements/${s.id}`}>{name}</Link>,
    },
    { title: 'Department', dataIndex: 'department', key: 'department', width: 140, ellipsis: true },
    {
      title: 'Type', dataIndex: 'kind', key: 'kind', width: 150,
      render: (kind, s) => (kind === 'EXIT' ? (s.termination_reason || 'Exit').replace('_', ' ') : `Contract end ${s.contract_number ?? ''}`),
    },
    { title: 'Last day', dataIndex: 'last_working_day', key: 'last', width: 110 },
    { title: 'Earnings', dataIndex: 'total_earnings', key: 'earn', align: 'right', render: kwacha },
    { title: 'Deductions', dataIndex: 'total_deductions', key: 'ded', align: 'right', render: kwacha },
    { title: 'Net payable', dataIndex: 'net_payable', key: 'net', align: 'right', render: (v) => <strong>{kwacha(v)}</strong> },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render: (v: SettlementStatus) => <Tag color={settlementStatusColor[v]}>{v}</Tag> },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="Final Settlements"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="All statuses"
              value={status}
              onChange={setStatus}
              style={{ width: 150 }}
              options={(['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'] as SettlementStatus[]).map((s) => ({ value: s, label: s }))}
            />
            <Button type="primary" onClick={() => setNewOpen(true)}>Prepare settlement</Button>
          </Space>
        }
      >
        {settlements.length || isLoading ? (
          <MobileTable
            columns={columns}
            dataSource={settlements.map((s) => ({ ...s, key: s.id }))}
            loading={isLoading}
            size="small"
            pagination={{ pageSize: 15 }}
            scroll={{ x: 1100 }}
          />
        ) : (
          <Empty description="No settlements yet. Record a termination, then prepare its settlement here." />
        )}
      </Card>

      <PriorRedundancyCard />

      <Modal
        title="Prepare final settlement"
        open={newOpen}
        onOk={() => form.submit()}
        onCancel={() => setNewOpen(false)}
        confirmLoading={create.isPending}
        okText="Calculate"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item
            name="employee"
            label="Employee who has left"
            rules={[{ required: true, message: 'Choose the employee' }]}
            extra="Only employees with a recorded termination are listed."
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={terminations
                .filter((t) => !openExitEmployees.has(t.employee))
                .map((t) => ({
                  value: t.employee,
                  label: `${t.employee_id} - ${t.employee_name} (left ${t.termination_date}, ${t.termination_reason_name})`,
                }))}
            />
          </Form.Item>
          <Form.Item name="last_working_day" label="Last working day" extra="Defaults to the termination date.">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="payee_name" label="Pay to (if not the employee)" extra="For example the estate or a beneficiary.">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
