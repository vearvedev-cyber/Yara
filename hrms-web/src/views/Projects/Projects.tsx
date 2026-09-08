import { Row, Col, Progress, Avatar, Button, Space, Drawer, Form, Input, DatePicker, Select, InputNumber, Modal, message } from 'antd';
import { PlusOutlined, UserOutlined } from '@ant-design/icons';
import { FolderKanban } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard, TagPill } from '../../components/NeonPrimitives';
import { HeroBanner } from '../../components/HeroBanner';
import { coreApi } from '../../api/services/coreApi';
import type { Project as ApiProject } from '../../api/services/coreApi';

interface Project {
  id: number;
  title: string;
  description: string;
  progress: number;
  status: 'active' | 'completed' | 'on-hold';
  team: { name: string; avatar?: string }[];
  dueDate: string;
  priority: 'normal' | 'urgent' | 'low';
}

export default function Projects() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  // Listen for workspace changes and clear project cache
  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ queryKey: ['projects'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Fetch projects from API
  const { data: projectsData } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => coreApi.listProjects(),
    enabled: !!workspaceId,
  });


  // Transform API data to match component interface
  const projects: Project[] = useMemo(() => {
    if (!projectsData) return [];
    return projectsData.map((p: ApiProject) => ({
      id: p.id,
      title: p.name,
      description: p.description || '',
      progress: typeof p.progress === 'number'
        ? p.progress
        : p.status === 'COMPLETED' ? 100 : p.status === 'ACTIVE' ? 50 : p.status === 'ON_HOLD' ? 30 : 0,
      status: p.status === 'COMPLETED' ? 'completed' : p.status === 'ON_HOLD' ? 'on-hold' : 'active',
      team: (p.team_members || []).map(name => ({ name })),
      dueDate: p.end_date || '',
      priority: 'normal',
    }));
  }, [projectsData]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form] = Form.useForm();

  const teamOptions = useMemo(() => {
    // Build a simple options list from existing team names
    const names = new Set<string>();
    projects.forEach(p => p.team.forEach(t => names.add(t.name)));
    return Array.from(names).map(n => ({ label: n, value: n }));
  }, [projects]);

  const getStatusVariant = (status: string): 'gold' | 'lime' | 'amber' | 'cyan' | 'pink' | 'neutral' => {
    switch (status) {
      case 'active': return 'cyan';
      case 'completed': return 'lime';
      case 'on-hold': return 'amber';
      default: return 'neutral';
    }
  };

  const getPriorityVariant = (priority: string): 'gold' | 'lime' | 'amber' | 'cyan' | 'pink' | 'neutral' => {
    switch (priority) {
      case 'urgent': return 'pink';
      case 'normal': return 'cyan';
      case 'low': return 'neutral';
      default: return 'neutral';
    }
  };

  const openCreate = () => {
    form.resetFields();
    setDrawerOpen(true);
    setEditing(null);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    // Fetch the full project details from API to get start_date
    coreApi.getProject(p.id).then((apiProject) => {
      form.setFieldsValue({
        title: apiProject.name,
        description: apiProject.description,
        status: apiProject.status === 'COMPLETED' ? 'completed' : apiProject.status === 'ON_HOLD' ? 'on-hold' : 'active',
        priority: p.priority,
        startDate: apiProject.start_date ? dayjs(apiProject.start_date) : undefined,
        dueDate: apiProject.end_date ? dayjs(apiProject.end_date) : undefined,
        progress: typeof apiProject.progress === 'number' ? apiProject.progress : p.progress,
        team: Array.isArray(apiProject.team_members) ? apiProject.team_members : p.team.map(t => t.name),
      });
      setDrawerOpen(true);
    }).catch(() => {
      message.error('Failed to load project details');
    });
  };

  const handleDelete = (p: Project) => {
    Modal.confirm({
      title: 'Delete Program',
      content: 'Are you sure you want to delete this program?',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => {
        return coreApi
          .deleteProject(p.id)
          .then(() => {
            message.success('Program deleted');
            queryClient.invalidateQueries({ queryKey: ['projects'], exact: false });
          })
          .catch(() => message.error('Failed to delete program'));
      },
    });
  };

  const handleUpsert = (values: any) => {
    // Map UI status to API status values
    const toApiStatus = (s: string) => (s === 'completed' ? 'COMPLETED' : s === 'on-hold' ? 'ON_HOLD' : 'ACTIVE');
    const payload = {
      name: values.title,
      description: values.description,
      status: toApiStatus(values.status),
      start_date: values.startDate ? (values.startDate as dayjs.Dayjs).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      end_date: values.dueDate ? (values.dueDate as dayjs.Dayjs).format('YYYY-MM-DD') : undefined,
      progress: typeof values.progress === 'number' ? values.progress : 0,
      team_members: Array.isArray(values.team) ? values.team : [],
    } as Partial<ApiProject>;

    const action = editing
      ? coreApi.updateProject(editing.id, payload)
      : coreApi.createProject(payload);

    action
      .then(() => {
        message.success(editing ? 'Program updated' : 'Program created');
        queryClient.invalidateQueries({ queryKey: ['projects'], exact: false });
        setDrawerOpen(false);
        setEditing(null);
        form.resetFields();
      })
      .catch((err) => {
        console.error('Project creation error:', err);
        const apiData = err?.response?.data;
        let detail = '';
        if (typeof apiData === 'string') {
          detail = apiData;
        } else if (apiData?.detail) {
          detail = apiData.detail;
        } else if (apiData && typeof apiData === 'object') {
          const firstKey = Object.keys(apiData)[0];
          if (firstKey) {
            const val = Array.isArray(apiData[firstKey]) ? apiData[firstKey][0] : apiData[firstKey];
            detail = `${firstKey}: ${val}`;
          }
        }
        const base = editing ? 'Failed to update program' : 'Failed to create program';
        message.error(detail ? `${base} - ${detail}` : base);
      });
  };

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Projects"
        title="Organizational Initiatives"
        description="Manage and track all HR projects, programs, and organizational initiatives across your teams."
        icon={<FolderKanban className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
        gradient="neutral"
        tags={[
          { label: 'Programs', variant: 'neutral' },
          { label: 'Delivery Tracking', variant: 'cyan' },
          { label: 'Priorities', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openCreate}>
            Add New Program
          </Button>
        )}
      />

      <Row gutter={[20, 20]}>
        {projects.map((project) => (
          <Col xs={24} sm={12} lg={8} key={project.id}>
            <GlassCard
              hoverable
              gradient="gold"
              style={{ height: '100%' }}
              bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px' }}
              extra={
                <Space>
                  <Button
                    size="small"
                    onClick={() => openEdit(project)}
                    style={{ color: '#f5c400', borderColor: 'rgba(245, 196, 0, 0.3)' }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => handleDelete(project)}
                    style={{ borderColor: 'rgba(255, 79, 216, 0.3)' }}
                  >
                    Delete
                  </Button>
                </Space>
              }
            >
              <div style={{ marginBottom: 12 }}>
                <Space>
                  <TagPill variant={getStatusVariant(project.status)}>
                    {project.status.replace('-', ' ').toUpperCase()}
                  </TagPill>
                  <TagPill variant={getPriorityVariant(project.priority)}>
                    {project.priority.toUpperCase()}
                  </TagPill>
                </Space>
              </div>

              <h3 style={{ marginBottom: 8, fontSize: 16 }}>{project.title}</h3>
              <p style={{ color: '#666', marginBottom: 16, flex: 1 }}>{project.description}</p>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#999' }}>Progress</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{project.progress}%</span>
                </div>
                <Progress
                  percent={project.progress}
                  showInfo={false}
                  strokeColor={project.progress === 100 ? '#52c41a' : '#1890ff'}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <Avatar.Group maxCount={3} size="small">
                  {project.team.map((member, idx) => (
                    <Avatar
                      key={idx}
                      style={{ backgroundColor: '#1890ff' }}
                      icon={<UserOutlined />}
                    >
                      {member.name[0]}
                    </Avatar>
                  ))}
                </Avatar.Group>
                <span style={{ fontSize: 12, color: '#999' }}>
                  Due: {project.dueDate ? new Date(project.dueDate).toLocaleDateString() : 'Not set'}
                </span>
              </div>
            </GlassCard>
          </Col>
        ))}
      </Row>

      <Drawer
        title={editing ? 'Edit Program' : 'Add New Program'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        destroyOnClose
        closeIcon={
          <button
            type="button"
            aria-label="Close program editor"
            onClick={() => setDrawerOpen(false)}
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
        extra={<Button type="primary" onClick={() => form.submit()}>{editing ? 'Save' : 'Create'}</Button>}
      >
        <Form layout="vertical" form={form} onFinish={handleUpsert} initialValues={{ status: 'active', priority: 'normal', progress: 0, startDate: dayjs() }}>
          <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Please enter a title' }]}>
            <Input placeholder="e.g., Safety Training Program 2026" />
          </Form.Item>
          <Form.Item label="Description" name="description" rules={[{ required: true, message: 'Please enter a description' }]}>
            <Input.TextArea rows={3} placeholder="Short summary of the program" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Status" name="status" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'active', label: 'Active' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'on-hold', label: 'On Hold' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Priority" name="priority" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'urgent', label: 'Urgent' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'low', label: 'Low' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Start Date" name="startDate" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Due Date" name="dueDate" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Progress (%)" name="progress" rules={[{ required: true }]}>
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Team" name="team" tooltip="Type and press Enter to add names">
            <Select mode="tags" options={teamOptions} placeholder="Add team members" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
