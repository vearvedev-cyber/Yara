import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Popconfirm, Row, Select,
  Space, Switch, Table, Tag, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import {
  useAddHoliday, useDeleteHoliday, useLeavePolicy, usePublicHolidays, useSaveLeavePolicy, useSeedHolidays,
} from '@/lib/hooks/useLeave';
import { apiErrorMessage as errorText } from '@/api/services/leaveApi';
import type { PublicHoliday } from '@/api/services/leaveApi';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gratuityApi } from '@/api/services/gratuityApi';

interface PolicyFormValues {
  days_per_month: number;
  carry_forward_cap?: number;
  no_cap: boolean;
  leave_year_start_month: number;
  working_weekdays: string[];
  allow_negative_balance: boolean;
}

const weekdayOptions = [
  { label: 'Mon', value: '0' }, { label: 'Tue', value: '1' }, { label: 'Wed', value: '2' },
  { label: 'Thu', value: '3' }, { label: 'Fri', value: '4' }, { label: 'Sat', value: '5' }, { label: 'Sun', value: '6' },
];

const monthOptions = Array.from({ length: 12 }, (_, i) => ({ label: dayjs().month(i).format('MMMM'), value: i + 1 }));

export default function LeaveSettings() {
  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={11}><AnnualLeavePolicyCard /></Col>
        <Col xs={24} lg={13}><PublicHolidaysCard /></Col>
        <Col xs={24} lg={11}><GratuityPolicyCard /></Col>
      </Row>
    </div>
  );
}

function AnnualLeavePolicyCard() {
  const { data: policy, isLoading } = useLeavePolicy('ANNUAL');
  const save = useSaveLeavePolicy();
  const [form] = Form.useForm<PolicyFormValues>();
  const noCap = Form.useWatch('no_cap', form);

  useEffect(() => {
    if (!policy) return;
    form.setFieldsValue({
      days_per_month: Number(policy.days_per_month),
      carry_forward_cap: policy.carry_forward_cap != null ? Number(policy.carry_forward_cap) : undefined,
      no_cap: policy.carry_forward_cap == null,
      leave_year_start_month: policy.leave_year_start_month,
      working_weekdays: policy.working_weekdays.split(','),
      allow_negative_balance: policy.allow_negative_balance,
    });
  }, [policy, form]);

  const onFinish = async (values: PolicyFormValues) => {
    if (!policy) return;
    try {
      await save.mutateAsync({
        ...policy,
        leave_type: 'ANNUAL',
        days_per_month: String(values.days_per_month),
        carry_forward_cap: values.no_cap ? null : String(values.carry_forward_cap ?? 0),
        leave_year_start_month: values.leave_year_start_month,
        working_weekdays: values.working_weekdays.join(','),
        count_working_days: true,
        allow_negative_balance: values.allow_negative_balance,
      });
      message.success('Leave policy saved');
    } catch (err) {
      message.error(errorText(err, 'Could not save the leave policy'));
    }
  };

  const daysPerMonth = Form.useWatch('days_per_month', form);

  return (
    <Card title="Annual Leave Policy" loading={isLoading}>
      {policy?.is_default && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Using the default policy"
          description="2 days per month (24 a year), up to 12 days carried into a new leave year, Monday–Friday working days. Save to customise it for this workspace."
        />
      )}
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="days_per_month"
          label="Days earned per month"
          extra={daysPerMonth ? `${(Number(daysPerMonth) * 12).toFixed(1)} days a year` : undefined}
          rules={[{ required: true }]}
        >
          <InputNumber min={0} max={10} step={0.25} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item label="Days carried into a new leave year">
          <Space>
            <Form.Item name="carry_forward_cap" noStyle>
              <InputNumber min={0} max={365} disabled={noCap} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="no_cap" valuePropName="checked" noStyle>
              <Checkbox>No limit</Checkbox>
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="leave_year_start_month" label="Leave year starts in" rules={[{ required: true }]}>
          <Select options={monthOptions} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          name="working_weekdays"
          label="Working days"
          extra="Leave requests count only these days, and skip public holidays."
          rules={[{ required: true, message: 'Pick at least one day' }]}
        >
          <Checkbox.Group options={weekdayOptions} />
        </Form.Item>
        <Form.Item name="allow_negative_balance" label="Allow approving leave beyond the balance" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>Save policy</Button>
      </Form>
    </Card>
  );
}

