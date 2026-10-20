import { Card, Row, Col, Statistic, Space, Empty, Button, Form, Input, InputNumber, message, Select, Slider } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../components/MobileTable';
import MobileModal from '../components/MobileModal';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useSalaryRanges, useTitleBreakdowns, usePayrollEntries, useCreateTitleBreakdown, useUpdateTitleBreakdown, useDeleteTitleBreakdown } from '@/lib/hooks/useSalaryManagement';
import type { SalaryRange, TitleBreakdown } from '@/api/services/salaryApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import http from '@/lib/http';

export const SalaryManagementDashboard = () => {
  const [filtersForm] = Form.useForm();
  const [filters, setFilters] = useState<{ dept?: string; title?: string; range?: [number, number] }>({});
  const { data: salaryRanges = [], isLoading: rangesLoading } = useSalaryRanges();
  const { data: titleBreakdowns = [], isLoading: breakdownsLoading } = useTitleBreakdowns();
  const { data: payrollEntries = [], isLoading: entriesLoading, refetch } = usePayrollEntries();
  const queryClient = useQueryClient();
  const createTitleBreakdown = useCreateTitleBreakdown();
  const updateTitleBreakdown = useUpdateTitleBreakdown();
  const deleteTitleBreakdown = useDeleteTitleBreakdown();
  const [form] = Form.useForm();
  const [employeeForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [workspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const closeTitleBreakdownModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const closeEmployeeModal = () => {
    setIsEmployeeModalOpen(false);
    employeeForm.resetFields();
  };

  const handleAddNew = () => {
    form.resetFields();
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (record: TitleBreakdown) => {
    form.setFieldsValue(record);
    setEditingId(record.id);
    setIsModalOpen(true);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: 'Delete Title Breakdown',
      content: 'Are you sure you want to delete this record?',
      okText: 'Yes',
      cancelText: 'No',
      onOk: async () => {
        try {
          await deleteTitleBreakdown.mutateAsync(id);
          message.success('Deleted successfully');
        } catch (error) {
          message.error('Failed to delete');
        }
      },
    });
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingId) {
        await updateTitleBreakdown.mutateAsync({
          id: editingId,
          data: values,
        });
        message.success('Updated successfully');
      } else {
        await createTitleBreakdown.mutateAsync(values);
        message.success('Created successfully');
      }
      closeTitleBreakdownModal();
    } catch (error) {
      message.error('Operation failed');
    }
  };

  const salaryRangeColumns = [
    {
      title: 'Salary Range',
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: 'Min Gross',
      dataIndex: 'min_gross',
      key: 'min_gross',
      render: (val: number) => `ZMW ${val?.toLocaleString()}`,
    },
    {
      title: 'Max Gross',
      dataIndex: 'max_gross',
      key: 'max_gross',
      render: (val: number) => (val ? `ZMW ${val.toLocaleString()}` : 'Unlimited'),
    },
    {
      title: 'Employee Count',
      dataIndex: 'employee_count',
      key: 'employee_count',
      render: (val: number) => <strong>{val}</strong>,
    },
  ];

  const titleBreakdownColumns = [
    {
      title: 'Position',
      dataIndex: 'position',
      key: 'position',
    },
    {
      title: 'Basic',
      dataIndex: 'basic',
      key: 'basic',
      render: (val: number) => `ZMW ${val?.toLocaleString()}`,
    },
    {
      title: 'Housing',
      dataIndex: 'housing',
      key: 'housing',
      render: (val: number) => `ZMW ${val?.toLocaleString()}`,
    },
    {
      title: 'Transportation',
      dataIndex: 'transportation',
      key: 'transportation',
      render: (val: number) => `ZMW ${val?.toLocaleString()}`,
    },
    {
      title: 'Lunch',
      dataIndex: 'lunch',
      key: 'lunch',
      render: (val: number) => `ZMW ${val?.toLocaleString()}`,
    },
    {
      title: 'Gross',
      dataIndex: 'gross',
      key: 'gross',
      render: (val: number) => <strong>ZMW {val?.toLocaleString()}</strong>,
    },
    {
      title: 'Net',
      dataIndex: 'net',
      key: 'net',
      render: (val: number) => <strong style={{ color: '#1890ff' }}>ZMW {val?.toLocaleString()}</strong>,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TitleBreakdown) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      ),
    },
  ];

  const employeeSalaryColumns = [
    {
      title: 'Employee #',
      dataIndex: 'employee_number',
      key: 'employee_number',
      width: 120,
    },
    {
      title: 'Name',
      dataIndex: 'employee_name',
      key: 'employee_name',
      width: 180,
    },
    {
      title: 'Position',
      dataIndex: 'position',
      key: 'position',
      width: 150,
    },
    {
      title: 'Department',
      dataIndex: 'department',
      key: 'department',
      width: 120,
    },
    {
      title: 'Basic',
      dataIndex: 'basic',
      key: 'basic',
      width: 100,
      render: (val: number) => `${val?.toLocaleString()}`,
    },
    {
      title: 'Housing',
      dataIndex: 'housing',
      key: 'housing',
      width: 100,
      render: (val: number) => `${val?.toLocaleString()}`,
    },
    {
      title: 'Transport',
      dataIndex: 'transportation',
      key: 'transportation',
      width: 100,
      render: (val: number) => `${val?.toLocaleString()}`,
    },
    {
      title: 'Lunch',
      dataIndex: 'lunch',
      key: 'lunch',
      width: 100,
      render: (val: number) => `${val?.toLocaleString()}`,
    },
    {
      title: 'Gross',
      dataIndex: 'gross',
      key: 'gross',
      width: 120,
      render: (val: number) => <strong>ZMW {val?.toLocaleString()}</strong>,
    },
    {
      title: 'Net',
      dataIndex: 'net',
      key: 'net',
      width: 120,
      render: (val: number) => <strong style={{ color: '#52c41a' }}>ZMW {val?.toLocaleString()}</strong>,
    },
  ];

  const filteredEntries = payrollEntries.filter((e: any) => {
    const inDept = filters.dept ? (e.department || '').toLowerCase().includes(filters.dept.toLowerCase()) : true;
    const inTitle = filters.title ? (e.position || '').toLowerCase().includes(filters.title.toLowerCase()) : true;
    const inRange = filters.range ? (e.gross ?? 0) >= filters.range[0] && (e.gross ?? 0) <= filters.range[1] : true;
    return inDept && inTitle && inRange;
  });

  const totalEmployees = salaryRanges.reduce((sum: number, range) => sum + range.employee_count, 0);
  const totalGrossByRange = salaryRanges.reduce((sum: number, range) => {
    if (range.min_gross) return sum + range.min_gross * range.employee_count;
    return sum;
  }, 0);

  return (
    <div style={{ padding: '24px' }}>
      <h1>💰 Salary Management</h1>

      {/* Key Statistics */}
      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={12} md={6}>
          <Statistic
            title="Total Employees"
            value={totalEmployees}
            suffix="staff"
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Statistic
            title="Salary Ranges"
            value={salaryRanges.length}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Statistic
            title="Positions"
            value={titleBreakdowns.length}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Statistic
            title="Avg Gross"
            value={totalEmployees > 0 ? Math.round(totalGrossByRange / totalEmployees) : 0}
            prefix="ZMW "
          />
        </Col>
      </Row>

      {/* Salary Range Section */}
      <Card
        title="📊 Employee Salary Range Distribution"
        style={{ marginBottom: '24px' }}
        loading={rangesLoading}
      >
        {salaryRanges.length > 0 ? (
          <MobileTable
            columns={salaryRangeColumns}
            dataSource={salaryRanges.map((r: SalaryRange, idx: number) => ({ ...r, key: idx }))}
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
            size="small"
          />
        ) : (
          <Empty description="No salary ranges found" />
        )}
      </Card>

      {/* Employee Salary Details Section */}
      <Card
        title="👥 Employee Salary Breakdown"
        extra={
          <Space>
            <Form form={filtersForm} layout="inline" onFinish={(vals) => setFilters(vals)}>
              <Form.Item name="dept">
                <Input placeholder="Filter Dept" allowClear />
              </Form.Item>
              <Form.Item name="title">
                <Input placeholder="Job Title" allowClear />
              </Form.Item>
              <Form.Item name="range" initialValue={[0, 100000]}>
                <Slider range step={1000} min={0} max={500000} style={{ width: 180 }} />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button onClick={() => { filtersForm.resetFields(); setFilters({}); }}>Reset</Button>
                  <Button type="primary" htmlType="submit">Apply</Button>
                </Space>
              </Form.Item>
            </Form>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                employeeForm.resetFields();
                setIsEmployeeModalOpen(true);
              }}
            >
              Add Employee
            </Button>
          </Space>
        }
        style={{ marginBottom: '24px' }}
        loading={entriesLoading}
      >
        {filteredEntries.length > 0 ? (
          <MobileTable
            columns={employeeSalaryColumns}
            dataSource={filteredEntries.map((e, idx) => ({ ...e, key: idx }))}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1400 }}
            size="small"
          />
        ) : (
          <Empty description="No employee salary records found" />
        )}
      </Card>

      {/* Title Breakdown Section */}
      <Card
        title="🏢 Position Pay Breakdown"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddNew}
          >
            New Position
          </Button>
        }
        loading={breakdownsLoading}
      >
        {titleBreakdowns.length > 0 ? (
          <MobileTable
            columns={titleBreakdownColumns}
            dataSource={titleBreakdowns.map((t: TitleBreakdown, idx: number) => ({ ...t, key: idx }))}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1200 }}
            size="small"
          />
        ) : (
          <Empty description="No title breakdowns found" />
        )}
      </Card>

      {/* Add/Edit Modal */}
      <MobileModal
        title={editingId ? 'Edit Position Pay' : 'Add New Position'}
        open={isModalOpen}
        onOk={() => form.submit()}
        onClose={closeTitleBreakdownModal}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            label="Position"
            name="position"
            rules={[{ required: true, message: 'Please enter position name' }]}
          >
            <Input placeholder="e.g., Admin, Stores, Mechanic" />
          </Form.Item>

          <Form.Item
            label="Currency"
            name="currency"
            initialValue="ZMW"
            rules={[{ required: true }]}
          >
            <Input maxLength={3} placeholder="ZMW" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Basic Salary"
                name="basic"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Housing"
                name="housing"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Transportation"
                name="transportation"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Lunch Allowance"
                name="lunch"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Gross"
                name="gross"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Net Pay"
                name="net"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </MobileModal>

      {/* Add Employee Payroll Modal */}
      <MobileModal
        title="Add Employee to Payroll"
        open={isEmployeeModalOpen}
        onOk={() => employeeForm.submit()}
        onClose={closeEmployeeModal}
        width={700}
      >
        <Form
          form={employeeForm}
          layout="vertical"
          onFinish={async (values) => {
            try {
              // Calculate gross and net if not provided
              const basic = values.basic || 0;
              const housing = values.housing || 0;
              const transportation = values.transportation || 0;
              const lunch = values.lunch || 0;
              const gross = values.gross || (basic + housing + transportation + lunch);
              const net = values.net || gross;
              
              const payload = {
                ...values,
                gross,
                net,
                currency: 'ZMW'
              };
              
              await http.post('/api/v1/payroll/entries/', payload);
              message.success('Employee added to payroll');
              closeEmployeeModal();
              await refetch();
              queryClient.invalidateQueries({ queryKey: ['salaryRanges'] });
            } catch (error: any) {
              console.error('Payroll entry error:', error.response?.data);
              const errorData = error.response?.data;
              if (errorData && typeof errorData === 'object') {
                const firstKey = Object.keys(errorData)[0];
                const firstMessage = firstKey ? errorData[firstKey] : null;
                message.error(
                  Array.isArray(firstMessage)
                    ? `${firstKey}: ${firstMessage[0]}`
                    : (errorData.detail || 'Failed to add employee')
                );
              } else {
                message.error('Failed to add employee');
              }
            }
          }}
        >
          <Form.Item
            label="Employee"
            name="employee"
            rules={[{ required: true, message: 'Please select an employee' }]}
          >
            <Select
              showSearch
              placeholder="Select employee"
              optionFilterProp="label"
              options={employees.map((emp: any) => ({
                value: emp.id,
                label: `${emp.full_name} (${emp.employee_id || emp.employee_number})`,
              }))}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Basic Salary"
                name="basic"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Housing Allowance"
                name="housing"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Transportation"
                name="transportation"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Lunch Allowance"
                name="lunch"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Gross Pay"
                name="gross"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Net Pay"
                name="net"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </MobileModal>
    </div>
  );
};
