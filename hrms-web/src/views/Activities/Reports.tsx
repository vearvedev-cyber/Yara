import { Button, Tag, Space, Form, Input, Select, message, Upload, DatePicker, Card } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, DownloadOutlined, FilePdfOutlined, UploadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listReports, createReport } from '../../api/activities';
import { exportReportToPDF } from '../../lib/pdfExport';
import dayjs from 'dayjs';
import http from '../../lib/http';
import { HeroBanner } from '../../components/HeroBanner';

export default function Reports() {
  const qc = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);
  const [editFileList, setEditFileList] = useState<any[]>([]);
  const [editingRecord, setEditingRecord] = useState<any>(null);

  // Listen for workspace changes
  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      qc.removeQueries({ queryKey: ['reports'] });
      qc.removeQueries({ queryKey: ['case-studies-min'] });
      qc.removeQueries({ queryKey: ['report-types'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [qc]);

  // Filters
  const [pendingFilters, setPendingFilters] = useState<{ employee?: string; type?: string; search?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ employee?: string; type?: string; search?: string }>({});

  const { data: reports = [], isLoading, refetch: refetchReports } = useQuery({
    queryKey: ['reports', workspaceId, appliedFilters],
    queryFn: async () => {
      const params: any = {};
      if (appliedFilters.employee) params.reported_by = appliedFilters.employee;
      if (appliedFilters.type) params.report_type = appliedFilters.type;
      if (appliedFilters.search) params.search = appliedFilters.search;

      try {
        const res = await listReports();
        return (Array.isArray(res) ? res : res?.data || []).filter((r: any) => {
          if (appliedFilters.search && !r.report_number?.includes(appliedFilters.search) && !r.title?.toLowerCase().includes(appliedFilters.search.toLowerCase())) return false;
          return true;
        });
      } catch {
        return [];
      }
    },
    enabled: !!workspaceId,
  });

  const { data: reportTypes = [] } = useQuery({
    queryKey: ['report-types', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/activities/report-types/');
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
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

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const employeeOptions = useMemo(
    () => (employees || []).map((employee: any) => ({
      value: employee.id,
      label: `${employee.employee_id || employee.employee_code || 'EMP'} - ${employee.full_name || `${employee.first_name} ${employee.last_name}`}`,
    })),
    [employees],
  );
  const caseStudyOptions = useMemo(
    () => (caseStudies || []).map((c: any) => ({ value: c.id, label: c.case_number })),
    [caseStudies],
  );

  const reportTypeOptions = (reportTypes?.length ? reportTypes : [
    { id: 'SAFETY', name: 'SAFETY' },
    { id: 'COMPLAINT', name: 'COMPLAINT' },
    { id: 'GRIEVANCE', name: 'GRIEVANCE' },
    { id: 'DISCIPLINARY', name: 'DISCIPLINARY' },
  ]).map((t: any) => ({ value: t.id, label: t.name }));

  const createMut = useMutation({
    mutationFn: async (payload: any) => createReport(payload),
    onSuccess: async () => {
      message.success('Report created');
      setCreateOpen(false);
      form.resetFields();
      setFileList([]);
      qc.invalidateQueries({ queryKey: ['reports'], exact: false });
      await refetchReports();
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      if (data && typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ');
        message.error(`Failed to create report: ${msgs}`);
      } else {
        message.error('Failed to create report');
      }
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: FormData }) => {
      return (await http.patch(`/api/v1/activities/reports/${id}/`, payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      message.success('Report updated');
      setEditOpen(false);
      editForm.resetFields();
      setEditFileList([]);
      setEditingRecord(null);
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      if (data && typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ');
        message.error(`Failed to update report: ${msgs}`);
      } else {
        message.error('Failed to update report');
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => http.delete(`/api/v1/activities/reports/${id}/`),
    onSuccess: () => {
      message.success('Report deleted');
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: () => message.error('Failed to delete report'),
  });

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      report_number: record.report_number,
      report_type: record.report_type_detail?.id || record.report_type,
      reported_by: record.reported_by,
      case_study: record.case_study,
      title: record.title,
      description: record.description,
      incident_date: record.incident_date ? dayjs(record.incident_date) : null,
      severity: record.severity,
    });
    setEditFileList([]);
    setEditOpen(true);
  };

  const handleEditSubmit = (vals: any) => {
    if (!editingRecord) return;
    const fd = new FormData();
    Object.entries(vals).forEach(([k, v]: any) => {
      if (v === undefined || v === null) return;
      if (typeof v === 'object' && typeof v.format === 'function') {
        fd.append(k, v.format('YYYY-MM-DD'));
        return;
      }
      fd.append(k, v as any);
    });
    if (editFileList.length > 0 && editFileList[0].originFileObj) {
      fd.append('attachments', editFileList[0].originFileObj as File);
    }
    updateMut.mutate({ id: editingRecord.id, payload: fd });
  };

  const rows = useMemo(() => {
    return (Array.isArray(reports) ? reports : []).map((r: any, idx: number) => ({
      ...r,
      key: r.id || idx,
      sn: idx + 1,
    }));
  }, [reports]);

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
            onClick={() => exportReportToPDF(record)}
          />
          <DeleteOutlined
            style={{ cursor: 'pointer', color: '#ff4d4f' }}
            onClick={() => {
              Modal.confirm({
                title: 'Delete Report',
                content: `Delete report ${record.report_number}?`,
                okText: 'Delete',
                okType: 'danger',
                onOk: () => deleteMut.mutate(record.id),
              });
            }}
          />
        </Space>
      ),
    },
    { title: 'S/No', dataIndex: 'sn', width: 70 },
    { title: 'Report #', dataIndex: 'report_number', key: 'report_number' },
    { title: 'Case #', dataIndex: 'case_number', key: 'case_number', render: (v: string) => v || '-' },
    { title: 'Type', dataIndex: 'report_type_detail', key: 'report_type', render: (t: any, r: any) => t?.name || r.report_type || '-' },
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Reported By', dataIndex: 'reported_by_name', key: 'reported_by_name' },
    { title: 'Date', dataIndex: 'created_at', key: 'created_at', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'CLOSED' ? 'green' : status === 'SUBMITTED' ? 'blue' : 'orange'}>
          {status}
        </Tag>
      )
    },
    {
      title: 'Download',
      key: 'download',
      render: (_: any, record: any) => (
        <Space>
          {record.attachments && (
            <Button type="link" icon={<DownloadOutlined />} size="small" href={record.attachments} target="_blank">File</Button>
          )}
          <Button
            type="link"
            icon={<FilePdfOutlined />}
            size="small"
            onClick={() => exportReportToPDF(record)}
          >
            PDF
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Activities"
        title="Reports"
        description="Capture safety, complaint, and disciplinary reports with searchable records and attachments."
        gradient="neutral"
        tags={[
          { label: 'Incident Logs', variant: 'neutral' },
          { label: 'Report Types', variant: 'cyan' },
          { label: 'Attachments', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Create Report
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
            placeholder="Search by report #"
            value={pendingFilters.search || ''}
            onChange={(e) => setPendingFilters({ ...pendingFilters, search: e.target.value })}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            allowClear
            placeholder="Filter by type"
            style={{ width: 180 }}
            value={pendingFilters.type || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, type: val })}
            options={reportTypeOptions}
          />
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

      {/* Reports Table */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
        }}
        bodyStyle={{ padding: '16px' }}
      >
        <MobileTable columns={columns} dataSource={rows} loading={isLoading} rowKey="id" scroll={{ x: 1600 }} style={{ color: '#f7f8fb' }} />
      </Card>

      {/* View Report Modal */}
      <Modal
        title="Report Details"
        open={viewModalOpen}
        onCancel={() => setViewModalOpen(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        {viewingRecord && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><strong>Report #:</strong> {viewingRecord.report_number}</div>
            <div><strong>Type:</strong> {viewingRecord.report_type_detail?.name || viewingRecord.report_type}</div>
            <div><strong>Title:</strong> {viewingRecord.title}</div>
            <div><strong>Case #:</strong> {viewingRecord.case_number || '-'}</div>
            <div><strong>Reported By:</strong> {viewingRecord.reported_by_name}</div>
            <div><strong>Date:</strong> {dayjs(viewingRecord.created_at).format('YYYY-MM-DD')}</div>
            <div><strong>Status:</strong> {viewingRecord.status}</div>
            {viewingRecord.description && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Description:</strong>
                <p>{viewingRecord.description}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="Edit Report"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          editForm.resetFields();
          setEditFileList([]);
          setEditingRecord(null);
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item name="report_number" label="Report Number" rules={[{ required: true }]}>
            <Input placeholder="e.g., RPT-2025-001" />
          </Form.Item>
          <Form.Item name="report_type" label="Type" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={reportTypeOptions}
              placeholder="Select report type"
            />
          </Form.Item>
          <Form.Item name="reported_by" label="Reported By">
            <Select
              showSearch
              optionFilterProp="label"
              options={employeeOptions}
              placeholder="Select the reporting employee"
              allowClear
            />
          </Form.Item>
          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              showSearch
              optionFilterProp="label"
              options={caseStudyOptions}
              placeholder="Link to case study"
              allowClear
            />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="incident_date" label="Incident Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="severity" label="Severity">
            <Select>
              <Select.Option value="LOW">Low</Select.Option>
              <Select.Option value="MEDIUM">Medium</Select.Option>
              <Select.Option value="HIGH">High</Select.Option>
              <Select.Option value="CRITICAL">Critical</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Attachment">
            <Upload
              fileList={editFileList}
              onChange={({ fileList }) => setEditFileList(fileList || [])}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Create Report"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(vals) => {
          const fd = new FormData();
          Object.entries(vals).forEach(([k, v]: any) => {
            if (v === undefined || v === null) return;
            if (k === 'report_number' && !String(v).trim()) return; // let backend auto-generate
            if (typeof v === 'object' && typeof v.format === 'function') {
              fd.append(k, v.format('YYYY-MM-DD'));
              return;
            }
            fd.append(k, v as any);
          });
          if (fileList.length > 0 && fileList[0].originFileObj) {
            fd.append('attachments', fileList[0].originFileObj as File);
          }
          createMut.mutate(fd as any);
        }}>
          <Form.Item name="report_number" label="Report Number (auto-generated if left blank)">
            <Input placeholder="e.g., RPT-2026-03-001 (leave blank to auto-generate)" />
          </Form.Item>
          <Form.Item name="report_type" label="Type" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={reportTypeOptions}
              placeholder="Select report type"
            />
          </Form.Item>
          <Form.Item name="reported_by" label="Reported By">
            <Select
              showSearch
              optionFilterProp="label"
              options={employeeOptions}
              placeholder="Select the reporting employee"
              allowClear
            />
          </Form.Item>
          <Form.Item name="case_study" label="Case Study (optional)">
            <Select
              showSearch
              optionFilterProp="label"
              options={caseStudyOptions}
              placeholder="Link to case study"
              allowClear
            />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="incident_date" label="Incident Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="severity" label="Severity">
            <Select>
              <Select.Option value="LOW">Low</Select.Option>
              <Select.Option value="MEDIUM">Medium</Select.Option>
              <Select.Option value="HIGH">High</Select.Option>
              <Select.Option value="CRITICAL">Critical</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Attachment">
            <Upload fileList={fileList} onChange={({ fileList }) => setFileList(fileList)} beforeUpload={() => false} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
