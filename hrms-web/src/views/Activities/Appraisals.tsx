import { useMemo, useState, useEffect } from 'react';
import MobileTable from '../../components/MobileTable';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag, message, Upload } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { addDevelopmentItem, addFactor, addImprovement, addNextObjective, addObjective, createAppraisal, deleteAppraisal, deleteDevelopmentItem, deleteImprovement, deleteNextObjectiveItem, deleteObjective, deleteFactor, listAppraisals, listDevelopmentItems, listFactors, listImprovements, listNextObjectives, listObjectives, ratingOptions, updateAppraisal, updateDevelopmentItem, updateImprovement, updateNextObjectiveItem, updateObjective, updateFactor } from '../../api/appraisals';
import { UploadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import http from '../../lib/http';
import { HeroBanner } from '../../components/HeroBanner';

const { RangePicker } = DatePicker;

function useEmployees(workspaceId: string | null) {
  return useQuery({
    queryKey: ['employees-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 100 } });
      const data = res.data?.results ?? res.data ?? [];
      return Array.isArray(data) ? data : [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

function useDepartments(workspaceId: string | null) {
  return useQuery({
    queryKey: ['departments-min', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/', { params: { page_size: 100 } });
      const data = res.data?.results ?? res.data ?? [];
      return Array.isArray(data) ? data : [];
    },
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export default function Appraisals() {
  const qc = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      qc.removeQueries({ queryKey: ['appraisals'] });
      qc.removeQueries({ queryKey: ['appraisal-objectives'] });
      qc.removeQueries({ queryKey: ['appraisal-factors'] });
      qc.removeQueries({ queryKey: ['appraisal-improvements'] });
      qc.removeQueries({ queryKey: ['appraisal-next-objectives'] });
      qc.removeQueries({ queryKey: ['appraisal-development-items'] });
      qc.removeQueries({ queryKey: ['employees-min'] });
      qc.removeQueries({ queryKey: ['departments-min'] });
      qc.removeQueries({ queryKey: ['jobs'] });
    };

    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [qc]);

  const [filters, setFilters] = useState<{
    search: string;
    department?: number;
    period: [dayjs.Dayjs, dayjs.Dayjs] | null;
  }>({
    search: '',
    department: undefined,
    period: null,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [manageId, setManageId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createForm] = Form.useForm();
  const [objectiveForm] = Form.useForm();
  const [factorForm] = Form.useForm();
  const [improveForm] = Form.useForm();
  const [nextObjForm] = Form.useForm();
  const [devForm] = Form.useForm();
  const [summaryForm] = Form.useForm();
  const selectedDepartment = Form.useWatch('department', createForm);
  const [objectiveEditingId, setObjectiveEditingId] = useState<number | null>(null);
  const [factorEditingId, setFactorEditingId] = useState<number | null>(null);
  const [improveEditingId, setImproveEditingId] = useState<number | null>(null);
  const [nextEditingId, setNextEditingId] = useState<number | null>(null);
  const [devEditingId, setDevEditingId] = useState<number | null>(null);

  const filterKey = useMemo(() => {
    const period = filters.period
      ? [filters.period[0].format('YYYY-MM-DD'), filters.period[1].format('YYYY-MM-DD')]
      : null;
    return {
      search: filters.search.trim(),
      department: filters.department ?? null,
      period,
    };
  }, [filters]);

  const { data: appraisalsData, isLoading } = useQuery({
    queryKey: ['appraisals', filterKey, workspaceId],
    queryFn: () => {
      const params: Record<string, string | number> = {};
      if (filterKey.search) params.search = filterKey.search;
      if (filterKey.department) params.department = filterKey.department;
      if (filterKey.period) {
        params.review_start__gte = filterKey.period[0];
        params.review_end__lte = filterKey.period[1];
      }
      return listAppraisals(params);
    },
    enabled: !!workspaceId,
  });
  const appraisals = useMemo(() => appraisalsData?.results ?? appraisalsData ?? [], [appraisalsData]);
  const selectedAppraisal: any = useMemo(() => appraisals.find((a: any) => a.id === manageId) || null, [appraisals, manageId]);

  const { data: employees = [] } = useEmployees(workspaceId);
  const { data: departments = [] } = useDepartments(workspaceId);
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', selectedDepartment, workspaceId],
    queryFn: async () => {
      const params = selectedDepartment ? { department: selectedDepartment, page_size: 200 } : { page_size: 200 };
      const res = await http.get('/api/v1/hcm/jobs/', { params });
      return res.data?.results ?? res.data ?? [];
    },
    enabled: !!workspaceId,
  });

  const createMut = useMutation({
    mutationFn: async (vals: any) => {
      const payload = {
        appraisee: vals.appraisee,
        supervisor: vals.supervisor || null,
        department: vals.department || null,
        position_held: vals.position_held,
        review_start: vals.review_start?.format('YYYY-MM-DD'),
        review_end: vals.review_end?.format('YYYY-MM-DD'),
        overall_percentage: vals.overall_percentage ?? null,
        overall_rating: vals.overall_rating ?? null,
        employee_comments: vals.employee_comments ?? '',
        supervisor_comments: vals.supervisor_comments ?? '',
        feedback_notes: vals.feedback_notes ?? '',
      };
      if (editingId) {
        return updateAppraisal(editingId, payload);
      }
      return createAppraisal(payload);
    },
    onSuccess: () => {
      message.success(editingId ? 'Appraisal updated' : 'Appraisal created');
      setCreateOpen(false);
      setEditingId(null);
      createForm.resetFields();
      qc.invalidateQueries({ queryKey: ['appraisals'] });
    },
    onError: () => message.error('Could not create appraisal'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => deleteAppraisal(id),
    onSuccess: () => {
      message.success('Appraisal deleted');
      qc.invalidateQueries({ queryKey: ['appraisals'] });
    },
    onError: () => message.error('Could not delete appraisal'),
  });

  const { data: objectives = [] } = useQuery({
    queryKey: ['appraisal-objectives', manageId, workspaceId],
    enabled: !!manageId,
    queryFn: () => listObjectives(manageId as number),
  });

  const { data: perfFactors = [] } = useQuery({
    queryKey: ['appraisal-factors', manageId, 'PERFORMANCE', workspaceId],
    enabled: !!manageId,
    queryFn: () => listFactors(manageId as number, 'PERFORMANCE'),
  });
  const { data: behFactors = [] } = useQuery({
    queryKey: ['appraisal-factors', manageId, 'BEHAVIORAL', workspaceId],
    enabled: !!manageId,
    queryFn: () => listFactors(manageId as number, 'BEHAVIORAL'),
  });
  const { data: supFactors = [] } = useQuery({
    queryKey: ['appraisal-factors', manageId, 'SUPERVISORY', workspaceId],
    enabled: !!manageId,
    queryFn: () => listFactors(manageId as number, 'SUPERVISORY'),
  });

  const addObjectiveMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      const payload = {
        appraisal: manageId,
        title: vals.title,
        self_rating: vals.self_rating ?? null,
        supervisor_rating: vals.supervisor_rating ?? null,
        agreed_rating: vals.agreed_rating ?? null,
        comments: vals.comments ?? '',
        order: vals.order ?? 0,
      } as any;
      if (objectiveEditingId) return updateObjective(objectiveEditingId, payload);
      return addObjective(payload);
    },
    onSuccess: () => {
      message.success(objectiveEditingId ? 'Objective updated' : 'Objective added');
      objectiveForm.resetFields();
      setObjectiveEditingId(null);
      qc.invalidateQueries({ queryKey: ['appraisal-objectives', manageId] });
    },
    onError: () => message.error('Could not add objective'),
  });

  const addFactorMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      const payload = {
        appraisal: manageId,
        group: vals.group,
        name: vals.name,
        rating: vals.rating ?? null,
        notes: vals.notes ?? '',
        order: vals.order ?? 0,
      } as any;
      if (factorEditingId) return updateFactor(factorEditingId, payload);
      return addFactor(payload);
    },
    onSuccess: () => {
      message.success(factorEditingId ? 'Factor updated' : 'Factor added');
      factorForm.resetFields();
      setFactorEditingId(null);
      qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'PERFORMANCE'] });
      qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'BEHAVIORAL'] });
      qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'SUPERVISORY'] });
    },
    onError: () => message.error('Could not add factor'),
  });

  const { data: improvements = [] } = useQuery({
    queryKey: ['appraisal-improvements', manageId, workspaceId],
    enabled: !!manageId,
    queryFn: () => listImprovements(manageId as number),
  });

  const { data: nextObjectives = [] } = useQuery({
    queryKey: ['appraisal-next-objectives', manageId, workspaceId],
    enabled: !!manageId,
    queryFn: () => listNextObjectives(manageId as number),
  });

  const { data: devItems = [] } = useQuery({
    queryKey: ['appraisal-development-items', manageId, workspaceId],
    enabled: !!manageId,
    queryFn: () => listDevelopmentItems(manageId as number),
  });

  const addImprovementMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      const payload = {
        appraisal: manageId,
        issue: vals.issue,
        limiting_factors: vals.limiting_factors ?? '',
        actions: vals.actions ?? '',
        completion_indicator: vals.completion_indicator ?? '',
        due_date: vals.due_date ? vals.due_date.format('YYYY-MM-DD') : null,
      } as any;
      if (improveEditingId) return updateImprovement(improveEditingId, payload);
      return addImprovement(payload);
    },
    onSuccess: () => {
      message.success(improveEditingId ? 'Improvement item updated' : 'Improvement item added');
      improveForm.resetFields();
      setImproveEditingId(null);
      qc.invalidateQueries({ queryKey: ['appraisal-improvements', manageId] });
    },
    onError: () => message.error('Could not add improvement item'),
  });

  const addNextObjectiveMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      const payload = {
        appraisal: manageId,
        key_area: vals.key_area ?? '',
        objective: vals.objective,
        indicators: vals.indicators ?? '',
      } as any;
      if (nextEditingId) return updateNextObjectiveItem(nextEditingId, payload);
      return addNextObjective(payload);
    },
    onSuccess: () => {
      message.success(nextEditingId ? 'Next objective updated' : 'Next period objective added');
      nextObjForm.resetFields();
      setNextEditingId(null);
      qc.invalidateQueries({ queryKey: ['appraisal-next-objectives', manageId] });
    },
    onError: () => message.error('Could not add next objective'),
  });

  const addDevItemMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      const payload = {
        appraisal: manageId,
        training_need: vals.training_need,
        action: vals.action ?? '',
        responsible: vals.responsible ?? '',
        due_date: vals.due_date ? vals.due_date.format('YYYY-MM-DD') : null,
        application_note: vals.application_note ?? '',
        review_date: vals.review_date ? vals.review_date.format('YYYY-MM-DD') : null,
      } as any;
      if (devEditingId) return updateDevelopmentItem(devEditingId, payload);
      return addDevelopmentItem(payload);
    },
    onSuccess: () => {
      message.success(devEditingId ? 'Development item updated' : 'Development plan item added');
      devForm.resetFields();
      setDevEditingId(null);
      qc.invalidateQueries({ queryKey: ['appraisal-development-items', manageId] });
    },
    onError: () => message.error('Could not add development item'),
  });

  const updateSummaryMut = useMutation({
    mutationFn: async (vals: any) => {
      if (!manageId) return;
      return updateAppraisal(manageId, {
        overall_percentage: vals.overall_percentage ?? null,
        overall_rating: vals.overall_rating ?? null,
        employee_comments: vals.employee_comments ?? '',
        supervisor_comments: vals.supervisor_comments ?? '',
        feedback_notes: vals.feedback_notes ?? '',
      });
    },
    onSuccess: () => {
      message.success('Appraisal updated');
      qc.invalidateQueries({ queryKey: ['appraisals'] });
    },
    onError: () => message.error('Could not update appraisal'),
  });

  const columns = [
    { title: 'Appraisee', dataIndex: 'appraisee_name' },
    { title: 'Supervisor', dataIndex: 'supervisor_name' },
    { title: 'Department', dataIndex: 'department_name' },
    { title: 'Position', dataIndex: 'position_held' },
    { title: 'Period', render: (r: any) => `${r.review_start} → ${r.review_end}` },
    {
      title: 'Overall', render: (r: any) => {
        const opt = ratingOptions.find(o => o.value === r.overall_rating);
        return r.overall_percentage ? <Tag color="gold">{r.overall_percentage}% {opt?.label?.split(' ')?.[0]}</Tag> : (opt?.label || '-')
      }
    },
    {
      title: 'Action', render: (_: any, r: any) => (
        <Space>
          <Button type="link" onClick={() => setManageId(r.id)}>Manage</Button>
          <EditOutlined
            style={{ cursor: 'pointer', color: '#52c41a' }}
            onClick={() => {
              setEditingId(r.id);
              setCreateOpen(true);
              createForm.setFieldsValue({
                appraisee: r.appraisee,
                supervisor: r.supervisor ?? null,
                department: r.department ?? null,
                position_held: r.position_held,
                review_start: dayjs(r.review_start),
                review_end: dayjs(r.review_end),
                overall_percentage: r.overall_percentage ?? null,
                overall_rating: r.overall_rating ?? null,
                employee_comments: r.employee_comments ?? '',
                supervisor_comments: r.supervisor_comments ?? '',
                feedback_notes: r.feedback_notes ?? '',
              });
            }}
          />
          <DeleteOutlined
            style={{ cursor: 'pointer', color: '#ff4d4f' }}
            onClick={() => {
              Modal.confirm({
                title: 'Delete Appraisal',
                content: 'Are you sure you want to delete this appraisal?',
                okText: 'Delete',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: () => deleteMut.mutate(r.id),
              });
            }}
          />
        </Space>
      )
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Activities"
        title="Appraisals"
        description="Manage performance appraisals, objectives, factors, and development follow-ups in one workflow."
        gradient="neutral"
        tags={[
          { label: 'Performance Reviews', variant: 'neutral' },
          { label: 'Objectives', variant: 'cyan' },
          { label: 'Development Plans', variant: 'lime' },
        ]}
        actions={(
          <Button type="primary" size="large" onClick={() => setCreateOpen(true)}>
            New Appraisal
          </Button>
        )}
      />
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            allowClear
            placeholder="Search appraisee name or ID"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder="Department"
            value={filters.department}
            onChange={(value) => setFilters((prev) => ({ ...prev, department: value }))}
            style={{ width: 220 }}
          >
            {departments.map((dept: any) => (
              <Select.Option key={dept.id} value={dept.id}>
                {dept.name}
              </Select.Option>
            ))}
          </Select>
          <RangePicker
            value={filters.period}
            onChange={(dates) =>
              setFilters((prev) => ({
                ...prev,
                period: dates && dates[0] && dates[1] ? [dates[0], dates[1]] : null,
              }))
            }
          />
          <Button
            onClick={() =>
              setFilters({
                search: '',
                department: undefined,
                period: null,
              })
            }
          >
            Reset
          </Button>
        </Space>
      </Card>
      <Card>
        <MobileTable rowKey={(r: any) => r.id} loading={isLoading} columns={columns as any} dataSource={appraisals} />
      </Card>

      <Modal
        title={editingId ? `Edit Appraisal #${editingId}` : 'New Appraisal'}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); setEditingId(null); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        okText={editingId ? 'Save' : 'Create'}
        confirmLoading={createMut.isPending}
        destroyOnClose
      >
        <Form layout="vertical" form={createForm} onFinish={(vals) => createMut.mutate(vals)}>
          <Form.Item name="appraisee" label="Appraisee" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={employees.map((e: any) => ({ value: e.id, label: e.full_name }))} />
          </Form.Item>
          <Form.Item name="supervisor" label="Supervisor">
            <Select allowClear showSearch optionFilterProp="label" options={employees.map((e: any) => ({ value: e.id, label: e.full_name }))} />
          </Form.Item>
          <Form.Item name="department" label="Department">
            <Select allowClear showSearch optionFilterProp="label" options={departments.map((d: any) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="position_held" label="Position Held" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select position"
              options={(jobs || []).map((j: any) => ({ value: j.title, label: j.title }))}
            />
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="review_start" label="Review Start" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="review_end" label="Review End" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }}>
            <Form.Item name="overall_percentage" label="Overall %">
              <InputNumber min={0} max={100} />
            </Form.Item>
            <Form.Item name="overall_rating" label="Overall Rating">
              <Select allowClear options={ratingOptions} />
            </Form.Item>
          </Space>
          <Form.Item name="employee_comments" label="Employee Comments">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="supervisor_comments" label="Supervisor Comments">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="feedback_notes" label="360° Feedback Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        width={920}
        title={manageId ? `Manage Appraisal #${manageId}` : ''}
        open={!!manageId}
        onClose={() => setManageId(null)}
        destroyOnClose
        closeIcon={
          <button
            type="button"
            aria-label="Close appraisal manager"
            onClick={() => setManageId(null)}
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
        <Tabs
          items={[
            {
              key: 'objectives',
              label: 'Objectives',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Card title="Add Objective">
                    <Form layout="vertical" form={objectiveForm} onFinish={(v) => addObjectiveMut.mutate(v)}>
                      <Form.Item name="title" label="Objective" rules={[{ required: true }]}>
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space style={{ width: '100%' }}>
                        <Form.Item name="self_rating" label="Self">
                          <Select allowClear options={ratingOptions} style={{ minWidth: 160 }} />
                        </Form.Item>
                        <Form.Item name="supervisor_rating" label="Supervisor">
                          <Select allowClear options={ratingOptions} style={{ minWidth: 160 }} />
                        </Form.Item>
                        <Form.Item name="agreed_rating" label="Agreed">
                          <Select allowClear options={ratingOptions} style={{ minWidth: 160 }} />
                        </Form.Item>
                        <Form.Item name="order" label="#">
                          <InputNumber min={0} style={{ width: 100 }} />
                        </Form.Item>
                      </Space>
                      <Form.Item name="comments" label="Comments">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space>
                        <Button onClick={() => { objectiveForm.resetFields(); setObjectiveEditingId(null); }}>Reset</Button>
                        <Button type="primary" onClick={() => objectiveForm.submit()} loading={addObjectiveMut.isPending}>{objectiveEditingId ? 'Save' : 'Add'}</Button>
                      </Space>
                    </Form>
                  </Card>
                  <Card title="Objectives List">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={objectives} columns={[
                      { title: '#', dataIndex: 'order', width: 70 },
                      { title: 'Title', dataIndex: 'title' },
                      { title: 'Self', dataIndex: 'self_rating', width: 90 },
                      { title: 'Supervisor', dataIndex: 'supervisor_rating', width: 120 },
                      { title: 'Agreed', dataIndex: 'agreed_rating', width: 100 },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setObjectiveEditingId(r.id);
                              objectiveForm.setFieldsValue({
                                title: r.title,
                                self_rating: r.self_rating ?? null,
                                supervisor_rating: r.supervisor_rating ?? null,
                                agreed_rating: r.agreed_rating ?? null,
                                comments: r.comments ?? '',
                                order: r.order ?? 0,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Objective',
                                content: 'Are you sure you want to delete this objective?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteObjective(r.id);
                                  message.success('Objective deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-objectives', manageId] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                </Space>
              )
            },
            {
              key: 'factors',
              label: 'Factors',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Card title="Add Factor">
                    <Form layout="vertical" form={factorForm} onFinish={(v) => addFactorMut.mutate(v)}>
                      <Space style={{ width: '100%' }}>
                        <Form.Item name="group" label="Group" rules={[{ required: true }]}>
                          <Select style={{ minWidth: 220 }} options={[
                            { value: 'PERFORMANCE', label: 'Performance' },
                            { value: 'BEHAVIORAL', label: 'Behavioral' },
                            { value: 'SUPERVISORY', label: 'Supervisory' },
                          ]} />
                        </Form.Item>
                        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                          <Input style={{ minWidth: 280 }} />
                        </Form.Item>
                        <Form.Item name="rating" label="Rating">
                          <Select allowClear options={ratingOptions} style={{ minWidth: 160 }} />
                        </Form.Item>
                        <Form.Item name="order" label="#">
                          <InputNumber min={0} style={{ width: 100 }} />
                        </Form.Item>
                      </Space>
                      <Form.Item name="notes" label="Notes">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space>
                        <Button onClick={() => { factorForm.resetFields(); setFactorEditingId(null); }}>Reset</Button>
                        <Button type="primary" onClick={() => factorForm.submit()} loading={addFactorMut.isPending}>{factorEditingId ? 'Save' : 'Add'}</Button>
                      </Space>
                    </Form>
                  </Card>
                  <Card title="Performance Factors">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={perfFactors} columns={[
                      { title: '#', dataIndex: 'order', width: 70 },
                      { title: 'Name', dataIndex: 'name' },
                      { title: 'Rating', dataIndex: 'rating', width: 100 },
                      { title: 'Notes', dataIndex: 'notes' },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setFactorEditingId(r.id);
                              factorForm.setFieldsValue({
                                group: r.group,
                                name: r.name,
                                rating: r.rating ?? null,
                                notes: r.notes ?? '',
                                order: r.order ?? 0,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Factor',
                                content: 'Delete this factor?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteFactor(r.id);
                                  message.success('Factor deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'PERFORMANCE'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'BEHAVIORAL'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'SUPERVISORY'] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                  <Card title="Behavioral Traits">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={behFactors} columns={[
                      { title: '#', dataIndex: 'order', width: 70 },
                      { title: 'Name', dataIndex: 'name' },
                      { title: 'Rating', dataIndex: 'rating', width: 100 },
                      { title: 'Notes', dataIndex: 'notes' },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setFactorEditingId(r.id);
                              factorForm.setFieldsValue({
                                group: r.group,
                                name: r.name,
                                rating: r.rating ?? null,
                                notes: r.notes ?? '',
                                order: r.order ?? 0,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Factor',
                                content: 'Delete this factor?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteFactor(r.id);
                                  message.success('Factor deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'PERFORMANCE'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'BEHAVIORAL'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'SUPERVISORY'] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                  <Card title="Supervisory Factors">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={supFactors} columns={[
                      { title: '#', dataIndex: 'order', width: 70 },
                      { title: 'Name', dataIndex: 'name' },
                      { title: 'Rating', dataIndex: 'rating', width: 100 },
                      { title: 'Notes', dataIndex: 'notes' },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setFactorEditingId(r.id);
                              factorForm.setFieldsValue({
                                group: r.group,
                                name: r.name,
                                rating: r.rating ?? null,
                                notes: r.notes ?? '',
                                order: r.order ?? 0,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Factor',
                                content: 'Delete this factor?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteFactor(r.id);
                                  message.success('Factor deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'PERFORMANCE'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'BEHAVIORAL'] });
                                  qc.invalidateQueries({ queryKey: ['appraisal-factors', manageId, 'SUPERVISORY'] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                </Space>
              )
            },
            {
              key: 'improvement',
              label: 'Improvement Plan',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Card title="Add Improvement Item">
                    <Form layout="vertical" form={improveForm} onFinish={(v) => addImprovementMut.mutate(v)}>
                      <Form.Item name="issue" label="Issue / Area for Improvement" rules={[{ required: true }]}>
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Form.Item name="limiting_factors" label="Limiting Factors">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Form.Item name="actions" label="Actions to Accomplish Success">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space style={{ width: '100%' }}>
                        <Form.Item name="completion_indicator" label="Completion Indicators">
                          <Input.TextArea rows={1} />
                        </Form.Item>
                        <Form.Item name="due_date" label="Due Date">
                          <DatePicker />
                        </Form.Item>
                      </Space>
                      <Space>
                        <Button onClick={() => { improveForm.resetFields(); setImproveEditingId(null); }}>Reset</Button>
                        <Button type="primary" onClick={() => improveForm.submit()} loading={addImprovementMut.isPending}>{improveEditingId ? 'Save' : 'Add'}</Button>
                      </Space>
                    </Form>
                  </Card>
                  <Card title="Improvement Items">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={improvements} columns={[
                      { title: 'Issue', dataIndex: 'issue' },
                      { title: 'Limiting Factors', dataIndex: 'limiting_factors' },
                      { title: 'Actions', dataIndex: 'actions' },
                      { title: 'Indicators', dataIndex: 'completion_indicator' },
                      { title: 'Due', dataIndex: 'due_date', width: 120 },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setImproveEditingId(r.id);
                              improveForm.setFieldsValue({
                                issue: r.issue,
                                limiting_factors: r.limiting_factors ?? '',
                                actions: r.actions ?? '',
                                completion_indicator: r.completion_indicator ?? '',
                                due_date: r.due_date ? dayjs(r.due_date) : null,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Improvement Item',
                                content: 'Delete this improvement item?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteImprovement(r.id);
                                  message.success('Improvement item deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-improvements', manageId] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                </Space>
              )
            },
            {
              key: 'next-period',
              label: 'Next Period Objectives',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Card title="Add Next Objective">
                    <Form layout="vertical" form={nextObjForm} onFinish={(v) => addNextObjectiveMut.mutate(v)}>
                      <Space style={{ width: '100%' }}>
                        <Form.Item name="key_area" label="Key Area">
                          <Input style={{ minWidth: 220 }} />
                        </Form.Item>
                        <Form.Item name="objective" label="Objective" rules={[{ required: true }]}>
                          <Input.TextArea rows={2} style={{ minWidth: 420 }} />
                        </Form.Item>
                      </Space>
                      <Form.Item name="indicators" label="Performance Indicators">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space>
                        <Button onClick={() => { nextObjForm.resetFields(); setNextEditingId(null); }}>Reset</Button>
                        <Button type="primary" onClick={() => nextObjForm.submit()} loading={addNextObjectiveMut.isPending}>{nextEditingId ? 'Save' : 'Add'}</Button>
                      </Space>
                    </Form>
                  </Card>
                  <Card title="Next Period Objectives">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={nextObjectives} columns={[
                      { title: 'Key Area', dataIndex: 'key_area', width: 180 },
                      { title: 'Objective', dataIndex: 'objective' },
                      { title: 'Indicators', dataIndex: 'indicators' },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setNextEditingId(r.id);
                              nextObjForm.setFieldsValue({
                                key_area: r.key_area ?? '',
                                objective: r.objective,
                                indicators: r.indicators ?? '',
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Objective',
                                content: 'Delete this next objective?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteNextObjectiveItem(r.id);
                                  message.success('Next objective deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-next-objectives', manageId] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                </Space>
              )
            },
            {
              key: 'development',
              label: 'Development Plan',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Card title="Add Development Item">
                    <Form layout="vertical" form={devForm} onFinish={(v) => addDevItemMut.mutate(v)}>
                      <Form.Item name="training_need" label="Training/Development Need" rules={[{ required: true }]}>
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Space style={{ width: '100%' }}>
                        <Form.Item name="action" label="Action">
                          <Input style={{ minWidth: 220 }} />
                        </Form.Item>
                        <Form.Item name="responsible" label="Responsible">
                          <Input style={{ minWidth: 220 }} />
                        </Form.Item>
                        <Form.Item name="due_date" label="Due Date">
                          <DatePicker />
                        </Form.Item>
                      </Space>
                      <Form.Item name="application_note" label="How learning will be applied">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                      <Form.Item name="review_date" label="Review Date">
                        <DatePicker />
                      </Form.Item>
                      <Space>
                        <Button onClick={() => { devForm.resetFields(); setDevEditingId(null); }}>Reset</Button>
                        <Button type="primary" onClick={() => devForm.submit()} loading={addDevItemMut.isPending}>{devEditingId ? 'Save' : 'Add'}</Button>
                      </Space>
                    </Form>
                  </Card>
                  <Card title="Development Plan">
                    <MobileTable rowKey={(r: any) => r.id} size="small" dataSource={devItems} columns={[
                      { title: 'Training Need', dataIndex: 'training_need' },
                      { title: 'Action', dataIndex: 'action' },
                      { title: 'Responsible', dataIndex: 'responsible' },
                      { title: 'Due', dataIndex: 'due_date', width: 120 },
                      { title: 'Application', dataIndex: 'application_note' },
                      { title: 'Review', dataIndex: 'review_date', width: 120 },
                      {
                        title: 'Action', width: 160, render: (_: any, r: any) => (
                          <Space>
                            <Button size="small" onClick={() => {
                              setDevEditingId(r.id);
                              devForm.setFieldsValue({
                                training_need: r.training_need,
                                action: r.action ?? '',
                                responsible: r.responsible ?? '',
                                due_date: r.due_date ? dayjs(r.due_date) : null,
                                application_note: r.application_note ?? '',
                                review_date: r.review_date ? dayjs(r.review_date) : null,
                              });
                            }}>Edit</Button>
                            <Button size="small" danger onClick={() => {
                              Modal.confirm({
                                title: 'Delete Development Item',
                                content: 'Delete this development item?',
                                okText: 'Delete',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: async () => {
                                  await deleteDevelopmentItem(r.id);
                                  message.success('Development item deleted');
                                  qc.invalidateQueries({ queryKey: ['appraisal-development-items', manageId] });
                                },
                              });
                            }}>Delete</Button>
                          </Space>
                        )
                      }
                    ] as any} />
                  </Card>
                </Space>
              )
            },
            {
              key: 'summary',
              label: 'Summary',
              children: (
                <Card title="Overall & Comments">
                  <Form
                    layout="vertical"
                    form={summaryForm}
                    initialValues={{
                      overall_percentage: selectedAppraisal?.overall_percentage,
                      overall_rating: selectedAppraisal?.overall_rating,
                      employee_comments: selectedAppraisal?.employee_comments,
                      supervisor_comments: selectedAppraisal?.supervisor_comments,
                      feedback_notes: selectedAppraisal?.feedback_notes,
                    }}
                    onFinish={(v) => updateSummaryMut.mutate(v)}
                  >
                    <Space style={{ width: '100%' }}>
                      <Form.Item name="overall_percentage" label="Overall %">
                        <InputNumber min={0} max={100} />
                      </Form.Item>
                      <Form.Item name="overall_rating" label="Overall Rating">
                        <Select allowClear options={ratingOptions} style={{ minWidth: 160 }} />
                      </Form.Item>
                    </Space>
                    <Form.Item name="employee_comments" label="Employee Comments">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="supervisor_comments" label="Supervisor Comments">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="feedback_notes" label="360° Feedback Notes">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Space>
                      <Button onClick={() => summaryForm.resetFields()}>Reset</Button>
                      <Button type="primary" htmlType="submit" loading={updateSummaryMut.isPending}>Save</Button>
                    </Space>
                  </Form>
                  <div style={{ marginTop: 24 }}>
                    <h4>Appraisal Attachment</h4>
                    {selectedAppraisal?.attachment && (
                      <div style={{ marginBottom: 8 }}>
                        <a href={selectedAppraisal.attachment} target="_blank">Download current attachment</a>
                      </div>
                    )}
                    <Upload
                      beforeUpload={() => false}
                      maxCount={1}
                      onChange={async ({ fileList }) => {
                        const file = fileList[0]?.originFileObj as File | undefined;
                        if (!file || !manageId) return;
                        const fd = new FormData();
                        fd.append('attachment', file);
                        try {
                          await http.patch(`/api/v1/activities/appraisals/${manageId}/`, fd);
                          message.success('Attachment uploaded');
                          qc.invalidateQueries({ queryKey: ['appraisals'] });
                        } catch {
                          message.error('Failed to upload attachment');
                        }
                      }}
                    >
                      <Button icon={<UploadOutlined />}>Upload Attachment</Button>
                    </Upload>
                  </div>
                </Card>
              )
            }
          ]}
        />
      </Drawer>
    </div>
  );
}
