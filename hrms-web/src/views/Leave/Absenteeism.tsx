import { Button, Tag, Space, Form, Input, Select, message, DatePicker, Upload, Card, Row, Col } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, UploadOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { Stethoscope } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import http from '../../lib/http';
import dayjs, { Dayjs } from 'dayjs';
import { HeroBanner } from '../../components/HeroBanner';

export default function Absenteeism() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [fileList, setFileList] = useState<any[]>([]);
  const [filterName, setFilterName] = useState<string>('');
  const [filterDateRange, setFilterDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['absenteeism'] });
      queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['absenteeism'] });
    queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
  }, [workspaceId, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['absenteeism', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/leave/absenteeism/');
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const formData = new FormData();
      Object.entries(payload).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (fileList.length > 0 && fileList[0].originFileObj) {
        formData.append('supporting_document', fileList[0].originFileObj as File);
      }
      return (await http.post('/api/v1/leave/absenteeism/', formData)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absenteeism', workspaceId] });
      message.success('Absenteeism report created successfully');
      setIsModalOpen(false);
      createForm.resetFields();
      setFileList([]);
    },
    onError: () => {
      message.error('Failed to create absenteeism report');
    },
  });

  const handleCreate = async (values: any) => {
    const payload = {
      ...values,
      date: values.date?.format('YYYY-MM-DD'),
    };
    createMutation.mutate(payload);
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      const formData = new FormData();
      Object.entries(payload).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (fileList.length > 0 && fileList[0].originFileObj) {
        formData.append('supporting_document', fileList[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/leave/absenteeism/${id}/`, formData)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absenteeism', workspaceId] });
      message.success('Absenteeism report updated');
      setIsEditOpen(false);
      editForm.resetFields();
      setFileList([]);
    },
    onError: () => message.error('Failed to update absenteeism report'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/api/v1/leave/absenteeism/${id}/`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absenteeism', workspaceId] });
      message.success('Absenteeism report deleted');
    },
    onError: () => message.error('Failed to delete absenteeism report'),
  });

  const handleEditOpen = (record: any) => {
    setSelected(record);
    setIsEditOpen(true);
    editForm.setFieldsValue({
      employee: record.employee,
      date: record.date ? dayjs(record.date) : undefined,
      reason_provided: record.reason_provided,
      supervisor_notes: record.supervisor_notes,
      status: record.status || 'PENDING',
    });
    setFileList([]);
  };

  const handleEdit = async (values: any) => {
    if (!selected?.id) return;
    const payload = {
      ...values,
      date: values.date?.format('YYYY-MM-DD'),
    };
    updateMutation.mutate({ id: selected.id, payload });
  };

  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter((record: any) => {
      // Filter by employee name
      const matchesName = filterName
        ? (record.employee_name?.toLowerCase() || '').includes(filterName.toLowerCase())
        : true;

      // Filter by date range
      let matchesDate = true;
      if (filterDateRange) {
        const recordDate = new Date(record.date);
        const filterStart = filterDateRange[0].toDate();
        const filterEnd = filterDateRange[1].toDate();
        matchesDate = recordDate >= filterStart && recordDate <= filterEnd;
      }

      return matchesName && matchesDate;
    });
  }, [data, filterName, filterDateRange]);

  const handleResetFilters = () => {
    setFilterName('');
    setFilterDateRange(null);
  };

  const columns = [
    {
      title: 'Employee',
      dataIndex: 'employee_name',
      key: 'employee_name',
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : '-',
    },
    {
      title: 'Reported By',
      dataIndex: 'reported_by_name',
      key: 'reported_by_name',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: any = {
          PENDING: 'blue',
          JUSTIFIED: 'green',
          UNJUSTIFIED: 'red',
          UNDER_REVIEW: 'orange',
        };
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>;
      },
    },
    {
      title: 'Action',
      key: 'action',
      render: (record: any) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            size="small"
            onClick={() => {
              setSelected(record);
              setIsViewOpen(true);
            }}
          />
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEditOpen(record)}
          />
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            loading={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm('Are you sure you want to delete this absenteeism record?')) {
                deleteMutation.mutate(record.id);
              }
            }}
          />
          {record.supporting_document && (
            <Button type="link" size="small" href={record.supporting_document} target="_blank">
              Download
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Leave"
        title="Absenteeism & Sick Reports"
        description="Track and manage employee absences, sick leave, and wellness-related incidents with supporting documentation."
        icon={<Stethoscope className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
        gradient="neutral"
        tags={[
          { label: 'Attendance Risk', variant: 'neutral' },
          { label: 'Sick Notes', variant: 'cyan' },
          { label: 'Compliance', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            Report Absence
          </Button>
        )}
      />

      {/* Filters Section */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col xs={24} sm={12} md={8}>
            <Input
              placeholder="Search by employee name"
              prefix={<SearchOutlined />}
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              value={filterDateRange}
              onChange={(dates) => setFilterDateRange(dates as [Dayjs, Dayjs] | null)}
              placeholder={['Start Date', 'End Date']}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleResetFilters}
              disabled={!filterName && !filterDateRange}
            >
              Reset Filters
            </Button>
          </Col>
        </Row>
      </Card>

      <MobileTable columns={columns} dataSource={filteredData} loading={isLoading} rowKey="id" />

      <Modal
        title="Report Absenteeism"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          createForm.resetFields();
          setFileList([]);
        }}
        onOk={() => createForm.submit()}
        confirmLoading={createMutation.isPending}
        width={600}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}>
            <Select
              placeholder="Select employee"
              showSearch
              options={employees?.map((emp: any) => ({
                label: `${emp.employee_id || emp.employee_code} - ${emp.full_name || `${emp.first_name} ${emp.last_name}`}`,
                value: emp.id
              }))}
              filterOption={(input, option: any) =>
                (option?.label?.toLowerCase() || '').includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item
            name="date"
            label="Date"
            rules={[{ required: true, message: 'Please select date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="reason_provided" label="Reason Provided by Employee">
            <Input.TextArea rows={3} placeholder="Reason for absence" />
          </Form.Item>

          <Form.Item name="supervisor_notes" label="Supervisor Notes">
            <Input.TextArea rows={2} placeholder="Supervisor or HR notes" />
          </Form.Item>

          <Form.Item name="status" label="Status" initialValue="PENDING">
            <Select>
              <Select.Option value="PENDING">Pending</Select.Option>
              <Select.Option value="JUSTIFIED">Justified</Select.Option>
              <Select.Option value="UNJUSTIFIED">Unjustified</Select.Option>
              <Select.Option value="UNDER_REVIEW">Under Review</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Supporting Document">
            <Upload
              fileList={fileList}
              onChange={({ fileList }) => setFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Edit Absenteeism"
        open={isEditOpen}
        onCancel={() => {
          setIsEditOpen(false);
          editForm.resetFields();
          setFileList([]);
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMutation.isPending}
        width={600}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}>
            <Select
              placeholder="Select employee"
              showSearch
              options={employees?.map((emp: any) => ({
                label: `${emp.employee_id || emp.employee_code} - ${emp.full_name || `${emp.first_name} ${emp.last_name}`}`,
                value: emp.id
              }))}
              filterOption={(input, option: any) =>
                (option?.label?.toLowerCase() || '').includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item
            name="date"
            label="Date"
            rules={[{ required: true, message: 'Please select date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="reason_provided" label="Reason Provided by Employee">
            <Input.TextArea rows={3} placeholder="Reason for absence" />
          </Form.Item>

          <Form.Item name="supervisor_notes" label="Supervisor Notes">
            <Input.TextArea rows={2} placeholder="Supervisor or HR notes" />
          </Form.Item>

          <Form.Item name="status" label="Status" initialValue="PENDING">
            <Select>
              <Select.Option value="PENDING">Pending</Select.Option>
              <Select.Option value="JUSTIFIED">Justified</Select.Option>
              <Select.Option value="UNJUSTIFIED">Unjustified</Select.Option>
              <Select.Option value="UNDER_REVIEW">Under Review</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Supporting Document">
            <Upload
              fileList={fileList}
              onChange={({ fileList }) => setFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Absenteeism Details"
        open={isViewOpen}
        onCancel={() => setIsViewOpen(false)}
        footer={null}
        width={520}
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <div><strong>Employee:</strong> {selected?.employee_name || '-'}</div>
          <div><strong>Date:</strong> {selected?.date ? dayjs(selected.date).format('YYYY-MM-DD') : '-'}</div>
          <div><strong>Reported By:</strong> {selected?.reported_by_name || '-'}</div>
          <div><strong>Status:</strong> {selected?.status || '-'}</div>
          <div><strong>Reason:</strong> {selected?.reason_provided || '-'}</div>
          <div><strong>Supervisor Notes:</strong> {selected?.supervisor_notes || '-'}</div>
          {selected?.supporting_document && (
            <div>
              <Button type="link" href={selected.supporting_document} target="_blank">
                View Supporting Document
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
