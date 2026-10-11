import { useState } from 'react';
import MobileTable from '../../components/MobileTable';
import { Card, Row, Col, Select, Button, Space, Statistic, Divider, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import http from '../../lib/http';

interface RemittanceData {
  period: { year: number; month: number };
  zra: { paye_total: number };
  napsa: { employee_total: number; employer_total: number; combined_total: number };
  nhima: { employee_total: number; employer_total: number; combined_total: number };
  employee_breakdown: Array<{
    employee_id: string;
    employee_name: string;
    gross_salary: number;
    paye: number;
    napsa_employee: number;
    napsa_employer: number;
    nhima_employee: number;
    nhima_employer: number;
  }>;
  summary: {
    total_employees: number;
    total_gross_payroll: number;
    total_statutory_deductions: number;
    total_employer_contributions: number;
  };
}

const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = currentDate.getMonth() + 1;

const safeNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const safeMoney = (value: unknown) => safeNumber(value).toFixed(2);

const months = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);

export default function RemittanceReport() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const canViewPayroll = localStorage.getItem('canPerformAction') === 'true' &&
    ['HR_ADMIN', 'FINANCE_MANAGER', 'PAYROLL_MANAGER'].includes(localStorage.getItem('workspaceRole') || '');

  const { data: report, isLoading } = useQuery<RemittanceData>({
    queryKey: ['remittance-report', selectedYear, selectedMonth],
    queryFn: async () => {
      const response = await http.get('/api/v1/payroll/payslips/remittance_report/', {
        params: { year: selectedYear, month: selectedMonth }
      });
      return response.data;
    },
    enabled: canViewPayroll,
  });

  const handleExportCSV = () => {
    if (!report) return;

    const headers = [
      'Employee ID',
      'Employee Name',
      'Gross Salary',
      'PAYE (ZRA)',
      'NAPSA Employee',
      'NAPSA Employer',
      'NHIMA Employee',
      'NHIMA Employer',
    ];

    const rows = report.employee_breakdown.map(emp => [
      emp.employee_id,
      emp.employee_name,
      safeMoney(emp.gross_salary),
      safeMoney(emp.paye),
      safeMoney(emp.napsa_employee),
      safeMoney(emp.napsa_employer),
      safeMoney(emp.nhima_employee),
      safeMoney(emp.nhima_employer),
    ]);

    // Add summary rows
    rows.push([
      'TOTALS',
      '',
      safeMoney(report.summary.total_gross_payroll),
      safeMoney(report.zra.paye_total),
      safeMoney(report.napsa.employee_total),
      safeMoney(report.napsa.employer_total),
      safeMoney(report.nhima.employee_total),
      safeMoney(report.nhima.employer_total),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remittance-report-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    message.success('Report exported successfully');
  };

  const monthName = months.find(m => m.value === selectedMonth)?.label || '';

  const breakdownColumns = [
    {
      title: 'Employee ID',
      dataIndex: 'employee_id',
      key: 'employee_id',
      width: '15%',
    },
    {
      title: 'Name',
      dataIndex: 'employee_name',
      key: 'employee_name',
      width: '20%',
    },
    {
      title: 'Gross Salary',
      dataIndex: 'gross_salary',
      key: 'gross_salary',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
    {
      title: 'PAYE (ZRA)',
      dataIndex: 'paye',
      key: 'paye',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
    {
      title: 'NAPSA (Emp)',
      dataIndex: 'napsa_employee',
      key: 'napsa_employee',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
    {
      title: 'NAPSA (Empr)',
      dataIndex: 'napsa_employer',
      key: 'napsa_employer',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
    {
      title: 'NHIMA (Emp)',
      dataIndex: 'nhima_employee',
      key: 'nhima_employee',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
    {
      title: 'NHIMA (Empr)',
      dataIndex: 'nhima_employer',
      key: 'nhima_employer',
      align: 'right' as const,
      render: (value: number) => `K ${safeMoney(value)}`,
    },
  ];

  if (!canViewPayroll) {
    return <Card>You don't have permission to view payroll reports.</Card>;
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card title="Statutory Remittance Report" style={{ marginBottom: '24px' }}>
        <Space style={{ marginBottom: '24px' }}>
          <Select
            style={{ width: 120 }}
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={months}
          />
          <Select
            style={{ width: 100 }}
            value={selectedYear}
            onChange={setSelectedYear}
            options={years.map(y => ({ value: y, label: y.toString() }))}
          />
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExportCSV}
            loading={isLoading}
          >
            Export CSV
          </Button>
        </Space>

        {report && (
          <>
            <Divider>Summary - {monthName} {selectedYear}</Divider>
            <Row gutter={[16, 16]} style={{ marginBottom: '32px' }}>
              <Col xs={24} sm={12} lg={6}>
                <Statistic
                  title="Total Employees"
                  value={report.summary.total_employees}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Statistic
                  title="Total Gross Payroll"
                  value={report.summary.total_gross_payroll}
                  prefix="K"
                  precision={2}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Statistic
                  title="Total Statutory Deductions"
                  value={report.summary.total_statutory_deductions}
                  prefix="K"
                  precision={2}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Statistic
                  title="Total Employer Contributions"
                  value={report.summary.total_employer_contributions}
                  prefix="K"
                  precision={2}
                />
              </Col>
            </Row>

            <Divider>Statutory Amounts Due</Divider>
            <Row gutter={[16, 16]} style={{ marginBottom: '32px' }}>
              <Col xs={24} sm={12} lg={8}>
                <Card>
                  <Statistic
                    title="ZRA (PAYE)"
                    value={report.zra.paye_total}
                    prefix="K"
                    precision={2}
                    valueStyle={{ color: '#cf1322' }}
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                    Due to: Zambia Revenue Authority
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Card>
                  <div style={{ marginBottom: '12px' }}>
                    <Statistic
                      title="NAPSA Employee"
                      value={report.napsa.employee_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ fontSize: '16px' }}
                    />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <Statistic
                      title="NAPSA Employer"
                      value={report.napsa.employer_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ fontSize: '16px' }}
                    />
                  </div>
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '8px' }}>
                    <Statistic
                      title="NAPSA Total"
                      value={report.napsa.combined_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#faad14', fontWeight: 'bold' }}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                    Due to: National Pensions Scheme Authority
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <Card>
                  <div style={{ marginBottom: '12px' }}>
                    <Statistic
                      title="NHIMA Employee"
                      value={report.nhima.employee_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ fontSize: '16px' }}
                    />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <Statistic
                      title="NHIMA Employer"
                      value={report.nhima.employer_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ fontSize: '16px' }}
                    />
                  </div>
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '8px' }}>
                    <Statistic
                      title="NHIMA Total"
                      value={report.nhima.combined_total}
                      prefix="K"
                      precision={2}
                      valueStyle={{ color: '#52c41a', fontWeight: 'bold' }}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                    Due to: National Health Insurance Management Authority
                  </div>
                </Card>
              </Col>
            </Row>

            <Divider>Employee Breakdown</Divider>
            <MobileTable
              columns={breakdownColumns}
              dataSource={report.employee_breakdown.map((emp, idx) => ({
                ...emp,
                key: idx,
              }))}
              pagination={{ pageSize: 10 }}
              loading={isLoading}
              scroll={{ x: true }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
