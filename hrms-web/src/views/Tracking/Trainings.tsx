import React from 'react';
import MobileTable from '../../components/MobileTable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AutoComplete, Tag, Space, Button, Modal, Form, Input, Select, Upload, message } from 'antd';
import { UploadOutlined, PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import http from '../../lib/http';

interface Training {
  id: number;
  employee: number;
  training_type: number;
  provider: string;
  status: string;
  scheduled_date: string;
  completion_date?: string;
  expiry_date?: string;
}

export default function Trainings() {
  const qc = useQueryClient();
  const [workspaceId] = React.useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [open, setOpen] = React.useState(false);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Training | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [fileList, setFileList] = React.useState<any[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['trainings', workspaceId],
    queryFn: async () => (await http.get('/api/v1/tracking/trainings/')).data,
    enabled: !!workspaceId,
  });

  const rows: Training[] = data?.results ?? data ?? [];

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: trainingTypes = [] } = useQuery({
    queryKey: ['training-types', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/tracking/training-types/');
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const resolveTrainingTypeId = async (name: string) => {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new Error('Training type is required');
    }
    const existing = (trainingTypes || []).find((t: any) => String(t.name || '').toLowerCase() === trimmed.toLowerCase());
    if (existing?.id) return existing.id;
    const created = await http.post('/api/v1/tracking/training-types/', {
      name: trimmed,
      category: 'ADMINISTRATIVE',
    });
    const newType = created.data;
    if (newType?.id) {
      qc.invalidateQueries({ queryKey: ['training-types'] });
      return newType.id;
    }
    throw new Error('Unable to create training type');
  };

  const createMut = useMutation({
    mutationFn: async (vals: any) => {
      const attendees: number[] = vals.employees || [];
      if (!attendees.length) {
        throw new Error('Select at least one employee');
      }
      const trainingTypeId = await resolveTrainingTypeId(vals.training_type_name);
      const common = { ...vals, training_type: trainingTypeId };
      delete common.employees;
      delete common.training_type_name;
      const results = [] as any[];
      if (fileList.length > 0 && fileList[0].originFileObj) {
        common.attachment = fileList[0].originFileObj as File;
      }
      // Post one record per employee to ensure backend compatibility
      for (const empId of attendees) {
        const fd = new FormData();
        Object.entries({ ...common, employee: empId }).forEach(([k, v]: any) => v !== undefined && v !== null && fd.append(k, v));
        if (common.attachment) fd.append('certificate_document', common.attachment);
        const res = await http.post('/api/v1/tracking/trainings/', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        results.push(res.data);
      }
      return results;
    },
    onSuccess: () => {
      message.success('Training saved');
      setOpen(false);
      form.resetFields();
      setFileList([]);
      qc.invalidateQueries({ queryKey: ['trainings'] });
    },
    onError: () => message.error('Failed to save training'),
  });

  const updateMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!selected?.id) throw new Error('No training selected');
      const fd = new FormData();
      Object.entries(vals).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) fd.append(k, v);
      });
      if (fileList.length > 0 && fileList[0].originFileObj) {
        fd.append('certificate_document', fileList[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/tracking/trainings/${selected.id}/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      message.success('Training updated');
      setEditOpen(false);
      editForm.resetFields();
      setFileList([]);
      qc.invalidateQueries({ queryKey: ['trainings'] });
    },
    onError: () => message.error('Failed to update training'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/api/v1/tracking/trainings/${id}/`)).data,
    onSuccess: () => { message.success('Deleted'); qc.invalidateQueries({ queryKey: ['trainings'] }); },
    onError: () => message.error('Delete failed'),
  });

  return (
    <div style={{ padding: '24px' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add Training</Button>
      </Space>
      <MobileTable
        loading={isLoading}
        dataSource={rows}
        rowKey={(r: Training) => r.id}
        columns={[
          { title: 'Provider', dataIndex: 'provider' },
          { title: 'Scheduled', dataIndex: 'scheduled_date' },
          { title: 'Completion', dataIndex: 'completion_date' },
          { title: 'Expiry', dataIndex: 'expiry_date' },
          { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'COMPLETED' ? 'green' : 'blue'}>{s}</Tag> },
          {
            title: 'Action',
            key: 'action',
            render: (_: any, rec: Training) => (
              <Space>
                <EyeOutlined onClick={() => { setSelected(rec); setViewOpen(true); }} />
                <EditOutlined onClick={() => { setSelected(rec); editForm.setFieldsValue(rec); setEditOpen(true); }} />
                <DeleteOutlined onClick={() => deleteMut.mutate(rec.id)} style={{ cursor: 'pointer', color: '#ff4d4f' }} />
              </Space>
            )
          }
        ]}
      />

      <Modal
        title="Add Training"
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); setFileList([]); }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(vals) => createMut.mutate(vals)}>
          <Form.Item name="training_type_name" label="Training Type" rules={[{ required: true }]}>
            <AutoComplete
              placeholder="Type training type"
              options={(trainingTypes || []).map((t: any) => ({ value: t.name }))}
              filterOption={(input, option) => {
                const inputValue = String(input ?? '').toLowerCase();
                const optionValue = String(option?.value ?? '').toLowerCase();
                return optionValue.includes(inputValue);
              }}
            />
          </Form.Item>
          <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
            <Input placeholder="Training provider" />
          </Form.Item>
          <Form.Item name="scheduled_date" label="Scheduled Date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="employees" label="Employees" rules={[{ required: true, message: 'Select at least one employee' }]}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder="Select participants"
              optionFilterProp="label"
              options={(employees || []).map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))}
            />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Additional notes about training" />
          </Form.Item>
          <Form.Item label="Certificate Document">
            <Upload fileList={fileList || []} beforeUpload={() => false} onChange={({ fileList }) => setFileList(fileList || [])} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload Certificate</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="View Training"
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
      >
        {selected && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div><strong>Provider:</strong> {selected.provider}</div>
            <div><strong>Scheduled Date:</strong> {selected.scheduled_date}</div>
            <div><strong>Completion Date:</strong> {selected.completion_date || '-'}</div>
            <div><strong>Expiry Date:</strong> {selected.expiry_date || '-'}</div>
            <div><strong>Status:</strong> <Tag color={selected.status === 'COMPLETED' ? 'green' : 'blue'}>{selected.status}</Tag></div>
          </div>
        )}
      </Modal>

      <Modal
        title="Edit Training"
        open={editOpen}
        onCancel={() => { setEditOpen(false); editForm.resetFields(); setFileList([]); }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        width={640}
      >
        <Form form={editForm} layout="vertical" onFinish={(vals) => updateMut.mutate(vals)}>
          <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
            <Input placeholder="Training provider" />
          </Form.Item>
          <Form.Item name="scheduled_date" label="Scheduled Date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="completion_date" label="Completion Date">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="expiry_date" label="Expiry Date">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select options={[
              { label: 'Scheduled', value: 'SCHEDULED' },
              { label: 'In Progress', value: 'IN_PROGRESS' },
              { label: 'Completed', value: 'COMPLETED' },
            ]} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Additional notes about training" />
          </Form.Item>
          <Form.Item label="Certificate Document">
            <Upload fileList={fileList || []} beforeUpload={() => false} onChange={({ fileList }) => setFileList(fileList || [])} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload Certificate</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
