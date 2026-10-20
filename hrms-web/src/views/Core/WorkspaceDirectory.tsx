import React, { useState } from 'react';
import MobileTable from '../../components/MobileTable';
import {
  Card,
  Button,
  Input,
  message,
  Form,
  Tag,
  Empty,
  Badge,
} from 'antd';
import { Modal } from '@/components/overlays';
import {
  PlusOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';

interface Workspace {
  id: number;
  name: string;
  code: string;
  workspace_type: string;
  description: string;
  industry: string;
  contact_email: string;
  member_count: number;
  employee_count: number;
}

interface AccessRequest {
  id: number;
  workspace: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  requested_at: string;
}

const WorkspaceDirectory: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [requestModalVisible, setRequestModalVisible] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // Fetch all workspaces
  const { data: workspacesData, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspace-directory'],
    queryFn: () =>
      http.get<{ results: Workspace[] }>('/core/workspaces/?page_size=1000').then((res) => res.data),
  });

  // Fetch user's current access requests
  const { data: myRequestsData } = useQuery({
    queryKey: ['my-access-requests'],
    queryFn: () =>
      http.get<AccessRequest[]>('/api/v1/core/access-requests/my_requests/').then((res) => res.data),
  });

  // Create access request mutation
  const createRequestMutation = useMutation({
    mutationFn: (payload: { workspace: number; message: string }) =>
      http.post('/api/v1/core/access-requests/', payload),
    onSuccess: () => {
      message.success('Access request sent successfully');
      setRequestModalVisible(false);
      setSelectedWorkspace(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['my-access-requests'] });
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || error.response?.data?.detail || 'Failed to send request';
      message.error(errorMsg);
    },
  });

  const workspaces = workspacesData?.results || [];

  // Filter workspaces by search
  const filteredWorkspaces = workspaces.filter((ws) =>
    ws.name.toLowerCase().includes(searchText.toLowerCase()) ||
    ws.code.toLowerCase().includes(searchText.toLowerCase()) ||
    ws.industry.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleRequestAccess = (workspace: Workspace) => {
    // Check if user already has a pending request
    const hasPendingRequest = myRequestsData?.some(
      (req) => req.workspace === workspace.id && req.status === 'PENDING'
    );

    if (hasPendingRequest) {
      message.warning('You already have a pending request for this workspace');
      return;
    }

    setSelectedWorkspace(workspace);
    setRequestModalVisible(true);
  };

  const handleSubmitRequest = async () => {
    try {
      const values = await form.validateFields();
      createRequestMutation.mutate({
        workspace: selectedWorkspace!.id,
        message: values.message,
      });
    } catch (error) {
      // Form validation failed
    }
  };

  const getRequestStatus = (workspaceId: number) => {
    const request = myRequestsData?.find((req) => req.workspace === workspaceId);
    if (!request) return null;

    if (request.status === 'PENDING') {
      return <Tag icon={<ClockCircleOutlined />} color="orange">Pending</Tag>;
    } else if (request.status === 'APPROVED') {
      return <Tag icon={<CheckCircleOutlined />} color="green">Approved</Tag>;
    } else {
      return <Tag color="red">Denied</Tag>;
    }
  };

  const columns = [
    {
      title: 'Workspace Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: Workspace, b: Workspace) => a.name.localeCompare(b.name),
      render: (text: string, record: Workspace) => (
        <div>
          <div className="font-medium">{text}</div>
          <div className="text-xs text-gray-500">{record.code}</div>
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'workspace_type',
      key: 'workspace_type',
      render: (type: string) => {
        const colors: { [key: string]: string } = {
          COMPANY: 'blue',
          CONTRACTOR_FIRM: 'green',
          CONSULTANT: 'purple',
        };
        return <Tag color={colors[type] || 'default'}>{type}</Tag>;
      },
    },
    {
      title: 'Industry',
      dataIndex: 'industry',
      key: 'industry',
      sorter: (a: Workspace, b: Workspace) => (a.industry || '').localeCompare(b.industry || ''),
    },
    {
      title: 'Members',
      dataIndex: 'member_count',
      key: 'member_count',
      align: 'center' as const,
      render: (count: number) => <Badge count={count} />,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: Workspace) => getRequestStatus(record.id),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Workspace) => {
        const hasApprovedRequest = myRequestsData?.some(
          (req) => req.workspace === record.id && req.status === 'APPROVED'
        );
        const hasPendingRequest = myRequestsData?.some(
          (req) => req.workspace === record.id && req.status === 'PENDING'
        );

        if (hasApprovedRequest) {
          return (
            <Button type="primary" disabled>
              Already Member
            </Button>
          );
        }

        if (hasPendingRequest) {
          return (
            <Button type="dashed" disabled>
              Request Pending
            </Button>
          );
        }

        return (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleRequestAccess(record)}
          >
            Request Access
          </Button>
        );
      },
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Workspace Directory</h1>
        <p className="text-gray-600">
          Browse available workspaces and request access to collaborate with other organizations
        </p>
      </div>

      <Card className="mb-6">
        <Input
          placeholder="Search workspaces by name, code, or industry..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          size="large"
        />
      </Card>

      {filteredWorkspaces.length === 0 ? (
        <Empty description={searchText ? 'No workspaces found' : 'No workspaces available'} />
      ) : (
        <Card>
          <MobileTable
            columns={columns}
            dataSource={filteredWorkspaces}
            rowKey="id"
            loading={workspacesLoading}
            pagination={{ pageSize: 10 }}
          />
        </Card>
      )}

      <Modal
        title={`Request Access: ${selectedWorkspace?.name}`}
        open={requestModalVisible}
        onOk={handleSubmitRequest}
        onCancel={() => {
          setRequestModalVisible(false);
          setSelectedWorkspace(null);
          form.resetFields();
        }}
        confirmLoading={createRequestMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Workspace" className="mb-0">
            <div className="bg-gray-100 p-3 rounded">
              <div className="font-medium">{selectedWorkspace?.name}</div>
              <div className="text-sm text-gray-600">{selectedWorkspace?.description}</div>
            </div>
          </Form.Item>

          <Form.Item
            label="Message (Optional)"
            name="message"
            rules={[
              { max: 500, message: 'Message must be less than 500 characters' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="Tell the workspace admin why you need access (e.g., 'I'm a consultant helping with payroll implementation')"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default WorkspaceDirectory;