function PublicHolidaysCard() {
  const [year, setYear] = useState(dayjs().year());
  const { data: holidays = [], isLoading } = usePublicHolidays(year);
  const addHoliday = useAddHoliday();
  const deleteHoliday = useDeleteHoliday();
  const seed = useSeedHolidays();
  const [form] = Form.useForm();

  const onAdd = async (values: { date: Dayjs; name: string }) => {
    try {
      await addHoliday.mutateAsync({ date: values.date.format('YYYY-MM-DD'), name: values.name });
      message.success('Holiday added');
      form.resetFields();
    } catch (err) {
      message.error(errorText(err, 'Could not add the holiday'));
    }
  };

  const onSeed = async () => {
    try {
      const res = await seed.mutateAsync(year);
      message.success(res.created ? `${res.created} national holidays added for ${year}` : `${year} holidays were already loaded`);
    } catch (err) {
      message.error(errorText(err, 'Could not load holidays'));
    }
  };

  const columns: ColumnsType<PublicHoliday> = [
    { title: 'Date', dataIndex: 'date', key: 'date', width: 120 },
    { title: 'Day', key: 'day', width: 70, render: (_, h) => dayjs(h.date).format('ddd') },
    { title: 'Holiday', dataIndex: 'name', key: 'name' },
    {
      title: '', key: 'scope', width: 110,
      render: (_, h) => (h.is_national ? <Tag color="blue">National</Tag> : <Tag color="purple">Company</Tag>),
    },
    {
      title: '', key: 'actions', width: 60,
      render: (_, h) => !h.is_national && (
        <Popconfirm title="Remove this holiday?" onConfirm={() => deleteHoliday.mutate(h.id)}>
          <Button size="small" danger type="link">Remove</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title="Public Holidays"
      extra={
        <Space>
          <Select
            value={year}
            onChange={setYear}
            options={[year - 1, year, year + 1].map((y) => ({ label: y, value: y }))}
            style={{ width: 100 }}
          />
          <Button onClick={onSeed} loading={seed.isPending}>Load Zambian holidays</Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Check the list against the official gazette each year and add any one-off holidays the government declares."
      />
      <Form form={form} layout="inline" onFinish={onAdd} style={{ marginBottom: 12 }}>
        <Form.Item name="date" rules={[{ required: true, message: 'Date' }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item name="name" rules={[{ required: true, message: 'Name' }]}>
          <Input placeholder="Company holiday name" maxLength={100} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={addHoliday.isPending}>Add</Button>
        </Form.Item>
      </Form>
      <Table
        columns={columns}
        dataSource={holidays.map((h) => ({ ...h, key: h.id }))}
        loading={isLoading}
        size="small"
        pagination={false}
        scroll={{ x: 480 }}
      />
    </Card>
  );
}

const contractTypeOptions = [
  { value: 'FIXED_TERM', label: 'Fixed-term' },
  { value: 'SHORT_TERM', label: 'Short-term' },
  { value: 'TEMPORARY', label: 'Temporary' },
  { value: 'SEASONAL', label: 'Seasonal' },
  { value: 'PROBATION', label: 'Probation' },
];

interface GratuityFormValues {
  rate_percent: number;
  long_term_months: number;
  eligible_contract_types: string[];
  estimate_missing_months: boolean;
}

function GratuityPolicyCard() {
  const queryClient = useQueryClient();
  const { data: policy, isLoading } = useQuery({ queryKey: ['gratuity', 'policy'], queryFn: gratuityApi.getPolicy });
  const save = useMutation({
    mutationFn: gratuityApi.savePolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gratuity'] }),
  });
  const [form] = Form.useForm<GratuityFormValues>();
  const threshold = Form.useWatch('long_term_months', form);

  useEffect(() => {
    if (!policy) return;
    form.setFieldsValue({
      rate_percent: Number(policy.rate_percent),
      long_term_months: policy.long_term_months,
      eligible_contract_types: policy.eligible_contract_types.split(',').filter(Boolean),
      estimate_missing_months: policy.estimate_missing_months,
    });
  }, [policy, form]);

  const onFinish = async (values: GratuityFormValues) => {
    try {
      await save.mutateAsync({
        rate_percent: String(values.rate_percent),
        long_term_months: values.long_term_months,
        eligible_contract_types: values.eligible_contract_types.join(','),
        estimate_missing_months: values.estimate_missing_months,
      });
      message.success('Gratuity policy saved');
    } catch (err) {
      message.error(errorText(err, 'Could not save the gratuity policy'));
    }
  };

  return (
    <Card title="Gratuity & short-term severance" loading={isLoading}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Employment Code Act No. 3 of 2019"
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Long-term contracts (more than {threshold ?? 12} months): gratuity of at least 25% of basic pay earned (s73).</li>
            <li>Shorter fixed-duration contracts: severance pay of at least 25% of basic pay (s54).</li>
            <li>Contracts ending early, including by dismissal, are paid pro rata to the period worked (s51(1), s73(2)).</li>
            <li>Basic pay earned excludes unpaid leave (basic ÷ 26 per unpaid day).</li>
          </ul>
        }
      />
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="rate_percent" label="Rate (% of basic pay)" rules={[{ required: true }]}>
              <InputNumber min={25} max={100} step={0.5} addonAfter="%" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="long_term_months" label="Long-term means more than" rules={[{ required: true }]}>
              <InputNumber min={1} max={120} addonAfter="months" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="eligible_contract_types"
          label="Fixed-duration contract types"
          rules={[{ required: true, message: 'Pick at least one contract type' }]}
          extra="Contracts of these types with an end date earn gratuity or short-term severance."
        >
          <Checkbox.Group options={contractTypeOptions} />
        </Form.Item>
        <Form.Item
          name="estimate_missing_months"
          label="Estimate months with no payslip from the contract's basic salary"
          valuePropName="checked"
          extra="For contracts that started before payroll was run in this system. Estimated months are marked in the breakdown."
        >
          <Switch />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>Save gratuity policy</Button>
      </Form>
    </Card>
  );
}
