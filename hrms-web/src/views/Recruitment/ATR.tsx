import { Table, Button, Form, Input, Select, DatePicker, message, Tag, Row, Col, InputNumber, Card, Space } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { recruitmentApi, type ATR as ApiATR } from '../../api/services/recruitmentApi';
import { exportAtrToPDF } from '../../lib/pdfExport';
import http from '../../lib/http';
import dayjs from 'dayjs';
import { HeroBanner } from '../../components/HeroBanner';

// ATR = Approval To Recruit: department request for labour, not candidate intake
interface ATRRequest {
  id: number;
  departmentId: number;
  department: string;
  role: string;
  hiringManager: string;
  requestedDate: string;
  reason: string;
  currentHeadcount: number;
  vacancies: number;
  status: 'pending' | 'approved' | 'rejected';
  approval_status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<{ detail?: string; message?: string }>;
  return axiosError.response?.data?.detail || axiosError.response?.data?.message || fallback;
}

export default function ATR() {
  const [form] = Form.useForm();
  const [modalVisible, setModalVisible] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageRecord, setManageRecord] = useState<ATRRequest | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<ATRRequest | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const selectedDepartment = Form.useWatch('department', form);
  const selectedRoles = Form.useWatch('role', form);

  // Position-specific data: { [position: string]: { currentHeadcount: number, vacancies: number } }
  const [positionData, setPositionData] = useState<Record<string, { currentHeadcount: number; vacancies: number }>>({});

  // Filters
  const [pendingFilters, setPendingFilters] = useState<{ department?: number; status?: string }>({});
  const [appliedFilters, setAppliedFilters] = useState<{ department?: number; status?: string }>({});

  const { data: atrsRaw = [], isLoading } = useQuery({
    queryKey: ['recruitment-atrs', appliedFilters],
    queryFn: async () => {
      const allData = await recruitmentApi.listATRs({ page_size: 200 });
      // Filter client-side
      return (allData || []).filter((atr: ApiATR) => {
        if (appliedFilters.department && atr.department !== appliedFilters.department) return false;
        if (appliedFilters.status) {
          const status = atr.approval_status?.toUpperCase() || 'PENDING';
          if (status !== appliedFilters.status.toUpperCase()) return false;
        }
        return true;
      });
    },
  });

  const [workspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', workspaceId, selectedDepartment],
    queryFn: async () => {
      const params = selectedDepartment ? { department: selectedDepartment, page_size: 200 } : { page_size: 200 };
      const res = await http.get('/api/v1/hcm/jobs/', { params });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const departmentMap = useMemo(() => {
    const map = new Map<number, string>();
    (departments || []).forEach((d: any) => map.set(d.id, d.name));
    return map;
  }, [departments]);

  const toUi = (atr: ApiATR): ATRRequest => {
    const statusMap: Record<string, ATRRequest['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
    };
    const status = atr.approval_status ? (statusMap[atr.approval_status] || 'pending') : (
      atr.hr_manager_signed_at && atr.ops_manager_signed_at && atr.director_signed_at ? 'approved' : 'pending'
    );
    const deptName = departmentMap.get(atr.department) || `Dept #${atr.department}`;
    return {
      id: atr.id,
      departmentId: atr.department,
      department: deptName,
      role: atr.position_title,
      hiringManager: atr.hiring_supervisor_name,
      requestedDate: atr.due_date || atr.created_at || '',
      reason: atr.notes || '',
      currentHeadcount: 0,
      vacancies: atr.roles_to_fill || 0,
      status,
      approval_status: atr.approval_status,
      hr_manager_signed_at: atr.hr_manager_signed_at,
      ops_manager_signed_at: atr.ops_manager_signed_at,
      director_signed_at: atr.director_signed_at,
    };
  };

  const rows = (atrsRaw || []).map(toUi);

  const createMutation = useMutation({
    mutationFn: (payload: Partial<ApiATR>) => recruitmentApi.createATR(payload),
    onSuccess: () => {
      message.success('ATR recorded');
      setModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['recruitment-atrs'] });
    },
    onError: () => message.error('Failed to record ATR'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ApiATR> }) => recruitmentApi.updateATR(id, payload),
    onSuccess: () => {
      message.success('ATR updated');
      queryClient.invalidateQueries({ queryKey: ['recruitment-atrs'] });
    },
    onError: () => message.error('Failed to update ATR'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recruitmentApi.deleteATR(id),
    onSuccess: () => {
      message.success('ATR deleted');
      queryClient.invalidateQueries({ queryKey: ['recruitment-atrs'] });
    },
    onError: (error) => message.error(getApiErrorMessage(error, 'Failed to delete ATR')),
  });

  const handleApprove = (record: ATRRequest) => {
    const today = new Date().toISOString().slice(0, 10);
    updateMutation.mutate({
      id: record.id,
      payload: {
        approval_status: 'APPROVED',
        hr_manager_signed_at: record.hr_manager_signed_at || today,
      },
    });
  };

  const handleReject = (record: ATRRequest) => {
    updateMutation.mutate({
      id: record.id,
      payload: {
        approval_status: 'REJECTED',
        hr_manager_signed_at: null,
        ops_manager_signed_at: null,
        director_signed_at: null,
      },
    });
  };

  const columns = useMemo(
    () => [
      {
        title: 'Actions',
        key: 'actions',
        width: 220,
        fixed: 'left' as const,
        render: (_: any, record: ATRRequest) => (
          <Space size="small">
            <Button
              type="link"
              onClick={() => {
                setManageRecord(record);
                setManageOpen(true);
              }}
            >
              Manage
            </Button>
            <EyeOutlined
              style={{ cursor: 'pointer', color: '#1890ff' }}
              onClick={() => {
                setViewRecord(record);
                setViewOpen(true);
              }}
            />
            <EditOutlined
              style={{ cursor: 'pointer', color: '#52c41a' }}
              onClick={() => {
                setEditingId(record.id);
                setModalVisible(true);
                form.setFieldsValue({
                  department: record.departmentId,
                  role: record.role,
                  hiringManager: record.hiringManager,
                  requestedDate: record.requestedDate ? dayjs(record.requestedDate) : null,
                  currentHeadcount: record.currentHeadcount ?? 0,
                  vacancies: record.vacancies,
                  reason: record.reason || '',
                });
              }}
            />
            <FilePdfOutlined
              style={{ cursor: 'pointer', color: '#10b981' }}
              onClick={() => exportAtrToPDF(record)}
            />
            <DeleteOutlined
              style={{ cursor: 'pointer', color: '#ff4d4f' }}
              onClick={() => {
                Modal.confirm({
                  title: 'Delete ATR',
                  content: 'Are you sure you want to delete this ATR request?',
                  okText: 'Delete',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  onOk: () => deleteMutation.mutate(record.id),
                });
              }}
            />
          </Space>
        ),
      },
      { title: 'S/N', dataIndex: 'id', key: 'id', width: 70 },
      { title: 'Department', dataIndex: 'department', key: 'department' },
      { title: 'Role', dataIndex: 'role', key: 'role' },
      { title: 'Hiring Manager', dataIndex: 'hiringManager', key: 'hiringManager' },
      { title: 'Requested On', dataIndex: 'requestedDate', key: 'requestedDate' },
      { title: 'Vacancies', dataIndex: 'vacancies', key: 'vacancies', width: 100 },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (status: ATRRequest['status']) => {
          const colors: Record<ATRRequest['status'], string> = {
            pending: 'gold',
            approved: 'green',
            rejected: 'red',
          };
          return <Tag color={colors[status]}>{status.toUpperCase()}</Tag>;
        },
      },
    ],
    [updateMutation]
  );

  const handleAddRequest = async (values: any) => {
    const roles = Array.isArray(values.role) ? values.role : [values.role];

    // Create an ATR for each selected role with their specific data
    const payloads = roles.map((role: string) => {
      const roleData = positionData[role] || { currentHeadcount: 0, vacancies: 0 };
      return {
        department: values.department,
        hiring_supervisor_name: values.hiringManager,
        position_title: role,
        roles_to_fill: roleData.vacancies,
        due_date: values.requestedDate?.format('YYYY-MM-DD'),
        notes: `Reason: ${values.reason || '-'} | Current HC: ${roleData.currentHeadcount}`,
      };
    });

    if (editingId) {
      // For editing, only support single role (keep existing behavior)
      updateMutation.mutate(
        { id: editingId, payload: payloads[0] },
        {
          onSuccess: () => {
            setModalVisible(false);
            setEditingId(null);
            form.resetFields();
            setPositionData({});
          },
        }
      );
      return;
    }

    // Create multiple ATRs if multiple roles selected
    let completed = 0;
    for (let i = 0; i < payloads.length; i++) {
      const reference_number = `ATR-${Date.now().toString().slice(-6)}-${i + 1}`;
      createMutation.mutate(
        { ...payloads[i], reference_number },
        {
          onSuccess: () => {
            completed++;
            if (completed === payloads.length) {
              // All ATRs created
              setModalVisible(false);
              form.resetFields();
              setPositionData({});
              message.success(`${payloads.length} ATR(s) created successfully`);
            }
          },
        }
      );
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Recruitment"
        title="Approval To Recruit (ATR)"
        description="Department labour request intake with role demand, current versus needed headcount, and approval status."
        gradient="neutral"
        tags={[
          { label: 'Headcount Planning', variant: 'neutral' },
          { label: 'Approvals', variant: 'cyan' },
          { label: 'Department Demand', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            New ATR
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
          <Select
            allowClear
            placeholder="Filter by department"
            style={{ width: 220 }}
            value={pendingFilters.department || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, department: val })}
            options={(departments || []).map((d: any) => ({ value: d.id, label: d.name }))}
          />
          <Select
            allowClear
            placeholder="Filter by status"
            style={{ width: 180 }}
            value={pendingFilters.status || undefined}
            onChange={(val) => setPendingFilters({ ...pendingFilters, status: val })}
          >
            <Select.Option value="PENDING">Pending</Select.Option>
            <Select.Option value="APPROVED">Approved</Select.Option>
            <Select.Option value="REJECTED">Rejected</Select.Option>
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

      <MobileTable
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        rowKey="id"
        scroll={{ x: 1400 }}
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid rgba(245, 196, 0, 0.15)',
        }}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="Manage ATR"
        open={manageOpen}
        onCancel={() => {
          setManageOpen(false);
          setManageRecord(null);
        }}
        footer={null}
        width={480}
      >
        {manageRecord && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <strong>Department:</strong> {manageRecord.department}
            </div>
            <div>
              <strong>Role:</strong> {manageRecord.role}
            </div>
            <div>
              <strong>Vacancies:</strong> {manageRecord.vacancies}
            </div>
            <div>
              <strong>Status:</strong> {manageRecord.status.toUpperCase()}
            </div>
            <Space>
              <Button
                type="primary"
                onClick={() => {
                  handleApprove(manageRecord);
                  setManageOpen(false);
                  setManageRecord(null);
                }}
              >
                Approve
              </Button>
              <Button
                danger
                onClick={() => {
                  handleReject(manageRecord);
                  setManageOpen(false);
                  setManageRecord(null);
                }}
              >
                Reject
              </Button>
            </Space>
          </Space>
        )}
      </Modal>

      <Modal
        title="ATR Details"
        open={viewOpen}
        onCancel={() => {
          setViewOpen(false);
          setViewRecord(null);
        }}
        footer={null}
        width={700}
      >
        {viewRecord && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><strong>Department:</strong> {viewRecord.department}</div>
            <div><strong>Role:</strong> {viewRecord.role}</div>
            <div><strong>Hiring Manager:</strong> {viewRecord.hiringManager}</div>
            <div><strong>Requested Date:</strong> {viewRecord.requestedDate || '-'}</div>
            <div><strong>Vacancies:</strong> {viewRecord.vacancies}</div>
            <div><strong>Status:</strong> {viewRecord.status.toUpperCase()}</div>
            <div style={{ gridColumn: '1 / -1' }}>
              <strong>Reason:</strong>
              <p>{viewRecord.reason || '-'}</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={editingId ? 'Edit Approval To Recruit' : 'Log Approval To Recruit'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingId(null);
          form.resetFields();
          setPositionData({});
        }}
        onOk={() => form.submit()}
        width={900}
      >
        <Form form={form} layout="vertical" onFinish={handleAddRequest}>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="department"
                label="Department"
                rules={[{ required: true, message: 'Please select department' }]}
              >
                <Select placeholder="Select department" showSearch optionFilterProp="label">
                  {(departments || []).map((dept: any) => (
                    <Select.Option key={dept.id} value={dept.id} label={dept.name}>
                      {dept.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="role"
                label="Role / Position (Select Multiple)"
                rules={[{ required: true, message: 'Please select at least one role' }]}
              >
                <Select
                  mode="multiple"
                  placeholder="Select roles (can select multiple from same department)"
                  showSearch
                  optionFilterProp="label"
                >
                  {(jobs || []).map((job: any) => (
                    <Select.Option key={job.id} value={job.title} label={job.title}>
                      {job.title}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="hiringManager"
                label="Manager Responsible"
                rules={[{ required: true, message: 'Please enter manager name' }]}
              >
                <Input placeholder="Manager full name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="requestedDate"
                label="Request Date"
                rules={[{ required: true, message: 'Please select date' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Position-specific headcount and vacancies grid */}
          {selectedRoles && selectedRoles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, color: '#f7f8fb' }}>
                Position Details
              </div>
              <Table
                dataSource={selectedRoles.map((role: string) => ({ role }))}
                pagination={false}
                size="small"
                rowKey="role"
                style={{
                  background: 'rgba(15, 22, 40, 0.4)',
                  borderRadius: '8px',
                  border: '1px solid rgba(245, 196, 0, 0.15)',
                }}
              >
                <Table.Column
                  title="Position"
                  dataIndex="role"
                  key="role"
                  width="40%"
                />
                <Table.Column
                  title="Current Headcount"
                  key="currentHeadcount"
                  width="30%"
                  render={(_: any, record: any) => (
                    <InputNumber
                      min={0}
                      placeholder="0"
                      value={positionData[record.role]?.currentHeadcount || 0}
                      onChange={(val) => {
                        setPositionData(prev => ({
                          ...prev,
                          [record.role]: {
                            ...prev[record.role],
                            currentHeadcount: val || 0,
                            vacancies: prev[record.role]?.vacancies || 0,
                          }
                        }));
                      }}
                      style={{ width: '100%' }}
                    />
                  )}
                />
                <Table.Column
                  title="Vacancies Needed"
                  key="vacancies"
                  width="30%"
                  render={(_: any, record: any) => (
                    <InputNumber
                      min={0}
                      placeholder="0"
                      value={positionData[record.role]?.vacancies || 0}
                      onChange={(val) => {
                        setPositionData(prev => ({
                          ...prev,
                          [record.role]: {
                            ...prev[record.role],
                            currentHeadcount: prev[record.role]?.currentHeadcount || 0,
                            vacancies: val || 0,
                          }
                        }));
                      }}
                      style={{ width: '100%' }}
                    />
                  )}
                />
              </Table>
            </div>
          )}

          <Form.Item
            name="reason"
            label="Reason for Request"
            rules={[{ required: true, message: 'Please provide reason' }]}
          >
            <Input.TextArea rows={3} placeholder="e.g., project mobilization, backfill for attrition, safety coverage" />
          </Form.Item>

        </Form>
      </Modal>
    </div>
  );
}
