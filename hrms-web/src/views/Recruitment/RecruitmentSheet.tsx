import { Button, Modal, Form, Input, DatePicker, message, Row, Col, Select, Upload, Drawer, Card, Space, InputNumber } from 'antd';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TagPill } from '../../components/NeonPrimitives';
import { recruitmentApi, type Candidate as ApiCandidate } from '../../api/services/recruitmentApi';
import http from '../../lib/http';
import dayjs from 'dayjs';
import { exportCandidateToPDF } from '../../lib/pdfExport';
import { HeroBanner } from '../../components/HeroBanner';

interface RecruitmentData {
  id: number;
  engagedDate: string;
  candidateName: string;
  nrc: string;
  phoneNumber: string;
  position: string;
  accommodation: string;
  scheduledDate: string;
  status: 'Pipeline' | 'Onboarded' | 'Rejected';
}

export default function RecruitmentSheet() {
  const [form] = Form.useForm();
  const [modalVisible, setModalVisible] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [editFileList, setEditFileList] = useState<any[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<ApiCandidate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<ApiCandidate | null>(null);
  const [pendingFilters, setPendingFilters] = useState<{ position?: string; status?: string; search?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ position?: string; status?: string; search?: string }>({});
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ queryKey: ['recruitment-candidates'] });
      queryClient.removeQueries({ queryKey: ['jobs-all'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['recruitment-candidates', workspaceId, appliedFilters],
    enabled: !!workspaceId,
    queryFn: async () => {
      const allData = await recruitmentApi.listCandidates({ page_size: 200 });
      return (allData || []).filter((c: ApiCandidate) => {
        if (appliedFilters.position && c.position !== appliedFilters.position) return false;
        if (appliedFilters.status && c.status !== appliedFilters.status) return false;
        if (appliedFilters.search) {
          const searchLower = appliedFilters.search.toLowerCase();
          if (!c.name.toLowerCase().includes(searchLower) &&
            !c.position.toLowerCase().includes(searchLower) &&
            !(c.nrc || '').toLowerCase().includes(searchLower)) {
            return false;
          }
        }
        return true;
      });
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs-all', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/jobs/', { params: { page_size: 500 } });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
  });

  const rows: RecruitmentData[] = (candidates || []).map((c: ApiCandidate) => ({
    id: c.id,
    engagedDate: c.engaged_date,
    candidateName: c.name,
    nrc: c.nrc || '',
    phoneNumber: c.phone_number || '',
    position: c.position,
    accommodation: c.accommodation || 'N/A',
    scheduledDate: c.interview_due_date || '',
    status: c.status || 'Pipeline',
  }));

  const createMutation = useMutation({
    mutationFn: (payload: FormData) => recruitmentApi.createCandidate(payload),
    onSuccess: () => {
      message.success('Recruitment record added');
      setModalVisible(false);
      form.resetFields();
      setFileList([]);
      queryClient.invalidateQueries({ queryKey: ['recruitment-candidates'] });
    },
    onError: () => message.error('Failed to add recruitment record'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: FormData }) => http.patch(`/api/v1/recruitment/candidates/${id}/`, payload, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    onSuccess: () => {
      message.success('Candidate updated');
      setModalVisible(false);
      setEditingCandidate(null);
      form.resetFields();
      setEditFileList([]);
      queryClient.invalidateQueries({ queryKey: ['recruitment-candidates'] });
    },
    onError: () => message.error('Failed to update candidate'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recruitmentApi.deleteCandidate(id),
    onSuccess: () => {
      message.success('Candidate deleted');
      queryClient.invalidateQueries({ queryKey: ['recruitment-candidates'] });
    },
    onError: () => message.error('Failed to delete candidate'),
  });

  const handleAddRecord = async (values: any) => {
    const payload = new FormData();
    payload.append('engaged_date', values.engagedDate.format('YYYY-MM-DD'));
    payload.append('name', values.candidateName);
    payload.append('nrc', values.nrc || '');
    payload.append('phone_number', values.phoneNumber || '');
    payload.append('position', values.position);
    payload.append('accommodation', values.accommodation || 'N/A');
    payload.append('interview_remarks', values.interviewRemarks || '');
    if (values.knowledgeScore !== undefined && values.knowledgeScore !== null) {
      payload.append('knowledge_score', String(values.knowledgeScore));
    }
    if (values.experienceScore !== undefined && values.experienceScore !== null) {
      payload.append('experience_score', String(values.experienceScore));
    }
    if (values.qualificationScore !== undefined && values.qualificationScore !== null) {
      payload.append('qualification_score', String(values.qualificationScore));
    }
    if (values.scheduledDate) {
      payload.append('interview_due_date', values.scheduledDate.format('YYYY-MM-DD'));
    }
    payload.append('status', values.status || 'Pipeline');
    const files = editingCandidate ? editFileList : fileList;
    files.forEach((file) => {
      if (file.originFileObj) {
        payload.append('documents', file.originFileObj as File);
      }
    });
    if (editingCandidate) {
      updateMutation.mutate({ id: editingCandidate.id, payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const columns = [
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      fixed: 'left' as const,
      render: (_: any, record: RecruitmentData) => (
        <Space size="small">
          <EyeOutlined
            onClick={() => {
              const candidate = (candidates || []).find((c: ApiCandidate) => c.id === record.id) || null;
              setSelectedCandidate(candidate);
              setDrawerOpen(true);
            }}
            style={{ cursor: 'pointer', color: '#0ea5e9' }}
          />
          <EditOutlined
            onClick={() => {
              const candidate = (candidates || []).find((c: ApiCandidate) => c.id === record.id) || null;
              if (candidate) {
                setEditingCandidate(candidate);
                setModalVisible(true);
                form.setFieldsValue({
                  engagedDate: candidate.engaged_date ? dayjs(candidate.engaged_date) : null,
                  candidateName: candidate.name,
                  nrc: candidate.nrc || '',
                  phoneNumber: candidate.phone_number || '',
                  position: candidate.position,
                  accommodation: candidate.accommodation || 'N/A',
                  interviewRemarks: candidate.interview_remarks || '',
                  knowledgeScore: candidate.knowledge_score ?? undefined,
                  experienceScore: candidate.experience_score ?? undefined,
                  qualificationScore: candidate.qualification_score ?? undefined,
                  scheduledDate: candidate.interview_due_date ? dayjs(candidate.interview_due_date) : null,
                  status: candidate.status || 'Pipeline',
                });
                setEditFileList([]);
              }
            }}
            style={{ cursor: 'pointer', color: '#f59e0b' }}
          />
          <FilePdfOutlined
            onClick={() => {
              const candidate = (candidates || []).find((c: ApiCandidate) => c.id === record.id) || null;
              if (candidate) {
                exportCandidateToPDF(candidate);
              }
            }}
            style={{ cursor: 'pointer', color: '#10b981' }}
          />
          <DeleteOutlined
            onClick={() => {
              Modal.confirm({
                title: 'Delete Candidate',
                content: 'Are you sure you want to delete this candidate?',
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
    { title: 'Engaged Date', dataIndex: 'engagedDate', key: 'engagedDate', width: 120 },
    { title: 'Candidate Name', dataIndex: 'candidateName', key: 'candidateName', width: 150 },
    { title: 'NRC', dataIndex: 'nrc', key: 'nrc', width: 120 },
    { title: 'Phone Number', dataIndex: 'phoneNumber', key: 'phoneNumber', width: 130 },
    { title: 'Position', dataIndex: 'position', key: 'position', width: 150 },
    { title: 'Accommodation', dataIndex: 'accommodation', key: 'accommodation', width: 110 },
    { title: 'Scheduled Date', dataIndex: 'scheduledDate', key: 'scheduledDate', width: 120 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const variants: { [key: string]: 'gold' | 'cyan' | 'lime' | 'amber' | 'pink' | 'neutral' } = {
          Pipeline: 'cyan',
          Onboarded: 'lime',
          Rejected: 'pink',
        };
        return <TagPill variant={variants[status] || 'neutral'}>{status.toUpperCase()}</TagPill>;
      },
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Recruitment"
        title="Recruitment Data Sheet"
        description="Manage recruitment records, interviews, and candidate status progression from pipeline to onboarding."
        gradient="neutral"
        tags={[
          { label: 'Candidate Pipeline', variant: 'neutral' },
          { label: 'Interview Readiness', variant: 'cyan' },
          { label: 'Hiring Outcomes', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            Add Candidate
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
            <Col xs={24} sm={12} lg={6}>
              <Select
                placeholder="Filter by position"
                allowClear
                value={pendingFilters.position || undefined}
                onChange={(value) => setPendingFilters({ ...pendingFilters, position: value })}
                options={(jobs || []).map((j: any) => ({ value: j.title, label: j.title }))}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Select
                placeholder="Filter by status"
                allowClear
                value={pendingFilters.status || undefined}
                onChange={(value) => setPendingFilters({ ...pendingFilters, status: value })}
                options={[
                  { value: 'Pipeline', label: 'Pipeline' },
                  { value: 'Onboarded', label: 'Onboarded' },
                  { value: 'Rejected', label: 'Rejected' },
                ]}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Input
                placeholder="Search by name, NRC, or position..."
                value={pendingFilters.search || ''}
                onChange={(e) => setPendingFilters({ ...pendingFilters, search: e.target.value })}
              />
            </Col>
            <Col xs={24} sm={12} lg={4}>
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
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        rowKey="id"
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 10 }}
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid rgba(245, 196, 0, 0.15)',
        }}
      />

      <Modal
        title={editingCandidate ? 'Edit Recruitment Record' : 'Add Recruitment Record'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingCandidate(null);
          setFileList([]);
          setEditFileList([]);
        }}
        onOk={() => form.submit()}
        width={800}
      >
        <Form form={form} layout="vertical" onFinish={handleAddRecord}>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="engagedDate"
                label="Engaged Date"
                rules={[{ required: true }]}
              >
                <DatePicker />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="candidateName"
                label="Candidate Name"
                rules={[{ required: true }]}
              >
                <Input placeholder="Full name" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="nrc"
                label="NRC"
                rules={[{ required: true }]}
              >
                <Input placeholder="NRC number" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="phoneNumber"
                label="Phone Number"
                rules={[{ required: true }]}
              >
                <Input placeholder="+260 9..." />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="position"
                label="Position"
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  placeholder="Select position"
                  optionFilterProp="label"
                  options={(jobs || []).map((j: any) => ({ value: j.title, label: j.title }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="Pipeline">Pipeline</Select.Option>
                  <Select.Option value="Onboarded">Onboarded</Select.Option>
                  <Select.Option value="Rejected">Rejected</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="accommodation"
                label="Accommodation"
              >
                <Input placeholder="Accommodation (optional)" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="scheduledDate"
                label="Scheduled Date"
                rules={[{ required: true }]}
              >
                <DatePicker />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                name="knowledgeScore"
                label="Knowledge Score (%)"
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="0-100" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                name="experienceScore"
                label="Experience Score (%)"
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="0-100" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                name="qualificationScore"
                label="Qualification Score (%)"
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="0-100" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="interviewRemarks"
            label="Interview Remarks"
          >
            <Input.TextArea rows={3} placeholder="Interview notes / candidate assessment" />
          </Form.Item>

          <Form.Item label="Documents">
            <Upload
              multiple
              fileList={editingCandidate ? editFileList : fileList}
              onChange={({ fileList }) => {
                if (editingCandidate) {
                  setEditFileList(fileList);
                } else {
                  setFileList(fileList);
                }
              }}
              beforeUpload={() => false}
            >
              <Button icon={<PlusOutlined />}>Upload Documents</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={selectedCandidate ? `Candidate: ${selectedCandidate.name}` : 'Candidate'}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        size="large"
      >
        {selectedCandidate && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div><strong>Engaged Date:</strong> {selectedCandidate.engaged_date}</div>
            <div><strong>NRC:</strong> {selectedCandidate.nrc || '-'}</div>
            <div><strong>Phone:</strong> {selectedCandidate.phone_number || '-'}</div>
            <div><strong>Position:</strong> {selectedCandidate.position}</div>
            <div><strong>Accommodation:</strong> {selectedCandidate.accommodation || '-'}</div>
            <div><strong>Knowledge Score:</strong> {selectedCandidate.knowledge_score !== null && selectedCandidate.knowledge_score !== undefined ? `${selectedCandidate.knowledge_score}%` : '-'}</div>
            <div><strong>Experience Score:</strong> {selectedCandidate.experience_score !== null && selectedCandidate.experience_score !== undefined ? `${selectedCandidate.experience_score}%` : '-'}</div>
            <div><strong>Qualification Score:</strong> {selectedCandidate.qualification_score !== null && selectedCandidate.qualification_score !== undefined ? `${selectedCandidate.qualification_score}%` : '-'}</div>
            <div><strong>Interview Remarks:</strong> {selectedCandidate.interview_remarks || '-'}</div>
            <div><strong>Interview Due:</strong> {selectedCandidate.interview_due_date || '-'}</div>
            <div><strong>Status:</strong> {selectedCandidate.status}</div>
            <div>
              <strong>Documents:</strong>
              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                {(selectedCandidate.documents || []).length === 0 ? (
                  <span>No documents uploaded.</span>
                ) : (
                  (selectedCandidate.documents || []).map((doc: any) => (
                    <a key={doc.id} href={doc.document} target="_blank">
                      View document {doc.id}
                    </a>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
