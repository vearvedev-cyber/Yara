import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Popconfirm, Row, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dayjs } from 'dayjs';
import http from '../../lib/http';
import { apiErrorMessage } from '@/api/services/leaveApi';
import { kwacha, priorRedundancyApi } from '@/api/services/settlementApi';
import type { PriorRedundancyPayment } from '@/api/services/settlementApi';

interface FormValues {
  employee: number;
  amount: number;
  paid_on: Dayjs;
  employer_name: string;
  note?: string;
}

interface EmployeeOption {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
}

/** Redundancy an employee received before (here before go-live, or from another employer).
 *  It uses up part of their K2,000,000 lifetime PAYE-free redundancy allowance. */
export default function PriorRedundancyCard() {
  const queryClient = useQueryClient();
  const workspaceId = localStorage.getItem('workspaceId');
  const [form] = Form.useForm<FormValues>();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['prior-redundancy', workspaceId],
    queryFn: priorRedundancyApi.list,
    enabled: !!workspaceId,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 500 } });
      return (res.data?.results || res.data || []) as EmployeeOption[];
    },
    enabled: !!workspaceId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['prior-redundancy'] });
    queryClient.invalidateQueries({ queryKey: ['settlements'] });
  };
  const create = useMutation({ mutationFn: priorRedundancyApi.create, onSuccess: refresh });
  const remove = useMutation({ mutationFn: priorRedundancyApi.remove, onSuccess: refresh });

  const onFinish = async (values: FormValues) => {
    try {
      await create.mutateAsync({
        employee: values.employee,
        amount: values.amount,
        paid_on: values.paid_on.format('YYYY-MM-DD'),
        employer_name: values.employer_name,
        note: values.note || undefined,
      });
      message.success('Recorded');
      form.resetFields();
    } catch (err) {
      message.error(apiErrorMessage(err, 'Could not record the payment'));
    }
  };

  const columns: ColumnsType<PriorRedundancyPayment> = [
    { title: 'Employee', key: 'employee', render: (_, p) => `${p.employee_code} - ${p.employee_name}` },
    { title: 'Paid on', dataIndex: 'paid_on', key: 'paid_on', width: 110 },
    { title: 'Paid by', dataIndex: 'employer_name', key: 'employer_name' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: kwacha },
    { title: 'Note', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: '', key: 'remove', width: 80,
      render: (_, p) => (
        <Popconfirm title="Remove this record?" onConfirm={() => remove.mutate(p.id)}>
          <Button type="link" danger size="small">Remove</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card title="Previous redundancy payments" style={{ marginTop: 16 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Redundancy pay is free of PAYE only up to K2,000,000 over a person's lifetime."
        description="Record any redundancy an employee received before this system went live, or from another employer, so their final settlement doesn't grant more tax-free pay than the limit allows."
      />
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Row gutter={12}>
          <Col xs={24} md={7}>
            <Form.Item name="employee" label="Employee" rules={[{ required: true, message: 'Choose the employee' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={employees.map((e) => ({ value: e.id, label: `${e.employee_id} - ${e.first_name} ${e.last_name}` }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item name="amount" label="Amount (K)" rules={[{ required: true, message: 'Amount' }]}>
              <InputNumber min={0.01} step={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item name="paid_on" label="Paid on" rules={[{ required: true, message: 'Date' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={5}>
            <Form.Item name="employer_name" label="Paid by (employer)" rules={[{ required: true, message: 'Who paid it' }]}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24} md={4}>
            <Form.Item name="note" label="Note">
              <Input maxLength={255} />
            </Form.Item>
          </Col>
        </Row>
        <Button htmlType="submit" loading={create.isPending} style={{ marginBottom: 16 }}>Record payment</Button>
      </Form>
      <Table
        columns={columns}
        dataSource={payments.map((p) => ({ ...p, key: p.id }))}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 700 }}
        locale={{ emptyText: 'No previous redundancy payments recorded' }}
      />
    </Card>
  );
}
