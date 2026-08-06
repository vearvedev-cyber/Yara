import { Modal, Form, Input, Select, InputNumber, message, Divider, Card, Row, Col, Button, Space, Alert, Switch, Tooltip } from 'antd';
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
  employer_borne_deductions?: boolean;
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
  const [employerBorne, setEmployerBorne] = useState(false);
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

  // Recomputes both liveGross and liveNet from current form values
  const recompute = (overrideBasic?: number) => {
    const basic = overrideBasic ?? Number(form.getFieldValue('basic') || 0);
    const housing = Number(form.getFieldValue('housing') || 0);
    const transportation = Number(form.getFieldValue('transportation') || 0);
    const lunch = Number(form.getFieldValue('lunch') || 0);
    const g = basic + housing + transportation + lunch;
    setLiveGross(g);
    setLiveNet(g * 0.7);
  };

  // Direct onChange for basic salary — updates allowances + net proportionally and refreshes summary
  const handleBasicChange = (val: number | null) => {
    if (autoCalcRef.current) return;
    const basic = Number(val || 0);
    const r = ratiosRef.current;
    if (basic > 0 && r.basic > 0) {
      const newGross = basic / r.basic;
      const newHousing = parseFloat((newGross * r.housing).toFixed(2));
      const newTransport = parseFloat((newGross * r.transport).toFixed(2));
      const newLunch = parseFloat((newGross * r.lunch).toFixed(2));
      // Keep net/gross ratio so net input and summary both update proportionally
      const netRatio = liveGross > 0 ? liveNet / liveGross : 0.7;
      const newNet = parseFloat((newGross * netRatio).toFixed(2));
      autoCalcRef.current = true;
      form.setFieldsValue({ housing: newHousing, transportation: newTransport, lunch: newLunch, net: newNet });
      setTimeout(() => { autoCalcRef.current = false; }, 0);
      setLiveGross(newGross);
      setLiveNet(newNet);
      if (netCalcResult) setNetCalcResult({ ...netCalcResult, gross_salary: newGross });
    } else {
      recompute(basic);
    }
  };

  // Direct onChange for housing / transportation / lunch — recomputes both gross and net
  const handleComponentChange = () => {
    if (autoCalcRef.current) return;
    recompute();
  };

  // onValuesChange — triggers on net field change
  const handleNetChange = async (changedValues: any, allValues: any) => {
    if (autoCalcRef.current) return;
    if (!('net' in changedValues) || !(Number(allValues.net) > 0)) return;

    const enteredValue = Number(allValues.net);

    if (employerBorne) {
      // Employer-borne: entered value IS the gross — just split by ratios, no API needed
      const r = ratiosRef.current;
      const gross = enteredValue;
      const housing = parseFloat((gross * r.housing).toFixed(2));
      const transport = parseFloat((gross * r.transport).toFixed(2));
      const lunch = parseFloat((gross * r.lunch).toFixed(2));
      const basic = parseFloat((gross - housing - transport - lunch).toFixed(2));
      autoCalcRef.current = true;
      form.setFieldsValue({ basic, housing, transportation: transport, lunch });
      setTimeout(() => { autoCalcRef.current = false; }, 0);
      setLiveGross(gross);
      setLiveNet(gross);
      setNetCalcResult(null);
      return;
    }

    // Standard mode: back-calculate gross from net via API
    try {
      setNetCalcLoading(true);
      const response = await http.post('/api/v1/payroll/payslips/calculate_from_net/', {
        net_salary: enteredValue,
      });
      const data = response.data;
      setNetCalcResult(data);
      applyNetCalcResult(data, enteredValue);
    } catch (e: any) {
      console.warn('Could not auto-calculate from net:', e.message);
    } finally {
      setNetCalcLoading(false);
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
      setEmployerBorne(!!entry.employer_borne_deductions);
    } else {
      form.resetFields();
      form.setFieldsValue({ currency: 'ZMW' });
      setLiveGross(0);
      setLiveNet(0);
      setEmployerBorne(false);
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
        employer_borne_deductions: employerBorne,
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

        <Card
          size="small"
          style={{ marginBottom: 16, borderColor: employerBorne ? '#fa8c16' : '#d9d9d9', backgroundColor: employerBorne ? '#fff7e6' : undefined }}
        >
          <Row align="middle" gutter={12}>
            <Col>
              <Tooltip title="When ON, the company absorbs NAPSA, PAYE and NHIMA — employee takes home the full gross salary. Deductions are still recorded for ZRA remittance.">
                <Switch checked={employerBorne} onChange={setEmployerBorne} />
              </Tooltip>
            </Col>
            <Col flex="auto">
              <div style={{ fontWeight: 600 }}>Employer-Borne Deductions</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {employerBorne
                  ? 'Company covers NAPSA, PAYE & NHIMA — employee receives gross as take-home'
                  : 'Standard: deductions taken from employee gross salary'}
              </div>
            </Col>
          </Row>
        </Card>

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

        <Card size="small" style={{ marginBottom: 16, backgroundColor: employerBorne ? '#fff7e6' : '#f0f5ff', borderColor: employerBorne ? '#fa8c16' : undefined }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Form.Item
              label={
                <span style={{ fontWeight: 600, color: '#000' }}>
                  {employerBorne
                    ? 'Gross Salary (employee takes home this full amount)'
                    : 'Net Salary (components auto-calculate below)'}
                </span>
              }
              name="net"
              style={{ marginBottom: 0 }}
            >
              <InputNumber prefix="K" precision={2} min={0} max={MAX_SALARY} style={{ width: '100%' }} />
            </Form.Item>
            {!employerBorne && netCalcLoading && <span style={{ fontSize: '12px', color: '#ff7a45' }}>Calculating...</span>}
            {!employerBorne && netCalcResult && (
              <Alert
                type="success"
                showIcon
                title="Auto-calculated"
                description={`Gross Salary: K${Number(netCalcResult.gross_salary).toFixed(2)}`}
              />
            )}
            {employerBorne && (
              <span style={{ fontSize: '12px', color: '#fa8c16' }}>
                Employer-borne: entered value is the gross — components split by workspace ratios
              </span>
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

        <Card size="small" style={{ backgroundColor: employerBorne ? '#fff7e6' : '#f0f5ff' }}>
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
                <strong>{employerBorne ? 'Take-Home (= Gross):' : 'Net Pay (Est.):'}</strong>
                <div style={{ fontSize: '18px', color: employerBorne ? '#fa8c16' : '#52c41a', marginTop: 4 }}>
                  K{employerBorne ? liveGross.toFixed(2) : liveNet.toFixed(2)}
                </div>
              </div>
            </Col>
          </Row>
          <div style={{ marginTop: 12, fontSize: '12px', color: '#666' }}>
            {employerBorne
              ? 'Employer-borne mode: employee takes home full gross. NAPSA, PAYE & NHIMA still remitted by company.'
              : netCalcResult
                ? 'Net pay entered by user. Components calculated from net.'
                : 'Note: Net pay estimate assumes ~30% deductions (NAPSA, PAYE, NHIMA). Actual net will be calculated in payslip.'}
          </div>
        </Card>
      </Form>
    </Modal>
  );
}
