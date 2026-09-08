import { Button, Tag, Space, Modal, Form, Input, Select, message, Upload, Drawer } from 'antd';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, FilePdfOutlined, UploadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { listHearings, createHearing } from '../../api/activities';
import http from '../../lib/http';
import { exportHearingToPDF } from '../../lib/pdfExport';
import { HeroBanner } from '../../components/HeroBanner';

export default function Hearings() {
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
      queryClient.removeQueries({ queryKey: ['hearings'] });
      queryClient.removeQueries({ queryKey: ['employees-list'] });
      queryClient.removeQueries({ queryKey: ['case-studies-min'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Filter states
  const [pendingName, setPendingName] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pendingHearingNumber, setPendingHearingNumber] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ name: string; status: string | null; hearing_number: string }>({
    name: '',
    status: null,
    hearing_number: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['hearings', workspaceId],
    queryFn: () => listHearings(),
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
    mutationFn: createHearing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hearings'] });
      message.success('Hearing scheduled successfully');
      setIsModalOpen(false);
      form.resetFields();
      setFileList([]);
    },
    onError: () => {
      message.error('Failed to schedule hearing');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (editFileList.length > 0 && editFileList[0].originFileObj) {
        formData.append('hearing_document', editFileList[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/activities/hearings/${id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hearings'] });
      message.success('Hearing updated successfully');
      setEditModalOpen(false);
      editForm.resetFields();
      setEditFileList([]);
      setEditingRecord(null);
    },
    onError: () => {
      message.error('Failed to update hearing');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await http.delete(`/api/v1/activities/hearings/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hearings'] });
      message.success('Hearing deleted successfully');
    },
    onError: () => message.error('Failed to delete hearing'),
  });

  const handleCreate = async (values: any) => {
    const formData = new FormData();
    Object.entries(values).forEach(([k, v]: any) => {
      if (v !== undefined && v !== null) formData.append(k, v);
    });
    if (fileList.length > 0 && fileList[0].originFileObj) {
      formData.append('hearing_document', fileList[0].originFileObj as File);
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
      hearing_number: record.hearing_number,
      related_employee: record.related_employee,
      case_study: record.case_study,
      hearing_date: record.hearing_date,
      status: record.status,
      committee_members: record.committee_members,
      chairperson: record.chairperson,
      charges: record.charges,
      employee_statement: record.employee_statement,
      committee_findings: record.committee_findings,
      recommendations: record.recommendations,
      sanctions: record.sanctions,
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
    const matchesName = appliedFilters.name
      ? (record.related_employee_name || '').toLowerCase().includes(appliedFilters.name.toLowerCase())
      : true;
    const matchesStatus = appliedFilters.status ? record.status === appliedFilters.status : true;
    const matchesHearingNumber = appliedFilters.hearing_number
      ? (record.hearing_number || '').toLowerCase().includes(appliedFilters.hearing_number.toLowerCase())
      : true;
    return matchesName && matchesStatus && matchesHearingNumber;
  });

  const columns = [
    { title: 'Hearing #', dataIndex: 'hearing_number', key: 'hearing_number' },
    { title: 'Case #', dataIndex: 'case_number', key: 'case_number', render: (v: string) => v || '-' },
    {
      title: 'Employee',
      dataIndex: 'related_employee_name',
      key: 'related_employee_name',
      render: (_: any, record: any) => record.related_employee_name || '-'
    },
    {
      title: 'Date',
      dataIndex: 'hearing_date',
      key: 'hearing_date',
      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: any = { CONCLUDED: 'green', SCHEDULED: 'blue', HELD: 'orange', ADJOURNED: 'purple' };
        return <Tag color={colorMap[status] || 'default'}>{status || 'SCHEDULED'}</Tag>;
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
            onClick={() => exportHearingToPDF(record)}
            style={{ cursor: 'pointer', color: '#10b981' }}
          />
          <DeleteOutlined
            onClick={() => {
              Modal.confirm({
                title: 'Delete Hearing',
                content: 'Are you sure you want to delete this hearing?',
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
        title="Hearings"
        description="Schedule, document, and track disciplinary hearings from planning through conclusion."
        gradient="neutral"
        tags={[
          { label: 'Hearings Calendar', variant: 'neutral' },
          { label: 'Committee Notes', variant: 'cyan' },
          { label: 'Outcomes', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            Schedule Hearing
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
            placeholder="Search by employee name"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Input
            placeholder="Search by hearing #"
            value={pendingHearingNumber}
            onChange={(e) => setPendingHearingNumber(e.target.value)}
            allowClear
            style={{ width: 180 }}
          />
          <Select
            allowClear
            placeholder="Filter by status"
            value={pendingStatus || undefined}
            onChange={(val) => setPendingStatus(val || null)}
            style={{ width: 180 }}
            options={[
              { label: 'SCHEDULED', value: 'SCHEDULED' },
              { label: 'HELD', value: 'HELD' },
              { label: 'ADJOURNED', value: 'ADJOURNED' },
              { label: 'CONCLUDED', value: 'CONCLUDED' },
            ]}
          />
          <Button
            type="primary"
            onClick={() => setAppliedFilters({ name: pendingName, status: pendingStatus, hearing_number: pendingHearingNumber })}
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
              setPendingName('');
              setPendingStatus(null);
              setPendingHearingNumber('');
              setAppliedFilters({ name: '', status: null, hearing_number: '' });
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
        title="Schedule Hearing"
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
            name="hearing_number"
            label="Hearing Number"
            rules={[{ required: true, message: 'Please enter hearing number' }]}
          >
            <Input placeholder="H-2025-001" />
          </Form.Item>

          <Form.Item
            name="related_employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select placeholder="Select employee" showSearch filterOption={(input, option: any) =>
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

          <Form.Item
            name="hearing_date"
            label="Hearing Date"
            rules={[{ required: true, message: 'Please select date' }]}
          >
            <Input type="date" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="SCHEDULED">Scheduled</Select.Option>
              <Select.Option value="HELD">Held</Select.Option>
              <Select.Option value="ADJOURNED">Adjourned</Select.Option>
              <Select.Option value="CONCLUDED">Concluded</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="committee_members" label="Committee Members">
            <Input.TextArea rows={2} placeholder="Names of committee members" />
          </Form.Item>
          <Form.Item name="chairperson" label="Chairperson">
            <Input placeholder="Chairperson name" />
          </Form.Item>
          <Form.Item name="charges" label="Charges" rules={[{ required: true, message: 'Please enter charges' }]}>
            <Input.TextArea rows={3} placeholder="Charges" />
          </Form.Item>
          <Form.Item name="employee_statement" label="Employee Statement">
            <Input.TextArea rows={2} placeholder="Employee statement" />
          </Form.Item>
          <Form.Item name="committee_findings" label="Committee Findings">
            <Input.TextArea rows={2} placeholder="Findings" />
          </Form.Item>
          <Form.Item name="recommendations" label="Recommendations">
            <Input.TextArea rows={2} placeholder="Recommendations" />
          </Form.Item>
          <Form.Item name="sanctions" label="Sanctions">
            <Input.TextArea rows={2} placeholder="Sanctions (if any)" />
          </Form.Item>
          <Form.Item label="Hearing Document">
            <Upload fileList={fileList} onChange={({ fileList }) => setFileList(fileList)} beforeUpload={() => false} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Hearing Modal */}
      <Modal
        title="Edit Hearing"
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
            name="hearing_number"
            label="Hearing Number"
            rules={[{ required: true, message: 'Please enter hearing number' }]}
          >
            <Input placeholder="H-2025-001" />
          </Form.Item>

          <Form.Item
            name="related_employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select placeholder="Select employee" showSearch filterOption={(input, option: any) =>
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

          <Form.Item
            name="hearing_date"
            label="Hearing Date"
            rules={[{ required: true, message: 'Please select date' }]}
          >
            <Input type="date" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="SCHEDULED">Scheduled</Select.Option>
              <Select.Option value="HELD">Held</Select.Option>
              <Select.Option value="ADJOURNED">Adjourned</Select.Option>
              <Select.Option value="CONCLUDED">Concluded</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="committee_members" label="Committee Members">
            <Input.TextArea rows={2} placeholder="Names of committee members" />
          </Form.Item>
          <Form.Item name="chairperson" label="Chairperson">
            <Input placeholder="Chairperson name" />
          </Form.Item>
          <Form.Item name="charges" label="Charges" rules={[{ required: true, message: 'Please enter charges' }]}>
            <Input.TextArea rows={3} placeholder="Charges" />
          </Form.Item>
          <Form.Item name="employee_statement" label="Employee Statement">
            <Input.TextArea rows={2} placeholder="Employee statement" />
          </Form.Item>
          <Form.Item name="committee_findings" label="Committee Findings">
            <Input.TextArea rows={2} placeholder="Findings" />
          </Form.Item>
          <Form.Item name="recommendations" label="Recommendations">
            <Input.TextArea rows={2} placeholder="Recommendations" />
          </Form.Item>
          <Form.Item name="sanctions" label="Sanctions">
            <Input.TextArea rows={2} placeholder="Sanctions (if any)" />
          </Form.Item>
          <Form.Item label="Hearing Document">
            <Upload fileList={editFileList} onChange={({ fileList }) => setEditFileList(fileList)} beforeUpload={() => false} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload Document</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* View Hearing Drawer */}
      <Drawer
        title={`Hearing ${viewingRecord?.hearing_number} - Details`}
        onClose={() => setViewDrawerOpen(false)}
        open={viewDrawerOpen}
        width={600}
        closeIcon={
          <button
            type="button"
            aria-label="Close hearing details"
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
              <strong>Hearing #:</strong> {viewingRecord.hearing_number}
            </div>
            <div>
              <strong>Employee:</strong> {viewingRecord.related_employee_name || '-'}
            </div>
            <div>
              <strong>Case #:</strong> {viewingRecord.case_number || '-'}
            </div>
            <div>
              <strong>Date:</strong> {viewingRecord.hearing_date ? new Date(viewingRecord.hearing_date).toLocaleDateString() : '-'}
            </div>
            <div>
              <strong>Status:</strong> <Tag color="blue">{viewingRecord.status || 'SCHEDULED'}</Tag>
            </div>
            <div>
              <strong>Chairperson:</strong> {viewingRecord.chairperson || '-'}
            </div>
            <div>
              <strong>Committee Members:</strong> {viewingRecord.committee_members || '-'}
            </div>
            <div>
              <strong>Charges:</strong>
              <p>{viewingRecord.charges || '-'}</p>
            </div>
            <div>
              <strong>Employee Statement:</strong>
              <p>{viewingRecord.employee_statement || '-'}</p>
            </div>
            <div>
              <strong>Committee Findings:</strong>
              <p>{viewingRecord.committee_findings || '-'}</p>
            </div>
            <div>
              <strong>Recommendations:</strong>
              <p>{viewingRecord.recommendations || '-'}</p>
            </div>
            <div>
              <strong>Sanctions:</strong>
              <p>{viewingRecord.sanctions || '-'}</p>
            </div>
            {viewingRecord.hearing_document && (
              <div>
                <strong>Document:</strong>{' '}
                <a href={viewingRecord.hearing_document} target="_blank" rel="noreferrer">
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
                    title: 'Delete Hearing',
                    content: 'Are you sure you want to delete this hearing?',
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
      </Drawer>    </div>
  );
}