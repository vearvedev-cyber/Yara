import { Form, Input, Select, DatePicker, message, Upload, Avatar, Row, Col } from 'antd';
import { Modal } from '@/components/overlays';
import { UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../lib/http';

interface EmployeeFormProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  employee?: any;
}

export default function EmployeeForm({ visible, onClose, onSuccess, employee }: EmployeeFormProps) {
  const [form] = Form.useForm();
  const [photo, setPhoto] = useState<string | null>(employee?.photo || null);
  const selectedDepartment = Form.useWatch('department', form);
  const queryClient = useQueryClient();
  const workspaceId = localStorage.getItem('workspaceId');

  // Cache departments for 10 minutes with stale-while-revalidate
  // Include workspace in queryKey to separate data across workspaces
  const { data: departments = [] } = useQuery({
    queryKey: ['departments', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { 
        params: { page_size: 500 } 
      });
      return res.data?.results ?? res.data ?? [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // Cache for 30 minutes in background
  });

  // Cache jobs per department, with stale-while-revalidate
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', selectedDepartment, workspaceId],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const res = await http.get('/api/v1/hcm/jobs/', { 
        params: { department: selectedDepartment, page_size: 500 } 
      });
      return res.data?.results ?? res.data ?? [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // Cache for 30 minutes
    enabled: !!selectedDepartment,
  });

  // Memoize department and job options to avoid re-renders
  const departmentOptions = useMemo(() => 
    departments.map((dept: any) => ({
      label: dept.name,
      value: dept.id,
    })), [departments]
  );

  const jobOptions = useMemo(() => 
    jobs.map((job: any) => ({
      label: job.title,
      value: job.id,
    })), [jobs]
  );

  const handlePhotoUpload = (info: any) => {
    if (info.file.originFileObj) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhoto(e.target?.result as string);
      };
      reader.readAsDataURL(info.file.originFileObj);
    }
  };

  const initialValues = employee ? {
    ...employee,
    contractor_type: employee.contractor_type || 'PERMANENT',
    date_of_birth: employee.date_of_birth ? dayjs(employee.date_of_birth) : undefined,
    hire_date: employee.hire_date ? dayjs(employee.hire_date) : undefined,
  } : {
    contractor_type: 'PERMANENT',
  };

  const handleSubmit = async (values: any) => {
    try {
      const payload = {
        ...values,
        contractor_type: values.contractor_type || 'PERMANENT',
        date_of_birth: values.date_of_birth?.format('YYYY-MM-DD'),
        hire_date: values.hire_date?.format('YYYY-MM-DD'),
        photo: photo,
      };
      
      if (employee) {
        await http.put(`/api/v1/hcm/employees/${employee.id}/`, payload);
        message.success('Employee updated');
      } else {
        await http.post('/api/v1/hcm/employees/', payload);
        message.success('Employee created');
      }
      
      // Invalidate employee list query to refetch
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      
      onSuccess();
      onClose();
      form.resetFields();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Failed to save employee');
    }
  };

  return (
    <Modal
      open={visible}
      title={employee ? 'Edit Employee' : 'Add Employee'}
      onCancel={() => {
        onClose();
        form.resetFields();
        setPhoto(null);
      }}
      onOk={() => form.submit()}
      width={750}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={initialValues}>
        {/* Photo Upload Section */}
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          {photo ? (
            <Avatar src={photo} size={80} />
          ) : (
            <Avatar size={80}>{employee?.first_name?.charAt(0) || 'E'}</Avatar>
          )}
          <Form.Item label="Photo (Optional)" style={{ marginTop: 16, marginBottom: 0 }}>
            <Upload
              beforeUpload={() => false}
              onChange={handlePhotoUpload}
              showUploadList={false}
              accept="image/*"
            >
              <div style={{ padding: '8px 16px', border: '1px solid #d9d9d9', borderRadius: '4px', cursor: 'pointer', display: 'inline-block' }}>
                <UploadOutlined /> Click to Upload Photo
              </div>
            </Upload>
          </Form.Item>
        </div>

        {/* Row 1: Employee ID + First Name */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="employee_id" label="Employee ID" rules={[{ required: true }]}>
              <Input placeholder="EMP-001" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="first_name" label="First Name" rules={[{ required: true }]}>
              <Input placeholder="John" />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 2: Last Name + Email */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="last_name" label="Last Name" rules={[{ required: true }]}>
              <Input placeholder="Doe" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input placeholder="john@example.com" />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 3: NRC + Phone */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="nrc" label="NRC" rules={[{ required: true }]}>
              <Input placeholder="353891/66/1" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="Phone" rules={[{ required: true }]}>
              <Input placeholder="+260 97..." />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 4: Date of Birth + Hire Date */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="date_of_birth" label="Date of Birth" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="hire_date" label="Hire Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 5: Gender + Employment Status */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="gender" label="Gender" rules={[{ required: true }]}>
              <Select placeholder="Select gender">
                <Select.Option value="M">Male</Select.Option>
                <Select.Option value="F">Female</Select.Option>
                <Select.Option value="OTHER">Other</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="employment_status" label="Status" rules={[{ required: true }]}>
              <Select placeholder="Select status">
                <Select.Option value="ACTIVE">Active</Select.Option>
                <Select.Option value="INACTIVE">Inactive</Select.Option>
                <Select.Option value="SUSPENDED">Suspended</Select.Option>
                <Select.Option value="ON_LEAVE">On Leave</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* Row 6: Department + Job Title */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="department" label="Department">
              <Select
                allowClear
                showSearch
                placeholder="Select department"
                optionFilterProp="label"
                options={departmentOptions}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="job_title" label="Job Title" rules={[{ required: true }]}>
              <Select
                showSearch
                placeholder="Select job title"
                optionFilterProp="label"
                options={jobOptions}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 7: Contract Type */}
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="contractor_type"
              label="Contract Type"
              rules={[{ required: true, message: 'Select contract type' }]}
              tooltip="Permanent, fixed-term, short term, or consulting"
            >
              <Select placeholder="Select contract type">
                <Select.Option value="PERMANENT">Permanent</Select.Option>
                <Select.Option value="CONTRACT">Fixed-Term / Verbal</Select.Option>
                <Select.Option value="TEMPORARY">Short Term / Temp</Select.Option>
                <Select.Option value="CONTRACTOR">Contractor (External)</Select.Option>
                <Select.Option value="CONSULTANT">Consultant</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* Address Row */}
        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item name="house_address" label="Address" rules={[{ required: true }]}>
              <Input.TextArea rows={2} placeholder="Full address" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
