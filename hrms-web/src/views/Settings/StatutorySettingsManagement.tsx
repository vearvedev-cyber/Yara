import React, { useState } from 'react';
import {
  Card,
  Form,
  Button,
  Space,
  Table,
  message,
  Modal,
  InputNumber,
  Divider,
  Row,
  Col,
  Popconfirm,
  Alert,
  Tag,
  Upload,
  Input,
  DatePicker,
  Select,
  Tooltip,
  Badge,
} from 'antd';
import {
  SaveOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  SafetyCertificateOutlined,
  FileProtectOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import http from '../../lib/http';
import { canPerformAction } from '../../lib/permissions';

interface PayeTaxBand {
  id: number;
  min_amount: string;
  max_amount: string;
  rate: string;
  order: number;
  effective_date: string;
}

interface StatutorySettings {
  id: number;
  workspace: number;
  napsa_rate: string;
  napsa_ceiling_monthly: string;
  nhima_rate: string;
  basic_ratio: string;
  housing_ratio: string;
  transport_ratio: string;
  lunch_ratio: string;
  effective_date: string;
  paye_bands: PayeTaxBand[];
}

interface ComplianceDocument {
  id: number;
  workspace: number;
  document_type: string;
  document_type_display: string;
  document_name: string;
  reference_number: string;
  issued_by: string;
  issue_date: string | null;
  expiry_date: string | null;
  is_permanent: boolean;
  notes: string;
  reminder_days: number;
  computed_status: string;
  days_until_expiry: number | null;
  document_file: string | null;
}

const DOCUMENT_TYPES = [
  { value: 'NAPSA', label: 'NAPSA Registration Certificate' },
  { value: 'NHIMA', label: 'NHIMA Registration Certificate' },
  { value: 'ZRA_TPIN', label: 'ZRA TPIN Certificate' },
  { value: 'ZRA_TCC', label: 'ZRA Tax Clearance Certificate (TCC)' },
  { value: 'WCFCB', label: "Workers' Compensation (WCFCB)" },
  { value: 'PACRA', label: 'PACRA Business Registration' },
  { value: 'MOL', label: 'Ministry of Labour Registration' },
  { value: 'OHS', label: 'Occupational Health & Safety Certificate' },
  { value: 'OTHER', label: 'Other (specify below)' },
];

const STATUS_COLORS: Record<string, string> = {
  Active: 'green',
  Permanent: 'blue',
  'Expiring Soon': 'orange',
  Expired: 'red',
};

const ZRA_HERO_CONTENT = (
  <div style={{ lineHeight: 1.7 }}>
    <Row gutter={[24, 16]}>
      <Col xs={24} md={8}>
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#f5c400', fontSize: 13 }}>
            NAPSA — National Pension Scheme Authority
          </div>
          <div style={{ fontSize: 12, color: '#e0e4ef' }}>
            Employee contributes <strong>5%</strong> of gross salary.<br />
            Employer matches <strong>5%</strong>.<br />
            Maximum monthly contribution capped at <strong>K1,708.20</strong> (ceiling K34,164.00 × 5%).<br />
            <em>Contributions beyond ceiling are waived.</em>
          </div>
        </div>
      </Col>
      <Col xs={24} md={8}>
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#3ee7ff', fontSize: 13 }}>
            PAYE — Pay As You Earn (ZRA 2025/2026)
          </div>
          <div style={{ fontSize: 12, color: '#e0e4ef' }}>
            Chargeable income = Gross − NAPSA employee contribution.<br />
            Tax bands:<br />
            <strong>K0 – K5,100:</strong> 0%<br />
            <strong>K5,100 – K7,100:</strong> 20%<br />
            <strong>K7,100 – K9,200:</strong> 30%<br />
            <strong>K9,200+:</strong> 37%
          </div>
        </div>
      </Col>
      <Col xs={24} md={8}>
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#7cff6b', fontSize: 13 }}>
            NHIMA — National Health Insurance
          </div>
          <div style={{ fontSize: 12, color: '#e0e4ef' }}>
            Employee contributes <strong>1%</strong> of gross salary.<br />
            Employer matches <strong>1%</strong>.<br />
            <strong>No ceiling</strong> — applies to full gross.<br />
            <em>Note: ZRA treats all allowances (housing, transport, lunch) as fully taxable for private sector.</em>
          </div>
        </div>
      </Col>
    </Row>
    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(245,196,0,0.12)', borderRadius: 8, fontSize: 12, color: '#f5c400' }}>
      <strong>Net Pay Formula:</strong> Gross − NAPSA (employee) − PAYE − NHIMA (employee) − Unpaid Leave Deductions − Custom Deductions
    </div>
  </div>
);

const StatutorySettingsManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [bandsForm] = Form.useForm();
  const [complianceForm] = Form.useForm();
  const [bandModalVisible, setBandModalVisible] = useState(false);
  const [editingBand, setEditingBand] = useState<PayeTaxBand | null>(null);
  const [complianceModalVisible, setComplianceModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<ComplianceDocument | null>(null);
  const [heroBannerVisible, setHeroBannerVisible] = useState(true);
  const workspaceId = localStorage.getItem('workspaceId');
  const canManageSettings = canPerformAction('can_manage_settings');

  // Fetch statutory settings
  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ['statutory-settings', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;
      try {
        const response = await http.get(`/api/v1/payroll/statutory-settings/?workspace=${workspaceId}`);
        const data = response.data?.results?.[0] ?? (Array.isArray(response.data) ? response.data[0] : response.data);
        return data as StatutorySettings;
      } catch {
        return null;
      }
    },
    enabled: !!workspaceId,
  });

  // Fetch compliance documents
  const { data: complianceDocs = [], isLoading: docsLoading, refetch: refetchDocs } = useQuery({
    queryKey: ['compliance-documents', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const res = await http.get(`/api/v1/payroll/compliance-documents/?workspace=${workspaceId}`);
      return (res.data?.results ?? res.data ?? []) as ComplianceDocument[];
    },
    enabled: !!workspaceId,
  });

  // Update statutory settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (data: any) => {
      // Convert percentage inputs back to decimals
      const payload = {
        ...data,
        napsa_rate: data.napsa_rate / 100,
        nhima_rate: data.nhima_rate / 100,
        basic_ratio: data.basic_ratio / 100,
        housing_ratio: data.housing_ratio / 100,
        transport_ratio: data.transport_ratio / 100,
        lunch_ratio: data.lunch_ratio / 100,
      };
      if (settings?.id) {
        return http.patch(`/api/v1/payroll/statutory-settings/${settings.id}/`, payload);
      }
      return http.post('/api/v1/payroll/statutory-settings/', { workspace: workspaceId, ...payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statutory-settings'] });
      message.success('Statutory settings updated successfully');
      refetch();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to update settings');
    },
  });

  // PAYE band mutations
  const saveBandMutation = useMutation({
    mutationFn: (data: any) => {
      if (editingBand?.id) {
        return http.patch(`/api/v1/payroll/paye-tax-bands/${editingBand.id}/`, data);
      }
      return http.post('/api/v1/payroll/paye-tax-bands/', { workspace: workspaceId, ...data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statutory-settings'] });
      message.success(editingBand ? 'Tax band updated' : 'Tax band created');
      setBandModalVisible(false);
      bandsForm.resetFields();
      setEditingBand(null);
      refetch();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to save tax band');
    },
  });

  const deleteBandMutation = useMutation({
    mutationFn: (bandId: number) => http.delete(`/api/v1/payroll/paye-tax-bands/${bandId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statutory-settings'] });
      message.success('Tax band deleted');
      refetch();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to delete tax band');
    },
  });

  // Compliance document mutations
  const saveDocMutation = useMutation({
    mutationFn: (formData: FormData) => {
      if (editingDoc?.id) {
        return http.patch(`/api/v1/payroll/compliance-documents/${editingDoc.id}/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      return http.post('/api/v1/payroll/compliance-documents/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-documents'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary'] });
      message.success(editingDoc ? 'Document updated' : 'Document added');
      setComplianceModalVisible(false);
      complianceForm.resetFields();
      setEditingDoc(null);
      refetchDocs();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to save document');
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: (docId: number) => http.delete(`/api/v1/payroll/compliance-documents/${docId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-documents'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary'] });
      message.success('Document deleted');
      refetchDocs();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.error || 'Failed to delete document');
    },
  });

  const handleSaveSettings = async () => {
    try {
      const values = await form.validateFields();
      const ratioTotal = (values.basic_ratio ?? 0) + (values.housing_ratio ?? 0) + (values.transport_ratio ?? 0) + (values.lunch_ratio ?? 0);
      if (Math.abs(ratioTotal - 100) > 0.1) {
        message.error(`Salary ratios must add up to 100%. Current total: ${ratioTotal.toFixed(1)}%`);
        return;
      }
      updateSettingsMutation.mutate(values);
    } catch {
      // Form validation failed
    }
  };

  const handleOpenBandModal = (band?: PayeTaxBand) => {
    if (band) {
      setEditingBand(band);
      bandsForm.setFieldsValue({
        min_amount: parseFloat(band.min_amount),
        max_amount: parseFloat(band.max_amount),
        rate: parseFloat(band.rate) * 100,
        order: band.order,
      });
    } else {
      setEditingBand(null);
      bandsForm.resetFields();
    }
    setBandModalVisible(true);
  };

  const handleSaveBand = async () => {
    try {
      const values = await bandsForm.validateFields();
      saveBandMutation.mutate({ ...values, rate: values.rate / 100 });
    } catch {
      // Form validation failed
    }
  };

  const handleOpenDocModal = (doc?: ComplianceDocument) => {
    if (doc) {
      setEditingDoc(doc);
      complianceForm.setFieldsValue({
        document_type: doc.document_type,
        document_name: doc.document_name,
        reference_number: doc.reference_number,
        issued_by: doc.issued_by,
        issue_date: doc.issue_date ? dayjs(doc.issue_date) : null,
        expiry_date: doc.expiry_date ? dayjs(doc.expiry_date) : null,
        is_permanent: doc.is_permanent,
        notes: doc.notes,
        reminder_days: doc.reminder_days,
      });
    } else {
      setEditingDoc(null);
      complianceForm.resetFields();
      complianceForm.setFieldsValue({ reminder_days: 30, is_permanent: false });
    }
    setComplianceModalVisible(true);
  };

  const handleSaveDoc = async () => {
    try {
      const values = await complianceForm.validateFields();
      const fd = new FormData();
      fd.append('workspace', workspaceId!);
      Object.entries(values).forEach(([key, val]) => {
        if (val === undefined || val === null) return;
        if (key === 'issue_date' || key === 'expiry_date') {
          fd.append(key, (val as any).format('YYYY-MM-DD'));
        } else if (key === 'document_file') {
          const fileList = (val as any)?.fileList;
          if (fileList?.[0]?.originFileObj) {
            fd.append('document_file', fileList[0].originFileObj);
          }
        } else {
          fd.append(key, String(val));
        }
      });
      saveDocMutation.mutate(fd);
    } catch {
      // Form validation failed
    }
  };

  React.useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        napsa_rate: parseFloat(settings.napsa_rate) * 100,
        napsa_ceiling_monthly: parseFloat(settings.napsa_ceiling_monthly),
        nhima_rate: parseFloat(settings.nhima_rate) * 100,
        basic_ratio: parseFloat(settings.basic_ratio || '0.45') * 100,
        housing_ratio: parseFloat(settings.housing_ratio || '0.25') * 100,
        transport_ratio: parseFloat(settings.transport_ratio || '0.15') * 100,
        lunch_ratio: parseFloat(settings.lunch_ratio || '0.15') * 100,
      });
    } else {
      form.setFieldsValue({
        napsa_rate: 5,
        napsa_ceiling_monthly: 34164,
        nhima_rate: 1,
        basic_ratio: 45,
        housing_ratio: 25,
        transport_ratio: 15,
        lunch_ratio: 15,
      });
    }
  }, [settings, form]);

  const bandColumns = [
    {
      title: 'Min Amount',
      dataIndex: 'min_amount',
      key: 'min_amount',
      render: (val: string) => `K${parseFloat(val).toLocaleString()}`,
    },
    {
      title: 'Max Amount',
      dataIndex: 'max_amount',
      key: 'max_amount',
      render: (val: string) => (parseFloat(val) === 999999999 ? 'Unlimited' : `K${parseFloat(val).toLocaleString()}`),
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      render: (val: string) => `${(parseFloat(val) * 100).toFixed(0)}%`,
    },
    {
      title: 'Order',
      dataIndex: 'order',
      key: 'order',
      width: 70,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: any, record: PayeTaxBand) => (
        canManageSettings ? (
          <Space size="small">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleOpenBandModal(record)} />
            <Popconfirm title="Delete tax band?" onConfirm={() => deleteBandMutation.mutate(record.id)}>
              <Button type="text" size="small" icon={<DeleteOutlined />} danger loading={deleteBandMutation.isPending} />
            </Popconfirm>
          </Space>
        ) : null
      ),
    },
  ];

  const docColumns = [
    {
      title: 'Document',
      key: 'doc',
      render: (_: any, record: ComplianceDocument) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.document_type_display || record.document_type}</div>
          {record.document_name && <div style={{ fontSize: 12, color: '#888' }}>{record.document_name}</div>}
        </div>
      ),
    },
    {
      title: 'Reference #',
      dataIndex: 'reference_number',
      key: 'reference_number',
      render: (val: string) => val || '—',
    },
    {
      title: 'Issued By',
      dataIndex: 'issued_by',
      key: 'issued_by',
      render: (val: string) => val || '—',
    },
    {
      title: 'Expiry Date',
      key: 'expiry',
      render: (_: any, record: ComplianceDocument) => {
        if (record.is_permanent) return <Tag color="blue">Permanent</Tag>;
        if (!record.expiry_date) return '—';
        return (
          <div>
            <div>{dayjs(record.expiry_date).format('DD MMM YYYY')}</div>
            {record.days_until_expiry !== null && record.days_until_expiry <= 90 && (
              <div style={{ fontSize: 11, color: record.days_until_expiry <= 0 ? '#ff4d4f' : '#fa8c16' }}>
                {record.days_until_expiry <= 0 ? 'Expired' : `${record.days_until_expiry}d remaining`}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: ComplianceDocument) => (
        <Badge
          color={STATUS_COLORS[record.computed_status] || 'default'}
          text={record.computed_status}
        />
      ),
    },
    {
      title: 'File',
      key: 'file',
      render: (_: any, record: ComplianceDocument) =>
        record.document_file ? (
          <a href={record.document_file} target="_blank" rel="noreferrer">View</a>
        ) : '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: any, record: ComplianceDocument) => (
        canManageSettings ? (
          <Space size="small">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleOpenDocModal(record)} />
            <Popconfirm title="Delete this document?" onConfirm={() => deleteDocMutation.mutate(record.id)}>
              <Button type="text" size="small" icon={<DeleteOutlined />} danger loading={deleteDocMutation.isPending} />
            </Popconfirm>
          </Space>
        ) : null
      ),
    },
  ];

  if (!canManageSettings) {
    return (
      <Card>
        <p>You don't have permission to manage statutory settings</p>
      </Card>
    );
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Hero Banner — ZRA Formula Reference */}
      {heroBannerVisible && (
        <Card
          style={{
            background: 'linear-gradient(135deg, #1a1233 0%, #0d1b2a 100%)',
            border: '1px solid rgba(245,196,0,0.25)',
            borderRadius: 14,
          }}
          bodyStyle={{ padding: '20px 24px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <SafetyCertificateOutlined style={{ color: '#f5c400', fontSize: 20 }} />
                <span style={{ color: '#f5c400', fontWeight: 800, fontSize: 16 }}>ZRA Statutory Compliance Reference</span>
                <Tag color="gold" style={{ marginLeft: 4 }}>2025 / 2026</Tag>
              </div>
              <div style={{ color: '#c4c8d4', fontSize: 12 }}>
                All calculations in this system comply with the Zambia Revenue Authority (ZRA) Employment Code Act regulations.
              </div>
            </div>
            <Button type="text" size="small" style={{ color: '#888' }} onClick={() => setHeroBannerVisible(false)}>
              Hide
            </Button>
          </div>
          {ZRA_HERO_CONTENT}
        </Card>
      )}

      {!heroBannerVisible && (
        <Button
          type="dashed"
          icon={<InfoCircleOutlined />}
          onClick={() => setHeroBannerVisible(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          Show ZRA Formula Reference
        </Button>
      )}

      {/* Warning Banner */}
      <Alert
        type="warning"
        icon={<WarningOutlined />}
        showIcon
        message="Statutory Settings — Handle With Care"
        description="The values below are set by ZRA regulation. Only change them if ZRA has officially updated the rates or if your workspace has received written authorisation for a different arrangement. Incorrect values will affect all payslip calculations across your entire workspace."
        style={{ borderRadius: 10 }}
      />

      {/* Rates Section */}
      <Card title="Statutory Rates" loading={isLoading} style={{ borderRadius: 12 }}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                label={
                  <span>
                    NAPSA Employee Rate (%)
                    <Tooltip title="Default: 5% — both employee and employer contribute equally. ZRA 2025/2026.">
                      <InfoCircleOutlined style={{ marginLeft: 6, color: '#888' }} />
                    </Tooltip>
                  </span>
                }
                name="napsa_rate"
                rules={[
                  { required: true, message: 'NAPSA rate is required' },
                  { type: 'number', min: 0, max: 100, message: 'Rate must be between 0 and 100' },
                ]}
                extra="ZRA default: 5%"
              >
                <InputNumber
                  min={0} max={100} step={0.01}
                  style={{ width: '100%' }}
                  placeholder="e.g. 5"
                  addonAfter="%"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                label={
                  <span>
                    NAPSA Monthly Ceiling (K)
                    <Tooltip title="Max gross salary subject to NAPSA. ZRA 2025/2026 ceiling: K34,164.00">
                      <InfoCircleOutlined style={{ marginLeft: 6, color: '#888' }} />
                    </Tooltip>
                  </span>
                }
                name="napsa_ceiling_monthly"
                rules={[{ required: true, message: 'NAPSA ceiling is required' }]}
                extra="ZRA default: K34,164.00"
              >
                <InputNumber
                  min={0} step={0.01}
                  style={{ width: '100%' }}
                  placeholder="e.g. 34164"
                  addonBefore="K"
                  formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                  parser={(v) => v ? parseFloat(v.replace(/,/g, '')) : 0}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                label={
                  <span>
                    NHIMA Employee Rate (%)
                    <Tooltip title="Default: 1% of gross salary — no ceiling. ZRA 2025/2026.">
                      <InfoCircleOutlined style={{ marginLeft: 6, color: '#888' }} />
                    </Tooltip>
                  </span>
                }
                name="nhima_rate"
                rules={[
                  { required: true, message: 'NHIMA rate is required' },
                  { type: 'number', min: 0, max: 100, message: 'Rate must be between 0 and 100' },
                ]}
                extra="ZRA default: 1%"
              >
                <InputNumber
                  min={0} max={100} step={0.01}
                  style={{ width: '100%' }}
                  placeholder="e.g. 1"
                  addonAfter="%"
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">
            <span style={{ fontSize: 13 }}>
              Salary Component Ratios
              <Tooltip title="How gross salary is split into Basic, Housing, Transport, and Lunch. Must add up to 100%. These ratios are applied when calculating gross from a target net salary.">
                <InfoCircleOutlined style={{ marginLeft: 6, color: '#888' }} />
              </Tooltip>
            </span>
          </Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, borderRadius: 8 }}
            message="Default split: Basic 45%, Housing 25%, Transport 15%, Lunch 15% — totalling 100%."
            description="These ratios affect how gross salary is broken down when an employee's net pay is set. They do not change the tax formula — only the component labelling."
          />

          <Row gutter={16}>
            <Col xs={24} sm={12} lg={6}>
              <Form.Item
                label="Basic Salary (%)"
                name="basic_ratio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}
                extra="Default: 45%"
              >
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} addonAfter="%" placeholder="45" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Form.Item
                label="Housing Allowance (%)"
                name="housing_ratio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}
                extra="Default: 25%"
              >
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} addonAfter="%" placeholder="25" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Form.Item
                label="Transport Allowance (%)"
                name="transport_ratio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}
                extra="Default: 15%"
              >
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} addonAfter="%" placeholder="15" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Form.Item
                label="Lunch Allowance (%)"
                name="lunch_ratio"
                rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}
                extra="Default: 15%"
              >
                <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} addonAfter="%" placeholder="15" />
              </Form.Item>
            </Col>
          </Row>

          <Row>
            <Col span={24} style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveSettings}
                loading={updateSettingsMutation.isPending}
              >
                Save Statutory Settings
              </Button>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* PAYE Tax Bands */}
      <Card
        title="PAYE Tax Bands"
        style={{ borderRadius: 12 }}
        extra={
          canManageSettings && (
            <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => handleOpenBandModal()}>
              Add Band
            </Button>
          )
        }
      >
        {settings?.paye_bands && settings.paye_bands.length > 0 ? (
          <Table
            columns={bandColumns}
            dataSource={settings.paye_bands}
            rowKey="id"
            pagination={false}
            size="small"
          />
        ) : (
          <div style={{ color: '#888', padding: '16px 0' }}>
            No custom tax bands configured — system is using ZRA 2025/2026 defaults. Add bands here to override.
          </div>
        )}
      </Card>

      {/* Compliance Documents */}
      <Card
        title={
          <span>
            <FileProtectOutlined style={{ marginRight: 8, color: '#f5c400' }} />
            Company Compliance Documents
          </span>
        }
        style={{ borderRadius: 12 }}
        extra={
          canManageSettings && (
            <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => handleOpenDocModal()}>
              Add Document
            </Button>
          )
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="Track all legally required Zambian employer registrations and certifications below."
          description="Required documents: NAPSA Registration, NHIMA Registration, ZRA TPIN, ZRA Tax Clearance (TCC), Workers' Compensation (WCFCB), PACRA Registration, Ministry of Labour, and OHS Certificate."
        />
        <Table
          columns={docColumns}
          dataSource={complianceDocs}
          rowKey="id"
          loading={docsLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: 'No compliance documents added yet. Add your first document above.' }}
        />
      </Card>

      {/* Tax Band Modal */}
      <Modal
        title={editingBand ? 'Edit Tax Band' : 'Add Tax Band'}
        open={bandModalVisible}
        onCancel={() => {
          setBandModalVisible(false);
          setEditingBand(null);
          bandsForm.resetFields();
        }}
        onOk={handleSaveBand}
        confirmLoading={saveBandMutation.isPending}
      >
        <Form form={bandsForm} layout="vertical">
          <Form.Item label="Minimum Amount (K)" name="min_amount" rules={[{ required: true }]}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="K" />
          </Form.Item>
          <Form.Item
            label="Maximum Amount (K)"
            name="max_amount"
            rules={[{ required: true }]}
            extra="Enter 999999999 for the top unlimited band"
          >
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonBefore="K" />
          </Form.Item>
          <Form.Item label="Tax Rate (%)" name="rate" rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}>
            <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} addonAfter="%" />
          </Form.Item>
          <Form.Item label="Order" name="order" initialValue={0} rules={[{ required: true }]}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Compliance Document Modal */}
      <Modal
        title={editingDoc ? 'Edit Compliance Document' : 'Add Compliance Document'}
        open={complianceModalVisible}
        onCancel={() => {
          setComplianceModalVisible(false);
          setEditingDoc(null);
          complianceForm.resetFields();
        }}
        onOk={handleSaveDoc}
        confirmLoading={saveDocMutation.isPending}
        width={600}
      >
        <Form form={complianceForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Document Type" name="document_type" rules={[{ required: true }]}>
                <Select options={DOCUMENT_TYPES} placeholder="Select document type" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.document_type !== cur.document_type}>
                {({ getFieldValue }) => {
                  const isOther = getFieldValue('document_type') === 'OTHER';
                  return (
                    <Form.Item
                      label="Document Name / Title"
                      name="document_name"
                      rules={isOther ? [{ required: true, message: 'Please specify the document name for Other type' }] : []}
                      extra={isOther ? <span style={{ color: '#fa8c16' }}>Required — describe what this document is</span> : undefined}
                    >
                      <Input placeholder={isOther ? 'e.g. Fire Safety Certificate, Site Permit...' : 'e.g. NAPSA Employer Registration'} />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Reference / Certificate Number" name="reference_number">
                <Input placeholder="e.g. NAPSA/EMP/001234" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Issued By" name="issued_by">
                <Input placeholder="e.g. NAPSA, ZRA, Ministry of Labour" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Issue Date" name="issue_date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Expiry Date" name="expiry_date" extra="Leave blank if permanent">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Is Permanent (No Expiry)?" name="is_permanent" valuePropName="checked">
                <Select
                  options={[
                    { value: false, label: 'No — has expiry date' },
                    { value: true, label: 'Yes — permanent document' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Reminder Days Before Expiry" name="reminder_days" extra="Default: 30 days">
                <InputNumber min={1} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Upload Document (PDF/Image)" name="document_file">
            <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.jpg,.jpeg,.png">
              <Button icon={<UploadOutlined />}>Click to Upload</Button>
            </Upload>
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={2} placeholder="Any additional notes about this document..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default StatutorySettingsManagement;
