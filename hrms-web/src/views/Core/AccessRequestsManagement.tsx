import React, { useState } from 'react';
import MobileTable from '../../components/MobileTable';
import { Link } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Form,
  Select,
  Input,
  message,
  Tag,
  Empty,
  Divider,
  Statistic,
  Row,
  Col,
} from 'antd';
import { Modal } from '@/components/overlays';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface AccessRequest {
  id: number;
  workspace: number;
  requesting_user: number;
  requesting_user_details: {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
  };
  message: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  processed_by?: number;
  processed_at?: string;
  admin_notes?: string;
  assigned_role?: string;
  requested_at: string;
}

interface CustomRole {
  id: number;
  name: string;
  description: string;
}

const AccessRequestsManagement: React.FC = () => {
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<AccessRequest | null>(null);
  const [processModalVisible, setProcessModalVisible] = useState(false);
  const [processAction, setProcessAction] = useState<'APPROVE' | 'DENY' | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // Fetch pending access requests
  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ['access-requests-pending'],
    queryFn: () =>
      http.get<AccessRequest[]>('/api/v1/core/access-requests/pending/').then((res) => res.data),
  });

  // Fetch custom roles for workspace
  const { data: rolesData } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () =>
      http.get<{ results: CustomRole[] }>('/api/v1/core/custom-roles/?page_size=100').then((res) => res.data),
  });

  // Approve/Deny mutation
  const processRequestMutation = useMutation({
    mutationFn: (payload: {
      requestId: number;
      action: 'APPROVE' | 'DENY';
      assigned_role?: string;
      assigned_custom_role?: number;
      admin_notes?: string;
    }) => {
      const endpoint =
        payload.action === 'APPROVE'
          ? `/api/v1/core/access-requests/${payload.requestId}/approve/`
          : `/api/v1/core/access-requests/${payload.requestId}/deny/`;

      const data: any = { action: payload.action };
      if (payload.assigned_role) data.assigned_role = payload.assigned_role;
      if (payload.assigned_custom_role) data.assigned_custom_role = payload.assigned_custom_role;
      if (payload.admin_notes) data.admin_notes = payload.admin_notes;

      return http.post(endpoint, data);
    },
    onSuccess: () => {
      message.success(`Request ${processAction === 'APPROVE' ? 'approved' : 'denied'} successfully`);
      setProcessModalVisible(false);
      setProcessAction(null);
      setSelectedRequest(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['access-requests-pending'] });
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Failed to process request';
      message.error(errorMsg);
    },
  });

  const handleViewDetails = (request: AccessRequest) => {
    setSelectedRequest(request);
    setDetailModalVisible(true);
  };

  const handleProcessRequest = (request: AccessRequest, action: 'APPROVE' | 'DENY') => {
    setSelectedRequest(request);
    setProcessAction(action);
    setProcessModalVisible(true);
    form.resetFields();
  };

  const handleSubmitProcess = async () => {
    if (!selectedRequest) return;

    try {
      const values = await form.validateFields();
      processRequestMutation.mutate({
        requestId: selectedRequest.id,
        action: processAction!,
        assigned_role: values.assigned_role,
        assigned_custom_role: values.assigned_custom_role,
        admin_notes: values.admin_notes,
      });
    } catch (error) {
      // Form validation failed
    }
  };

  const requests = requestsData || [];
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const approvedCount = requests.filter((r) => r.status === 'APPROVED').length;

  const columns = [
    {
      title: 'Requester',
      key: 'requester',
      render: (_: any, record: AccessRequest) => {
        const user = record.requesting_user_details;
        return (
          <div>
            <div className="font-medium">
              {user.first_name} {user.last_name}
            </div>
            <div className="text-xs text-gray-500">{user.username}</div>
            <div className="text-xs text-gray-400">{user.email}</div>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'PENDING') {
          return <Tag icon={<ClockCircleOutlined />} color="orange">Pending</Tag>;
        } else if (status === 'APPROVED') {
          return <Tag icon={<CheckCircleOutlined />} color="green">Approved</Tag>;
        } else {
          return <Tag icon={<CloseCircleOutlined />} color="red">Denied</Tag>;
        }
      },
    },
    {
      title: 'Requested',
      dataIndex: 'requested_at',
      key: 'requested_at',
      render: (date: string) => dayjs(date).fromNow(),
      sorter: (a: AccessRequest, b: AccessRequest) =>
        dayjs(a.requested_at).unix() - dayjs(b.requested_at).unix(),
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right' as const,
      width: 200,
      render: (_: any, record: AccessRequest) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetails(record)}
          >
            Details
          </Button>
          {record.status === 'PENDING' && (
            <>
              <Button
                type="primary"
                size="small"
                onClick={() => handleProcessRequest(record, 'APPROVE')}
              >
                Approve
              </Button>
              <Button
                type="primary"
                danger
                size="small"
                onClick={() => handleProcessRequest(record, 'DENY')}
              >
                Deny
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">Access Requests</h1>

        <Row gutter={16} className="mb-6">
          <Col xs={12} sm={6}>
            <Card>
              <Statistic title="Pending" value={pendingCount} styles={{ content: { color: '#faad14' } }} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card>
              <Statistic title="Approved" value={approvedCount} styles={{ content: { color: '#52c41a' } }} />
            </Card>
          </Col>
        </Row>

        <Card className="mb-6">
          <Space direction="vertical" size={6}>
            <div className="font-medium">Workspace Debug</div>
            <div className="text-sm text-gray-500">Check your workspace access and roles if the UI is not showing all assigned workspaces.</div>
            <Button type="primary">
              <Link to="/debug/workspaces">Open Workspace Debug</Link>
            </Button>
          </Space>
        </Card>
      </div>

      {requests.length === 0 ? (
        <Empty description="No access requests" />
      ) : (
        <Card>
          <MobileTable
            columns={columns}
            dataSource={requests}
            rowKey="id"
            loading={requestsLoading}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 800 }}
          />
        </Card>
      )}

      {/* Detail Modal */}
      <Modal
        title="Request Details"
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false);
          setSelectedRequest(null);
        }}
        footer={null}
        width={600}
        destroyOnClose
      >
        {selectedRequest && (
          <div>
            <Divider>Requester Information</Divider>
            <Row gutter={16} className="mb-4">
              <Col xs={12}>
                <div className="text-sm text-gray-600">Name</div>
                <div className="font-medium">
                  {selectedRequest.requesting_user_details.first_name}{' '}
                  {selectedRequest.requesting_user_details.last_name}
                </div>
              </Col>
              <Col xs={12}>
                <div className="text-sm text-gray-600">Username</div>
                <div className="font-medium">{selectedRequest.requesting_user_details.username}</div>
              </Col>
              <Col xs={24}>
                <div className="text-sm text-gray-600">Email</div>
                <div className="font-medium">{selectedRequest.requesting_user_details.email}</div>
              </Col>
            </Row>

            <Divider>Request Details</Divider>
            <Row gutter={16} className="mb-4">
              <Col xs={12}>
                <div className="text-sm text-gray-600">Status</div>
                <div className="font-medium">
                  {selectedRequest.status === 'PENDING' && (
                    <Tag icon={<ClockCircleOutlined />} color="orange">Pending</Tag>
                  )}
                  {selectedRequest.status === 'APPROVED' && (
                    <Tag icon={<CheckCircleOutlined />} color="green">Approved</Tag>
                  )}
                  {selectedRequest.status === 'DENIED' && (
                    <Tag icon={<CloseCircleOutlined />} color="red">Denied</Tag>
                  )}
                </div>
              </Col>
              <Col xs={12}>
                <div className="text-sm text-gray-600">Requested</div>
                <div className="font-medium">{dayjs(selectedRequest.requested_at).format('MMM DD, YYYY HH:mm')}</div>
              </Col>
            </Row>

            {selectedRequest.message && (
              <>
                <Divider>Message</Divider>
                <div className="bg-gray-50 p-3 rounded mb-4">{selectedRequest.message}</div>
              </>
            )}

            {selectedRequest.status !== 'PENDING' && (
              <>
                <Divider>Processing Details</Divider>
                <Row gutter={16} className="mb-4">
                  <Col xs={12}>
                    <div className="text-sm text-gray-600">Assigned Role</div>
                    <div className="font-medium">{selectedRequest.assigned_role || 'N/A'}</div>
                  </Col>
                  <Col xs={12}>
                    <div className="text-sm text-gray-600">Processed</div>
                    <div className="font-medium">
                      {dayjs(selectedRequest.processed_at).format('MMM DD, YYYY HH:mm')}
                    </div>
                  </Col>
                  {selectedRequest.admin_notes && (
                    <Col xs={24}>
                      <div className="text-sm text-gray-600">Admin Notes</div>
                      <div className="bg-gray-50 p-2 rounded text-sm">{selectedRequest.admin_notes}</div>
                    </Col>
                  )}
                </Row>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Process Modal */}
      <Modal
        title={`${processAction === 'APPROVE' ? 'Approve' : 'Deny'} Access Request`}
        open={processModalVisible}
        onOk={handleSubmitProcess}
        onCancel={() => {
          setProcessModalVisible(false);
          setProcessAction(null);
          form.resetFields();
        }}
        confirmLoading={processRequestMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {selectedRequest && (
            <Form.Item label="Requester" className="mb-4">
              <div className="bg-blue-50 p-3 rounded">
                <div className="font-medium">
                  {selectedRequest.requesting_user_details.first_name}{' '}
                  {selectedRequest.requesting_user_details.last_name}
                </div>
                <div className="text-sm text-gray-600">{selectedRequest.requesting_user_details.email}</div>
              </div>
            </Form.Item>
          )}

          {processAction === 'APPROVE' && (
            <>
              <Form.Item
                label="Workspace Role"
                name="assigned_role"
                rules={[{ required: true, message: 'Please select a role' }]}
              >
                <Select
                  placeholder="Select workspace role"
                  options={[
                    { value: 'ADMIN', label: 'Administrator' },
                    { value: 'HR_MANAGER', label: 'HR Manager' },
                    { value: 'MANAGER', label: 'Manager' },
                    { value: 'VIEWER', label: 'Viewer' },
                  ]}
                />
              </Form.Item>

              <Form.Item label="Custom Role (Optional)" name="assigned_custom_role">
                <Select
                  placeholder="Select additional custom role"
                  options={
                    rolesData?.results?.map((role) => ({
                      value: role.id,
                      label: `${role.name} - ${role.description}`,
                    })) || []
                  }
                  allowClear
                />
              </Form.Item>
            </>
          )}

          <Form.Item
            label={`${processAction === 'APPROVE' ? 'Approval' : 'Denial'} Notes (Optional)`}
            name="admin_notes"
            rules={[{ max: 500, message: 'Notes must be less than 500 characters' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder={
                processAction === 'APPROVE'
                  ? 'e.g., "Approved for 3-month payroll implementation project"'
                  : 'e.g., "Not currently accepting external consultants"'
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AccessRequestsManagement;
