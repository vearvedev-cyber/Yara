import { Calendar, Form, Input, Select, DatePicker, Button, message, Tag, Tabs, Space, Upload } from 'antd';
import { Modal } from '@/components/overlays';
import MobileTable from '../../components/MobileTable';
import { UploadOutlined } from '@ant-design/icons';
import { PlusOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import http from '../../lib/http';

interface ScheduleEvent {
  id: number;
  title: string;
  description: string;
  date: string;
  type: 'hearing' | 'investigation' | 'charge' | 'report' | 'training' | 'medical' | 'leave' | 'meeting' | 'travel' | 'other';
  caseStudy: string;
  caseStudyId: string | number | null;
  status: 'scheduled' | 'completed' | 'cancelled';
}

export default function Schedule() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['schedule-events'] });
      queryClient.removeQueries({ exact: false, queryKey: ['trainings'] });
      queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
      queryClient.removeQueries({ exact: false, queryKey: ['case-studies'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['schedule-events'] });
    queryClient.removeQueries({ exact: false, queryKey: ['trainings'] });
    queryClient.removeQueries({ exact: false, queryKey: ['employees-list'] });
    queryClient.removeQueries({ exact: false, queryKey: ['case-studies'] });
  }, [workspaceId, queryClient]);

  const [form] = Form.useForm();
  const [trainingForm] = Form.useForm();
  const [modalVisible, setModalVisible] = useState(false);
  const [trainingModalVisible, setTrainingModalVisible] = useState(false);
  const [certFiles, setCertFiles] = useState<any[]>([]);
  const [editingTraining, setEditingTraining] = useState<any>(null);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleEvent | null>(null);
  const [viewingSchedule, setViewingSchedule] = useState<ScheduleEvent | null>(null);

  // Fetch schedule events from API
  const { data: scheduleData = [] } = useQuery({
    queryKey: ['schedule-events', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/activities/schedule-events/');
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const events: ScheduleEvent[] = scheduleData.map((e: any) => {
    // Handle case_study as either ID or object with title
    let caseStudyDisplay = 'N/A';
    let caseStudyId: string | number | null = null;
    if (e.case_study) {
      if (typeof e.case_study === 'object') {
        caseStudyId = e.case_study.id;
        caseStudyDisplay = `${e.case_study.reference_number || e.case_study.id} - ${e.case_study.title || 'Untitled'}`;
      } else {
        caseStudyId = e.case_study;
        caseStudyDisplay = String(e.case_study);
      }
    }
    return {
      id: e.id,
      title: e.title,
      description: e.description || '',
      date: e.date,
      type: e.type,
      caseStudy: caseStudyDisplay,
      caseStudyId,
      status: e.status,
    };
  });

  // Fetch trainings from API
  const { data: trainingsData, isLoading: trainingsLoading } = useQuery({
    queryKey: ['trainings', workspaceId],
    queryFn: async () => (await http.get('/api/v1/tracking/trainings/')).data,
    enabled: !!workspaceId,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-list', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 200 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: caseStudies = [] } = useQuery({
    queryKey: ['case-studies', workspaceId],
    queryFn: async () => {
      const res = await http.get('/api/v1/activities/case-studies/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
    enabled: !!workspaceId,
  });

  const { data: trainingTypes } = useQuery({
    queryKey: ['training-types'],
    queryFn: async () => (await http.get('/api/v1/tracking/training-types/')).data,
  });

  const createScheduleEventMutation = useMutation({
    mutationFn: async (values: any) => {
      return (await http.post('/api/v1/activities/schedule-events/', {
        title: values.title,
        description: values.description || '',
        date: values.date.format('YYYY-MM-DD'),
        type: values.type,
        case_study: values.caseStudy || '',
        status: 'scheduled',
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-events', workspaceId] });
      message.success('Schedule added successfully');
      setModalVisible(false);
      form.resetFields();
      setEditingSchedule(null);
    },
    onError: () => {
      message.error('Failed to add schedule');
    },
  });

  const updateScheduleEventMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      return (await http.patch(`/api/v1/activities/schedule-events/${id}/`, {
        title: values.title,
        description: values.description || '',
        date: values.date.format('YYYY-MM-DD'),
        type: values.type,
        case_study: values.caseStudy || '',
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-events', workspaceId] });
      message.success('Schedule updated successfully');
      setModalVisible(false);
      form.resetFields();
      setEditingSchedule(null);
    },
    onError: () => {
      message.error('Failed to update schedule');
    },
  });

  const deleteScheduleEventMutation = useMutation({
    mutationFn: async (id: number) => {
      return (await http.delete(`/api/v1/activities/schedule-events/${id}/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-events', workspaceId] });
      message.success('Schedule deleted');
    },
    onError: () => {
      message.error('Failed to delete schedule');
    },
  });

  const createTrainingMutation = useMutation({
    mutationFn: async (values: any) => {
      const fd = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) fd.append(k, v);
      });
      if (certFiles.length > 0 && certFiles[0].originFileObj) {
        fd.append('certificate_document', certFiles[0].originFileObj as File);
      }
      return (await http.post('/api/v1/tracking/trainings/', fd)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainings', workspaceId] });
      message.success('Training created successfully');
      setTrainingModalVisible(false);
      trainingForm.resetFields();
      setCertFiles([]);
      setEditingTraining(null);
    },
    onError: () => {
      message.error('Failed to create training');
    },
  });

  const updateTrainingMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => {
      const fd = new FormData();
      Object.entries(values).forEach(([k, v]: any) => {
        if (v !== undefined && v !== null) fd.append(k, v);
      });
      if (certFiles.length > 0 && certFiles[0].originFileObj) {
        fd.append('certificate_document', certFiles[0].originFileObj as File);
      }
      return (await http.patch(`/api/v1/tracking/trainings/${id}/`, fd)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainings', workspaceId] });
      message.success('Training updated successfully');
      setTrainingModalVisible(false);
      trainingForm.resetFields();
      setCertFiles([]);
      setEditingTraining(null);
    },
    onError: () => {
      message.error('Failed to update training');
    },
  });

  const handleAddEvent = async (values: any) => {
    if (editingSchedule) {
      updateScheduleEventMutation.mutate({ id: editingSchedule.id, values });
    } else {
      createScheduleEventMutation.mutate(values);
    }
  };

  const handleEditSchedule = (event: ScheduleEvent) => {
    setEditingSchedule(event);
    form.setFieldsValue({
      title: event.title,
      description: event.description,
      type: event.type,
      caseStudy: event.caseStudyId || undefined,
      date: event.date ? dayjs(event.date) : null,
    });
    setModalVisible(true);
  };

  const handleDeleteSchedule = (event: ScheduleEvent) => {
    Modal.confirm({
      title: 'Delete Schedule',
      content: 'Are you sure you want to delete this schedule?',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => deleteScheduleEventMutation.mutate(event.id),
    });
  };

  const handleTrainingSubmit = async (values: any) => {
    const formattedValues: any = {
      ...values,
      scheduled_date: values.scheduled_date ? dayjs(values.scheduled_date).format('YYYY-MM-DD') : undefined,
      completion_date: values.completion_date ? dayjs(values.completion_date).format('YYYY-MM-DD') : undefined,
      issue_date: values.issue_date ? dayjs(values.issue_date).format('YYYY-MM-DD') : undefined,
      expiry_date: values.expiry_date ? dayjs(values.expiry_date).format('YYYY-MM-DD') : undefined,
    };

    if (editingTraining) {
      updateTrainingMutation.mutate({ id: editingTraining.id, values: formattedValues });
    } else {
      createTrainingMutation.mutate(formattedValues);
    }
  };

  const handleEditTraining = (record: any) => {
    setEditingTraining(record);
    trainingForm.setFieldsValue({
      ...record,
      scheduled_date: record.scheduled_date ? dayjs(record.scheduled_date) : null,
      completion_date: record.completion_date ? dayjs(record.completion_date) : null,
      issue_date: record.issue_date ? dayjs(record.issue_date) : null,
      expiry_date: record.expiry_date ? dayjs(record.expiry_date) : null,
    });
    setTrainingModalVisible(true);
  };

  const getEventColor = (type: string) => {
    const colors: { [key: string]: string } = {
      hearing: '#faad14',
      investigation: '#f5222d',
      charge: '#eb2f96',
      report: '#1890ff',
      training: '#52c41a',
      medical: '#722ed1',
      leave: '#13c2c2',
      meeting: '#f5c400',
      travel: '#40a9ff',
      other: '#8c8c8c',
    };
    return colors[type] || '#1890ff';
  };

  // Get events for calendar cell rendering
  const getListData = (value: dayjs.Dayjs) => {
    const dateStr = value.format('YYYY-MM-DD');
    return events.filter(event => event.date === dateStr);
  };

  const dateCellRender = (value: dayjs.Dayjs) => {
    const listData = getListData(value);
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {listData.map(item => (
          <li key={item.id} style={{ marginBottom: 4 }}>
            <Tag color={getEventColor(item.type)} style={{ fontSize: 10, padding: '2px 6px' }}>
              {item.type.toUpperCase()}
            </Tag>
            <div style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.title}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Schedule & Training</h2>
      </div>

      <Tabs
        defaultActiveKey="calendar"
        items={[
          {
            key: 'calendar',
            label: 'Event Calendar',
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
                    Add Schedule
                  </Button>
                </div>

                <div style={{ background: '#fff', padding: 16, borderRadius: 4 }}>
                  <Calendar
                    fullscreen
                    cellRender={dateCellRender}
                  />
                </div>

                {/* Events List */}
                <div style={{ marginTop: 24 }}>
                  <h3>Upcoming Events</h3>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {events
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map(event => (
                        <div
                          key={event.id}
                          style={{
                            padding: 16,
                            border: `2px solid ${getEventColor(event.type)}`,
                            borderRadius: 8,
                            background: '#0b0f1a',
                            boxShadow: `0 2px 8px ${getEventColor(event.type)}30`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <div>
                              <Tag color={getEventColor(event.type)}>{event.type.toUpperCase()}</Tag>
                              <h4 style={{ margin: '8px 0 4px' }}>{event.title}</h4>
                              <div style={{ fontSize: 12, color: '#666' }}>
                                Date: {new Date(event.date).toLocaleDateString()} | Case: {event.caseStudy}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                              <Tag color={event.status === 'completed' ? 'green' : event.status === 'cancelled' ? 'red' : 'blue'}>
                                {event.status.toUpperCase()}
                              </Tag>
                              <Space size={6}>
                                <Button size="small" icon={<EyeOutlined />} onClick={() => setViewingSchedule(event)}>
                                  View
                                </Button>
                                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditSchedule(event)}>
                                  Edit
                                </Button>
                                <Button size="small" danger onClick={() => handleDeleteSchedule(event)}>
                                  Delete
                                </Button>
                              </Space>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ),
          },
          {
            key: 'trainings',
            label: 'Training Management',
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingTraining(null);
                      trainingForm.resetFields();
                      setTrainingModalVisible(true);
                    }}
                  >
                    Add Training
                  </Button>
                </div>

                <MobileTable
                  loading={trainingsLoading}
                  dataSource={trainingsData?.results || trainingsData || []}
                  rowKey="id"
                  columns={[
                    {
                      title: 'Employee',
                      dataIndex: 'employee_name',
                      key: 'employee_name',
                      render: (_: any, record: any) => record.employee_name || '-'
                    },
                    {
                      title: 'Training Type',
                      dataIndex: 'training_type_name',
                      key: 'training_type_name',
                      render: (_: any, record: any) => record.training_type_name || record.training_type_detail?.name || '-'
                    },
                    {
                      title: 'Scheduled Date',
                      dataIndex: 'scheduled_date',
                      key: 'scheduled_date',
                      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-'
                    },
                    {
                      title: 'Completion Date',
                      dataIndex: 'completion_date',
                      key: 'completion_date',
                      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-'
                    },
                    {
                      title: 'Expiry Date',
                      dataIndex: 'expiry_date',
                      key: 'expiry_date',
                      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-'
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      key: 'status',
                      render: (status: string) => {
                        const colorMap: any = { COMPLETED: 'green', IN_PROGRESS: 'blue', SCHEDULED: 'orange', CANCELLED: 'red' };
                        return <Tag color={colorMap[status] || 'default'}>{status || 'SCHEDULED'}</Tag>;
                      }
                    },
                    {
                      title: 'Actions',
                      key: 'actions',
                      render: (_: any, record: any) => (
                        <Space>
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditTraining(record)}
                          >
                            Edit
                          </Button>
                          {record.certificate && (
                            <Button
                              type="link"
                              size="small"
                              icon={<EyeOutlined />}
                              href={record.certificate}
                              target="_blank"
                            >
                              Certificate
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={editingSchedule ? 'Edit Schedule' : 'Add Schedule'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
          setEditingSchedule(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={createScheduleEventMutation.isPending || updateScheduleEventMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddEvent}
        >
          <Form.Item
            name="title"
            label="Event Title"
            rules={[{ required: true, message: 'Please enter event title' }]}
          >
            <Input placeholder="e.g., Disciplinary Hearing - John Doe" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea placeholder="Optional details" rows={3} />
          </Form.Item>

          <Form.Item
            name="type"
            label="Event Type"
            rules={[{ required: true, message: 'Please select event type' }]}
          >
            <Select placeholder="Select type">
              <Select.Option value="hearing">Hearing</Select.Option>
              <Select.Option value="investigation">Investigation</Select.Option>
              <Select.Option value="charge">Charge Filing</Select.Option>
              <Select.Option value="report">Report Submission</Select.Option>
              <Select.Option value="training">Training</Select.Option>
              <Select.Option value="medical">Medical Examination</Select.Option>
              <Select.Option value="leave">Leave</Select.Option>
              <Select.Option value="meeting">Meeting</Select.Option>
              <Select.Option value="travel">Travel</Select.Option>
              <Select.Option value="other">Others</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="caseStudy"
            label="Link to Case Study"
            tooltip="Optional - Link to related case study"
          >
            <Select placeholder="Select case (optional)" allowClear>
              {caseStudies.map((cs: any) => (
                <Select.Option key={cs.id} value={cs.id}>
                  {cs.reference_number || cs.id} - {cs.title || 'Untitled'}
                </Select.Option>
              ))}
              <Select.Option value="">No Case Link</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="date"
            label="Date"
            rules={[{ required: true, message: 'Please select date' }]}
          >
            <DatePicker />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Schedule Details"
        open={!!viewingSchedule}
        onCancel={() => setViewingSchedule(null)}
        footer={[
          <Button key="close" onClick={() => setViewingSchedule(null)}>
            Close
          </Button>,
        ]}
      >
        {viewingSchedule && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <strong>Title:</strong> {viewingSchedule.title}
            </div>
            <div>
              <strong>Description:</strong> {viewingSchedule.description || '-'}
            </div>
            <div>
              <strong>Type:</strong> {viewingSchedule.type.toUpperCase()}
            </div>
            <div>
              <strong>Date:</strong> {new Date(viewingSchedule.date).toLocaleDateString()}
            </div>
            <div>
              <strong>Case:</strong> {viewingSchedule.caseStudy || '-'}
            </div>
            <div>
              <strong>Status:</strong> {viewingSchedule.status.toUpperCase()}
            </div>
          </div>
        )}
      </Modal>

      {/* Training Modal */}
      <Modal
        title={editingTraining ? 'Edit Training' : 'Add Training'}
        open={trainingModalVisible}
        onCancel={() => {
          setTrainingModalVisible(false);
          trainingForm.resetFields();
          setEditingTraining(null);
        }}
        onOk={() => trainingForm.submit()}
        confirmLoading={createTrainingMutation.isPending || updateTrainingMutation.isPending}
        width={600}
      >
        <Form form={trainingForm} layout="vertical" onFinish={handleTrainingSubmit}>
          <Form.Item
            name="employee"
            label="Employee"
            rules={[{ required: true, message: 'Please select employee' }]}
          >
            <Select
              placeholder="Select employee"
              showSearch
              filterOption={(input, option: any) =>
                (option?.children?.toLowerCase() || '').includes(input.toLowerCase())
              }
            >
              {employees?.map((emp: any) => (
                <Select.Option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} ({emp.employee_code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="training_type"
            label="Training Type"
            rules={[{ required: true, message: 'Please select training type' }]}
          >
            <Select placeholder="Select training type">
              {trainingTypes?.results?.map((type: any) => (
                <Select.Option key={type.id} value={type.id}>
                  {type.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="provider" label="Provider" rules={[{ required: true, message: 'Please enter provider' }]}>
            <Input />
          </Form.Item>

          <Form.Item name="scheduled_date" label="Scheduled Date" rules={[{ required: true, message: 'Please select scheduled date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="completion_date" label="Completion Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="issue_date" label="Issue Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="expiry_date" label="Expiry Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item name="status" label="Status" initialValue="SCHEDULED">
            <Select placeholder="Select status">
              <Select.Option value="SCHEDULED">Scheduled</Select.Option>
              <Select.Option value="IN_PROGRESS">In Progress</Select.Option>
              <Select.Option value="COMPLETED">Completed</Select.Option>
              <Select.Option value="CANCELLED">Cancelled</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="certificate_number" label="Certificate Number">
            <Input />
          </Form.Item>

          <Form.Item label="Certificate Document">
            <Upload fileList={certFiles || []} onChange={({ fileList }) => setCertFiles(fileList || [])} beforeUpload={() => false} maxCount={1}>
              <Button icon={<UploadOutlined />}>Upload Certificate</Button>
            </Upload>
          </Form.Item>

          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Training notes" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Events List */}
      <div style={{ marginTop: 24 }}>
        <h3>Upcoming Events</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {events
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map(event => (
              <div
                key={event.id}
                style={{
                  padding: 16,
                  border: `2px solid ${getEventColor(event.type)}`,
                  borderRadius: 8,
                  background: 'rgba(10, 10, 10, 0.6)',
                  backdropFilter: 'blur(4px)',
                  boxShadow: `0 2px 8px ${getEventColor(event.type)}30`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <Tag color={getEventColor(event.type)}>{event.type.toUpperCase()}</Tag>
                    <h4 style={{ margin: '8px 0 4px' }}>{event.title}</h4>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      Date: {new Date(event.date).toLocaleDateString()} | Case: {event.caseStudy}
                    </div>
                  </div>
                  <Tag color={event.status === 'completed' ? 'green' : event.status === 'cancelled' ? 'red' : 'blue'}>
                    {event.status.toUpperCase()}
                  </Tag>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
