import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MobileTable from '../../components/MobileTable';
import { Tag, Space, Button, Modal, Form, Input, Select, message, Drawer, Collapse, Badge, Upload, Card, Row, Col } from 'antd';
import { EyeOutlined, PlusOutlined, FileAddOutlined, UploadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import http from '../../lib/http';
import { createCaseStudy, updateHearing, updateInvestigation, updateReport } from '../../api/activities';
import { exportCaseStudyToPDF, exportHearingToPDF, exportInvestigationToPDF, exportReportToPDF } from '../../lib/pdfExport';
import { HeroBanner } from '../../components/HeroBanner';

interface CaseStudy {
  id: number;
  case_number: string;
  related_report?: number;
  related_report_number?: string;
  related_employee?: number;
  related_employee_name?: string;
  status: string;
  verdict?: string;
  hearings_count?: number;
  investigations_count?: number;
  charges_text?: string;
  final_verdict_text?: string;
  sanctions_imposed?: string;
  appeal_status?: string;
  created_at: string;
}

export default function CaseStudies() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [pendingFilters, setPendingFilters] = useState<{ case_number?: string; status?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ case_number?: string; status?: string }>({});

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ queryKey: ['case-studies'] });
      queryClient.removeQueries({ queryKey: ['employees-list'] });
      queryClient.removeQueries({ queryKey: ['reports'] });
      queryClient.removeQueries({ queryKey: ['hearings'] });
      queryClient.removeQueries({ queryKey: ['investigations'] });
      queryClient.removeQueries({ queryKey: ['charges'] });
    };

    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['case-studies', appliedFilters, workspaceId],
    queryFn: async () => {
      const allData = (await http.get('/api/v1/activities/case-studies/')).data;
      const casesArray = allData?.results ?? allData ?? [];
      return {
        results: (casesArray || []).filter((c: CaseStudy) => {
          if (appliedFilters.case_number && !(c.case_number?.toLowerCase().includes(appliedFilters.case_number.toLowerCase()))) return false;
          if (appliedFilters.status && c.status !== appliedFilters.status) return false;
          return true;
        })
      };
    },
    enabled: !!workspaceId,
  });

  const [form] = Form.useForm();
  const [createForm] = Form.useForm();
  const [modalVisible, setModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseStudy | null>(null);
  const [editingRecord, setEditingRecord] = useState<CaseStudy | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [caseFileList, setCaseFileList] = useState<any[]>([]);
  const selectedActivityType = Form.useWatch('activity_type', form);

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

  const { data: reports } = useQuery({
    queryKey: ['reports', workspaceId],
    queryFn: async () => (await http.get('/api/v1/activities/reports/')).data,
    enabled: !!workspaceId,
  });

  const { data: hearings = [] } = useQuery({
    queryKey: ['hearings', workspaceId],
    queryFn: async () => (await http.get('/api/v1/activities/hearings/', { params: { page_size: 200 } })).data,
    enabled: !!workspaceId,
  });

  const { data: investigations = [] } = useQuery({
    queryKey: ['investigations', workspaceId],
    queryFn: async () => (await http.get('/api/v1/activities/investigations/', { params: { page_size: 200 } })).data,
    enabled: !!workspaceId,
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['charges', workspaceId],
    queryFn: async () => (await http.get('/api/v1/activities/charges/', { params: { page_size: 200 } })).data,
    enabled: !!workspaceId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => http.delete(`/api/v1/activities/case-studies/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-studies'] });
      message.success('Case study deleted');
    },
    onError: () => message.error('Failed to delete case study'),
  });

  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (caseFileList.length > 0 && caseFileList[0].originFileObj) {
        formData.append('charges_document', caseFileList[0].originFileObj as File);
      }
      return createCaseStudy(formData as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-studies'] });
      message.success('Case study created successfully');
      setCreateModalVisible(false);
      createForm.resetFields();
      setCaseFileList([]);
    },
    onError: () => {
      message.error('Failed to create case study');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) formData.append(k, v);
      });
      if (caseFileList.length > 0 && caseFileList[0].originFileObj) {
        formData.append('charges_document', caseFileList[0].originFileObj as File);
      }
      return http.patch(`/api/v1/activities/case-studies/${id}/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-studies'] });
      message.success('Case study updated successfully');
      setCreateModalVisible(false);
      createForm.resetFields();
      setCaseFileList([]);
      setEditingRecord(null);
    },
    onError: () => {
      message.error('Failed to update case study');
    },
  });

  const handleCreate = async (values: any) => {
    const payload = {
      case_number: values.case_number,
      related_report: values.related_report,
      related_employee: values.related_employee,
      status: values.status,
      verdict: values.verdict,
      charges_text: values.charges_text,
      final_verdict_text: values.final_verdict_text,
      sanctions_imposed: values.sanctions_imposed,
      appeal_status: values.appeal_status,
      case_closed_date: values.case_closed_date,
    };
    createMutation.mutate(payload);
  };

  const handleEdit = (record: CaseStudy) => {
    setEditingRecord(record);
    createForm.setFieldsValue({
      case_number: record.case_number,
      related_report: record.related_report,
      related_employee: record.related_employee,
      status: record.status,
      verdict: record.verdict,
      charges_text: record.charges_text,
      final_verdict_text: record.final_verdict_text,
      sanctions_imposed: record.sanctions_imposed,
      appeal_status: record.appeal_status,
      case_closed_date: record.case_closed_date,
    });
    setCaseFileList([]);
    setCreateModalVisible(true);
  };

  const handleSubmitForm = async (values: any) => {
    const payload = {
      case_number: values.case_number,
      related_report: values.related_report,
      related_employee: values.related_employee,
      status: values.status,
      verdict: values.verdict,
      charges_text: values.charges_text,
      final_verdict_text: values.final_verdict_text,
      sanctions_imposed: values.sanctions_imposed,
      appeal_status: values.appeal_status,
      case_closed_date: values.case_closed_date,
    };

    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.id, values: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const rows: CaseStudy[] = data?.results ?? data ?? [];

  const allReports = reports?.results ?? reports ?? [];
  const allHearings = hearings?.results ?? hearings ?? [];
  const allInvestigations = investigations?.results ?? investigations ?? [];
  const allCharges = charges?.results ?? charges ?? [];

  const linkedReports = selectedCase
    ? allReports.filter((r: any) => r.case_study === selectedCase.id)
    : [];
  const linkedHearings = selectedCase
    ? allHearings.filter((h: any) => h.case_study === selectedCase.id)
    : [];
  const linkedInvestigations = selectedCase
    ? allInvestigations.filter((i: any) => i.case_study === selectedCase.id)
    : [];
  const linkedCharges = selectedCase
    ? allCharges.filter((c: any) => c.case_study === selectedCase.id)
    : [];

  const handleAddActivity = async (values: any) => {
    try {
      if (!selectedCase) {
        message.error('Select a case study first');
        return;
      }
      if (values.activity_type === 'hearing' && values.hearing_id) {
        await updateHearing(values.hearing_id, { case_study: selectedCase.id });
      }
      if (values.activity_type === 'investigation' && values.investigation_id) {
        await updateInvestigation(values.investigation_id, { case_study: selectedCase.id });
      }
      if (values.activity_type === 'report' && values.report_id) {
        await updateReport(values.report_id, { case_study: selectedCase.id });
      }
      if (values.activity_type === 'charge' && values.charge_id) {
        await http.patch(`/api/v1/activities/charges/${values.charge_id}/`, { case_study: selectedCase.id });
      }
      queryClient.invalidateQueries({ queryKey: ['case-studies'] });
      queryClient.invalidateQueries({ queryKey: ['hearings'] });
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['charges'] });
      message.success(`${values.activity_type} linked to case ${selectedCase.case_number}`);
      setModalVisible(false);
      form.resetFields();
    } catch (error) {
      message.error('Failed to add activity');
    }
  };

  const openActivityModal = (caseStudy: CaseStudy) => {
    setSelectedCase(caseStudy);
    setModalVisible(true);
  };

  const openCaseDetail = (caseStudy: CaseStudy) => {
    setSelectedCase(caseStudy);
    setDrawerVisible(true);
  };

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Activities"
        title="Discipline & Activities"
        description="Manage employee discipline case studies, hearings, investigations, and related activities."
        icon={<FileText className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
        gradient="neutral"
        tags={[
          { label: 'Case Studies', variant: 'neutral' },
          { label: 'Hearings', variant: 'cyan' },
          { label: 'Investigations', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
            Add Case Study
          </Button>
        )}
      />

      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
          marginBottom: '24px'
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Row gutter={16}>
            <Col xs={24} sm={12} lg={8}>
              <Input
                placeholder="Search by case number..."
                value={pendingFilters.case_number || ''}
                onChange={(e) => setPendingFilters({ ...pendingFilters, case_number: e.target.value })}
              />
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Select
                placeholder="Filter by status"
                allowClear
                value={pendingFilters.status || undefined}
                onChange={(value) => setPendingFilters({ ...pendingFilters, status: value })}
                options={[
                  { value: 'OPENED', label: 'Opened' },
                  { value: 'UNDER_REVIEW', label: 'Under Review' },
                  { value: 'HEARING_PENDING', label: 'Hearing Pending' },
                  { value: 'INVESTIGATION_PENDING', label: 'Investigation Pending' },
                  { value: 'VERDICT_PENDING', label: 'Verdict Pending' },
                  { value: 'CLOSED', label: 'Closed' },
                ]}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Button
                type="primary"
                onClick={() => setAppliedFilters(pendingFilters)}
                style={{ width: '100%', background: '#f5c400', borderColor: '#f5c400', color: '#05060a', fontWeight: 600 }}
              >
                Search
              </Button>
            </Col>
          </Row>
          <Button
            onClick={() => {
              setPendingFilters({});
              setAppliedFilters({});
            }}
            style={{ width: '100%' }}
          >
            Reset Filters
          </Button>
        </Space>
      </Card>

      <MobileTable
        loading={isLoading}
        dataSource={rows}
        rowKey={(r: CaseStudy) => r.id}
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid rgba(245, 196, 0, 0.15)',
        }}
        columns={[
          {
            title: 'Actions',
            key: 'actions',
            width: 120,
            fixed: 'left' as const,
            render: (_, record: CaseStudy) => (
              <Space size="small">
                <EyeOutlined
                  onClick={() => openCaseDetail(record)}
                  style={{ cursor: 'pointer', color: '#0ea5e9' }}
                />
                <FileAddOutlined
                  onClick={() => openActivityModal(record)}
                  style={{ cursor: 'pointer', color: '#f59e0b' }}
                />
                <EditOutlined
                  onClick={() => handleEdit(record)}
                  style={{ cursor: 'pointer', color: '#52c41a' }}
                />
                <DeleteOutlined
                  onClick={() => {
                    Modal.confirm({
                      title: 'Delete Case Study',
                      content: 'Are you sure you want to delete this case study?',
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
          { title: 'Case #', dataIndex: 'case_number', render: (num: string) => <a>{num}</a> },
          { title: 'Report #', dataIndex: 'related_report_number', render: (num?: string) => num || '-' },
          { title: 'Employee', dataIndex: 'related_employee_name', render: (name?: string) => name || '-' },
          { title: 'Created', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleDateString() },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: string) => (
              <Tag color={s === 'CLOSED' ? 'green' : s === 'OPENED' ? 'blue' : 'orange'}>{s?.toUpperCase?.() || '-'}</Tag>
            ),
          },
          { title: 'Verdict', dataIndex: 'verdict', render: (v?: string) => v || 'PENDING' },
        ]}
      />

      {/* Add Activity Modal */}
      <Modal
        title={`Add Activity to Case ${selectedCase?.case_number}`}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={600}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddActivity}
        >
          <Form.Item
            name="activity_type"
            label="Activity Type"
            rules={[{ required: true, message: 'Please select activity type' }]}
          >
            <Select placeholder="Select what to add">
              <Select.Option value="hearing">Schedule Hearing</Select.Option>
              <Select.Option value="investigation">Start Investigation</Select.Option>
              <Select.Option value="charge">File Charge Sheet</Select.Option>
              <Select.Option value="report">Submit Report</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="details"
            label="Details"
            rules={[{ required: true, message: 'Please provide details' }]}
          >
            <Input.TextArea placeholder="Enter relevant details" rows={3} />
          </Form.Item>

          {selectedActivityType === 'hearing' && (
            <Form.Item
              name="hearing_id"
              label="Select Hearing"
              rules={[{ required: true, message: 'Select a hearing to link' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select hearing"
                options={(hearings?.results ?? hearings ?? []).map((h: any) => ({ value: h.id, label: h.hearing_number }))}
              />
            </Form.Item>
          )}

          {selectedActivityType === 'investigation' && (
            <Form.Item
              name="investigation_id"
              label="Select Investigation"
              rules={[{ required: true, message: 'Select an investigation to link' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select investigation"
                options={(investigations?.results ?? investigations ?? []).map((i: any) => ({ value: i.id, label: i.investigation_number }))}
              />
            </Form.Item>
          )}

          {selectedActivityType === 'report' && (
            <Form.Item
              name="report_id"
              label="Select Report"
              rules={[{ required: true, message: 'Select a report to link' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select report"
                options={(reports?.results ?? reports ?? []).map((r: any) => ({ value: r.id, label: r.report_number }))}
              />
            </Form.Item>
          )}

          {selectedActivityType === 'charge' && (
            <Form.Item
              name="charge_id"
              label="Select Charge"
              rules={[{ required: true, message: 'Select a charge to link' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select charge"
                options={(charges?.results ?? charges ?? []).map((c: any) => ({ value: c.id, label: `${c.employee_name || 'Employee'} - ${String(c.id)}` }))}
              />
            </Form.Item>
          )}

          <Form.Item name="date" label="Date">
            <Input type="date" />
          </Form.Item>

          <Form.Item name="assigned_to" label="Assigned To">
            <Select
              placeholder="Assign to staff member"
              showSearch
              optionFilterProp="label"
              options={(employees || []).map((emp: any) => ({
                value: emp.id,
                label: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Case Study Modal */}
      <Modal
        title={editingRecord ? `Edit Case ${editingRecord.case_number}` : 'Create Case Study'}
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
          setCaseFileList([]);
          setEditingRecord(null);
        }}
        onOk={() => createForm.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleSubmitForm}>
          <Form.Item
            name="case_number"
            label="Case Number"
            rules={[{ required: true, message: 'Please enter case number' }]}
          >
            <Input placeholder="CS-2025-001" />
          </Form.Item>

          <Form.Item
            name="related_report"
            label="Related Report"
            rules={[{ required: true, message: 'Please select a report' }]}
          >
            <Select placeholder="Link to a report" allowClear showSearch filterOption={(input, option: any) =>
              (option?.children?.toLowerCase() || '').includes(input.toLowerCase())
            }>
              {(reports?.results ?? reports ?? []).map((report: any) => (
                <Select.Option key={report.id} value={report.id}>
                  {report.report_number} - {report.title}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="related_employee" label="Related Employee" rules={[{ required: true, message: 'Please select an employee' }]}>
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

          <Form.Item name="status" label="Status" rules={[{ required: true, message: 'Please select status' }]}>
            <Select placeholder="Select status">
              <Select.Option value="OPENED">Opened</Select.Option>
              <Select.Option value="UNDER_REVIEW">Under Review</Select.Option>
              <Select.Option value="HEARING_PENDING">Hearing Pending</Select.Option>
              <Select.Option value="INVESTIGATION_PENDING">Investigation Pending</Select.Option>
              <Select.Option value="VERDICT_PENDING">Verdict Pending</Select.Option>
              <Select.Option value="CLOSED">Closed</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="verdict" label="Verdict">
            <Select placeholder="Select verdict">
              <Select.Option value="PENDING">Pending</Select.Option>
              <Select.Option value="GUILTY">Guilty</Select.Option>
              <Select.Option value="NOT_GUILTY">Not Guilty</Select.Option>
              <Select.Option value="SETTLED">Settled</Select.Option>
              <Select.Option value="DISMISSED">Dismissed</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="charges_text" label="Charges">
            <Input.TextArea placeholder="Description of charges" rows={3} />
          </Form.Item>

          <Form.Item name="final_verdict_text" label="Final Verdict Notes">
            <Input.TextArea rows={3} placeholder="Verdict notes (optional)" />
          </Form.Item>

          <Form.Item name="sanctions_imposed" label="Sanctions Imposed">
            <Input.TextArea rows={2} placeholder="Sanctions (if any)" />
          </Form.Item>

          <Form.Item name="appeal_status" label="Appeal Status">
            <Select placeholder="Appeal status">
              <Select.Option value="PENDING">Pending</Select.Option>
              <Select.Option value="UPHELD">Upheld</Select.Option>
              <Select.Option value="OVERTURNED">Overturned</Select.Option>
              <Select.Option value="WITHDRAWN">Withdrawn</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="case_closed_date" label="Case Closed Date">
            <Input type="date" />
          </Form.Item>

          <Form.Item label="Charge Sheet Document">
            <Upload
              fileList={caseFileList}
              onChange={({ fileList }) => setCaseFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Upload Charge Sheet</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Case Detail Drawer */}
      <Drawer
        title={`Case ${selectedCase?.case_number} - Details`}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        width={600}
        closeIcon={
          <button
            type="button"
            aria-label="Close case details"
            onClick={() => setDrawerVisible(false)}
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
        {selectedCase && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h4>Case Information</h4>
              <p><strong>Report #:</strong> {selectedCase.related_report_number || '-'}</p>
              <p><strong>Employee:</strong> {selectedCase.related_employee_name || '-'}</p>
              <p><strong>Status:</strong> <Tag color="blue">{selectedCase.status?.toUpperCase?.() || '-'}</Tag></p>
              <p><strong>Verdict:</strong> {selectedCase.verdict || 'PENDING'}</p>
              <p><strong>Created:</strong> {new Date(selectedCase.created_at).toLocaleDateString()}</p>
            </div>

            <h4 style={{ marginBottom: 16 }}>Case Notes</h4>
            <p><strong>Charges:</strong> {selectedCase.charges_text || '-'}</p>
            <p><strong>Allegations:</strong> {selectedCase.allegations || '-'}</p>
            <p><strong>Plea:</strong> {selectedCase.plea || '-'}</p>
            <p><strong>Statement:</strong> {selectedCase.statement || '-'}</p>
            <p><strong>Sanctions:</strong> {selectedCase.sanctions_imposed || '-'}</p>
            <p><strong>Appeal Status:</strong> {selectedCase.appeal_status || '-'}</p>
            <p><strong>Final Verdict Notes:</strong> {selectedCase.final_verdict_text || '-'}</p>
            <p><strong>Case Closed Date:</strong> {selectedCase.case_closed_date || '-'}</p>
            <p><strong>Charge Sheet:</strong> {selectedCase.charges_document ? <a href={selectedCase.charges_document} target="_blank">Download</a> : '-'}</p>

            <h4 style={{ marginBottom: 16 }}>Linked Activities</h4>
            <Collapse
              items={[
                {
                  key: 'hearings',
                  label: <Badge count={linkedHearings.length}><span>Hearings</span></Badge>,
                  children: (
                    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
                      {linkedHearings.length === 0 ? 'No hearings linked.' : linkedHearings.map((h: any) => (
                        <div key={h.id} style={{ border: '1px solid rgba(245, 196, 0, 0.15)', borderRadius: 8, padding: 12 }}>
                          <div><strong>Hearing #:</strong> {h.hearing_number}</div>
                          <div><strong>Date:</strong> {h.hearing_date || '-'}</div>
                          <div><strong>Status:</strong> {h.status || '-'}</div>
                          <div><strong>Charges:</strong> {h.charges || '-'}</div>
                          <div><strong>Findings:</strong> {h.committee_findings || '-'}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            {h.hearing_document && <a href={h.hearing_document} target="_blank">Download</a>}
                            <Button size="small" onClick={() => exportHearingToPDF(h)}>PDF</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'investigations',
                  label: <Badge count={linkedInvestigations.length}><span>Investigations</span></Badge>,
                  children: (
                    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
                      {linkedInvestigations.length === 0 ? 'No investigations linked.' : linkedInvestigations.map((i: any) => (
                        <div key={i.id} style={{ border: '1px solid rgba(245, 196, 0, 0.15)', borderRadius: 8, padding: 12 }}>
                          <div><strong>Investigation #:</strong> {i.investigation_number}</div>
                          <div><strong>Title:</strong> {i.title || '-'}</div>
                          <div><strong>Status:</strong> {i.status || '-'}</div>
                          <div><strong>Investigator:</strong> {i.investigator || '-'}</div>
                          <div><strong>Findings:</strong> {i.findings || '-'}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            {i.supporting_documents && <a href={i.supporting_documents} target="_blank">Download</a>}
                            <Button size="small" onClick={() => exportInvestigationToPDF(i)}>PDF</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'reports',
                  label: <Badge count={linkedReports.length}><span>Reports</span></Badge>,
                  children: (
                    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
                      {linkedReports.length === 0 ? 'No reports linked.' : linkedReports.map((r: any) => (
                        <div key={r.id} style={{ border: '1px solid rgba(245, 196, 0, 0.15)', borderRadius: 8, padding: 12 }}>
                          <div><strong>Report #:</strong> {r.report_number}</div>
                          <div><strong>Title:</strong> {r.title || '-'}</div>
                          <div><strong>Status:</strong> {r.status || '-'}</div>
                          <div><strong>Severity:</strong> {r.severity || '-'}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            {r.attachments && <a href={r.attachments} target="_blank">Download</a>}
                            <Button size="small" onClick={() => exportReportToPDF(r)}>PDF</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'charges',
                  label: <Badge count={linkedCharges.length}><span>Charges</span></Badge>,
                  children: (
                    <div style={{ padding: 8, display: 'grid', gap: 12 }}>
                      {linkedCharges.length === 0 ? 'No charges linked.' : linkedCharges.map((c: any) => (
                        <div key={c.id} style={{ border: '1px solid rgba(245, 196, 0, 0.15)', borderRadius: 8, padding: 12 }}>
                          <div><strong>Employee:</strong> {c.employee_name || '-'}</div>
                          <div><strong>Status:</strong> {c.status || '-'}</div>
                          <div><strong>Allegations:</strong> {c.allegations || '-'}</div>
                          <div><strong>Plea:</strong> {c.plea || '-'}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            {c.charges_document && <a href={c.charges_document} target="_blank">Download</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
