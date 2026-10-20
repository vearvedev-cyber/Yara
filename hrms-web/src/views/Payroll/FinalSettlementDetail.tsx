import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import { Modal } from '@/components/overlays';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { apiErrorMessage } from '@/api/services/leaveApi';
import { kwacha, settlementApi, settlementStatusColor } from '@/api/services/settlementApi';
import type { FinalSettlement, SettlementLine } from '@/api/services/settlementApi';

interface ManualLineForm {
  kind: string;
  amount: number;
  reason: string;
  description?: string;
  tax?: ('paye' | 'napsa' | 'nhima')[];
}

export default function FinalSettlementDetail() {
  const { id } = useParams();
  const settlementId = Number(id);
  const queryClient = useQueryClient();
  const [lineForm] = Form.useForm<ManualLineForm>();
  const [editForm] = Form.useForm<{ payee_name: string; notes: string; last_working_day: Dayjs }>();
  const [payForm] = Form.useForm<{ reference: string; paid_on: Dayjs }>();
  const [payOpen, setPayOpen] = useState(false);
  const chosenKind = Form.useWatch('kind', lineForm);
  const [editOpen, setEditOpen] = useState(false);

  const { data: s, isLoading } = useQuery({
    queryKey: ['settlements', 'detail', settlementId],
    queryFn: () => settlementApi.get(settlementId),
    enabled: !!settlementId,
  });
  const { data: kinds } = useQuery({ queryKey: ['settlements', 'line-kinds'], queryFn: settlementApi.lineKinds });

  const run = useMutation({
    mutationFn: (fn: () => Promise<FinalSettlement>) => fn(),
    onSuccess: (data) => {
      queryClient.setQueryData(['settlements', 'detail', settlementId], data);
      queryClient.invalidateQueries({ queryKey: ['settlements'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['leaveBalances'] });
      queryClient.invalidateQueries({ queryKey: ['gratuity'] });
    },
  });

  const act = async (fn: () => Promise<FinalSettlement>, ok: string, fail: string) => {
    try {
      await run.mutateAsync(fn);
      message.success(ok);
      return true;
    } catch (err) {
      message.error(apiErrorMessage(err, fail));
      return false;
    }
  };

  if (!s) return <Card loading={isLoading} style={{ margin: 16 }} />;

  const draft = s.status === 'DRAFT';
  const lines = s.lines ?? [];
  const isEarningKind = (kind?: string) => !!kinds?.manual_earnings.some((k) => k.value === kind);

  const lineColumns = (withTax: boolean): ColumnsType<SettlementLine> => [
    {
      title: 'Item', dataIndex: 'description', key: 'description',
      render: (text, l) => (
        <div>
          <div>{text} {l.is_manual && <Tag color="purple">Manual</Tag>}</div>
          {(l.basis || l.reason) && (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              {[l.basis, l.is_manual ? l.reason : ''].filter(Boolean).join(' — ')}
            </div>
          )}
        </div>
      ),
    },
    ...(withTax ? [{
      title: 'Taxed for', key: 'tax', width: 170,
      render: (_: unknown, l: SettlementLine) => (
        <Space size={2} wrap>
          {l.paye && <Tag>PAYE</Tag>}
          {l.napsa && <Tag>NAPSA</Tag>}
          {l.nhima && <Tag>NHIMA</Tag>}
          {!l.paye && !l.napsa && !l.nhima && '—'}
        </Space>
      ),
    }] : []),
    { title: 'Amount', dataIndex: 'amount', key: 'amount', width: 140, align: 'right', render: kwacha },
    {
      title: '', key: 'remove', width: 70,
      render: (_, l) => draft && l.is_manual && (
        <Popconfirm title="Remove this line?" onConfirm={() => act(() => settlementApi.removeLine(s.id, l.id), 'Line removed', 'Could not remove the line')}>
          <Button type="link" danger size="small">Remove</Button>
        </Popconfirm>
      ),
    },
  ];

  const section = (category: SettlementLine['category'], title: string, withTax = false) => {
    const items = lines.filter((l) => l.category === category).map((l) => ({ ...l, key: l.id }));
    if (!items.length && category === 'EMPLOYER') return null;
    return (
      <Table
        title={() => <strong>{title}</strong>}
        columns={lineColumns(withTax)}
        dataSource={items}
        pagination={false}
        size="small"
        scroll={{ x: 560 }}
        style={{ marginBottom: 16 }}
        locale={{ emptyText: 'None' }}
      />
    );
  };

  const onAddLine = async (values: ManualLineForm) => {
    const earning = isEarningKind(values.kind);
    const tax = values.tax ?? [];
    const ok = await act(
      () => settlementApi.addLine(s.id, {
        kind: values.kind,
        amount: values.amount,
        reason: values.reason,
        description: values.description || undefined,
        ...(earning ? { paye: tax.includes('paye'), napsa: tax.includes('napsa'), nhima: tax.includes('nhima') } : {}),
      }),
      'Line added',
      'Could not add the line',
    );
    if (ok) lineForm.resetFields();
  };

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to="/payroll/settlements">← All settlements</Link>
      </Space>
      <Card
        title={
          <Space wrap>
            <span>{s.kind === 'EXIT' ? 'Final settlement' : 'Contract-end payout'} — {s.employee_name} ({s.employee_code})</span>
            <Tag color={settlementStatusColor[s.status]}>{s.status}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            {draft && <Button onClick={() => act(() => settlementApi.recalculate(s.id), 'Recalculated', 'Could not recalculate')}>Recalculate</Button>}
            {draft && (
              <Button onClick={() => {
                editForm.setFieldsValue({ payee_name: s.payee_name, notes: s.notes, last_working_day: dayjs(s.last_working_day) });
                setEditOpen(true);
              }}>Edit details</Button>
            )}
            <Button onClick={() => settlementApi.downloadPdf(s.id, `settlement_${s.employee_code}_${s.last_working_day}.pdf`)
              .catch(() => message.error('Could not download the PDF'))}>Download PDF</Button>
            {draft && (
              <Popconfirm
                title="Approve this settlement?"
                description="It will be locked, and leave days paid out will be recorded. Someone other than the preparer must approve."
                onConfirm={() => act(() => settlementApi.approve(s.id), 'Settlement approved', 'Could not approve')}
              >
                <Button type="primary">Approve</Button>
              </Popconfirm>
            )}
            {s.status === 'APPROVED' && (
              <Button type="primary" onClick={() => { payForm.setFieldsValue({ paid_on: dayjs() }); setPayOpen(true); }}>Mark as paid</Button>
            )}
            {draft && (
              <Popconfirm title="Cancel this settlement?" onConfirm={() => act(() => settlementApi.cancel(s.id), 'Cancelled', 'Could not cancel')}>
                <Button danger>Cancel</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Department">{s.department || '—'}</Descriptions.Item>
          <Descriptions.Item label="Hired">{s.hire_date}</Descriptions.Item>
          <Descriptions.Item label="Last working day">{s.last_working_day}</Descriptions.Item>
          {s.termination_reason && <Descriptions.Item label="Reason">{s.termination_reason.replace('_', ' ')}</Descriptions.Item>}
          {s.contract_number && <Descriptions.Item label="Contract">{s.contract_number}</Descriptions.Item>}
          {s.payee_name && <Descriptions.Item label="Pay to">{s.payee_name}</Descriptions.Item>}
          <Descriptions.Item label="Prepared by">{s.prepared_by_name ?? '—'}</Descriptions.Item>
          {s.approved_by_name && <Descriptions.Item label="Approved by">{s.approved_by_name} · {dayjs(s.approved_at).format('YYYY-MM-DD')}</Descriptions.Item>}
          {s.paid_by_name && <Descriptions.Item label="Paid">{dayjs(s.paid_at).format('YYYY-MM-DD')} · {s.payment_reference || 'no reference'}</Descriptions.Item>}
          {s.notes && <Descriptions.Item label="Notes" span={3}>{s.notes}</Descriptions.Item>}
        </Descriptions>

        {(s.calculation_notes ?? []).map((note) => (
          <Alert key={note} type="warning" showIcon message={note} style={{ marginBottom: 8 }} />
        ))}

        <Row gutter={16} style={{ margin: '16px 0' }}>
          <Col xs={24} sm={8}><Statistic title="Earnings" value={kwacha(s.total_earnings)} /></Col>
          <Col xs={24} sm={8}><Statistic title="Deductions" value={kwacha(s.total_deductions)} /></Col>
          <Col xs={24} sm={8}>
            <Statistic
              title={Number(s.net_payable) >= 0 ? 'Net payable' : 'Owed by employee'}
              value={kwacha(Math.abs(Number(s.net_payable)))}
              valueStyle={{ color: Number(s.net_payable) >= 0 ? '#389e0d' : '#cf1322', fontWeight: 600 }}
            />
          </Col>
        </Row>

        {section('EARNING', 'Earnings', true)}
        {section('DEDUCTION', 'Deductions')}
        {section('EMPLOYER', 'Employer contributions (not deducted from pay)')}

        {draft && kinds && (
          <>
            <Divider titlePlacement="start">Add an earning or deduction</Divider>
            <Form form={lineForm} layout="vertical" onFinish={onAddLine} initialValues={{ tax: ['paye', 'napsa', 'nhima'] }}>
              <Row gutter={12}>
                <Col xs={24} md={6}>
                  <Form.Item name="kind" label="Type" rules={[{ required: true, message: 'Choose a type' }]}>
                    <Select
                      options={[
                        { label: 'Earnings', options: kinds.manual_earnings },
                        { label: 'Deductions', options: kinds.manual_deductions },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  <Form.Item name="amount" label="Amount (K)" rules={[{ required: true, message: 'Amount' }]}>
                    <InputNumber min={0.01} step={100} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'A reason is required' }]}>
                    <Input maxLength={255} placeholder="e.g. Staff loan balance per loan agreement" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item name="description" label="Label on statement (optional)">
                    <Input maxLength={255} />
                  </Form.Item>
                </Col>
              </Row>
              {isEarningKind(chosenKind) && (
                <Form.Item name="tax" label="Include in">
                  <Checkbox.Group options={[{ label: 'PAYE', value: 'paye' }, { label: 'NAPSA', value: 'napsa' }, { label: 'NHIMA', value: 'nhima' }]} />
                </Form.Item>
              )}
              <Button htmlType="submit" loading={run.isPending}>Add line</Button>
            </Form>
          </>
        )}
      </Card>

      <Modal
        title="Mark settlement as paid"
        open={payOpen}
        onCancel={() => setPayOpen(false)}
        onOk={() => payForm.submit()}
        confirmLoading={run.isPending}
        destroyOnClose
      >
        <Form
          form={payForm}
          layout="vertical"
          onFinish={async (v) => {
            const ok = await act(
              () => settlementApi.markPaid(s.id, { reference: v.reference, paid_on: v.paid_on?.format('YYYY-MM-DD') }),
              'Marked as paid', 'Could not mark as paid',
            );
            if (ok) setPayOpen(false);
          }}
        >
          <Form.Item name="reference" label="Payment reference" rules={[{ required: true, message: 'Enter the payment reference' }]}>
            <Input placeholder="e.g. EFT number or cheque number" maxLength={100} />
          </Form.Item>
          <Form.Item name="paid_on" label="Paid on" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Settlement details"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={run.isPending}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={async (v) => {
            const ok = await act(
              () => settlementApi.update(s.id, {
                payee_name: v.payee_name, notes: v.notes, last_working_day: v.last_working_day?.format('YYYY-MM-DD'),
              }),
              'Saved and recalculated', 'Could not save',
            );
            if (ok) setEditOpen(false);
          }}
        >
          <Form.Item name="last_working_day" label="Last working day" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="payee_name" label="Pay to (if not the employee)">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
