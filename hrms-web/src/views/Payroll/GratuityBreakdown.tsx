import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Descriptions, Table, Tag, message } from 'antd';
import { Modal } from '@/components/overlays';
import { settlementApi } from '@/api/services/settlementApi';
import { apiErrorMessage } from '@/api/services/leaveApi';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import {
  gratuityApi, gratuityBenefitLabel, gratuityStatusColor, gratuityStatusLabel,
} from '@/api/services/gratuityApi';
import type { GratuityMonth, GratuityPayment } from '@/api/services/gratuityApi';

const kwacha = (value: string | number) =>
  `K ${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sourceTag: Record<GratuityMonth['source'], ReactNode> = {
  payslip: <Tag color="green">Payslip</Tag>,
  estimate: <Tag color="gold">Estimate</Tag>,
  missing: <Tag color="red">No payslip</Tag>,
};

export default function GratuityBreakdown({ contractId, onClose }: { contractId: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['gratuity', 'detail', contractId],
    queryFn: () => gratuityApi.detail(contractId as number),
    enabled: !!contractId,
  });

  const monthColumns: ColumnsType<GratuityMonth> = [
    { title: 'Month', key: 'month', width: 100, render: (_, m) => dayjs(new Date(m.year, m.month - 1, 1)).format('MMM YYYY') },
    {
      title: 'Days', key: 'days', width: 70,
      render: (_, m) => (m.days_covered === m.days_in_month ? 'Full' : `${m.days_covered}/${m.days_in_month}`),
    },
    { title: 'Monthly basic', dataIndex: 'basic_salary', key: 'basic_salary', align: 'right', render: kwacha },
    {
      title: 'Unpaid leave', key: 'unpaid', align: 'right', width: 140,
      render: (_, m) => (Number(m.unpaid_leave_days) > 0
        ? `${Number(m.unpaid_leave_days)} d (−${kwacha(m.unpaid_leave_reduction)})`
        : '—'),
    },
    { title: 'Basic earned', dataIndex: 'basic_earned', key: 'basic_earned', align: 'right', render: kwacha },
    { title: 'Source', dataIndex: 'source', key: 'source', width: 100, render: (s: GratuityMonth['source']) => sourceTag[s] },
  ];

  const paymentColumns: ColumnsType<GratuityPayment> = [
    { title: 'Paid on', dataIndex: 'paid_on', key: 'paid_on' },
    { title: 'Covers to', dataIndex: 'covers_to', key: 'covers_to' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: kwacha },
    { title: 'Note', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  const benefitName = data?.benefit ? gratuityBenefitLabel[data.benefit] : 'Gratuity';
  const navigate = useNavigate();
  const [preparing, setPreparing] = useState(false);
  const canPayOut = !!data && data.status === 'DUE' && !data.employee_has_left;
  const preparePayout = async () => {
    if (!data) return;
    setPreparing(true);
    try {
      const created = await settlementApi.create({ employee: data.employee, kind: 'CONTRACT_END', contract: data.contract });
      onClose();
      navigate(`/payroll/settlements/${created.id}`);
    } catch (err) {
      message.error(apiErrorMessage(err, 'Could not prepare the payout'));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Modal
      open={!!contractId}
      onCancel={onClose}
      footer={canPayOut ? (
        <Button type="primary" loading={preparing} onClick={preparePayout}>Prepare contract-end payout</Button>
      ) : null}
      width={820}
      title={data ? `${benefitName} — ${data.employee_name} (${data.contract_number})` : 'Gratuity'}
      destroyOnClose
    >
      {data && (
        <>
          {!data.eligible && <Alert type="info" showIcon message={data.reason} style={{ marginBottom: 12 }} />}
          {data.eligible && (
            <Alert type="info" showIcon message={data.legal_basis} style={{ marginBottom: 12 }} />
          )}
          {data.ended_early && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`The contract ended early on ${data.service_end}; the benefit is paid pro rata to the period actually worked.`}
            />
          )}
          {data.estimated_months > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${data.estimated_months} month(s) have no payslip in the system and are estimated from the contract's basic salary, less approved unpaid leave.`}
            />
          )}
          {data.missing_months > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${data.missing_months} month(s) have no payslip and the contract has no basic salary, so they count as zero.`}
            />
          )}
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Contract">
              {data.start_date} → {data.end_date}{data.contract_months ? ` (${Number(data.contract_months)} months)` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={gratuityStatusColor[data.status]}>{gratuityStatusLabel[data.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Basic pay earned">{kwacha(data.basic_earned)}</Descriptions.Item>
            <Descriptions.Item label={`${benefitName} (${Number(data.rate_percent)}%)`}>{kwacha(data.gratuity_earned)}</Descriptions.Item>
            <Descriptions.Item label="Paid">{kwacha(data.paid)}</Descriptions.Item>
            <Descriptions.Item label="Outstanding"><strong>{kwacha(data.outstanding)}</strong></Descriptions.Item>
          </Descriptions>
        </>
      )}
      <Table
        columns={monthColumns}
        dataSource={(data?.months ?? []).map((m) => ({ ...m, key: `${m.year}-${m.month}` }))}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 12 }}
        scroll={{ x: 660 }}
      />
      {!!data?.payments.length && (
        <Table
          style={{ marginTop: 16 }}
          title={() => 'Payments'}
          columns={paymentColumns}
          dataSource={data.payments.map((p) => ({ ...p, key: p.id }))}
          size="small"
          pagination={false}
        />
      )}
    </Modal>
  );
}
