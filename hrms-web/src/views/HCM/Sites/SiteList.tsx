import { useState } from 'react';
import {
  Button,
  Table,
  Tag,
  Form,
  Input,
  DatePicker,
  Select,
  Space,
  message,
  Popconfirm,
  Badge,
} from 'antd';
import { Modal } from '@/components/overlays';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import http from '../../../lib/http';
import { GlassCard } from '../../../components/NeonPrimitives';
import { HeroBanner } from '../../../components/HeroBanner';
import { KPICard } from '../../../components/KPICard';
import { EnvironmentOutlined } from '@ant-design/icons';

interface Site {
  id: number;
  name: string;
  location: string;
  description: string;
  cost_centre: string;
  start_date: string;
  end_date: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  status_display: string;
  active_employee_count: number;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'green',
  PLANNED: 'blue',
  CLOSED: 'default',
};

export default function SiteList() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const workspaceId = localStorage.getItem('workspaceId');

  const { data: sites = [], isLoading } = useQuery<Site[]>({
    queryKey: ['sites', workspaceId],
    queryFn: async () => {
      const res = await http.get(`/api/v1/sites/sites/?workspace=${workspaceId}`);
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
  });

  const saveMutation = useMutation({
    mutationFn: (values: any) => {
      const payload = {
        ...values,
        workspace: workspaceId,
        start_date: values.start_date?.format('YYYY-MM-DD'),
        end_date: values.end_date?.format('YYYY-MM-DD') ?? null,
      };
      return editing
        ? http.patch(`/api/v1/sites/sites/${editing.id}/`, payload)
        : http.post('/api/v1/sites/sites/', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      message.success(editing ? 'Site updated' : 'Site created');
      setModalVisible(false);
      setEditing(null);
      form.resetFields();
    },
    onError: (e: any) => message.error(e.response?.data?.error || 'Failed to save site'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => http.delete(`/api/v1/sites/sites/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      message.success('Site deleted');
    },
    onError: (e: any) => message.error(e.response?.data?.error || 'Failed to delete site'),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'ACTIVE' });
    setModalVisible(true);
  };

  const openEdit = (site: Site) => {
    setEditing(site);
    form.setFieldsValue({
      name: site.name,
      location: site.location,
      description: site.description,
      cost_centre: site.cost_centre,
      status: site.status,
      start_date: site.start_date ? dayjs(site.start_date) : null,
      end_date: site.end_date ? dayjs(site.end_date) : null,
    });
    setModalVisible(true);
  };

  const active = sites.filter(s => s.status === 'ACTIVE').length;
  const totalEmployees = sites.reduce((s, site) => s + site.active_employee_count, 0);

  const columns = [
    {
      title: 'Site',
      key: 'site',
      render: (_: any, record: Site) => (
        <div>
          <div style={{ fontWeight: 700 }}>{record.name}</div>
          {record.location && (
            <div style={{ fontSize: 12, color: '#888' }}>
              <EnvironmentOutlined style={{ marginRight: 4 }} />{record.location}
            </div>
          )}
          {record.cost_centre && (
            <div style={{ fontSize: 11, color: '#aaa' }}>CC: {record.cost_centre}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (val: string, rec: Site) => (
        <Tag color={STATUS_COLOR[val]}>{rec.status_display}</Tag>
      ),
    },
    {
      title: 'Employees',
      dataIndex: 'active_employee_count',
      key: 'employees',
      width: 100,
      render: (v: number) => <Badge count={v} showZero color="#f5c400" />,
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      key: 'start_date',
      width: 120,
      render: (v: string) => v ? dayjs(v).format('DD MMM YYYY') : '—',
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      key: 'end_date',
      width: 120,
      render: (v: string | null) => v ? dayjs(v).format('DD MMM YYYY') : <span style={{ color: '#888' }}>Ongoing</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      render: (_: any, record: Site) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => nav(`/hcm/sites/${record.id}/manage`)}
          >
            Manage
          </Button>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="Delete this site?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="text" size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <HeroBanner
        eyebrow="Human Capital"
        title="Site Management"
        description="Create and manage work sites, allocate employees, and run Labour Reconciliation reports by period."
        gradient="neutral"
        tags={[
          { label: `${sites.length} Sites`, variant: 'gold' },
          { label: `${active} Active`, variant: 'cyan' },
          { label: `${totalEmployees} Allocated`, variant: 'lime' },
        ]}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Create Site
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard title="Total Sites" value={sites.length} color="#f5c400" gradient="gold" />
        <KPICard title="Active Sites" value={active} color="#3ee7ff" gradient="cyan" />
        <KPICard title="Allocated Employees" value={totalEmployees} color="#7cff6b" gradient="lime" />
        <KPICard
          title="Closed Sites"
          value={sites.filter(s => s.status === 'CLOSED').length}
          color="#c4c8d4"
          gradient="neutral"
        />
      </div>

      <GlassCard gradient="neutral" style={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={sites}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          onRow={(record) => ({
            onDoubleClick: () => nav(`/hcm/sites/${record.id}/manage`),
            style: { cursor: 'pointer' },
          })}
        />
      </GlassCard>

      <Modal
        title={editing ? 'Edit Site' : 'Create Site'}
        open={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); form.resetFields(); }}
        onOk={() => form.validateFields().then(saveMutation.mutate)}
        confirmLoading={saveMutation.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="Site Name" name="name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Ndola Mine Site" />
          </Form.Item>
          <Form.Item label="Location" name="location">
            <Input placeholder="e.g. Ndola, Copperbelt" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="Brief description of the site" />
          </Form.Item>
          <Form.Item label="Cost Centre Code" name="cost_centre" extra="Used for payroll cost allocation">
            <Input placeholder="e.g. CC-NDA-001" />
          </Form.Item>
          <Form.Item label="Status" name="status" rules={[{ required: true }]}>
            <Select options={[
              { value: 'PLANNED', label: 'Planned' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'CLOSED', label: 'Closed' },
            ]} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="Start Date" name="start_date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="End Date" name="end_date" extra="Leave blank if ongoing">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
