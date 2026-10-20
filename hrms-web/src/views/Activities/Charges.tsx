import { Button, Tag, Space, Form, Input, Select, message, Upload, Card } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, UploadOutlined, EditOutlined, DeleteOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import http from '../../lib/http';
import dayjs from 'dayjs';
import { exportChargeToPDF } from '../../lib/pdfExport';
import { HeroBanner } from '../../components/HeroBanner';

const toAbsoluteMediaUrl = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    if (window.location.protocol === 'https:' && trimmed.startsWith('http://')) {
      return `https://${trimmed.slice('http://'.length)}`;
    }
    return trimmed;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const envBaseURL = (import.meta.env.VITE_API_BASE_URL || '').trim();
  const apiOrigin = envBaseURL
    ? envBaseURL.replace(/\/+$/, '').replace(/\/api$/, '')
    : window.location.origin;

  return `${apiOrigin}${normalized}`;
};

export default function Charges() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [editFileList, setEditFileList] = useState<any[]>([]);
  const [editingRecord, setEditingRecord] = useState<any>(null);

  // Listen for workspace changes
  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ queryKey: ['charges'] });
      queryClient.removeQueries({ queryKey: ['employees-min'] });
      queryClient.removeQueries({ queryKey: ['case-studies-min'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Filters
  const [pendingFilters, setPendingFilters] = useState<{ employee?: string; status?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ employee?: string; status?: string }>({});

  const { data, isLoading } = useQuery({
    queryKey: ['charges', workspaceId, appliedFilters],
    queryFn: async () => {
      const params: any = {};
      if (appliedFilters.employee) params.search = appliedFilters.employee;
      if (appliedFilters.status) params.status = appliedFilters.status;
      const res = await http.get('/api/v1/activities/charges/', { params: { page_size: 200, ...params } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: caseStudies = [] } = useQuery({
    queryKey: ['case-studies-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/activities/case-studies/', { params: { page_size: 200 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const employeeOptions = useMemo(
    () => (employees || []).map((e: any) => ({ value: e.id, label: e.full_name || `${e.first_name} ${e.last_name}` })),
    [employees],
  );
  const caseStudyOptions = useMemo(
    () => (caseStudies || []).map((c: any) => ({ value: c.id, label: c.case_number })),
    [caseStudies],
  );

  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (fileList.length > 0 && fileList[0].originFileObj) {
        formData.append('charges_document', fileList[0].originFileObj as File);
      }
      return (await http.post('/api/v1/activities/charges/', formData)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges'], exact: false });
      message.success('Charge created successfully');
      setIsModalOpen(false);
      form.resetFields();
      setFileList([]);
    },
    onError: () => {
      message.error('Failed to create charge');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (editFileList.length > 0 && editFileList[0].originFileObj) {
        formData.append('charges_document', editFileList[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/activities/charges/${id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges'], exact: false });
      message.success('Charge updated');
      setEditModalOpen(false);
      editForm.resetFields();
      setEditFileList([]);
      setEditingRecord(null);
    },
    onError: () => message.error('Failed to update charge'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await http.delete(`/api/v1/activities/charges/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges'], exact: false });
      message.success('Charge deleted');
    },
    onError: () => message.error('Failed to delete charge'),
  });

  const handleCreate = async (values: any) => {
    createMutation.mutate(values);
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      employee: record.employee,
      case_study: record.case_study,
      allegations: record.allegations,
      plea: record.plea,
      statement: record.statement,
      status: record.status,
    });
    setEditFileList([]);
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (values: any) => {
    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.id, values });
    }
  };

  const rows = useMemo(() => {
    return (data || []).map((r: any, idx: number) => ({
      ...r,
      key: r.id || idx,
      sn: idx + 1,
    }));
  }, [data]);

  const columns = [
    {
      title: 'Actions',
      width: 120,
      fixed: 'left' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <EyeOutlined
            style={{ cursor: 'pointer', color: '#1890ff' }}
            onClick={() => {
              setViewingRecord(record);
              setViewModalOpen(true);
            }}
          />
          <EditOutlined
            style={{ cursor: 'pointer', color: '#52c41a' }}
            onClick={() => handleEdit(record)}
          />
          <FilePdfOutlined
            style={{ cursor: 'pointer', color: '#10b981' }}
            onClick={() => exportChargeToPDF(record)}
          />
          <DeleteOutlined
            style={{ cursor: 'pointer', color: '#ff4d4f' }}
            onClick={() => {
              Modal.confirm({
                title: 'Delete Charge',
                content: `Delete charge for ${record.employee_name}?`,
                okText: 'Delete',
                okType: 'danger',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
          />
        </Space>
      ),
    },
    { title: 'S/No', dataIndex: 'sn', width: 70 },
    { title: 'Employee', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'Case #', dataIndex: 'case_number', key: 'case_number', render: (v: string) => v || '-' },
    { title: 'Allegations', dataIndex: 'allegations', key: 'allegations', render: (t: string) => t || '-' },
    { title: 'Plea', dataIndex: 'plea', key: 'plea', render: (t: string) => t || '-' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'CLOSED' ? 'green' : status === 'OPENED' ? 'blue' : 'orange'}>
          {status || 'OPENED'}
        </Tag>
      )
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Activities"
        title="Charge Sheets"
        description="Track employee charges, supporting statements, and disciplinary outcomes."
        gradient="neutral"
        tags={[
          { label: 'Allegations', variant: 'neutral' },
          { label: 'Case Linkage', variant: 'cyan' },
          { label: 'Disposition', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            New Charge
          </Button>
        )}
      />

      {/* Filters */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
          marginBottom: 16,
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <Space wrap>
          <Input
            placeholder="Search by employee"
            value={pendingFilters.employee || ''}
            onChange={(e) => setPendingFilters({ ...pendingFilters, employee: e.target.value })}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            allowClear
            placeholder="Filter by status"
            style={{ width: 180 }}
            value={pendingFilters.status || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, status: val })}
          >
            <Select.Option value="OPENED">Opened</Select.Option>
            <Select.Option value="CLOSED">Closed</Select.Option>
          </Select>
          <Button
            type="primary"
            onClick={() => setAppliedFilters(pendingFilters)}
          >
            Search
          </Button>
          <Button
            onClick={() => {
              setPendingFilters({});
              setAppliedFilters({});
            }}
          >
            Reset
          </Button>
        </Space>
      </Card>

      {/* Charges Table */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <MobileTable columns={columns} dataSource={rows} loading={isLoading} rowKey="id" scroll={{ x: 1200 }} style={{ color: '#f7f8fb' }} />
      </Card>

      {/* View Charge Modal */}
      <Modal
        title="Charge Details"
        open={viewModalOpen}
        onCancel={() => setViewModalOpen(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {viewingRecord && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><strong>Employee:</strong> {viewingRecord.employee_name}</div>
            <div><strong>Case #:</strong> {viewingRecord.case_number || '-'}</div>
            <div><strong>Plea:</strong> {viewingRecord.plea}</div>
            <div><strong>Status:</strong> {viewingRecord.status}</div>
            {viewingRecord.allegations && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Allegations:</strong>
                <p>{viewingRecord.allegations}</p>
              </div>
            )}
            {viewingRecord.statement && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Statement:</strong>
                <p>{viewingRecord.statement}</p>
              </div>
            )}
            {viewingRecord.charges_document && (
              <div>
                <strong>Document:</strong>{' '}
                <a href={toAbsoluteMediaUrl(viewingRecord.charges_document) || '#'} target="_blank" rel="noreferrer">
                  Download
                </a>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="Edit Charge"
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          editForm.resetFields();
          setEditFileList([]);
          setEditingRecord(null);
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMutation.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select employee"
              options={employeeOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Link to case study"
              options={caseStudyOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item
            name="allegations"
            label="Allegations"
            rules={[{ required: true, message: 'Please enter allegations' }]}
          >
            <Input.TextArea rows={3} placeholder="Enter allegations" />
          </Form.Item>

          <Form.Item name="plea" label="Plea" rules={[{ required: true, message: 'Select plea' }]}
          >
            <Select placeholder="Select plea">
              <Select.Option value="GUILTY">Guilty</Select.Option>
              <Select.Option value="NOT_GUILTY">Not Guilty</Select.Option>
              <Select.Option value="PENDING">Pending</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="statement"
            label="Statement"
            rules={[{ required: true, message: 'Please enter statement' }]}
          >
            <Input.TextArea rows={3} placeholder="Statement from alleged individual" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="OPENED">Opened</Select.Option>
              <Select.Option value="CLOSED">Closed</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Charges Document">
            <Upload
              fileList={editFileList}
              onChange={({ fileList }) => setEditFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Charge Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="New Charge"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
          setFileList([]);
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select employee"
              options={employeeOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Link to case study"
              options={caseStudyOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item
            name="allegations"
            label="Allegations"
            rules={[{ required: true, message: 'Please enter allegations' }]}
          >
            <Input.TextArea rows={3} placeholder="Enter allegations" />
          </Form.Item>

          <Form.Item name="plea" label="Plea" rules={[{ required: true, message: 'Select plea' }]}>
            <Select placeholder="Select plea">
              <Select.Option value="GUILTY">Guilty</Select.Option>
              <Select.Option value="NOT_GUILTY">Not Guilty</Select.Option>
              <Select.Option value="PENDING">Pending</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="statement"
            label="Statement"
            rules={[{ required: true, message: 'Please enter statement' }]}
          >
            <Input.TextArea rows={3} placeholder="Statement from alleged individual" />
          </Form.Item>

          <Form.Item label="Charges Document">
            <Upload
              fileList={fileList}
              onChange={({ fileList }) => setFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Charge Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
