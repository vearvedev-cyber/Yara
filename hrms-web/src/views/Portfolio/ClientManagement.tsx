import { useState } from 'react';
import MobileTable from '../../components/MobileTable';
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Tag,
  Form,
  Input,
  Select,
  message,
  Descriptions,
  Statistic,
  Typography,
  Alert,
} from 'antd';
import { Modal } from '@/components/overlays';
import {
  PlusOutlined,
  EyeOutlined,
  TeamOutlined,
  ProjectOutlined,
  EnvironmentOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { canPerformAction } from '../../lib/permissions';
import { HeroBanner } from '../../components/HeroBanner';

const { Title, Text } = Typography;

interface Workspace {
  id: number;
  name: string;
  code: string;
  workspace_type: string;
  industry?: string;
  description?: string;
  is_active: boolean;
}

interface ClientSummary {
  workspace: Workspace;
  stats: {
    total_employees: number;
    active_employees: number;
    total_projects: number;
    active_projects: number;
    total_sites: number;
    contractors_count?: number;
  };
  role: string;
}

export default function ClientManagement() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: clients, isLoading } = useQuery<ClientSummary[]>({
    queryKey: ['client-workspaces'],
    queryFn: async () => {
      const res = await http.get('/api/v1/core/workspaces/portfolio_stats/');
      console.log('Portfolio Stats API Response:', res.data);
      console.log('Clients array:', res.data.clients);
      return res.data.clients || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await http.post('/api/v1/core/workspaces/', values);
      return res.data;
    },
    onSuccess: () => {
      message.success('Client workspace created successfully');
      setCreateModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['client-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-overview'] });
    },
    onError: () => {
      message.error('Failed to create client workspace');
    },
  });

  const columns = [
    {
      title: 'Client Name',
      key: 'name',
      render: (_: any, record: ClientSummary) => (
        <Space orientation="vertical" size={0}>
          <Text strong style={{ color: '#D4AF37', fontSize: 16 }}>
            {record.workspace.name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Code: {record.workspace.code}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Industry',
      dataIndex: ['workspace', 'industry'],
      key: 'industry',
      render: (industry?: string) => industry || 'Not specified',
    },
    {
      title: 'Type',
      dataIndex: ['workspace', 'workspace_type'],
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, { color: string; label: string }> = {
          COMPANY: { color: 'green', label: 'Company' },
          CONTRACTOR_FIRM: { color: 'orange', label: 'Contractor Firm' },
          CONSULTANT: { color: 'blue', label: 'Consultant' },
        };
        const t = typeMap[type] || { color: 'default', label: type };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: 'Employees',
      key: 'employees',
      render: (_: any, record: ClientSummary) => (
        <Space orientation="vertical" size={0}>
          <Space>
            <TeamOutlined />
            <span>{record.stats.total_employees} total</span>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>Active: {record.stats.active_employees}</Text>
        </Space>
      ),
      sorter: (a: ClientSummary, b: ClientSummary) =>
        a.stats.total_employees - b.stats.total_employees,
    },
    {
      title: 'Projects',
      key: 'projects',
      render: (_: any, record: ClientSummary) => (
        <Space>
          <ProjectOutlined />
          <span>{record.stats.active_projects}/{record.stats.total_projects}</span>
        </Space>
      ),
    },
    {
      title: 'Sites',
      key: 'sites',
      render: (_: any, record: ClientSummary) => (
        <Space>
          <EnvironmentOutlined />
          <span>{record.stats.total_sites}</span>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: ['workspace', 'is_active'],
      key: 'status',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: ClientSummary) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedClient(record);
              setDetailModalOpen(true);
            }}
            style={{ color: '#f5c400' }}
          >
            View
          </Button>
          <Button
            type="link"
            onClick={() => {
              console.log('🔄 Switching to workspace:', record.workspace.id, record.workspace.name);
              localStorage.setItem('workspaceId', String(record.workspace.id));
              localStorage.setItem('workspaceName', record.workspace.name);
              localStorage.setItem('workspaceRole', record.role || 'VIEWER');
              console.log('✅ localStorage set:', {
                workspaceId: localStorage.getItem('workspaceId'),
                workspaceName: localStorage.getItem('workspaceName')
              });
              window.dispatchEvent(new Event('workspaceChanged'));
              window.location.replace('/#/dashboard');
            }}
            style={{ color: '#f5c400' }}
          >
            Open →
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Portfolio"
        title="Client Management"
        description="Manage all client workspaces, add new clients, and monitor operational footprint across your portfolio."
        gradient="neutral"
        tags={[
          { label: `Total Clients: ${clients?.length || 0}`, variant: 'gold' },
          { label: `Active Clients: ${clients?.filter(c => c.workspace.is_active).length || 0}`, variant: 'lime' },
          { label: `Total Employees: ${clients?.reduce((sum, c) => sum + c.stats.total_employees, 0) || 0}`, variant: 'cyan' },
        ]}
        actions={canPerformAction('can_manage_clients') ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => setCreateModalOpen(true)}
          >
            Add New Client
          </Button>
        ) : null}
      />

      {!canPerformAction('can_manage_clients') && (
        <Alert
          message="Read-only access"
          description="You do not have permission to create or modify clients. Contact your workspace admin for access."
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Summary Cards */}
      <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
        <Col xs={24} sm={8}>
          <Card style={{ background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)', border: '1px solid rgba(245, 196, 0, 0.15)', borderRadius: '12px' }}>
            <Statistic
              title={<span style={{ color: '#c4c8d4' }}>Total Clients</span>}
              value={clients?.length || 0}
              valueStyle={{ color: '#f5c400', fontSize: 24, fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)', border: '1px solid rgba(124, 255, 107, 0.15)', borderRadius: '12px' }}>
            <Statistic
              title={<span style={{ color: '#c4c8d4' }}>Active Clients</span>}
              value={clients?.filter(c => c.workspace.is_active).length || 0}
              valueStyle={{ color: '#7cff6b', fontSize: 24, fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)', border: '1px solid rgba(62, 231, 255, 0.15)', borderRadius: '12px' }}>
            <Statistic
              title={<span style={{ color: '#c4c8d4' }}>Total Employees</span>}
              value={clients?.reduce((sum, c) => sum + c.stats.total_employees, 0) || 0}
              valueStyle={{ color: '#3ee7ff', fontSize: 24, fontWeight: 'bold' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Client Table */}
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(15, 22, 40, 0.6) 0%, rgba(11, 15, 26, 0.4) 100%)',
          border: '1px solid rgba(245, 196, 0, 0.15)',
          borderRadius: '12px',
        }}
      >
        <MobileTable
          columns={columns}
          dataSource={clients || []}
          loading={isLoading}
          rowKey={(record) => record.workspace.id}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Create Client Modal */}
      <Modal
        title={<span style={{ color: '#f5c400' }}>Add New Client Workspace</span>}
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item
            name="name"
            label={<span style={{ color: '#D4AF37' }}>Client Name</span>}
            rules={[{ required: true, message: 'Please enter client name' }]}
          >
            <Input placeholder="e.g., ABC Mining Corporation" />
          </Form.Item>

          <Form.Item
            name="code"
            label={<span style={{ color: '#D4AF37' }}>Client Code</span>}
            rules={[{ required: true, message: 'Please enter client code' }]}
          >
            <Input placeholder="e.g., ABC-MINING" />
          </Form.Item>

          <Form.Item
            name="workspace_type"
            label={<span style={{ color: '#D4AF37' }}>Workspace Type</span>}
            rules={[{ required: true }]}
          >
            <Select placeholder="Select type">
              <Select.Option value="CONSULTING_FIRM">Consulting Firm</Select.Option>
              <Select.Option value="CONTRACTOR_COMPANY">Contractor Company</Select.Option>
              <Select.Option value="LARGE_COMPANY">Large Company</Select.Option>
              <Select.Option value="FREELANCE">Freelance HR</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="industry"
            label={<span style={{ color: '#D4AF37' }}>Industry</span>}
          >
            <Input placeholder="e.g., Mining, Construction, IT" />
          </Form.Item>

          <Form.Item
            name="description"
            label={<span style={{ color: '#D4AF37' }}>Description</span>}
          >
            <Input.TextArea rows={3} placeholder="Brief description of the client" />
          </Form.Item>

          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setCreateModalOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={createMutation.isPending}
                style={{
                  background: 'linear-gradient(135deg, #D4AF37 0%, #B8941E 100%)',
                  border: 'none',
                }}
              >
                Create Client Workspace
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Client Detail Modal */}
      <Modal
        title={<span style={{ color: '#D4AF37' }}>Client Details</span>}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="open"
            type="primary"
            onClick={() => {
              if (selectedClient) {
                localStorage.setItem('workspaceId', String(selectedClient.workspace.id));
                localStorage.setItem('workspaceName', selectedClient.workspace.name);
                localStorage.setItem('workspaceRole', selectedClient.role || 'VIEWER');
                window.dispatchEvent(new Event('workspaceChanged'));
                window.location.replace('/#/dashboard');
              }
            }}
            style={{
              background: 'linear-gradient(135deg, #D4AF37 0%, #B8941E 100%)',
              border: 'none',
            }}
          >
            Open Workspace
          </Button>,
        ]}
        width={700}
      >
        {selectedClient && (
          <>
            <Descriptions bordered column={2} style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Client Name" span={2}>
                {selectedClient.workspace.name}
              </Descriptions.Item>
              <Descriptions.Item label="Code">
                {selectedClient.workspace.code}
              </Descriptions.Item>
              <Descriptions.Item label="Industry">
                {selectedClient.workspace.industry || 'N/A'}
              </Descriptions.Item>
              <Descriptions.Item label="Type" span={2}>
                <Tag color="blue">{selectedClient.workspace.workspace_type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Status" span={2}>
                <Tag color={selectedClient.workspace.is_active ? 'green' : 'red'}>
                  {selectedClient.workspace.is_active ? 'Active' : 'Inactive'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Your Role" span={2}>
                <Tag color="gold">{selectedClient.role}</Tag>
              </Descriptions.Item>
              {selectedClient.workspace.description && (
                <Descriptions.Item label="Description" span={2}>
                  {selectedClient.workspace.description}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5} style={{ color: '#D4AF37', marginBottom: 16 }}>
              Workspace Statistics
            </Title>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="Total Employees"
                    value={selectedClient.stats.total_employees}
                    suffix={`(${selectedClient.stats.active_employees} active)`}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="Total Projects"
                    value={selectedClient.stats.total_projects}
                    suffix={`(${selectedClient.stats.active_projects} active)`}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="Sites"
                    value={selectedClient.stats.total_sites}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="Contractors"
                    value={selectedClient.stats.contractors_count || 0}
                  />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Modal>
    </div>
  );
}
