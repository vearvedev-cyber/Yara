import { useMemo, useState, useEffect } from 'react';
import { Card, Row, Col, Tag, Button, Modal, Form, Input, Select, DatePicker, Upload, message, Statistic, Empty, Space, Descriptions } from 'antd';
import MobileTable from '../../components/MobileTable';
import { PlusOutlined, UploadOutlined, DownloadOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { CalendarDays, FileText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import type { ColumnsType } from 'antd/es/table';
import { Dayjs } from 'dayjs';
import { exportTableToPDF } from '@/lib/pdfExport';
import { HeroBanner } from '@/components/HeroBanner';
import { useLeaveRequests, useCreateLeaveRequest, useSickNotes, useCreateSickNote, useApproveLeave, useRejectLeave, useCancelLeave, useApproveSickNote, useRejectSickNote, useDoubleTickets, useCreateDoubleTicket, useApproveDoubleTicket, useRejectDoubleTicket, useDeleteLeaveRequest, useDeleteSickNote, useDeleteDoubleTicket } from '@/lib/hooks/useLeave';
import type { LeaveRequest, SickNote, DoubleTicketRequest } from '@/api/services/leaveApi';

const leaveTypeOptions = [
  { label: 'Annual', value: 'ANNUAL' },
  { label: 'Sick', value: 'SICK' },
  { label: 'Casual', value: 'CASUAL' },
  { label: 'Unpaid', value: 'UNPAID' },
];

const leaveStatusColor: Record<string, string> = {
  PENDING: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'default',
};

const sickStatusColor: Record<string, string> = {
  PENDING: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
};

const dateToStr = (value?: Dayjs) => (value ? value.format('YYYY-MM-DD') : undefined);

export default function LeaveDashboard() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['leaveRequests'] });
      queryClient.removeQueries({ exact: false, queryKey: ['sickNotes'] });
      queryClient.removeQueries({ exact: false, queryKey: ['doubleTickets'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['leaveRequests'] });
    queryClient.removeQueries({ exact: false, queryKey: ['sickNotes'] });
    queryClient.removeQueries({ exact: false, queryKey: ['doubleTickets'] });
  }, [workspaceId, queryClient]);

  const { data: leaveRequests = [], isLoading: leaveLoading } = useLeaveRequests();
  const { data: sickNotes = [], isLoading: sickLoading } = useSickNotes();
  const { data: doubleTickets = [], isLoading: doubleTicketsLoading } = useDoubleTickets();
  const createLeave = useCreateLeaveRequest();
  const createSickNote = useCreateSickNote();
  const createDoubleTicket = useCreateDoubleTicket();
  const approveLeave = useApproveLeave();
  const rejectLeave = useRejectLeave();
  const cancelLeave = useCancelLeave();
  const approveSick = useApproveSickNote();
  const rejectSick = useRejectSickNote();
  const approveDoubleTicket = useApproveDoubleTicket();
  const rejectDoubleTicket = useRejectDoubleTicket();
  const deleteLeave = useDeleteLeaveRequest();
  const deleteSickNote = useDeleteSickNote();
  const deleteDoubleTicket = useDeleteDoubleTicket();

  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [sickModalOpen, setSickModalOpen] = useState(false);
  const [doubleTicketModalOpen, setDoubleTicketModalOpen] = useState(false);
  const [viewLeaveOpen, setViewLeaveOpen] = useState(false);
  const [viewSickOpen, setViewSickOpen] = useState(false);
  const [viewDoubleTicketOpen, setViewDoubleTicketOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<any>(null);
  const [selectedSick, setSelectedSick] = useState<any>(null);
  const [selectedDoubleTicket, setSelectedDoubleTicket] = useState<any>(null);
  const [leaveForm] = Form.useForm();
  const [sickForm] = Form.useForm();
  const [doubleTicketForm] = Form.useForm();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [sickUpload, setSickUpload] = useState<File | null>(null);
  const [filterEmployee, setFilterEmployee] = useState<string | null>(null);
  const [filterDateRange, setFilterDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  // Fetch all employees for dropdowns
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employees/', { params: { page_size: 500 } });
      return res.data?.results || res.data || [];
    },
  });

  // Populate employee options from fetched employees
  const employeeOptions = useMemo(() => {
    return employees.map((emp: any) => ({
      label: `${emp.employee_id || emp.employee_code} - ${emp.full_name || `${emp.first_name} ${emp.last_name}`}`,
      value: emp.id
    }));
  }, [employees]);

  const leaveColumns: ColumnsType<LeaveRequest> = [
    { title: 'Employee #', dataIndex: 'employee_code', key: 'employee_code', width: 130 },
    { title: 'Name', dataIndex: 'employee_name', key: 'employee_name', width: 160 },
    { title: 'Type', dataIndex: 'leave_type', key: 'leave_type', width: 110, render: (val) => val },
    { title: 'Start', dataIndex: 'start_date', key: 'start_date', width: 120 },
    { title: 'End', dataIndex: 'end_date', key: 'end_date', width: 120 },
    { title: 'Days', dataIndex: 'days', key: 'days', width: 80 },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render: (val) => <Tag color={leaveStatusColor[val] || 'default'}>{val}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 250,
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedLeave(r); setViewLeaveOpen(true); }} />
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedLeave(r); setViewLeaveOpen(true); }} />
          <Button size="small" icon={<DeleteOutlined />} danger onClick={() => { Modal.confirm({ title: 'Delete Leave Request', content: 'Are you sure you want to delete this leave request?', okText: 'Delete', okType: 'danger', onOk: () => deleteLeave.mutate(r.id) }); }} />
          <Button size="small" onClick={() => approveLeave.mutate(r.id)} disabled={r.status !== 'PENDING'}>Approve</Button>
          <Button size="small" danger onClick={() => rejectLeave.mutate(r.id)} disabled={r.status !== 'PENDING'}>Reject</Button>
        </Space>
      )
    }
  ];

  const sickColumns: ColumnsType<SickNote> = [
    { title: 'Employee #', dataIndex: 'employee_code', key: 'employee_code', width: 130 },
    { title: 'Name', dataIndex: 'employee_name', key: 'employee_name', width: 160 },
    { title: 'Diagnosis', dataIndex: 'diagnosis', key: 'diagnosis', ellipsis: true },
    { title: 'Start', dataIndex: 'start_date', key: 'start_date', width: 120 },
    { title: 'End', dataIndex: 'end_date', key: 'end_date', width: 120 },
    { title: 'Days', dataIndex: 'days', key: 'days', width: 80 },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render: (val) => <Tag color={sickStatusColor[val] || 'default'}>{val}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 250,
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedSick(r); setViewSickOpen(true); }} />
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedSick(r); setViewSickOpen(true); }} />
          <Button size="small" icon={<DeleteOutlined />} danger onClick={() => { Modal.confirm({ title: 'Delete Sick Note', content: 'Are you sure you want to delete this sick note?', okText: 'Delete', okType: 'danger', onOk: () => deleteSickNote.mutate(r.id) }); }} />
          <Button size="small" onClick={() => approveSick.mutate(r.id)} disabled={r.status !== 'PENDING'}>Approve</Button>
          <Button size="small" danger onClick={() => rejectSick.mutate(r.id)} disabled={r.status !== 'PENDING'}>Reject</Button>
        </Space>
      )
    }
  ];

  const doubleTicketColumns: ColumnsType<DoubleTicketRequest> = [
    { title: 'Employee #', dataIndex: 'employee_code', key: 'employee_code', width: 130 },
    { title: 'Name', dataIndex: 'employee_name', key: 'employee_name', width: 160 },
    { title: 'Work Date', dataIndex: 'work_date', key: 'work_date', width: 120 },
    { title: 'Hours', dataIndex: 'hours_worked', key: 'hours_worked', width: 80, render: (val) => `${val}h` },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: 'Payment', key: 'payment', width: 120, render: (_, r) => r.calculated_payment ? `K${Number(r.calculated_payment).toFixed(2)}` : r.calculated_amount ? `K${Number(r.calculated_amount).toFixed(2)}` : '-' },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render: (val) => <Tag color={leaveStatusColor[val] || 'default'}>{val}</Tag> },
    {
      title: 'Actions', key: 'actions', width: 250,
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedDoubleTicket(r); setViewDoubleTicketOpen(true); }} />
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedDoubleTicket(r); setViewDoubleTicketOpen(true); }} />
          <Button size="small" icon={<DeleteOutlined />} danger onClick={() => { Modal.confirm({ title: 'Delete Double Ticket', content: 'Are you sure you want to delete this double ticket request?', okText: 'Delete', okType: 'danger', onOk: () => deleteDoubleTicket.mutate(r.id) }); }} />
          <Button size="small" onClick={() => approveDoubleTicket.mutate(r.id)} disabled={r.status === 'APPROVED'}>Approve</Button>
          <Button size="small" danger onClick={() => rejectDoubleTicket.mutate(r.id)} disabled={r.status !== 'PENDING'}>Reject</Button>
        </Space>
      )
    }
  ];

  const filteredLeaveRequests = useMemo(() => {
    return leaveRequests.filter((req) => {
      const matchesEmployee = filterEmployee ? req.employee_name?.toLowerCase().includes(filterEmployee.toLowerCase()) : true;
      if (!matchesEmployee) return false;
      if (filterDateRange) {
        const startDate = new Date(req.start_date);
        const filterStart = filterDateRange[0].toDate();
        const filterEnd = filterDateRange[1].toDate();
        return startDate >= filterStart && startDate <= filterEnd;
      }
      return true;
    });
  }, [leaveRequests, filterEmployee, filterDateRange]);

  const filteredSickNotes = useMemo(() => {
    return sickNotes.filter((note) => {
      const matchesEmployee = filterEmployee ? note.employee_name?.toLowerCase().includes(filterEmployee.toLowerCase()) : true;
      if (!matchesEmployee) return false;
      if (filterDateRange) {
        const startDate = new Date(note.start_date);
        const filterStart = filterDateRange[0].toDate();
        const filterEnd = filterDateRange[1].toDate();
        return startDate >= filterStart && startDate <= filterEnd;
      }
      return true;
    });
  }, [sickNotes, filterEmployee, filterDateRange]);

  const filteredDoubleTickets = useMemo(() => {
    return doubleTickets.filter((ticket) => {
      const matchesEmployee = filterEmployee ? ticket.employee_name?.toLowerCase().includes(filterEmployee.toLowerCase()) : true;
      if (!matchesEmployee) return false;
      if (filterDateRange) {
        const workDate = new Date(ticket.work_date);
        const filterStart = filterDateRange[0].toDate();
        const filterEnd = filterDateRange[1].toDate();
        return workDate >= filterStart && workDate <= filterEnd;
      }
      return true;
    });
  }, [doubleTickets, filterEmployee, filterDateRange]);

  const summaryCards = useMemo(() => {
    // Calculate from filtered data instead of API summaries to respect filters
    const totalLeave = filteredLeaveRequests.length;
    const totalSickDays = filteredSickNotes.reduce((sum, note) => sum + (note.days || 0), 0);
    const approvedSickNotes = filteredSickNotes.filter(note => note.status === 'APPROVED').length;
    return { totalLeave, totalSickDays, approvedSickNotes };
  }, [filteredLeaveRequests, filteredSickNotes]);

  const handleLeaveSubmit = async (values: any) => {
    try {
      await createLeave.mutateAsync({
        employee: Number(values.employee),
        leave_type: values.leave_type,
        start_date: dateToStr(values.start_date),
        end_date: dateToStr(values.end_date),
        reason: values.reason || '',
        doctor_note: uploadFile || undefined,
      } as any);
      message.success('Leave request submitted');
      setLeaveModalOpen(false);
      leaveForm.resetFields();
      setUploadFile(null);
    } catch (err) {
      message.error('Failed to submit leave request');
    }
  };

  const handleSickSubmit = async (values: any) => {
    try {
      await createSickNote.mutateAsync({
        employee: Number(values.employee),
        start_date: dateToStr(values.start_date),
        end_date: dateToStr(values.end_date),
        diagnosis: values.diagnosis || '',
        notes: values.notes || '',
        document: sickUpload || undefined,
      } as any);
      message.success('Sick note submitted');
      setSickModalOpen(false);
      sickForm.resetFields();
      setSickUpload(null);
    } catch (err) {
      message.error('Failed to submit sick note');
    }
  };

  const handleDoubleTicketSubmit = async (values: any) => {
    try {
      await createDoubleTicket.mutateAsync({
        employee: Number(values.employee),
        work_date: dateToStr(values.work_date),
        hours_worked: Number(values.hours_worked) || 8,
        reason: values.reason || '',
      } as any);
      message.success('Double ticket request submitted');
      setDoubleTicketModalOpen(false);
      doubleTicketForm.resetFields();
    } catch (err) {
      message.error('Failed to submit double ticket request');
    }
  };

  const exportLeaveToPDF = () => {
    const columns = [
      'Employee #',
      'Name',
      'Type',
      'Start',
      'End',
      'Days',
      'Reason',
      'Status',
      'Doctor Note',
      'Created',
    ];
    const data = filteredLeaveRequests.map((req) => [
      req.employee_code || '',
      req.employee_name || '',
      req.leave_type || '',
      req.start_date || '',
      req.end_date || '',
      String(req.days ?? ''),
      req.reason || '',
      req.status || '',
      req.doctor_note || '',
      req.created_at ? new Date(req.created_at).toLocaleDateString() : '',
    ]);
    exportTableToPDF('Leave Requests', columns, data, 'leave-requests.pdf');
  };

  const exportSickNotesToPDF = () => {
    const columns = [
      'Employee #',
      'Name',
      'Diagnosis',
      'Start',
      'End',
      'Days',
      'Notes',
      'Status',
      'Document',
      'Created',
    ];
    const data = filteredSickNotes.map((note) => [
      note.employee_code || '',
      note.employee_name || '',
      note.diagnosis || '',
      note.start_date || '',
      note.end_date || '',
      String(note.days ?? ''),
      note.notes || '',
      note.status || '',
      note.document || '',
      note.created_at ? new Date(note.created_at).toLocaleDateString() : '',
    ]);
    exportTableToPDF('Sick Notes', columns, data, 'sick-notes.pdf');
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <HeroBanner
          eyebrow="Dashboard"
          title="Leave Management System"
          description="Manage employee leave requests, sick notes, absences, and time-off tracking with comprehensive approval workflows."
          icon={<CalendarDays className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
          gradient="neutral"
          tags={[
            { label: 'Leave & Sick Notes', variant: 'neutral' },
            { label: 'Approval Workflow', variant: 'amber' },
            { label: 'Absence Tracking', variant: 'cyan' },
          ]}
          actions={(
            <>
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setLeaveModalOpen(true)}>
                New Leave Request
              </Button>
              <Button size="large" icon={<FileText size={18} />} onClick={() => setSickModalOpen(true)}>
                New Sick Note
              </Button>
            </>
          )}
        />
      </div>

      {/* Filter Bar */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <span style={{ color: '#666', fontSize: 12 }}>Filters:</span>
          <Input
            placeholder="Search by employee name"
            style={{ width: 200 }}
            allowClear
            value={filterEmployee || undefined}
            onChange={(e) => setFilterEmployee(e.target.value || null)}
          />
          <DatePicker.RangePicker
            onChange={(dates) => setFilterDateRange(dates as [Dayjs, Dayjs] | null)}
            value={filterDateRange}
            style={{ width: 250 }}
          />
          <Button
            onClick={() => {
              setFilterEmployee(null);
              setFilterDateRange(null);
            }}
          >
            Reset
          </Button>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={8}>
          <Card loading={leaveLoading}>
            <Statistic title="Total Leave Requests" value={summaryCards.totalLeave} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={leaveLoading}>
            <Statistic title="Total Sick Days" value={summaryCards.totalSickDays} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={sickLoading}>
            <Statistic title="Approved Sick Notes" value={summaryCards.approvedSickNotes} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card
            title="Leave Requests"
            extra={
              <Space>
                <Button icon={<DownloadOutlined />} onClick={exportLeaveToPDF}>Export PDF</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setLeaveModalOpen(true)}>New Leave</Button>
              </Space>
            }
            loading={leaveLoading}
          >
            <div id="leave-table">
              {filteredLeaveRequests.length ? (
                <MobileTable columns={leaveColumns} dataSource={filteredLeaveRequests.map((r) => ({ ...r, key: r.id }))} pagination={{ pageSize: 10 }} size="small" scroll={{ x: 900 }} />
              ) : (
                <Empty description="No leave requests" />
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title="Sick Notes"
            extra={
              <Space>
                <Button icon={<DownloadOutlined />} onClick={exportSickNotesToPDF}>Export PDF</Button>
                <Button icon={<PlusOutlined />} onClick={() => setSickModalOpen(true)}>New Sick Note</Button>
              </Space>
            }
            loading={sickLoading}
          >
            <div id="sick-table">
              {filteredSickNotes.length ? (
                <MobileTable columns={sickColumns} dataSource={filteredSickNotes.map((s) => ({ ...s, key: s.id }))} pagination={{ pageSize: 8 }} size="small" scroll={{ x: 700 }} />
              ) : (
                <Empty description="No sick notes" />
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Double Ticket (Sunday/Holiday Work) Section */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card
            title="Double Ticket Requests (Sunday/Holiday Work)"
            extra={
              <Space>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setDoubleTicketModalOpen(true)}>New Double Ticket</Button>
              </Space>
            }
            loading={doubleTicketsLoading}
          >
            {doubleTickets.length ? (
              <MobileTable columns={doubleTicketColumns} dataSource={filteredDoubleTickets.map((d) => ({ ...d, key: d.id }))} pagination={{ pageSize: 10 }} size="small" scroll={{ x: 1000 }} />
            ) : (
              <Empty description="No double ticket requests" />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="Submit Leave Request"
        open={leaveModalOpen}
        onOk={() => leaveForm.submit()}
        onCancel={() => setLeaveModalOpen(false)}
        confirmLoading={createLeave.isPending}
      >
        <Form layout="vertical" form={leaveForm} onFinish={handleLeaveSubmit}>
          <Form.Item name="employee" label="Employee" rules={[{ required: true, message: 'Select employee' }]}>
            <Select
              showSearch
              placeholder="Select employee"
              options={employeeOptions}
              filterOption={(input, option: any) =>
                (option?.label?.toLowerCase() || '').includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="leave_type" label="Leave Type" rules={[{ required: true }]}>
            <Select options={leaveTypeOptions} />
          </Form.Item>
          <Form.Item name="start_date" label="Start Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="end_date" label="End Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} placeholder="Optional details" />
          </Form.Item>
          <Form.Item label="Doctor Note (optional)">
            <Upload
              beforeUpload={(file) => { setUploadFile(file as File); return false; }}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Attach file</Button>
            </Upload>
            {uploadFile && <div style={{ marginTop: 8 }}><Tag>{uploadFile.name}</Tag></div>}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Submit Sick Note"
        open={sickModalOpen}
        onOk={() => sickForm.submit()}
        onCancel={() => setSickModalOpen(false)}
        confirmLoading={createSickNote.isPending}
      >
        <Form layout="vertical" form={sickForm} onFinish={handleSickSubmit}>
          <Form.Item name="employee" label="Employee" rules={[{ required: true, message: 'Select employee' }]}>
            <Select
              showSearch
              placeholder="Select employee"
              options={employeeOptions}
              filterOption={(input, option: any) =>
                (option?.label?.toLowerCase() || '').includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="diagnosis" label="Diagnosis" rules={[{ required: true }]}>
            <Input placeholder="e.g., Flu" />
          </Form.Item>
          <Form.Item name="start_date" label="Start Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="end_date" label="End Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="Optional" />
          </Form.Item>
          <Form.Item label="Document (optional)">
            <Upload
              beforeUpload={(file) => { setSickUpload(file as File); return false; }}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Attach file</Button>
            </Upload>
            {sickUpload && <div style={{ marginTop: 8 }}><Tag>{sickUpload.name}</Tag></div>}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Submit Double Ticket Request"
        open={doubleTicketModalOpen}
        onOk={() => doubleTicketForm.submit()}
        onCancel={() => setDoubleTicketModalOpen(false)}
        confirmLoading={createDoubleTicket.isPending}
      >
        <Form layout="vertical" form={doubleTicketForm} onFinish={handleDoubleTicketSubmit}>
          <Form.Item name="employee" label="Employee" rules={[{ required: true, message: 'Select employee' }]}>
            <Select
              showSearch
              placeholder="Select employee"
              options={employeeOptions}
              filterOption={(input, option: any) =>
                (option?.label?.toLowerCase() || '').includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="work_date" label="Work Date (Sunday/Holiday)" rules={[{ required: true, message: 'Select work date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="hours_worked" label="Hours Worked" initialValue={8} rules={[{ required: true }]}>
            <Input type="number" min={0} max={24} step={0.5} placeholder="8" />
          </Form.Item>
          <Form.Item name="reason" label="Reason for Sunday/Holiday Work" rules={[{ required: true, message: 'Provide reason' }]}>
            <Input.TextArea rows={3} placeholder="e.g., Emergency maintenance, urgent project deadline" />
          </Form.Item>
        </Form>
      </Modal>

      {/* View Leave Modal */}
      <Modal
        title="View Leave Request"
        open={viewLeaveOpen}
        onCancel={() => setViewLeaveOpen(false)}
        footer={[<Button key="close" onClick={() => setViewLeaveOpen(false)}>Close</Button>]}
        width={600}
      >
        {selectedLeave && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Employee">{selectedLeave.employee_name}</Descriptions.Item>
            <Descriptions.Item label="Employee #">{selectedLeave.employee_code}</Descriptions.Item>
            <Descriptions.Item label="Leave Type">{selectedLeave.leave_type}</Descriptions.Item>
            <Descriptions.Item label="Start Date">{selectedLeave.start_date}</Descriptions.Item>
            <Descriptions.Item label="End Date">{selectedLeave.end_date}</Descriptions.Item>
            <Descriptions.Item label="Days">{selectedLeave.days}</Descriptions.Item>
            <Descriptions.Item label="Reason">{selectedLeave.reason || '-'}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={leaveStatusColor[selectedLeave.status]}>{selectedLeave.status}</Tag></Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* View Sick Note Modal */}
      <Modal
        title="View Sick Note"
        open={viewSickOpen}
        onCancel={() => setViewSickOpen(false)}
        footer={[<Button key="close" onClick={() => setViewSickOpen(false)}>Close</Button>]}
        width={600}
      >
        {selectedSick && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Employee">{selectedSick.employee_name}</Descriptions.Item>
            <Descriptions.Item label="Employee #">{selectedSick.employee_code}</Descriptions.Item>
            <Descriptions.Item label="Diagnosis">{selectedSick.diagnosis}</Descriptions.Item>
            <Descriptions.Item label="Start Date">{selectedSick.start_date}</Descriptions.Item>
            <Descriptions.Item label="End Date">{selectedSick.end_date}</Descriptions.Item>
            <Descriptions.Item label="Days">{selectedSick.days}</Descriptions.Item>
            <Descriptions.Item label="Doctor">{selectedSick.doctor_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={sickStatusColor[selectedSick.status]}>{selectedSick.status}</Tag></Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* View Double Ticket Modal */}
      <Modal
        title="View Double Ticket Request"
        open={viewDoubleTicketOpen}
        onCancel={() => setViewDoubleTicketOpen(false)}
        footer={[<Button key="close" onClick={() => setViewDoubleTicketOpen(false)}>Close</Button>]}
        width={600}
      >
        {selectedDoubleTicket && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Employee">{selectedDoubleTicket.employee_name}</Descriptions.Item>
            <Descriptions.Item label="Employee #">{selectedDoubleTicket.employee_code}</Descriptions.Item>
            <Descriptions.Item label="Work Date">{selectedDoubleTicket.work_date}</Descriptions.Item>
            <Descriptions.Item label="Hours Worked">{selectedDoubleTicket.hours_worked}h</Descriptions.Item>
            <Descriptions.Item label="Reason">{selectedDoubleTicket.reason || '-'}</Descriptions.Item>
            <Descriptions.Item label="Payment">{selectedDoubleTicket.calculated_payment ? `K${Number(selectedDoubleTicket.calculated_payment).toFixed(2)}` : selectedDoubleTicket.calculated_amount ? `K${Number(selectedDoubleTicket.calculated_amount).toFixed(2)}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={leaveStatusColor[selectedDoubleTicket.status]}>{selectedDoubleTicket.status}</Tag></Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
