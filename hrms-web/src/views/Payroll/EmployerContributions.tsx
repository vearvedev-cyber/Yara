import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Select,
  Spin,
  Typography,
  Table,
} from 'antd';
import {
  DollarOutlined,
  TeamOutlined,
  BankOutlined,
  SafetyOutlined,
  CalculatorOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import http from '../../lib/http';
import { canPerformAction } from '../../lib/permissions';

const { Title, Text } = Typography;

interface EmployeeBreakdown {
  employee_name: string;
  employee_id: string;
  gross_salary: number;
  napsa_employer: number;
  nhima_employer: number;
  paye_tax: number;
  total_employer: number;
}

interface EmployerSummary {
  total_napsa_employer: number;
  total_nhima_employer: number;
  total_paye: number;
  total_employer_cost: number;
  total_gross: number;
  employee_count: number;
  breakdown: EmployeeBreakdown[];
}

const safeNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const safeMoney = (value: unknown) => safeNumber(value).toFixed(2);

const EmployerContributions: React.FC = () => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const canViewPayroll = canPerformAction('can_view_payroll');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['employer-contributions', selectedYear, selectedMonth],
    queryFn: async () => {
      const response = await http.get(
        `/api/v1/payroll/payslips/remittance_report/?year=${selectedYear}&month=${selectedMonth}`
      );
      const data = response.data || {};
      const breakdown: EmployeeBreakdown[] = (data.employee_breakdown || []).map((p: any) => ({
        employee_name: p.employee_name,
        employee_id: p.employee_id,
        gross_salary: Number(p.gross_salary || 0),
        napsa_employer: Number(p.napsa_employer || 0),
        nhima_employer: Number(p.nhima_employer || 0),
        paye_tax: Number(p.paye_tax || 0),
        total_employer: Number(p.napsa_employer || 0) + Number(p.nhima_employer || 0),
      }));

      const total_napsa_employer = Number(data.napsa?.employer_total || 0);
      const total_nhima_employer = Number(data.nhima?.employer_total || 0);
      const total_paye = Number(data.paye?.total || 0) ||
        breakdown.reduce((s, r) => s + r.paye_tax, 0);
      const total_employer_cost =
        Number(data.summary?.total_employer_contributions || 0) ||
        (total_napsa_employer + total_nhima_employer);
      const total_gross = Number(data.summary?.total_gross_payroll || 0);
      const employee_count = Number(data.summary?.total_employees || breakdown.length);

      return {
        total_napsa_employer,
        total_nhima_employer,
        total_paye,
        total_employer_cost,
        total_gross,
        employee_count,
        breakdown,
      } as EmployerSummary;
    },
    enabled: canViewPayroll,
  });

  const columns = [
    {
      title: 'Employee ID',
      dataIndex: 'employee_id',
      key: 'employee_id',
      width: 130,
      fixed: 'left' as const,
    },
    {
      title: 'Employee Name',
      dataIndex: 'employee_name',
      key: 'employee_name',
      width: 200,
    },
    {
      title: 'Gross Salary',
      dataIndex: 'gross_salary',
      key: 'gross_salary',
      width: 130,
      render: (val: number) => `K${safeMoney(val)}`,
    },
    {
      title: 'NAPSA (Employer 5%)',
      dataIndex: 'napsa_employer',
      key: 'napsa_employer',
      width: 150,
      render: (val: number) => `K${safeMoney(val)}`,
    },
    {
      title: 'NHIMA (Employer 1%)',
      dataIndex: 'nhima_employer',
      key: 'nhima_employer',
      width: 155,
      render: (val: number) => `K${safeMoney(val)}`,
    },
    {
      title: 'PAYE (Employee)',
      dataIndex: 'paye_tax',
      key: 'paye_tax',
      width: 140,
      render: (val: number) => (
        <Text style={{ color: '#faad14' }}>K{safeMoney(val)}</Text>
      ),
    },
    {
      title: 'Employer Cost',
      dataIndex: 'total_employer',
      key: 'total_employer',
      width: 130,
      render: (val: number) => (
        <Text strong style={{ color: '#fa8c16' }}>
          K{safeMoney(val)}
        </Text>
      ),
    },
  ];

  if (!canViewPayroll) {
    return (
      <Card>
        <Text>You don&apos;t have permission to view employer contributions</Text>
      </Card>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
          <Col>
            <Title level={3} style={{ margin: 0 }}>Employer Contributions Report</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              NAPSA &amp; NHIMA employer obligations + PAYE employee deductions
            </Text>
          </Col>
          <Col>
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              style={{ width: 130, marginRight: 8 }}
              options={[
                { label: 'January', value: 1 },
                { label: 'February', value: 2 },
                { label: 'March', value: 3 },
                { label: 'April', value: 4 },
                { label: 'May', value: 5 },
                { label: 'June', value: 6 },
                { label: 'July', value: 7 },
                { label: 'August', value: 8 },
                { label: 'September', value: 9 },
                { label: 'October', value: 10 },
                { label: 'November', value: 11 },
                { label: 'December', value: 12 },
              ]}
            />
            <Select
              value={selectedYear}
              onChange={setSelectedYear}
              style={{ width: 100 }}
              options={Array.from({ length: 5 }, (_, i) => ({
                label: (new Date().getFullYear() - 2 + i).toString(),
                value: new Date().getFullYear() - 2 + i,
              }))}
            />
          </Col>
        </Row>

        <Spin spinning={isLoading}>
          {summary && (
            <>
              {/* KPI row */}
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="Employees"
                      value={summary.employee_count}
                      valueStyle={{ color: '#1890ff' }}
                      prefix={<TeamOutlined />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="NAPSA Employer"
                      value={summary.total_napsa_employer}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#722ed1' }}
                      suffix={<SafetyOutlined style={{ fontSize: 12 }} />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="NHIMA Employer"
                      value={summary.total_nhima_employer}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#13c2c2' }}
                      suffix={<SafetyOutlined style={{ fontSize: 12 }} />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="PAYE (Employees)"
                      value={summary.total_paye}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#faad14' }}
                      suffix={<CalculatorOutlined style={{ fontSize: 12 }} />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="Employer Cost"
                      value={summary.total_employer_cost}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#fa8c16' }}
                      suffix={<BankOutlined style={{ fontSize: 12 }} />}
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Card size="small">
                    <Statistic
                      title="Total Gross"
                      value={summary.total_gross}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#52c41a' }}
                      suffix={<DollarOutlined style={{ fontSize: 12 }} />}
                    />
                  </Card>
                </Col>
              </Row>

              {/* Burden rate bar */}
              <Card size="small" style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="Employer Burden Rate"
                      value={summary.total_gross > 0
                        ? ((summary.total_employer_cost / summary.total_gross) * 100).toFixed(2)
                        : '0.00'}
                      suffix="%"
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="PAYE as % of Gross"
                      value={summary.total_gross > 0
                        ? ((summary.total_paye / summary.total_gross) * 100).toFixed(2)
                        : '0.00'}
                      suffix="%"
                      valueStyle={{ color: '#faad14' }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="Total Payroll Obligations"
                      value={summary.total_employer_cost + summary.total_paye}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#ff4d4f' }}
                    />
                  </Col>
                </Row>
              </Card>

              <Table
                columns={columns}
                dataSource={summary.breakdown}
                rowKey="employee_id"
                pagination={{ pageSize: 20 }}
                scroll={{ x: 1100 }}
                size="small"
              />
            </>
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default EmployerContributions;
