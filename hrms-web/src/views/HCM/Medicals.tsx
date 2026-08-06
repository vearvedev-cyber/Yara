import { Button, Tag, Space, Modal, Form, Input, Select, DatePicker, message, Upload, Card } from 'antd';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EditOutlined, ExclamationCircleOutlined, EyeOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useEffect } from 'react';
import http from '../../lib/http';
import dayjs from 'dayjs';
import { HeroBanner } from '../../components/HeroBanner';

export default function Medicals() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['medicals'] });
      queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['medicals'] });
    queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
  }, [workspaceId, queryClient]);

  const getUploadFile = (value: any) => {
    if (!value) return null;
    if (Array.isArray(value)) {
      return value[0]?.originFileObj || value[0]?.file || null;
    }
    return value?.originFileObj || value?.file || null;
  };

  // Filter states
  const [pendingFilters, setPendingFilters] = useState<{ employee?: string; type?: string; status?: string; expiry?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ employee?: string; type?: string; status?: string; expiry?: string }>({});

  const { data: medicals, isLoading } = useQuery({
    queryKey: ['medicals', workspaceId, appliedFilters],
    queryFn: async () => {
      const params: any = {};
      if (appliedFilters.employee) params.search = appliedFilters.employee;
      if (appliedFilters.type) params.medical_type = appliedFilters.type;
      if (appliedFilters.status) params.status = appliedFilters.status;
      const res = await http.get('/api/v1/tracking/medicals/', { params: { page_size: 500, ...params } });
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

  const { data: medicalTypes } = useQuery({
    queryKey: ['medical-types'],
    queryFn: async () => {
      const res = await http.get('/api/v1/tracking/medical-types/');
      return res.data?.results || res.data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const formData = new FormData();
      Object.keys(values).forEach((key) => {
        if (key === 'report_document') {
          const file = getUploadFile(values[key]);
          if (file) formData.append(key, file);
        } else if (values[key] !== undefined && values[key] !== null) {
          formData.append(key, values[key]);
        }
      });
      return (await http.post('/api/v1/tracking/medicals/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicals'] });
      message.success('Medical record created successfully');
      setIsModalOpen(false);
      form.resetFields();
      setEditingRecord(null);
    },
    onError: () => {
      message.error('Failed to create medical record');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const formData = new FormData();
      Object.keys(values).forEach((key) => {
        if (key === 'report_document') {
          const file = getUploadFile(values[key]);
          if (file) formData.append(key, file);
        } else if (values[key] !== undefined && values[key] !== null) {
          formData.append(key, values[key]);
        }
      });
      return (await http.patch(`/api/v1/tracking/medicals/${id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicals'] });
      message.success('Medical record updated successfully');
      setIsModalOpen(false);
      form.resetFields();
      setEditingRecord(null);
    },
    onError: () => {
      message.error('Failed to update medical record');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await http.delete(`/api/v1/tracking/medicals/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicals'] });
      message.success('Medical record deleted');
    },
    onError: () => message.error('Failed to delete record'),
  });

  const handleSubmit = async (values: any) => {
    const formattedValues = {
      ...values,
      scheduled_date: values.scheduled_date ? dayjs(values.scheduled_date).format('YYYY-MM-DD') : undefined,
      completion_date: values.completion_date ? dayjs(values.completion_date).format('YYYY-MM-DD') : undefined,
      issue_date: values.issue_date ? dayjs(values.issue_date).format('YYYY-MM-DD') : undefined,
      expiry_date: values.expiry_date ? dayjs(values.expiry_date).format('YYYY-MM-DD') : undefined,
    };

    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.id, values: formattedValues });
    } else {
      createMutation.mutate(formattedValues);
    }
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    form.setFieldsValue({
      ...record,
      scheduled_date: record.scheduled_date ? dayjs(record.scheduled_date) : null,
      completion_date: record.completion_date ? dayjs(record.completion_date) : null,
      issue_date: record.issue_date ? dayjs(record.issue_date) : null,
      expiry_date: record.expiry_date ? dayjs(record.expiry_date) : null,
      report_document: [], // Reset to empty array for Upload component
    });
    setIsModalOpen(true);
  };

  // Check if expiry date is near (within 30 days)
  const isExpiringsoon = (expiryDate: string) => {
    if (!expiryDate) return false;
    const today = dayjs();
    const expiry = dayjs(expiryDate);
    const daysUntilExpiry = expiry.diff(today, 'day');
    return daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
  };

  // Check if already expired
  const isExpired = (expiryDate: string) => {
    if (!expiryDate) return false;
    return dayjs(expiryDate).isBefore(dayjs());
  };

  const rows = useMemo(() => {
    let data = (medicals || []).map((m: any, idx: number) => ({
      ...m,
      key: m.id || idx,
    }));

    if (appliedFilters.expiry) {
      data = data.filter((m: any) => {
        const exp = m.expiry_date;
        if (appliedFilters.expiry === 'EXPIRED') return isExpired(exp);
        if (appliedFilters.expiry === 'EXPIRING_SOON') return !isExpired(exp) && isExpiringsoon(exp);
        if (appliedFilters.expiry === 'VALID') return exp && !isExpired(exp) && !isExpiringsoon(exp);
        if (appliedFilters.expiry === 'NO_EXPIRY') return !exp;
        return true;
      });
    }

    return data.map((m: any, idx: number) => ({ ...m, sn: idx + 1 }));
  }, [medicals, appliedFilters.expiry]);

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
          <DeleteOutlined
            style={{ cursor: 'pointer', color: '#ff4d4f' }}
            onClick={() => {
              Modal.confirm({
                title: 'Delete Medical Record',
                content: `Delete medical record for ${record.employee}?`,
                okText: 'Delete',
                okType: 'danger',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
          />
        </Space>
      ),
    },
    {
      title: 'S/No',
      dataIndex: 'sn',
      width: 70,
    },
    {
      title: 'Employee',
      dataIndex: 'employee_name',
      key: 'employee_name',
      render: (_: any, record: any) => record.employee_name || '-'
    },
    {
      title: 'Medical Type',
      dataIndex: 'medical_type_name',
      key: 'medical_type_name',
      render: (_: any, record: any) => record.medical_type_name || record.medical_type_detail?.name || '-'
    },
    {
      title: 'Scheduled Date',
      dataIndex: 'scheduled_date',
      key: 'scheduled_date',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : '-'
    },
    {
      title: 'Completion Date',
      dataIndex: 'completion_date',
      key: 'completion_date',
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : '-'
    },
    {
      title: 'Facility',
      dataIndex: 'facility',
      key: 'facility',
      render: (f: string) => f || '-'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'CLEARED' ? 'green' : status === 'COMPLETED' ? 'blue' : status === 'RESTRICTED' || status === 'NOT_CLEARED' ? 'red' : 'orange'}>
          {status?.toUpperCase() || 'SCHEDULED'}
        </Tag>
      )
    },
    {
      title: 'Clearance',
      dataIndex: 'clearance_status',
      key: 'clearance_status',
      render: (status: string) => status || '-'
    },
    {
      title: 'Expiry Date',
      dataIndex: 'expiry_date',
      key: 'expiry_date',
      render: (date: string) => {
        if (!date) return '-';
        const expired = isExpired(date);
        const expiringSoon = isExpiringsoon(date);
        if (expired) {
          return (
            <Tag icon={<ExclamationCircleOutlined />} color="error">
              {dayjs(date).format('YYYY-MM-DD')} (EXPIRED)
            </Tag>
          );
        }
        if (expiringSoon) {
          return (
            <Tag icon={<ExclamationCircleOutlined />} color="warning">
              {dayjs(date).format('YYYY-MM-DD')} (Due Soon)
            </Tag>
          );
        }
        return dayjs(date).format('YYYY-MM-DD');
      }
    },
    {
      title: 'Document',
      dataIndex: 'report_document',
      key: 'report_document',
      render: (doc: string) => doc ? (
        <Button
          type="link"
          size="small"
          icon={<DownloadOutlined />}
          href={doc}
          target="_blank"
        >
          Download
        </Button>
      ) : '-'
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Health & Safety"
        title="Medical Management"
        description="Track employee medical examinations, outcomes, and test expiry dates across the workforce."
        gradient="neutral"
        tags={[
          { label: 'Examinations', variant: 'neutral' },
          { label: 'Clearance Status', variant: 'cyan' },
          { label: 'Expiry Tracking', variant: 'lime' },
        ]}
        actions={(
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRecord(null);
              form.resetFields();
              setIsModalOpen(true);
            }}
          >
            Add Medical Record
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
          <Input
            placeholder="Filter by medical type"
            value={pendingFilters.type || ''}
            onChange={(e) => setPendingFilters({ ...pendingFilters, type: e.target.value })}
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
            <Select.Option value="SCHEDULED">Scheduled</Select.Option>
            <Select.Option value="COMPLETED">Completed</Select.Option>
            <Select.Option value="CLEARED">Cleared</Select.Option>
            <Select.Option value="RESTRICTED">Restricted</Select.Option>
            <Select.Option value="NOT_CLEARED">Not Cleared</Select.Option>
          </Select>
          <Select
            allowClear
            placeholder="Filter by expiry"
            style={{ width: 180 }}
            value={pendingFilters.expiry || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, expiry: val })}
          >
            <Select.Option value="EXPIRED">Expired</Select.Option>
            <Select.Option value="EXPIRING_SOON">Expiring Soon (30 days)</Select.Option>
            <Select.Option value="VALID">Valid</Select.Option>
            <Select.Option value="NO_EXPIRY">No Expiry Date</Select.Option>
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

      {/* Medical Records Table */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <MobileTable
          loading={isLoading}
          dataSource={rows}
          rowKey="id"
          columns={columns}
          scroll={{ x: 1800 }}
          style={{ color: '#f7f8fb' }}
        />
      </Card>

      {/* View Medical Record Modal */}
      <Modal
        title="Medical Record Details"
        open={viewModalOpen}
        onCancel={() => setViewModalOpen(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {viewingRecord && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><strong>Employee:</strong> {viewingRecord.employee_name}</div>
            <div><strong>Medical Type:</strong> {viewingRecord.medical_type_name}</div>
            <div><strong>Scheduled Date:</strong> {viewingRecord.scheduled_date ? dayjs(viewingRecord.scheduled_date).format('YYYY-MM-DD') : '-'}</div>
            <div><strong>Completion Date:</strong> {viewingRecord.completion_date ? dayjs(viewingRecord.completion_date).format('YYYY-MM-DD') : '-'}</div>
            <div><strong>Facility:</strong> {viewingRecord.facility}</div>
            <div><strong>Status:</strong> {viewingRecord.status}</div>
            <div><strong>Clearance:</strong> {viewingRecord.clearance_status}</div>
            <div><strong>Issue Date:</strong> {viewingRecord.issue_date ? dayjs(viewingRecord.issue_date).format('YYYY-MM-DD') : '-'}</div>
            <div><strong>Expiry Date:</strong> {viewingRecord.expiry_date ? dayjs(viewingRecord.expiry_date).format('YYYY-MM-DD') : '-'}</div>
            <div><strong>Restrictions:</strong> {viewingRecord.restrictions || '-'}</div>
            {viewingRecord.report_document && (
              <div>
                <strong>Document:</strong>{' '}
                <a href={viewingRecord.report_document} target="_blank" rel="noreferrer">
                  Download
                </a>
              </div>
            )}
            {viewingRecord.findings && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Findings:</strong>
                <p>{viewingRecord.findings}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={editingRecord ? 'Edit Medical Record' : 'Add Medical Record'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
          setEditingRecord(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={650}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select
              placeholder="Select employee"
              showSearch
              filterOption={(input, option: any) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={employees?.map((emp: any) => ({
                value: emp.id,
                label: `${emp.first_name} ${emp.last_name} (${emp.employee_id})`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="medical_type"
            label="Medical Type"
            rules={[{ required: true, message: 'Please enter medical type' }]}
          >
            <Input placeholder="Enter medical type (e.g., Silicosis, Physical Examination)" />
          </Form.Item>

          <Form.Item name="scheduled_date" label="Scheduled Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="completion_date" label="Completion Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="facility" label="Facility" rules={[{ required: true }]}>
            <Input placeholder="Medical facility name" />
          </Form.Item>

          <Form.Item name="status" label="Status">
            <Select placeholder="Select status">
              <Select.Option value="SCHEDULED">Scheduled</Select.Option>
              <Select.Option value="COMPLETED">Completed</Select.Option>
              <Select.Option value="CLEARED">Cleared</Select.Option>
              <Select.Option value="RESTRICTED">Restricted</Select.Option>
              <Select.Option value="NOT_CLEARED">Not Cleared</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="clearance_status" label="Clearance Status">
            <Input placeholder="e.g., Cleared, Referred, Failed" />
          </Form.Item>

          <Form.Item name="issue_date" label="Issue Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="expiry_date" label="Expiry Date">
            <DatePicker style={{ width: '100%' }} placeholder="When the test expires" />
          </Form.Item>

          <Form.Item name="restrictions" label="Work Restrictions">
            <Input.TextArea rows={2} placeholder="Any work restrictions from this medical" />
          </Form.Item>

          <Form.Item name="findings" label="Medical Findings">
            <Input.TextArea rows={3} placeholder="Details of medical findings" />
          </Form.Item>

          <Form.Item
            name="report_document"
            label="Medical Report Document"
            valuePropName="fileList"
            getValueFromEvent={(e) => e?.fileList || []}
            normalize={(value) => (value && Array.isArray(value) ? value : [])}
          >
            <Upload maxCount={1} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" beforeUpload={() => false}>
              <Button>Upload Report</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
