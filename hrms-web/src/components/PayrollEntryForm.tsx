import { Modal, Form, Input, Select, InputNumber, message, Divider, Card, Row, Col, Button, Space, Alert } from 'antd';
import { useState, useEffect, useRef } from 'react';
import http from '../lib/http';
import { useQuery } from '@tanstack/react-query';

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
}

interface PayrollEntryFormProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entry?: PayrollEntry;
}

export default function PayrollEntryForm({ visible, onClose, onSuccess, entry }: PayrollEntryFormProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [netCalcLoading, setNetCalcLoading] = useState(false);
  const [netCalcResult, setNetCalcResult] = useState<any>(null);
  const [liveGross, setLiveGross] = useState(0);
  const [liveNet, setLiveNet] = useState(0);
  const MAX_SALARY = 9999999999999.99;

  // Salary split ratios — updated from net-calc API result; defaults match backend
  const ratiosRef = useRef({ basic: 0.45, housing: 0.25, transport: 0.15, lunch: 0.15 });
  // Flag: prevents cascaded onValuesChange when we programmatically setFieldsValue
  const autoCalcRef = useRef(false);

  // Fetch all employees
  const { data: employeesRaw } = useQuery({
    queryKey: ['employees', 'payroll-entry-form'],
    queryFn: () =>
      http.get('/api/v1/hcm/employees/', { params: { page_size: 1000 } }).then((res) =>
        res.data.results || res.data || []
      ),
    enabled: visible,
  });

  const employeesData = Array.isArray(employeesRaw) ? employeesRaw : [];

  // Handle employee selection change
  const handleEmployeeChange = (employeeId: number) => {
    const selectedEmployee = employeesData.find((emp: any) => emp.id === employeeId);
    if (selectedEmployee) {
      form.setFieldsValue({
        department: selectedEmployee.department_name || '',
        date_of_hire: selectedEmployee.hire_date || '',
        resident: selectedEmployee.residential_area || '',
      });
    }
  };

  // Helper: apply net-calc result to form fields, store ratios, update live summary
  const applyNetCalcResult = (data: any, enteredNet?: number) => {
    const g = Number(data.gross_salary);
    if (g > 0) {
      ratiosRef.current = {
        basic:     Number(data.basic_salary)              / g,
        housing:   Number(data.housing_allowance)         / g,
        transport: Number(data.transportation_allowance)  / g,
        lunch:     Number(data.lunch_allowance)           / g,
      };
    }
    autoCalcRef.current = true;
    form.setFieldsValue({
      basic:          data.basic_salary,
      housing:        data.housing_allowance,
      transportation: data.transportation_allowance,
      lunch:          data.lunch_allowance,
    });
    setTimeout(() => { autoCalcRef.current = false; }, 0);
    setLiveGross(g);
    setLiveNet(enteredNet ?? g * 0.7);
  };

  // Direct onChange for basic salary — updates allowances proportionally and refreshes summary
  const handleBasicChange = (val: number | null) => {
    if (autoCalcRef.current) return;
    const basic = Number(val || 0);
    const r = ratiosRef.current;
    if (basic > 0 && r.basic > 0) {
      const newGross = basic / r.basic;
      const newHousing = parseFloat((newGross * r.housing).toFixed(2));
      const newTransport = parseFloat((newGross * r.transport).toFixed(2));
      const newLunch = parseFloat((newGross * r.lunch).toFixed(2));
      autoCalcRef.current = true;
      // Clear net input — user is now in component mode
      form.setFieldsValue({ housing: newHousing, transportation: newTransport, lunch: newLunch, net: null });
      setTimeout(() => { autoCalcRef.current = false; }, 0);
      setLiveGross(newGross);
      setLiveNet(newGross * 0.7);
      setNetCalcResult(null);
    } else {
      const h = Number(form.getFieldValue('housing') || 0);
      const t = Number(form.getFieldValue('transportation') || 0);
      const l = Number(form.getFieldValue('lunch') || 0);
      const g = basic + h + t + l;
      setLiveGross(g);
      setLiveNet(g * 0.7);
    }
  };

  // Direct onChange for housing / transportation / lunch — recomputes gross sum
  const handleComponentChange = () => {
    if (autoCalcRef.current) return;
    const basic = Number(form.getFieldValue('basic') || 0);
    const housing = Number(form.getFieldValue('housing') || 0);
    const transportation = Number(form.getFieldValue('transportation') || 0);
    const lunch = Number(form.getFieldValue('lunch') || 0);
    const g = basic + housing + transportation + lunch;
    setLiveGross(g);
    if (!form.getFieldValue('net')) setLiveNet(g * 0.7);
  };

  // onValuesChange — only used for net salary API trigger now
  const handleNetChange = async (changedValues: any, allValues: any) => {
    if (autoCalcRef.current) return;
    if ('net' in changedValues && Number(allValues.net) > 0) {
      try {
        setNetCalcLoading(true);
        const response = await http.post('/api/v1/payroll/payslips/calculate_from_net/', {
          net_salary: allValues.net,
        });
        const data = response.data;
        setNetCalcResult(data);
        applyNetCalcResult(data, Number(allValues.net));
      } catch (e: any) {
        console.warn('Could not auto-calculate from net:', e.message);
      } finally {
        setNetCalcLoading(false);
      }
    }
  };

  useEffect(() => {
    if (entry) {
      form.setFieldsValue({
        employee: entry.employee,
        date_of_hire: entry.date_of_hire,
        department: entry.department,
        resident: entry.resident,
        currency: entry.currency,
        basic: entry.basic,
        housing: entry.housing,
        transportation: entry.transportation,
        lunch: entry.lunch,
        net: entry.net,
      });
      const g = Number(entry.basic || 0) + Number(entry.housing || 0) +
                Number(entry.transportation || 0) + Number(entry.lunch || 0);
      setLiveGross(g);
      setLiveNet(entry.net || g * 0.7);
    } else {
      form.resetFields();
      form.setFieldsValue({ currency: 'ZMW' });
      setLiveGross(0);
      setLiveNet(0);
    }
  }, [entry, visible, form]);

  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);

      const netValue = Number(values.net || 0);
      const basicValue = Number(values.basic || 0);
      const housingValue = Number(values.housing || 0);
      const transportationValue = Number(values.transportation || 0);
      const lunchValue = Number(values.lunch || 0);

      const hasComponents = basicValue > 0 || housingValue > 0 || transportationValue > 0 || lunchValue > 0;
      const hasNet = netValue > 0;

      if (!hasNet && !hasComponents) {
        message.error('Please enter Net Salary or salary components before saving');
        setLoading(false);
        return;
      }

      // Always include all salary fields
      const payload: any = {
        employee: values.employee,
        date_of_hire: values.date_of_hire,
        department: values.department,
        resident: values.resident,
        currency: values.currency || 'ZMW',
        basic: basicValue,
        housing: housingValue,
        transportation: transportationValue,
        lunch: lunchValue,
      };

      // Only add net if provided
      if (hasNet) {
        payload.net = netValue;
      }

      console.log('Sending payload:', payload);

      if (entry) {
        await http.patch(`/api/v1/payroll/entries/${entry.id}/`, payload);
        message.success('Payroll entry updated');
      } else {
        await http.post('/api/v1/payroll/entries/', payload);
        message.success('Employee added to payroll');
      }

      onSuccess();
      onClose();
      form.resetFields();
    } catch (e: any) {
      console.error('Full Error:', e);
      console.error('Error response:', e.response?.data);
      console.error('Error status:', e.response?.status);

      let errorMsg = 'Failed to save payroll entry';

      if (e.response?.data) {
        if (typeof e.response.data === 'string') {
          errorMsg = e.response.data;
        } else if (e.response.data.detail) {
          errorMsg = e.response.data.detail;
        } else if (typeof e.response.data === 'object') {
          // Format validation errors nicely
          const errors = Object.entries(e.response.data)
            .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
            .join('\n');
          errorMsg = errors || JSON.stringify(e.response.data);
        }
      }

      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateFromNet = async () => {
    const netSalary = form.getFieldValue('net');
    if (!netSalary || Number(netSalary) <= 0) {
      message.error('Please enter a net salary amount');
      return;
    }
    try {
      setNetCalcLoading(true);
      const response = await http.post('/api/v1/payroll/payslips/calculate_from_net/', {
        net_salary: netSalary,
      });
      const data = response.data;
      setNetCalcResult(data);
      applyNetCalcResult(data);
      message.success('Salary components calculated from net salary');
    } catch (e: any) {
      const errorMsg = e.response?.data?.error || 'Failed to calculate from net salary';
      message.error(errorMsg);
    } finally {
      setNetCalcLoading(false);
    }
  };


  return (
    <Modal
      title={entry ? 'Edit Payroll Entry' : 'Add Employee to Payroll'}
      open={visible}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={600}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} onValuesChange={handleNetChange}>
        <Form.Item
          label="Employee"
          name="employee"
          rules={[{ required: true, message: 'Please select an employee' }]}
        >
          <Select
            showSearch
            placeholder="Select employee"
            disabled={!!entry}
            onChange={handleEmployeeChange}
            filterOption={(input, option) => {
              const label = String(option?.label ?? '');
              return label.toLowerCase().includes(input.toLowerCase());
            }}
            options={employeesData.map((e: any) => ({
              label: `${e.full_name} (${e.employee_id})`,
              value: e.id,
            }))}
          />
        </Form.Item>

        <Form.Item
          label="Date of Hire"
          name="date_of_hire"
        >
          <Input type="date" />
        </Form.Item>

        <Form.Item
          label="Department"
          name="department"
        >
          <Input placeholder="e.g., HR, Finance" />
        </Form.Item>

        <Form.Item
          label="Resident / Location"
          name="resident"
        >
          <Input placeholder="e.g., Lusaka" />
        </Form.Item>

        <Divider>Salary Components</Divider>

        <Form.Item
          label="Currency"
          name="currency"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { label: 'ZMW (Zambian Kwacha)', value: 'ZMW' },
              { label: 'USD (US Dollar)', value: 'USD' },
            ]}
          />
        </Form.Item>

        <Card size="small" style={{ marginBottom: 16, backgroundColor: '#f0f5ff' }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Form.Item
              label={<span style={{ fontWeight: 600, color: '#000' }}>Net Salary (components auto-calculate below)</span>}
              name="net"
              style={{ marginBottom: 0 }}
            >
              <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} />
            </Form.Item>
            {netCalcLoading && <span style={{ fontSize: '12px', color: '#ff7a45' }}>Calculating...</span>}
            {netCalcResult && (
              <Alert
                type="success"
                showIcon
                title="Auto-calculated"
                description={`Gross Salary: K${Number(netCalcResult.gross_salary).toFixed(2)}`}
              />
            )}
          </Space>
        </Card>

        <Form.Item label="Basic Salary" name="basic">
          <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} onChange={handleBasicChange} />
        </Form.Item>

        <Form.Item label="Housing Allowance" name="housing">
          <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} onChange={handleComponentChange} />
        </Form.Item>

        <Form.Item label="Transportation" name="transportation">
          <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} onChange={handleComponentChange} />
        </Form.Item>

        <Form.Item label="Lunch Allowance" name="lunch">
          <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} onChange={handleComponentChange} />
        </Form.Item>

        <Divider>Summary</Divider>

        <Card size="small" style={{ backgroundColor: '#f0f5ff' }}>
          <Row gutter={16}>
            <Col span={12}>
              <div>
                <strong>Gross Pay:</strong>
                <div style={{ fontSize: '18px', color: '#1890ff', marginTop: 4 }}>
                  K{liveGross.toFixed(2)}
                </div>
              </div>
            </Col>
            <Col span={12}>
              <div>
                <strong>Net Pay (Est.):</strong>
                <div style={{ fontSize: '18px', color: '#52c41a', marginTop: 4 }}>
                  K{liveNet.toFixed(2)}
                </div>
              </div>
            </Col>
          </Row>
          <div style={{ marginTop: 12, fontSize: '12px', color: '#666' }}>
            {netCalcResult
              ? 'Net pay entered by user. Components calculated from net.'
              : 'Note: Net pay estimate assumes ~30% deductions (NAPSA, PAYE, NHIMA). Actual net will be calculated in payslip.'}
          </div>
        </Card>
      </Form>
    </Modal>
  );
}
