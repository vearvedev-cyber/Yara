import React, { useState, useEffect } from 'react';
import MobileTable from '../../components/MobileTable';
import {
  Card,
  Button,
  Space,
  Select,
  message,
  Drawer,
  Form,
  InputNumber,
  Tag,
  Modal,
  Typography,
  Divider,
  Spin,
  Row,
  Col,
  Statistic,
  Input,
  Popconfirm,
  Tabs,
  Timeline,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  CalculatorOutlined,
  FileTextOutlined,
  ExportOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { canPerformAction } from '../../lib/permissions';
import PayrollEntryForm from '../../components/PayrollEntryForm';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Employee {
  id: number;
  full_name: string;
  employee_id: string;
  employee_number: string;
}

interface PayrollEntry {
  id: number;
  employee: number;
  employee_name: string;
  department: string;
  date_of_hire?: string;
  resident?: string;
  currency: string;
  basic: number;
  housing: number;
  transportation: number;
  lunch: number;
  gross: number;
  net: number;
  napsa_employee: number;
  nhima_employee: number;
  paye_tax: number;
}

interface Payslip {
  id: number;
  employee: number;
  employee_name: string;
  employee_number: string;
  employee_id: string;
  period: number;
  period_display: string;
  department: string;
  basic_salary: string;
  housing_allowance: string;
  transportation_allowance: string;
  lunch_allowance: string;
  other_allowances: string;
  overtime_payment: string;
  bonus: string;
  double_ticket_payment: string;
  gross_salary: string;
  unpaid_leave_days: string;
  unpaid_leave_deduction: string;
  absenteeism_days: string;
  absenteeism_deduction: string;
  napsa_employee: string;
  napsa_employer: string;
  paye_tax: string;
  nhima_employee: string;
  nhima_employer: string;
  total_custom_deductions: string;
  total_deductions: string;
  net_salary: string;
  is_processed: boolean;
  notes: string;
  custom_deductions: Array<{ id: number; description: string; amount: string }>;
}

interface CustomDeduction {
  description: string;
  amount: number;
}

const PayrollManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [payrollEntryFormVisible, setPayrollEntryFormVisible] = useState(false);
  const [editingPayrollEntry, setEditingPayrollEntry] = useState<PayrollEntry | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingPayslip, setEditingPayslip] = useState<Payslip | null>(null);
  const [viewPayslipModal, setViewPayslipModal] = useState(false);
  const [viewingPayslip, setViewingPayslip] = useState<Payslip | null>(null);
  const [activeTab, setActiveTab] = useState('payslips');
  const [taxBreakdown, setTaxBreakdown] = useState<null | {
    adjusted_gross: number;
    chargeable_income: number;
    bands: Array<{ band: string; rate: string; amount: number; tax: number }>;
  }>(null);
  const [taxBreakdownLoading, setTaxBreakdownLoading] = useState(false);
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [auditHistoryLoading, setAuditHistoryLoading] = useState(false);
  const [form] = Form.useForm();
  const [customDeductions, setCustomDeductions] = useState<CustomDeduction[]>([]);
  const [calculatedGross, setCalculatedGross] = useState<null | { gross_salary: number; net_salary: number }>(null);
  const [netToGrossLoading, setNetToGrossLoading] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterDepartment, setFilterDepartment] = useState<string | undefined>(undefined);
  const MAX_SALARY = 9999999999.99;

  const formatMoney = (value: unknown) => {
    const num = Number(value);
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      return 'K0.00';
    }
    return `K${num.toFixed(2)}`;
  };

  const canManagePayroll = canPerformAction('can_manage_payroll');
  const canViewPayroll = canPerformAction('can_view_payroll');

  const mergeUpdatedPayslipInCache = (updatedPayslip: Payslip) => {
    queryClient.setQueriesData({ queryKey: ['payslips'] }, (oldData: any) => {
      if (!oldData) {
        return oldData;
      }

      if (Array.isArray(oldData)) {
        return oldData.map((p: Payslip) => (p.id === updatedPayslip.id ? updatedPayslip : p));
      }

      if (Array.isArray(oldData.results)) {
        return {
          ...oldData,
          results: oldData.results.map((p: Payslip) => (p.id === updatedPayslip.id ? updatedPayslip : p)),
        };
      }

      return oldData;
    });
  };

  // Fetch payroll entries
  const { data: payrollEntriesData, isLoading: payrollEntriesLoading, refetch: refetchEntries } = useQuery({
    queryKey: ['payroll-entries'],
    queryFn: async () => {
      const response = await http.get('/api/v1/payroll/entries/', { params: { ordering: '-created_at', page_size: 1000 } });
      return response.data.results || response.data || [];
    },
  });

  // Filter payroll entries
  const filteredPayrollEntries = (payrollEntriesData || []).filter((entry: PayrollEntry) => {
    const matchesName = !filterName || entry.employee_name.toLowerCase().includes(filterName.toLowerCase());
    const matchesDepartment = !filterDepartment || entry.department === filterDepartment;
    return matchesName && matchesDepartment;
  });

  // Get unique departments for filter
  const departments = Array.from(new Set((payrollEntriesData || []).map((e: PayrollEntry) => e.department).filter(Boolean))) as string[];

  // Fetch payslips for selected period
  const { data: payslipsData, isLoading: payslipsLoading } = useQuery({
    queryKey: ['payslips', selectedYear, selectedMonth],
    queryFn: async () => {
      const response = await http.get('/api/v1/payroll/payslips/', {
        params: {
          period__year: selectedYear,
          period__month: selectedMonth,
          page_size: 1000,
        },
      });
      return (response.data?.results || response.data || []) as Payslip[];
    },
    enabled: canViewPayroll || canManagePayroll,
  });

  // Fetch employees for creating payslips
  const { data: employeesRaw } = useQuery({
    queryKey: ['employees', 'payroll-management'],
    queryFn: async () => {
      const response = await http.get('/api/v1/hcm/employees/', { params: { page_size: 1000 } });
      // Handle both paginated response { results: [...] } and direct array response
      const data = Array.isArray(response.data) ? response.data : (response.data?.results || []);
      return data as Employee[];
    },
  });

  const employeesData = Array.isArray(employeesRaw) ? employeesRaw : [];

  // Bulk create payslips mutation
  const bulkCreateMutation = useMutation({
    mutationFn: (data: { year: number; month: number; employee_ids?: number[] }) =>
      http.post('/api/v1/payroll/payslips/bulk_create/', data),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });

      const created = response.data?.created || 0;
      const errors = response.data?.errors || [];
      const summary = response.data?.summary || {};
      const skippedExisting = summary.skipped_existing || 0;
      const skippedNoSalary = summary.skipped_no_salary || 0;
      const targetEmployees = summary.target_employees || 0;

      if (created > 0) {
        message.success(`${created} payslips created successfully`);
      }

      if (errors.length > 0) {
        message.warning(`${errors.length} employees skipped: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '...' : ''}`);
      }

      if (created === 0 && errors.length > 0) {
        if (targetEmployees === 0) {
          message.warning('No payroll employees found for this workspace. Add employees to payroll first.');
        } else if (skippedExisting > 0 && skippedNoSalary === 0) {
          message.info('No new payslips created: all selected payroll employees already have payslips for this period.');
        } else if (skippedNoSalary > 0) {
          message.error('No payslips could be created because some selected employees have no salary data in payroll entries.');
        } else {
          message.error('No payslips could be created for the selected employees and period.');
        }
      }
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to create payslips');
    },
  });

  // Create/Update payslip mutation
  const savePayslipMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingPayslip) {
        return http.patch(`/api/v1/payroll/payslips/${editingPayslip.id}/`, data);
      } else {
        return http.post('/api/v1/payroll/payslips/', data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      message.success(editingPayslip ? 'Payslip updated' : 'Payslip created');
      setDrawerVisible(false);
      setEditingPayslip(null);
      form.resetFields();
      setCustomDeductions([]);
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to save payslip');
    },
  });

  // Recalculate payslip mutation
  const recalculateMutation = useMutation({
    mutationFn: (payslipId: number) =>
      http.post(`/api/v1/payroll/payslips/${payslipId}/recalculate/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      message.success('Payslip recalculated');
    },
  });

  // Persist auto-fetched leave/absenteeism/double-ticket into payslip
  const applyAutoDataMutation = useMutation({
    mutationFn: (payslipId: number) =>
      http.post(`/api/v1/payroll/payslips/${payslipId}/apply_auto_data/`),
    onSuccess: (response: any, payslipId: number) => {
      const updatedPayslip = response?.data as Payslip | undefined;
      if (updatedPayslip?.id) {
        mergeUpdatedPayslipInCache(updatedPayslip);
        if (viewingPayslip?.id === payslipId) {
          setViewingPayslip(updatedPayslip);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      message.success('Auto data applied and saved to payslip');
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to apply auto data');
    },
  });

  // Delete payslip mutation
  const deletePayslipMutation = useMutation({
    mutationFn: (payslipId: number) =>
      http.delete(`/api/v1/payroll/payslips/${payslipId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      message.success('Payslip deleted');
    },
  });

  // Delete payroll entry mutation
  const deletePayrollEntryMutation = useMutation({
    mutationFn: (entryId: number) =>
      http.delete(`/api/v1/payroll/entries/${entryId}/`),
    onSuccess: () => {
      refetchEntries();
      message.success('Payroll entry deleted');
    },
  });

  const handleBulkCreate = () => {
    bulkCreateMutation.mutate({ year: selectedYear, month: selectedMonth });
  };

  const handleOpenDrawer = (payslip?: Payslip) => {
    if (payslip) {
      setEditingPayslip(payslip);
      form.setFieldsValue({
        employee: payslip.employee,
        basic_salary: parseFloat(payslip.basic_salary),
        housing_allowance: parseFloat(payslip.housing_allowance),
        transportation_allowance: parseFloat(payslip.transportation_allowance),
        lunch_allowance: parseFloat(payslip.lunch_allowance),
        other_allowances: parseFloat(payslip.other_allowances),
        overtime_payment: payslip.overtime_payment ? parseFloat(payslip.overtime_payment) : 0,
        bonus: payslip.bonus ? parseFloat(payslip.bonus) : 0,
        double_ticket_payment: payslip.double_ticket_payment ? parseFloat(payslip.double_ticket_payment) : 0,
        unpaid_leave_days: parseFloat(payslip.unpaid_leave_days),
        unpaid_leave_deduction: parseFloat(payslip.unpaid_leave_deduction),
        absenteeism_days: parseFloat(payslip.absenteeism_days),
        absenteeism_deduction: parseFloat(payslip.absenteeism_deduction),
        notes: payslip.notes,
      });
      setCustomDeductions(
        payslip.custom_deductions.map((d) => ({
          description: d.description,
          amount: parseFloat(d.amount),
        }))
      );
    } else {
      form.resetFields();
      setEditingPayslip(null);
      setCustomDeductions([]);
    }
    setDrawerVisible(true);
  };

  const handleSavePayslip = async () => {
    try {
      const values = await form.validateFields();

      let periodId;
      if (editingPayslip) {
        // Use existing period when editing
        periodId = editingPayslip.period;
      } else {
        // Get or create period for new payslip
        const periodResponse = await http.post('/api/v1/payroll/periods/', {
          year: selectedYear,
          month: selectedMonth,
        });
        periodId = periodResponse.data.id || periodResponse.data[0]?.id;
      }

      const payslipData = {
        ...values,
        period: periodId,
        custom_deductions_data: customDeductions,
      };

      savePayslipMutation.mutate(payslipData);
    } catch (error: any) {
      message.error(error?.response?.data?.error || 'Form validation failed');
    }
  };

  const handleViewPayslip = async (payslip: Payslip) => {
    setViewingPayslip(payslip);
    setViewPayslipModal(true);
    loadTaxBreakdown(payslip.id);
    loadAuditHistory(payslip.id);

    try {
      const res = await http.get(`/api/v1/payroll/payslips/${payslip.id}/`);
      const latestPayslip = (res?.data || payslip) as Payslip;
      setViewingPayslip(latestPayslip);
      if (latestPayslip?.id) {
        mergeUpdatedPayslipInCache(latestPayslip);
      }
    } catch {
      // keep modal open with current row data if refresh fails
    }
  };

  const loadTaxBreakdown = async (payslipId: number) => {
    try {
      setTaxBreakdownLoading(true);
      const res = await http.get(`/api/v1/payroll/payslips/${payslipId}/tax_breakdown/`);
      setTaxBreakdown(res.data);
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Failed to load PAYE breakdown');
      setTaxBreakdown(null);
    } finally {
      setTaxBreakdownLoading(false);
    }
  };

  const loadAuditHistory = async (payslipId: number) => {
    try {
      setAuditHistoryLoading(true);
      const res = await http.get(`/api/v1/payroll/payslips/${payslipId}/audit_history/`);
      setAuditHistory(res.data);
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Failed to load audit history');
      setAuditHistory([]);
    } finally {
      setAuditHistoryLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const { data } = await http.get(
        `/api/v1/payroll/payslips/export/?year=${selectedYear}&month=${selectedMonth}`
      );
      const csvData = convertToCSV(data);
      downloadCSV(csvData, `Payroll_${selectedYear}_${selectedMonth}.csv`);
      message.success('Payroll exported');
    } catch (error) {
      message.error('Failed to export payroll');
    }
  };

  const handleBankTransferExport = async () => {
    try {
      const response = await http.get(
        `/api/v1/payroll/payslips/bank_transfer_export/?year=${selectedYear}&month=${selectedMonth}`,
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `BankTransfer_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success('Bank transfer file downloaded');
    } catch (error) {
      message.error('Failed to export bank transfer file');
    }
  };

  const handleCalculateFromNet = async (netValue: number) => {
    if (!netValue || netValue <= 0) {
      message.error('Please enter a valid net salary');
      return;
    }

    try {
      setNetToGrossLoading(true);
      const response = await http.post('/api/v1/payroll/payslips/calculate_from_net/', {
        net_salary: netValue,
      });

      if (response.data && response.data.gross_salary) {
        setCalculatedGross(response.data);
        // Update all salary fields with the breakdown
        form.setFieldsValue({
          gross_salary: response.data.gross_salary,
          basic_salary: response.data.basic_salary,
          housing_allowance: response.data.housing_allowance,
          transportation_allowance: response.data.transportation_allowance,
          lunch_allowance: response.data.lunch_allowance,
        });
        message.success(`✓ Salary breakdown calculated - Gross: K${parseFloat(response.data.gross_salary).toFixed(2)}`);
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Failed to calculate gross from net');
    } finally {
      setNetToGrossLoading(false);
    }
  };

  const loadAutoDataForEmployee = async (employeeId: number) => {
    if (!employeeId) {
      message.warning('Please select an employee first');
      return;
    }
    try {
      const response = await http.post('/api/v1/payroll/payslips/preview_auto_data/', {
        employee_id: employeeId,
        year: selectedYear,
        month: selectedMonth,
      });

      if (response.data) {
        form.setFieldsValue({
          unpaid_leave_days: response.data.unpaid_leave_days || 0,
          unpaid_leave_deduction: response.data.unpaid_leave_deduction || 0,
          absenteeism_days: response.data.absenteeism_days || 0,
          absenteeism_deduction: response.data.absenteeism_deduction || 0,
          double_ticket_payment: response.data.double_ticket_payment || 0,
        });

        const debug = response.data.debug_info;
        let msg = `Auto-loaded: ${response.data.unpaid_leave_days} unpaid leave days (K${response.data.unpaid_leave_deduction}), ${response.data.absenteeism_days} absenteeism days (K${response.data.absenteeism_deduction}), K${response.data.double_ticket_payment} double ticket`;

        if (debug) {
          console.log('Leave Management Debug Info:', debug);
          const totalLeaves = debug.all_leaves_in_period?.length || 0;
          const totalAbsent = debug.all_absenteeism_in_period?.length || 0;
          const totalTickets = debug.all_double_tickets_in_period?.length || 0;

          msg += `\n\nFound in period: ${totalLeaves} leave requests, ${totalAbsent} absenteeism reports, ${totalTickets} double tickets (check console for details)`;
        }

        message.success(msg, 6);
      }
    } catch (error: any) {
      console.error('Load auto-data error:', error);
      message.error('Failed to fetch auto-data: ' + (error.response?.data?.error || 'Unknown error'));
    }
  };

  const convertToCSV = (data: Payslip[]) => {
    const headers = [
      'Employee ID',
      'Employee Name',
      'Basic Salary',
      'Gross Salary',
      'NAPSA',
      'PAYE',
      'NHIMA',
      'Total Deductions',
      'Net Salary',
    ];

    const rows = data.map((p) => [
      p.employee_id,
      p.employee_name,
      p.basic_salary,
      p.gross_salary,
      p.napsa_employee,
      p.paye_tax,
      p.nhima_employee,
      p.total_deductions,
      p.net_salary,
    ]);

    return [headers, ...rows].map((row) => row.join(',')).join('\n');
  };

  const downloadCSV = (csvData: string, filename: string) => {
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: 'Actions',
      key: 'actions',
      width: 190,
      fixed: 'left' as const,
      render: (_: any, record: Payslip) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewPayslip(record)}
          />
          {canManagePayroll && (
            <>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleOpenDrawer(record)}
              />
              <Button
                type="text"
                size="small"
                icon={<CalculatorOutlined />}
                onClick={() => recalculateMutation.mutate(record.id)}
                loading={recalculateMutation.isPending}
              />
              <Button
                type="text"
                size="small"
                title="Apply auto leave/absenteeism/double-ticket"
                onClick={() => applyAutoDataMutation.mutate(record.id)}
                loading={applyAutoDataMutation.isPending}
              >
                Auto
              </Button>
              <Popconfirm
                title="Delete payslip?"
                onConfirm={() => deletePayslipMutation.mutate(record.id)}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
    {
      title: 'Employee ID',
      dataIndex: 'employee_id',
      key: 'employee_id',
      width: 140,
      fixed: 'left' as const,
    },
    {
      title: 'Employee Name',
      dataIndex: 'employee_name',
      key: 'employee_name',
      width: 200,
    },
    {
      title: 'Department',
      dataIndex: 'department',
      key: 'department',
      width: 150,
    },
    {
      title: 'Gross Salary',
      dataIndex: 'gross_salary',
      key: 'gross_salary',
      width: 130,
      render: (val: string) => `K${parseFloat(val).toFixed(2)}`,
    },
    {
      title: 'NAPSA',
      dataIndex: 'napsa_employee',
      key: 'napsa_employee',
      width: 110,
      render: (val: string) => `K${parseFloat(val).toFixed(2)}`,
    },
    {
      title: 'PAYE',
      dataIndex: 'paye_tax',
      key: 'paye_tax',
      width: 110,
      render: (val: string) => `K${parseFloat(val).toFixed(2)}`,
    },
    {
      title: 'NHIMA',
      dataIndex: 'nhima_employee',
      key: 'nhima_employee',
      width: 110,
      render: (val: string) => `K${parseFloat(val).toFixed(2)}`,
    },
    {
      title: 'Other Deductions',
      key: 'other_deductions',
      width: 140,
      render: (_: any, record: Payslip) => {
        const unpaidLeave = parseFloat(record.unpaid_leave_deduction || '0');
        const absenteeism = parseFloat(record.absenteeism_deduction || '0');
        const custom = parseFloat(record.total_custom_deductions || '0');
        const total = unpaidLeave + absenteeism + custom;

        return total > 0 ? (
          <Text style={{ color: '#ff4d4f' }}>K{total.toFixed(2)}</Text>
        ) : (
          <Text type="secondary">-</Text>
        );
      },
    },
    {
      title: 'NET PAY',
      dataIndex: 'net_salary',
      key: 'net_salary',
      width: 140,
      render: (val: string) => (
        <Text strong style={{ color: '#52c41a', fontSize: '15px' }}>
          K{parseFloat(val).toFixed(2)}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_processed',
      key: 'is_processed',
      width: 100,
      render: (val: boolean) => (
        <Tag color={val ? 'green' : 'orange'}>{val ? 'Processed' : 'Draft'}</Tag>
      ),
    },
  ];

  const payslipsList = (Array.isArray(payslipsData) ? payslipsData : []).filter((payslip: Payslip) => {
    const matchesName = !filterName || payslip.employee_name.toLowerCase().includes(filterName.toLowerCase());
    const matchesDepartment = !filterDepartment || payslip.department === filterDepartment;
    return matchesName && matchesDepartment;
  });

  // Calculate totals
  const totals = payslipsList.reduce(
    (acc, p) => ({
      gross: acc.gross + parseFloat(p.gross_salary),
      net: acc.net + parseFloat(p.net_salary),
      napsa: acc.napsa + parseFloat(p.napsa_employee),
      paye: acc.paye + parseFloat(p.paye_tax),
      nhima: acc.nhima + parseFloat(p.nhima_employee),
    }),
    { gross: 0, net: 0, napsa: 0, paye: 0, nhima: 0 }
  );

  if (!canViewPayroll && !canManagePayroll) {
    return (
      <Card>
        <Text>You don't have permission to view payroll</Text>
      </Card>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
          <Col>
            <Title level={3}>Payroll Management</Title>
          </Col>
        </Row>

        {/* Filters */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Input
              placeholder="Filter by employee name..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              allowClear
            />
          </Col>
          <Col span={8}>
            <Select
              placeholder="Filter by department"
              value={filterDepartment}
              onChange={setFilterDepartment}
              allowClear
              style={{ width: '100%' }}
            >
              {departments.map((dept: string) => (
                <Select.Option key={dept} value={dept}>
                  {dept}
                </Select.Option>
              ))}
            </Select>
          </Col>
          <Col span={8}>
            <Space>
              <Button type="primary" onClick={() => { }}>
                Filter
              </Button>
              <Button onClick={() => { setFilterName(''); setFilterDepartment(undefined); }}>
                Reset
              </Button>
            </Space>
          </Col>
        </Row>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'entries',
              label: 'Setup: Employees',
              children: (
                <>
                  <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Col>
                      <Text>Manage employee payroll profiles and salary components</Text>
                    </Col>
                    {canManagePayroll && (
                      <Col>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setEditingPayrollEntry(null);
                            setPayrollEntryFormVisible(true);
                          }}
                        >
                          Add Employee to Payroll
                        </Button>
                      </Col>
                    )}
                  </Row>

                  <Spin spinning={payrollEntriesLoading}>
                    <MobileTable
                      columns={[
                        {
                          title: 'Actions',
                          key: 'actions',
                          width: 90,
                          fixed: 'left' as const,
                          render: (_: any, record: PayrollEntry) => (
                            <Space>
                              {canManagePayroll && (
                                <>
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => {
                                      setEditingPayrollEntry(record);
                                      setPayrollEntryFormVisible(true);
                                    }}
                                  />
                                  <Popconfirm
                                    title="Delete this payroll entry?"
                                    onConfirm={() => deletePayrollEntryMutation.mutate(record.id)}
                                  >
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<DeleteOutlined />}
                                      danger
                                    />
                                  </Popconfirm>
                                </>
                              )}
                            </Space>
                          ),
                        },
                        {
                          title: 'Employee ID',
                          dataIndex: 'employee_id',
                          key: 'employee_id',
                          width: 120,
                          fixed: 'left' as const,
                        },
                        {
                          title: 'Employee Name',
                          dataIndex: 'employee_name',
                          key: 'employee_name',
                          width: 150,
                        },
                        {
                          title: 'Department',
                          dataIndex: 'department',
                          key: 'department',
                          width: 130,
                        },
                        {
                          title: 'Basic',
                          dataIndex: 'basic',
                          key: 'basic',
                          render: (val: number) => formatMoney(val),
                          width: 100,
                        },
                        {
                          title: 'Housing',
                          dataIndex: 'housing',
                          key: 'housing',
                          render: (val: number) => formatMoney(val),
                          width: 100,
                        },
                        {
                          title: 'Transport',
                          dataIndex: 'transportation',
                          key: 'transportation',
                          render: (val: number) => formatMoney(val),
                          width: 100,
                        },
                        {
                          title: 'Lunch',
                          dataIndex: 'lunch',
                          key: 'lunch',
                          render: (val: number) => formatMoney(val),
                          width: 100,
                        },
                        {
                          title: 'Gross',
                          dataIndex: 'gross',
                          key: 'gross',
                          render: (val: number) => (
                            <Text strong style={{ color: '#1890ff' }}>
                              {formatMoney(val)}
                            </Text>
                          ),
                          width: 110,
                        },
                        {
                          title: 'NAPSA',
                          dataIndex: 'napsa_employee',
                          key: 'napsa_employee',
                          render: (val: number) => formatMoney(val),
                          width: 110,
                        },
                        {
                          title: 'NHIMA',
                          dataIndex: 'nhima_employee',
                          key: 'nhima_employee',
                          render: (val: number) => formatMoney(val),
                          width: 110,
                        },
                        {
                          title: 'PAYE',
                          dataIndex: 'paye_tax',
                          key: 'paye_tax',
                          render: (val: number) => formatMoney(val),
                          width: 110,
                        },
                      ]}
                      dataSource={filteredPayrollEntries}
                      rowKey="id"
                      pagination={{ pageSize: 15 }}
                      scroll={{ x: 'max-content' }}
                    />
                  </Spin>
                </>
              ),
            },
            {
              key: 'payslips',
              label: 'Payslips',
              children: (
                <>
                  <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                    <Col>
                      <Space>
                        <Select
                          value={selectedMonth}
                          onChange={setSelectedMonth}
                          style={{ width: 130 }}
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
                        <Button
                          icon={<ExportOutlined />}
                          onClick={handleExport}
                        >
                          Export
                        </Button>
                        <Button
                          icon={<ExportOutlined />}
                          onClick={handleBankTransferExport}
                          style={{ background: '#1a4e8a', color: '#fff', border: 'none' }}
                        >
                          Bank Transfer
                        </Button>
                      </Space>
                    </Col>
                    <Col>
                      {canManagePayroll && (
                        <>
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => handleOpenDrawer()}
                            style={{ marginRight: 8 }}
                          >
                            Add Payslip
                          </Button>
                          <Button
                            type="dashed"
                            onClick={handleBulkCreate}
                            loading={bulkCreateMutation.isPending}
                          >
                            Generate All Payslips
                          </Button>
                        </>
                      )}
                    </Col>
                  </Row>

                  {/* Summary Statistics */}
                  {payslipsList.length > 0 && totals && (
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Total Employees"
                            value={payslipsList.length}
                            styles={{ content: { color: '#1890ff' } }}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Total Gross"
                            value={totals.gross}
                            prefix="K"
                            precision={2}
                            styles={{ content: { color: '#722ed1' } }}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Total Deductions"
                            value={totals.napsa + totals.paye + totals.nhima}
                            prefix="K"
                            precision={2}
                            styles={{ content: { color: '#fa8c16' } }}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title="Total Net Pay"
                            value={totals.net}
                            prefix="K"
                            precision={2}
                            styles={{ content: { color: '#52c41a' } }}
                          />
                        </Card>
                      </Col>
                    </Row>
                  )}

                  <Spin spinning={payslipsLoading}>
                    <MobileTable
                      columns={columns}
                      dataSource={payslipsList}
                      rowKey="id"
                      pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: ['20', '50', '100'],
                        showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} payslips`,
                      }}
                      scroll={{ x: 'max-content' }}
                    />
                  </Spin>
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* PayrollEntry Form Modal */}
      <PayrollEntryForm
        visible={payrollEntryFormVisible}
        entry={editingPayrollEntry || undefined}
        onClose={() => {
          setPayrollEntryFormVisible(false);
          setEditingPayrollEntry(null);
        }}
        onSuccess={() => {
          refetchEntries();
          setPayrollEntryFormVisible(false);
          setEditingPayrollEntry(null);
        }}
      />

      {/* Payslip Form Drawer */}
      <Drawer
        title={editingPayslip ? 'Edit Payslip' : 'Create Payslip'}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setEditingPayslip(null);
          form.resetFields();
        }}
        size="large"
        extra={
          <Button
            type="primary"
            onClick={handleSavePayslip}
            loading={savePayslipMutation.isPending}
          >
            {editingPayslip ? 'Update' : 'Create'}
          </Button>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(_changed, all) => {
            const gross =
              Number(all.basic_salary || 0) +
              Number(all.housing_allowance || 0) +
              Number(all.transportation_allowance || 0) +
              Number(all.lunch_allowance || 0) +
              Number(all.other_allowances || 0) +
              Number(all.overtime_payment || 0) +
              Number(all.bonus || 0) +
              Number(all.double_ticket_payment || 0);
            form.setFieldsValue({ gross_salary: parseFloat(gross.toFixed(2)) });
          }}
        >
          {!editingPayslip && (
            <Form.Item
              label="Employee"
              name="employee"
              rules={[{ required: true, message: 'Please select an employee' }]}
            >
              <Select
                showSearch
                placeholder="Select employee"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={employeesData?.map((e) => ({
                  label: `${e.full_name} (${e.employee_id})`,
                  value: e.id,
                }))}
              />
            </Form.Item>
          )}

          <Divider>Salary Components</Divider>

          {/* Net to Gross Calculator */}
          <Card
            title="Quick Calculate: Gross from Net"
            size="small"
            style={{
              marginBottom: 24,
              backgroundColor: '#f0f5ff',
              borderLeft: '4px solid #1890ff'
            }}
          >
            <Space orientation="vertical" style={{ width: '100%' }}>
              <Text style={{ color: '#595959', fontWeight: 500 }}>Enter your desired net salary and we'll calculate the required gross salary:</Text>
              <Row gutter={12} align="middle">
                <Col span={12}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, color: '#000' }}>Target Net Salary (K)</span>}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber
                      id="calc-net"
                      placeholder="0.00"
                      precision={2}
                      min={0}
                      max={MAX_SALARY}
                      size="large"
                      style={{ width: '100%' }}
                      onChange={() => {
                        if (calculatedGross) setCalculatedGross(null);
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={netToGrossLoading}
                    onClick={() => {
                      const netInput = (document.getElementById('calc-net') as any)?.value;
                      const netValue = parseFloat(netInput);
                      handleCalculateFromNet(netValue);
                    }}
                    style={{ marginTop: 24 }}
                  >
                    Calculate Gross
                  </Button>
                </Col>
              </Row>
              {calculatedGross && (
                <Alert
                  message="Success!"
                  description={`Gross Salary: K${Number(calculatedGross.gross_salary).toFixed(2)} → Basic Salary field updated`}
                  type="success"
                  showIcon
                  style={{ marginTop: 8 }}
                />
              )}
            </Space>
          </Card>

          <Form.Item label="Gross Salary" name="gross_salary">
            <InputNumber
              style={{ width: '100%', backgroundColor: '#f0f0f0' }}
              prefix="K"
              precision={2}
              disabled
              readOnly
              max={MAX_SALARY}
            />
          </Form.Item>

          <Form.Item label="Basic Salary" name="basic_salary" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Housing Allowance" name="housing_allowance">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Transportation Allowance" name="transportation_allowance">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Lunch Allowance" name="lunch_allowance">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Other Allowances" name="other_allowances">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Overtime Payment" name="overtime_payment">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Bonus" name="bonus">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item
            label="Double Ticket Payment (Sunday/Holiday Work)"
            name="double_ticket_payment"
            tooltip="Auto-fetched from approved double ticket requests"
          >
            <InputNumber
              style={{ width: '100%' }}
              prefix="K"
              precision={2}
              min={0}
              max={MAX_SALARY}
              placeholder="Auto-calculated from double ticket requests"
            />
          </Form.Item>

          <Divider>Deductions</Divider>
          <Alert
            message="Auto-Calculated Deductions"
            description={
              <div>
                <p><strong>The following data is automatically fetched from Leave Management:</strong></p>
                <ul style={{ marginLeft: 20, marginBottom: 0 }}>
                  <li><strong>Unpaid Leave Days:</strong> Only APPROVED + UNPAID leave requests (sick/annual leave does NOT deduct)</li>
                  <li><strong>Absenteeism Days:</strong> Only UNJUSTIFIED absenteeism reports</li>
                  <li><strong>Double Ticket Payment:</strong> Only APPROVED double ticket requests</li>
                </ul>
                <p style={{ marginTop: 8, marginBottom: 0 }}><em>Use the "Auto" button in the payslip Actions to load this data.</em></p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form.Item label="Unpaid Leave Days" name="unpaid_leave_days" tooltip="Auto-fetched from approved unpaid leave requests">
            <InputNumber style={{ width: '100%' }} precision={1} min={0} placeholder="Auto-calculated from leave records" />
          </Form.Item>
          <Form.Item label="Unpaid Leave Deduction (Optional)" name="unpaid_leave_deduction">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>
          <Form.Item label="Absenteeism Days" name="absenteeism_days" tooltip="Auto-fetched from unjustified absenteeism reports">
            <InputNumber style={{ width: '100%' }} precision={1} min={0} placeholder="Auto-calculated from absenteeism records" />
          </Form.Item>
          <Form.Item label="Absenteeism Deduction" name="absenteeism_deduction">
            <InputNumber style={{ width: '100%' }} prefix="K" precision={2} min={0} max={MAX_SALARY} />
          </Form.Item>

          <Divider>Custom Deductions</Divider>
          {customDeductions.map((deduction, index) => (
            <Row key={index} gutter={8} align="middle">
              <Col span={12}>
                <Input
                  placeholder="Description"
                  value={deduction.description}
                  onChange={(e) => {
                    const newDeductions = [...customDeductions];
                    newDeductions[index].description = e.target.value;
                    setCustomDeductions(newDeductions);
                  }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  style={{ width: '100%' }}
                  prefix="K"
                  precision={2}
                  value={deduction.amount}
                  max={MAX_SALARY}
                  onChange={(val) => {
                    const newDeductions = [...customDeductions];
                    newDeductions[index].amount = val || 0;
                    setCustomDeductions(newDeductions);
                  }}
                />
              </Col>
              <Col span={4}>
                <Button
                  danger
                  size="small"
                  onClick={() => {
                    setCustomDeductions(customDeductions.filter((_, i) => i !== index));
                  }}
                >
                  Remove
                </Button>
              </Col>
            </Row>
          ))}
          <Button
            type="dashed"
            block
            onClick={() => setCustomDeductions([...customDeductions, { description: '', amount: 0 }])}
            style={{ marginTop: 8 }}
          >
            Add Custom Deduction
          </Button>

          <Divider>Notes</Divider>
          <Form.Item label="Notes" name="notes">
            <TextArea rows={3} placeholder="Additional notes or comments" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* View Payslip Modal */}
      <Modal
        title={`Payslip - ${viewingPayslip?.employee_name}`}
        open={viewPayslipModal}
        onCancel={() => setViewPayslipModal(false)}
        footer={[
          <Button
            key="pdf"
            type="primary"
            icon={<FileTextOutlined />}
            onClick={async () => {
              if (viewingPayslip) {
                try {
                  const response = await http.get(
                    `/api/v1/payroll/payslips/${viewingPayslip.id}/download_pdf/`,
                    { responseType: 'blob' }
                  );
                  const blob = new Blob([response.data], { type: 'application/pdf' });
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `Payslip_${viewingPayslip.employee_name}_${viewingPayslip.period_display}.pdf`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  message.success('PDF downloaded successfully');
                } catch (error) {
                  message.error('Failed to download PDF');
                }
              }
            }}
          >
            Download PDF
          </Button>,
          <Button key="close" onClick={() => setViewPayslipModal(false)}>
            Close
          </Button>,
        ]}
        width={700}
      >
        {viewingPayslip && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                key: '1',
                label: 'Payslip Details',
                children: (
                  <div style={{ padding: '16px' }}>
                    <Row justify="space-between" style={{ marginBottom: 16 }}>
                      <Col>
                        <Text strong>Employee ID:</Text> {viewingPayslip.employee_id}
                        <br />
                        <Text strong>Name:</Text> {viewingPayslip.employee_name}
                        <br />
                        <Text strong>Department:</Text> {viewingPayslip.department || 'N/A'}
                      </Col>
                      <Col>
                        <Text strong>Period:</Text> {viewingPayslip.period_display}
                      </Col>
                    </Row>

                    <Divider />

                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Card size="small" title="Earnings">
                          <Space orientation="vertical" style={{ width: '100%' }}>
                            <Row justify="space-between">
                              <Text>Basic Salary:</Text>
                              <Text>K{parseFloat(viewingPayslip.basic_salary).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Housing:</Text>
                              <Text>K{parseFloat(viewingPayslip.housing_allowance).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Transportation:</Text>
                              <Text>K{parseFloat(viewingPayslip.transportation_allowance).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Lunch:</Text>
                              <Text>K{parseFloat(viewingPayslip.lunch_allowance).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Other Allowances:</Text>
                              <Text>K{parseFloat(viewingPayslip.other_allowances || '0').toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Overtime Pay:</Text>
                              <Text style={{ color: '#52c41a' }}>K{parseFloat(viewingPayslip.overtime_payment || '0').toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Bonus:</Text>
                              <Text style={{ color: '#52c41a' }}>K{parseFloat(viewingPayslip.bonus || '0').toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>Double Ticket (Sunday/Holiday):</Text>
                              <Text style={{ color: '#52c41a' }}>K{parseFloat(viewingPayslip.double_ticket_payment || '0').toFixed(2)}</Text>
                            </Row>
                            <Divider style={{ margin: '8px 0' }} />
                            <Row justify="space-between">
                              <Text strong>Gross Salary:</Text>
                              <Text strong>K{parseFloat(viewingPayslip.gross_salary).toFixed(2)}</Text>
                            </Row>
                          </Space>
                        </Card>
                      </Col>

                      <Col span={12}>
                        <Card size="small" title="Deductions">
                          <Space orientation="vertical" style={{ width: '100%' }}>
                            <Row justify="space-between">
                              <Text>NAPSA (5%):</Text>
                              <Text>K{parseFloat(viewingPayslip.napsa_employee).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>PAYE Tax:</Text>
                              <Text>K{parseFloat(viewingPayslip.paye_tax).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text>NHIMA (1%):</Text>
                              <Text>K{parseFloat(viewingPayslip.nhima_employee).toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text style={{ color: '#ff4d4f' }}>Unpaid Leave ({viewingPayslip.unpaid_leave_days || '0'} days):</Text>
                              <Text style={{ color: '#ff4d4f' }}>K{parseFloat(viewingPayslip.unpaid_leave_deduction || '0').toFixed(2)}</Text>
                            </Row>
                            <Row justify="space-between">
                              <Text style={{ color: '#ff4d4f' }}>Absenteeism ({viewingPayslip.absenteeism_days || '0'} days):</Text>
                              <Text style={{ color: '#ff4d4f' }}>K{parseFloat(viewingPayslip.absenteeism_deduction || '0').toFixed(2)}</Text>
                            </Row>
                            {viewingPayslip.custom_deductions.map((cd) => (
                              <Row key={cd.id} justify="space-between">
                                <Text>{cd.description}:</Text>
                                <Text>K{parseFloat(cd.amount).toFixed(2)}</Text>
                              </Row>
                            ))}
                            <Divider style={{ margin: '8px 0' }} />
                            <Row justify="space-between">
                              <Text strong>Total Deductions:</Text>
                              <Text strong style={{ color: '#ff4d4f' }}>K{parseFloat(viewingPayslip.total_deductions).toFixed(2)}</Text>
                            </Row>
                          </Space>
                        </Card>
                      </Col>
                    </Row>

                    <Divider />
                    <Card size="small" style={{ backgroundColor: '#f0f9ff', border: '2px solid #1890ff' }}>
                      <Row justify="space-between">
                        <Text strong style={{ fontSize: 20, color: '#000' }}>
                          NET PAY:
                        </Text>
                        <Text strong style={{ fontSize: 20, color: '#52c41a' }}>
                          K{parseFloat(viewingPayslip.net_salary).toFixed(2)}
                        </Text>
                      </Row>
                    </Card>

                    <Divider />

                    <Card size="small" title="PAYE Band Breakdown" loading={taxBreakdownLoading}>
                      {taxBreakdown && taxBreakdown.bands && taxBreakdown.bands.length > 0 ? (
                        <MobileTable
                          size="small"
                          pagination={false}
                          dataSource={taxBreakdown.bands.map((b, idx) => ({ key: idx, ...b }))}
                          columns={[
                            { title: 'Band Range', dataIndex: 'band', key: 'band' },
                            { title: 'Rate', dataIndex: 'rate', key: 'rate' },
                            { title: 'Amount in Band', dataIndex: 'amount', key: 'amount', render: (val: number) => `K${val.toFixed(2)}` },
                            { title: 'Tax', dataIndex: 'tax', key: 'tax', render: (val: number) => `K${val.toFixed(2)}` },
                          ]}
                        />
                      ) : (
                        <Text type="secondary">No PAYE breakdown available.</Text>
                      )}
                    </Card>

                    {viewingPayslip.notes && (
                      <>
                        <Divider />
                        <Text strong>Notes:</Text>
                        <div style={{ marginTop: 8, padding: 8, backgroundColor: '#fafafa', borderRadius: 4 }}>
                          {viewingPayslip.notes}
                        </div>
                      </>
                    )}
                  </div>
                ),
              },
              {
                key: '2',
                label: 'Audit History',
                children: (
                  <Spin spinning={auditHistoryLoading}>
                    {auditHistory && auditHistory.length > 0 ? (
                      <Timeline
                        items={auditHistory.map((log) => ({
                          children: (
                            <div>
                              <div style={{ marginBottom: 4 }}>
                                <Tag color={
                                  log.action === 'CREATED' ? 'green' :
                                    log.action === 'UPDATED' ? 'blue' :
                                      log.action === 'CALCULATED' ? 'purple' :
                                        'red'
                                }>
                                  {log.action_display}
                                </Tag>
                                <Text strong>{log.user_name || 'System'}</Text>
                              </div>
                              <Text type="secondary" style={{ fontSize: '12px' }}>
                                {new Date(log.timestamp).toLocaleString()}
                              </Text>
                              {log.changes && Object.keys(log.changes).length > 0 && (
                                <div style={{ marginTop: 8, fontSize: '12px' }}>
                                  <pre style={{
                                    backgroundColor: '#f5f5f5',
                                    padding: 8,
                                    borderRadius: 4,
                                    maxWidth: '100%',
                                    overflow: 'auto'
                                  }}>
                                    {JSON.stringify(log.changes, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ),
                        }))}
                      />
                    ) : (
                      <Text type="secondary">No audit history available.</Text>
                    )}
                  </Spin>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
};

export default PayrollManagement;
