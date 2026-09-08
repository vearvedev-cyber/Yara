import { Button, Tag, Space, Modal, Form, Input, Select, message, Upload, Drawer } from 'antd';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, UploadOutlined, FilePdfOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { listInvestigations, createInvestigation } from '../../api/activities';
import http from '../../lib/http';
import { exportInvestigationToPDF } from '../../lib/pdfExport';
import { HeroBanner } from '../../components/HeroBanner';

export default function Investigations() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewDrawerOpen, setViewDrawerOpen] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [editFileList, setEditFileList] = useState<any[]>([]);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [editingRecord, setEditingRecord] = useState<any>(null);

  // Listen for workspace changes
  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ queryKey: ['investigations'] });
      queryClient.removeQueries({ queryKey: ['employees-list'] });
      queryClient.removeQueries({ queryKey: ['case-studies-min'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Filter states
  const [pendingInvestigator, setPendingInvestigator] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pendingInvestigationNumber, setPendingInvestigationNumber] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ investigator: string; status: string | null; investigation_number: string }>({
    investigator: '',
    status: null,
    investigation_number: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['investigations', workspaceId],
    queryFn: () => listInvestigations(),
    enabled: !!workspaceId,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: caseStudies = [] } = useQuery({
    queryKey: ['case-studies-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/activities/case-studies/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const caseStudyOptions = useMemo(
    () => (caseStudies || []).map((c: any) => ({ value: c.id, label: c.case_number })),
    [caseStudies],
  );

  const createMutation = useMutation({
    mutationFn: createInvestigation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      message.success('Investigation created successfully');
      setIsModalOpen(false);
      form.resetFields();
      setFileList([]);
    },
    onError: () => {
      message.error('Failed to create investigation');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (editFileList.length > 0 && editFileList[0].originFileObj) {
        formData.append('supporting_documents', editFileList[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/activities/investigations/${id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      message.success('Investigation updated successfully');
      setEditModalOpen(false);
      editForm.resetFields();
      setEditFileList([]);
      setEditingRecord(null);
    },
    onError: () => {
      message.error('Failed to update investigation');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await http.delete(`/api/v1/activities/investigations/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      message.success('Investigation deleted successfully');
    },
    onError: () => message.error('Failed to delete investigation'),
  });

  const handleCreate = async (values: any) => {
    const formData = new FormData();
    Object.keys(values).forEach(key => {
      if (values[key] !== undefined && values[key] !== null) {
        formData.append(key, values[key]);
      }
    });
    if (fileList.length > 0 && fileList[0].originFileObj) {
      formData.append('supporting_documents', fileList[0].originFileObj);
    }
    createMutation.mutate(formData as any);
  };

  const handleView = (record: any) => {
    setViewingRecord(record);
    setViewDrawerOpen(true);
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      investigation_number: record.investigation_number,
      title: record.title,
      related_employee: record.related_employee,
      case_study: record.case_study,
      investigator: record.investigator,
      investigation_date: record.investigation_date,
      status: record.status,
      description: record.description,
      findings: record.findings,
      observations: record.observations,
      conclusion_of_scene: record.conclusion_of_scene,
    });
    setEditFileList([]);
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (values: any) => {
    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.id, values });
    }
  };

  const allRows = data?.results || data || [];

  const rows = allRows.filter((record: any) => {
    const matchesInvestigator = appliedFilters.investigator
      ? (record.investigator || '').toLowerCase().includes(appliedFilters.investigator.toLowerCase())
      : true;
    const matchesStatus = appliedFilters.status ? record.status === appliedFilters.status : true;
    const matchesInvestigationNumber = appliedFilters.investigation_number
      ? (record.investigation_number || '').toLowerCase().includes(appliedFilters.investigation_number.toLowerCase())
      : true;
    return matchesInvestigator && matchesStatus && matchesInvestigationNumber;
  });

  const columns = [
    { title: 'Investigation #', dataIndex: 'investigation_number', key: 'investigation_number' },
    { title: 'Case #', dataIndex: 'case_number', key: 'case_number', render: (v: string) => v || '-' },
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Investigator', dataIndex: 'investigator', key: 'investigator' },
    {
      title: 'Date',
      dataIndex: 'investigation_date',
      key: 'investigation_date',
      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: any = { COMPLETED: 'green', IN_PROGRESS: 'blue', INITIATED: 'orange', CLOSED: 'default' };
        return <Tag color={colorMap[status] || 'default'}>{status || 'INITIATED'}</Tag>;
      }
    },
    {
      title: 'Action',
      key: 'action',
      width: 120,
      render: (record: any) => (
        <Space size="small">
          <EyeOutlined
            onClick={() => handleView(record)}
            style={{ cursor: 'pointer', color: '#0ea5e9' }}
          />
          <EditOutlined
            onClick={() => handleEdit(record)}
            style={{ cursor: 'pointer', color: '#52c41a' }}
          />
          <FilePdfOutlined
            onClick={() => exportInvestigationToPDF(record)}
            style={{ cursor: 'pointer', color: '#10b981' }}
          />
          <DeleteOutlined
            onClick={() => {
              Modal.confirm({
                title: 'Delete Investigation',
                content: 'Are you sure you want to delete this investigation?',
                okText: 'Delete',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
            style={{ cursor: 'pointer', color: '#ef4444' }}
          />
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Activities"
        title="Investigations"
        description="Initiate, assign, and monitor workplace investigations with evidence and findings."
        gradient="neutral"
        tags={[
          { label: 'Case Intake', variant: 'neutral' },
          { label: 'Investigator Workflow', variant: 'cyan' },
          { label: 'Findings', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            New Investigation
          </Button>
        )}
      />

      {/* Filter Section */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
        border: '1px solid rgba(245, 196, 0, 0.15)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '16px',
      }}>
        <Space wrap>
          <Input
            placeholder="Search by investigator"
            value={pendingInvestigator}
            onChange={(e) => setPendingInvestigator(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Input
            placeholder="Search by investigation #"
            value={pendingInvestigationNumber}
            onChange={(e) => setPendingInvestigationNumber(e.target.value)}
            allowClear
            style={{ width: 200 }}
          />
          <Select
            allowClear
            placeholder="Filter by status"
            value={pendingStatus || undefined}
            onChange={(val) => setPendingStatus(val || null)}
            style={{ width: 180 }}
            options={[
              { label: 'INITIATED', value: 'INITIATED' },
              { label: 'IN_PROGRESS', value: 'IN_PROGRESS' },
              { label: 'COMPLETED', value: 'COMPLETED' },
              { label: 'CLOSED', value: 'CLOSED' },
            ]}
          />
          <Button
            type="primary"
            onClick={() => setAppliedFilters({ investigator: pendingInvestigator, status: pendingStatus, investigation_number: pendingInvestigationNumber })}
            style={{
              background: '#f5c400',
              borderColor: '#f5c400',
              color: '#05060a',
              fontWeight: 600,
            }}
          >
            Search
          </Button>
          <Button
            onClick={() => {
              setPendingInvestigator('');
              setPendingStatus(null);
              setPendingInvestigationNumber('');
              setAppliedFilters({ investigator: '', status: null, investigation_number: '' });
            }}
          >
            Reset
          </Button>
        </Space>
      </div>

      <MobileTable
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        rowKey="id"
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid rgba(245, 196, 0, 0.15)',
        }}
      />

      <Modal
        title="Create Investigation"
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
            name="investigation_number"
            label="Investigation Number"
            rules={[{ required: true, message: 'Please enter investigation number' }]}
          >
            <Input placeholder="INV-2025-001" />
          </Form.Item>

          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Please enter title' }]}
          >
            <Input placeholder="Investigation title" />
          </Form.Item>

          <Form.Item name="related_employee" label="Related Employee">
            <Select placeholder="Select employee" allowClear showSearch filterOption={(input, option: any) =>
              (option?.children?.toLowerCase() || '').includes(input.toLowerCase())
            }>
              {employees?.map((emp: any) => (
                <Select.Option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} ({emp.employee_code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              placeholder="Link to case study"
              showSearch
              optionFilterProp="label"
              options={caseStudyOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item name="investigator" label="Investigator">
            <Input placeholder="Investigator name" />
          </Form.Item>

          <Form.Item name="investigation_date" label="Investigation Date">
            <Input type="date" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="INITIATED">Initiated</Select.Option>
              <Select.Option value="IN_PROGRESS">In Progress</Select.Option>
              <Select.Option value="COMPLETED">Completed</Select.Option>
              <Select.Option value="CLOSED">Closed</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Investigation description" />
          </Form.Item>

          <Form.Item name="findings" label="Findings">
            <Input.TextArea rows={2} placeholder="Investigation findings" />
          </Form.Item>

          <Form.Item name="observations" label="Observations">
            <Input.TextArea rows={2} placeholder="Observations" />
          </Form.Item>

          <Form.Item name="conclusion_of_scene" label="Conclusion of Scene">
            <Input.TextArea rows={2} placeholder="Scene conclusion" />
          </Form.Item>

          <Form.Item label="Supporting Documents">
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
        title="Edit Investigation"
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
            name="investigation_number"
            label="Investigation Number"
            rules={[{ required: true, message: 'Please enter investigation number' }]}
          >
            <Input placeholder="INV-2025-001" />
          </Form.Item>

          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Please enter title' }]}
          >
            <Input placeholder="Investigation title" />
          </Form.Item>

          <Form.Item name="related_employee" label="Related Employee">
            <Select placeholder="Select employee" allowClear showSearch filterOption={(input, option: any) =>
              (option?.children?.toLowerCase() || '').includes(input.toLowerCase())
            }>
              {employees?.map((emp: any) => (
                <Select.Option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} ({emp.employee_code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              placeholder="Link to case study"
              showSearch
              optionFilterProp="label"
              options={caseStudyOptions}
              allowClear
            />
          </Form.Item>

          <Form.Item name="investigator" label="Investigator">
            <Input placeholder="Investigator name" />
          </Form.Item>

          <Form.Item name="investigation_date" label="Investigation Date">
            <Input type="date" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="INITIATED">Initiated</Select.Option>
              <Select.Option value="IN_PROGRESS">In Progress</Select.Option>
              <Select.Option value="COMPLETED">Completed</Select.Option>
              <Select.Option value="CLOSED">Closed</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Investigation description" />
          </Form.Item>

          <Form.Item name="findings" label="Findings">
            <Input.TextArea rows={2} placeholder="Investigation findings" />
          </Form.Item>

          <Form.Item name="observations" label="Observations">
            <Input.TextArea rows={2} placeholder="Observations" />
          </Form.Item>

          <Form.Item name="conclusion_of_scene" label="Conclusion of Scene">
            <Input.TextArea rows={2} placeholder="Scene conclusion" />
          </Form.Item>

          <Form.Item label="Supporting Documents">
            <Upload
              fileList={editFileList}
              onChange={({ fileList }) => setEditFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`Investigation ${viewingRecord?.investigation_number} - Details`}
        onClose={() => setViewDrawerOpen(false)}
        open={viewDrawerOpen}
        width={600}
        closeIcon={
          <button
            type="button"
            aria-label="Close investigation details"
            onClick={() => setViewDrawerOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ✕
          </button>
        }
      >
        {viewingRecord && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <strong>Investigation #:</strong> {viewingRecord.investigation_number}
            </div>
            <div>
              <strong>Title:</strong> {viewingRecord.title || '-'}
            </div>
            <div>
              <strong>Employee:</strong> {viewingRecord.related_employee_name || '-'}
            </div>
            <div>
              <strong>Case #:</strong> {viewingRecord.case_number || '-'}
            </div>
            <div>
              <strong>Investigator:</strong> {viewingRecord.investigator || '-'}
            </div>
            <div>
              <strong>Date:</strong> {viewingRecord.investigation_date ? new Date(viewingRecord.investigation_date).toLocaleDateString() : '-'}
            </div>
            <div>
              <strong>Status:</strong> <Tag color="blue">{viewingRecord.status || 'INITIATED'}</Tag>
            </div>
            <div>
              <strong>Description:</strong>
              <p>{viewingRecord.description || '-'}</p>
            </div>
            <div>
              <strong>Findings:</strong>
              <p>{viewingRecord.findings || '-'}</p>
            </div>
            <div>
              <strong>Observations:</strong>
              <p>{viewingRecord.observations || '-'}</p>
            </div>
            <div>
              <strong>Conclusion:</strong>
              <p>{viewingRecord.conclusion_of_scene || '-'}</p>
            </div>
            {viewingRecord.supporting_documents && (
              <div>
                <strong>Document:</strong>{' '}
                <a href={viewingRecord.supporting_documents} target="_blank" rel="noreferrer">
                  Download
                </a>
              </div>
            )}
            <Space>
              <Button
                type="primary"
                onClick={() => {
                  setViewDrawerOpen(false);
                  handleEdit(viewingRecord);
                }}
              >
                Edit
              </Button>
              <Button
                danger
                onClick={() => {
                  setViewDrawerOpen(false);
                  Modal.confirm({
                    title: 'Delete Investigation',
                    content: 'Are you sure you want to delete this investigation?',
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    cancelText: 'Cancel',
                    onOk: () => deleteMutation.mutate(viewingRecord.id),
                  });
                }}
              >
                Delete
              </Button>
            </Space>
          </div>
        )}
      </Drawer>
    </div>
  );
}
