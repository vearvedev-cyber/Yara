import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { Drawer } from '@/components/overlays';
import type { ColumnsType } from 'antd/es/table';
import { Dayjs } from 'dayjs';
import MobileTable from '../../components/MobileTable';
import { useAdjustLeaveBalance, useLeaveBalanceDetail, useLeaveBalances } from '@/lib/hooks/useLeave';
import { apiErrorMessage } from '@/api/services/leaveApi';
import type { LeaveBalanceRow, LeaveLedgerEntry } from '@/api/services/leaveApi';

const kindColor: Record<LeaveLedgerEntry['kind'], string> = {
  OPENING: 'blue',
  ACCRUAL: 'green',
  TAKEN: 'orange',
  ADJUSTMENT: 'purple',
  EXPIRY: 'red',
  PAID_OUT: 'default',
};

const days = (value: string | null | undefined) => (value == null ? '—' : Number(value).toFixed(2));

const signedDays = (value: string) => {
  const n = Number(value);
  return <span style={{ color: n < 0 ? '#cf1322' : '#389e0d' }}>{n > 0 ? '+' : ''}{n.toFixed(2)}</span>;
};

export default function LeaveBalances() {
  const [search, setSearch] = useState('');
  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading } = useLeaveBalances({ leave_type: 'ANNUAL', search: search || undefined, include_terminated: includeTerminated });
  const rows = data?.results ?? [];
  const policy = data?.policy;

  const columns: ColumnsType<LeaveBalanceRow> = [
    { title: 'Employee #', dataIndex: 'employee_code', key: 'employee_code', width: 120 },
    {
      title: 'Name', dataIndex: 'employee_name', key: 'employee_name', width: 180,
      render: (name, r) => (
        <Space size={4}>
          {name}
          {r.employment_status === 'TERMINATED' && <Tag color="red">Exited</Tag>}
        </Space>
      ),
    },
    { title: 'Department', dataIndex: 'department', key: 'department', width: 150, ellipsis: true },
    {
      title: <Tooltip title="Opening balance plus monthly accruals">Earned</Tooltip>, key: 'earned', width: 90, align: 'right',
      render: (_, r) => days(String(Number(r.opening) + Number(r.accrued))),
    },
    { title: 'Taken', dataIndex: 'taken', key: 'taken', width: 80, align: 'right', render: days },
    { title: 'Adjusted', dataIndex: 'adjustments', key: 'adjustments', width: 90, align: 'right', render: days },
    { title: 'Expired', dataIndex: 'expired', key: 'expired', width: 80, align: 'right', render: days },
    {
      title: 'Balance', dataIndex: 'balance', key: 'balance', width: 90, align: 'right',
      sorter: (a, b) => Number(a.balance) - Number(b.balance),
      render: (v) => <strong style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{days(v)}</strong>,
    },
    {
      title: <Tooltip title="Balance plus days earned so far this month">Available today</Tooltip>,
      dataIndex: 'available', key: 'available', width: 120, align: 'right', render: days,
    },
    {
      title: '', key: 'view', width: 80,
      render: (_, r) => <Button size="small" onClick={() => setSelected(r.employee)}>History</Button>,
    },
  ];

  return (
    <Card
      title="Annual Leave Balances"
      style={{ marginBottom: 16 }}
      extra={
        <Space wrap>
          <Input.Search allowClear placeholder="Search name or number" onSearch={setSearch} style={{ width: 220 }} />
          <Checkbox checked={includeTerminated} onChange={(e) => setIncludeTerminated(e.target.checked)}>
            Include exited
          </Checkbox>
        </Space>
      }
    >
      {policy && (
        <div style={{ marginBottom: 12, color: '#595959' }}>
          {Number(policy.days_per_month).toFixed(2)} days per month
          {policy.carry_forward_cap != null ? ` · up to ${Number(policy.carry_forward_cap)} days carried into a new leave year` : ' · no carry-forward limit'}
          {' · '}counted in working days
        </div>
      )}
      {rows.length || isLoading ? (
        <MobileTable
          columns={columns}
          dataSource={rows.map((r) => ({ ...r, key: r.employee }))}
          loading={isLoading}
          pagination={{ pageSize: 10 }}
          size="small"
          scroll={{ x: 1000 }}
        />
      ) : (
        <Empty description="No employees" />
      )}
      <BalanceDrawer employeeId={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function BalanceDrawer({ employeeId, onClose }: { employeeId: number | null; onClose: () => void }) {
  const { data, isLoading } = useLeaveBalanceDetail(employeeId);
  const adjust = useAdjustLeaveBalance();
  const [form] = Form.useForm();

  const entryColumns: ColumnsType<LeaveLedgerEntry> = [
    { title: 'Date', dataIndex: 'date', key: 'date', width: 105 },
    { title: 'Type', dataIndex: 'kind', key: 'kind', width: 130, render: (_, e) => <Tag color={kindColor[e.kind]}>{e.kind_display}</Tag> },
    { title: 'Days', dataIndex: 'days', key: 'days', width: 80, align: 'right', render: signedDays },
    { title: 'Details', dataIndex: 'note', key: 'note', ellipsis: true },
    { title: 'By', dataIndex: 'created_by_name', key: 'by', width: 110, ellipsis: true },
  ];

  const submitAdjustment = async (values: { days: number; note: string; date?: Dayjs }) => {
    if (!employeeId) return;
    try {
      await adjust.mutateAsync({
        employeeId,
        leave_type: 'ANNUAL',
        days: values.days,
        note: values.note,
        date: values.date ? values.date.format('YYYY-MM-DD') : undefined,
      });
      message.success('Adjustment recorded');
      form.resetFields();
    } catch (err) {
      message.error(apiErrorMessage(err, 'Could not record adjustment'));
    }
  };

  return (
    <Drawer
      open={!!employeeId}
      onClose={() => { form.resetFields(); onClose(); }}
      width={720}
      title={data ? `${data.employee_name} (${data.employee_code}) — annual leave` : 'Annual leave'}
      destroyOnClose
    >
      {data && (
        <>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Hired">{data.hire_date}</Descriptions.Item>
            <Descriptions.Item label="Earned">{days(String(Number(data.opening) + Number(data.accrued)))}</Descriptions.Item>
            <Descriptions.Item label="Taken">{days(data.taken)}</Descriptions.Item>
            <Descriptions.Item label="Adjusted">{days(data.adjustments)}</Descriptions.Item>
            <Descriptions.Item label="Expired">{days(data.expired)}</Descriptions.Item>
            <Descriptions.Item label="Paid out">{days(data.paid_out)}</Descriptions.Item>
            <Descriptions.Item label="Balance"><strong>{days(data.balance)}</strong></Descriptions.Item>
            <Descriptions.Item label="Earned this month">{days(data.accruing_this_month)}</Descriptions.Item>
            <Descriptions.Item label="Available today"><strong>{days(data.available)}</strong></Descriptions.Item>
          </Descriptions>

          <Card size="small" title="Manual adjustment" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Use a positive number to add days and a negative number to remove them. The reason is kept in the history."
            />
            <Form form={form} layout="inline" onFinish={submitAdjustment}>
              <Form.Item name="days" rules={[{ required: true, message: 'Days' }]}>
                <InputNumber step={0.5} placeholder="Days" style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="note" rules={[{ required: true, message: 'Reason required' }]} style={{ flex: 1, minWidth: 220 }}>
                <Input placeholder="Reason (e.g. balance carried from old system)" maxLength={255} />
              </Form.Item>
              <Form.Item name="date">
                <DatePicker placeholder="Effective (today)" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={adjust.isPending}>Record</Button>
              </Form.Item>
            </Form>
          </Card>
        </>
      )}
      <Table
        columns={entryColumns}
        dataSource={(data?.entries ?? []).map((e) => ({ ...e, key: e.id }))}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 15 }}
        scroll={{ x: 560 }}
      />
    </Drawer>
  );
}
