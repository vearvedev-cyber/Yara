import React, { useMemo } from 'react';
import MobileTable from '../../components/MobileTable';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Space, Modal, Form, Input, Select, Tag, message, Drawer } from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import http from '../../lib/http';
import { HeroBanner } from '../../components/HeroBanner';

interface Department {
  id: number;
  code: string;
  name: string;
  description: string;
  manager?: number;
  manager_name?: string;
  job_titles?: string[];
}

export default function Departments() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [isOpen, setIsOpen] = React.useState(false);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Department | null>(null);
  const [editing, setEditing] = React.useState<Department | null>(null);
  const [pendingSearch, setPendingSearch] = React.useState('');
  const [appliedSearch, setAppliedSearch] = React.useState('');
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      qc.removeQueries({ exact: false, queryKey: ['departments'] });
      qc.removeQueries({ exact: false, queryKey: ['employees-min'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [qc]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    qc.removeQueries({ exact: false, queryKey: ['departments'] });
    qc.removeQueries({ exact: false, queryKey: ['employees-min'] });
  }, [workspaceId, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ['departments', workspaceId, appliedSearch],
    queryFn: async () => (await http.get('/api/v1/hcm/departments/', {
      params: appliedSearch ? { search: appliedSearch } : {},
    })).data,
    enabled: !!workspaceId,
  });

  const rows: Department[] = data?.results ?? data ?? [];

  const { data: employees } = useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      const arr = res.data?.results ?? res.data ?? [];
      return Array.isArray(arr) ? arr : [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const employeeOptions = useMemo(
    () => (employees || []).map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` })),
    [employees],
  );

  const createMut = useMutation({
    mutationFn: async (payload: any) => (await http.post('/api/v1/hcm/departments/', payload)).data,
    onSuccess: () => {
      message.success('Department created');
      setIsOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['departments'], exact: false });
    },
    onError: () => message.error('Failed to create department'),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => (await http.put(`/api/v1/hcm/departments/${id}/`, payload)).data,
    onSuccess: () => {
      message.success('Department updated');
      setIsOpen(false);
      setEditing(null);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['departments'], exact: false });
    },
    onError: () => message.error('Failed to update department'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/api/v1/hcm/departments/${id}/`)).data,
    onSuccess: () => {
      message.success('Department deleted');
      qc.invalidateQueries({ queryKey: ['departments'], exact: false });
    },
    onError: () => message.error('Failed to delete department'),
  });

  return (
    <div style={{ padding: '24px' }}>
      <HeroBanner
        eyebrow="Human Capital"
        title="Departments"
        description="Manage department structures, managers, and mapped job titles across the organization."
        gradient="neutral"
        tags={[
          { label: 'Org Structure', variant: 'neutral' },
          { label: 'Department Leads', variant: 'cyan' },
          { label: 'Job Mapping', variant: 'lime' },
        ]}
      />
      <div className="mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space>
          <Input
            placeholder="Filter by code or name"
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Button icon={<SearchOutlined />} onClick={() => setAppliedSearch(pendingSearch.trim())}>Search</Button>
          <Button onClick={() => { setPendingSearch(''); setAppliedSearch(''); }}>Reset</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setIsOpen(true);
            }}
          >
            Add Department
          </Button>
        </Space>
      </div>
      <MobileTable
        loading={isLoading}
        dataSource={rows}
        rowKey={(r: Department) => r.id}
        columns={[
          {
            title: 'Action',
            key: 'action',
            width: 120,
            render: (_: any, rec: Department) => (
              <Space>
                <Button
                  size="small"
                  type="text"
                  icon={<EyeOutlined />}
                  onClick={() => { setSelected(rec); setViewOpen(true); }}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(rec);
                    form.setFieldsValue({
                      code: rec.code,
                      name: rec.name,
                      description: rec.description,
                      manager: rec.manager,
                      job_titles: rec.job_titles || [],
                    });
                    setIsOpen(true);
                  }}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleteMut.isPending}
                  onClick={() => Modal.confirm({
                    title: 'Delete Department',
                    content: `Delete ${rec.name}?`,
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    onOk: () => deleteMut.mutate(rec.id),
                  })}
                />
              </Space>
            )
          },
          { title: 'Code', dataIndex: 'code' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Description', dataIndex: 'description' },
          {
            title: 'Job Titles',
            dataIndex: 'job_titles',
            render: (vals?: string[]) => (vals && vals.length ? vals.map((v) => <Tag key={v}>{v}</Tag>) : '-')
          }
        ]}
      />

      <Modal
        title={editing ? 'Edit Department' : 'Add Department'}
        open={isOpen}
        onCancel={() => { setIsOpen(false); setEditing(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(vals) => {
          const payload = { ...vals };
          if (Array.isArray(vals.job_titles)) payload.job_titles = vals.job_titles;
          if (editing) {
            updateMut.mutate({ id: editing.id, payload });
          } else {
            createMut.mutate(payload);
          }
        }}>
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input placeholder="DEPT-001" />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Human Resources" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="What this department does" />
          </Form.Item>
          <Form.Item name="manager" label="Manager">
            <Select
              allowClear
              showSearch
              placeholder="Select manager"
              optionFilterProp="label"
              options={employeeOptions}
            />
          </Form.Item>
          <Form.Item name="job_titles" label="Job Titles">
            <Select mode="tags" placeholder="Add job titles (Enter to add)" tokenSeparators={[',']}></Select>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={selected ? `${selected.name} Details` : 'Department'}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        width={480}
        closeIcon={
          <button
            type="button"
            aria-label="Close department details"
            onClick={() => setViewOpen(false)}
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
        {selected ? (
          <div>
            <p><strong>Code:</strong> {selected.code}</p>
            <p><strong>Name:</strong> {selected.name}</p>
            <p><strong>Description:</strong> {selected.description || '-'}</p>
            <div style={{ marginTop: 12 }}>
              <strong>Job Titles</strong>
              <div style={{ marginTop: 8 }}>
                {selected.job_titles && selected.job_titles.length ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {selected.job_titles.map((t: string) => (
                      <div key={t}>{t}</div>
                    ))}
                  </div>
                ) : 'No titles'}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
