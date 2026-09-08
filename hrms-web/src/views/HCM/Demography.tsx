import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Drawer,
  Descriptions,
  Space,
  Form,
  Input,
  DatePicker,
  Select,
  InputNumber,
  message,
  Switch,
  Tag,
  Typography,
  Skeleton,
  Row,
  Col,
  Modal,
  Upload,
  Statistic,
  Avatar,
  Popconfirm,
  Divider,
} from 'antd';
import {
  UploadOutlined,
  UserOutlined,
  TeamOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Users } from 'lucide-react';
import http from '../../lib/http';
import { HeroBanner } from '../../components/HeroBanner';
import MobileCardList from '../../components/MobileCardList';

const { Text } = Typography;

const normalizeArray = (data: any) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
};

const buildCountList = (items: Array<string | null | undefined>, fallbackLabel = 'Unknown') => {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const key = (item ?? '').toString().trim() || fallbackLabel;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

const buildTopCounts = (items: Array<string | null | undefined>, top = 5, fallbackLabel = 'Unknown') => {
  const rows = buildCountList(items, fallbackLabel);
  if (rows.length <= top) return rows;
  const head = rows.slice(0, top);
  const tailCount = rows.slice(top).reduce((sum, row) => sum + row.count, 0);
  return [...head, { label: 'Other', count: tailCount }];
};

const toAbsoluteMediaUrl = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();

  if (trimmed.startsWith('//')) {
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    return `${protocol}${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    if (window.location.protocol === 'https:' && trimmed.startsWith('http://')) {
      return `https://${trimmed.slice('http://'.length)}`;
    }
    return trimmed;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const envBaseURL = (import.meta.env.VITE_API_BASE_URL || '').trim();
  let apiOrigin = '';

  if (envBaseURL) {
    apiOrigin = envBaseURL.replace(/\/+$/, '').replace(/\/api$/, '');
  }

  if (!apiOrigin && typeof window !== 'undefined') {
    apiOrigin = window.location.origin;
  }

  return `${apiOrigin}${normalized}`;
};

type EmployeeRow = {
  id: number;
  employee_id: string;
  photo?: string;
  full_name: string;
  first_name: string;
  last_name: string;
  job_title: string;
  department_name?: string;
  employment_status: string;
  hire_date: string;
  gender?: string;
  date_of_birth?: string;
  nationality?: string;
};

type EmployeeListResponse = {
  results?: EmployeeRow[];
  [key: string]: any;
};

type EmployeeDetail = {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  nrc: string;
  passport: string;
  tpin: string;
  nhima: string;
  sss_number: string;
  napsa_number: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  email: string;
  phone: string;
  house_address: string;
  residential_area: string;
  employment_type_detail?: { name: string };
  employment_status: string;
  job_title: string;
  department_detail?: { name: string };
  category_detail?: { name: string };
  classification_detail?: { name: string };
  point_of_hire?: string;
  hire_date: string;
  next_of_kin_name?: string;
  next_of_kin_relationship?: string;
  next_of_kin_phone?: string;
  employment_type?: number;
  category?: number;
  classification?: number;
  department?: number;
  photo?: string;
  contractor_type?: string;
};

type EngagementRecord = {
  id?: number;
  employee: number;
  engagement_date: string;
  contract_type?: number;
  contract_duration_months?: number;
  initial_contract_end_date?: string;
  notes?: string;
};

type TerminationRecord = {
  id?: number;
  employee: number;
  termination_date: string;
  termination_reason?: number;
  payroll_final?: boolean;
  comments?: string;
};

type EmployeeDocument = {
  id: number;
  employee: number;
  title?: string;
  file: string;
  uploaded_at: string;
};

type EmployeeBeneficiary = {
  id: number;
  employee: number;
  name: string;
  relationship: string;
  phone?: string;
  percentage?: number;
};

export default function Demography() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => localStorage.getItem('workspaceId'));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const handleWorkspaceChange = () => {
      const newWorkspaceId = localStorage.getItem('workspaceId');
      setWorkspaceId(newWorkspaceId);
      queryClient.removeQueries({ exact: false, queryKey: ['employees'] });
    };
    window.addEventListener('workspaceChanged', handleWorkspaceChange);
    return () => window.removeEventListener('workspaceChanged', handleWorkspaceChange);
  }, [queryClient]);

  // Also clear cache whenever workspaceId changes (backup for page navigation)
  useEffect(() => {
    queryClient.removeQueries({ exact: false, queryKey: ['employees'] });
  }, [workspaceId, queryClient]);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeForm] = Form.useForm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [beneficiaryModalOpen, setBeneficiaryModalOpen] = useState(false);
  const [beneficiaryForm] = Form.useForm();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [engagementForm] = Form.useForm();
  const [terminationForm] = Form.useForm();
  const [pendingDept, setPendingDept] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pendingJobTitle, setPendingJobTitle] = useState<string | null>(null);
  const [pendingHireRange, setPendingHireRange] = useState<any>(null);
  const [pendingEmployeeName, setPendingEmployeeName] = useState<string | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<{ dept: string | null; status: string | null; jobTitle: string | null; hireFrom?: string | null; hireTo?: string | null; employeeName?: string | null }>({
    dept: null,
    status: null,
    jobTitle: null,
    hireFrom: null,
    hireTo: null,
    employeeName: null,
  });

  const beneficiaryEmployeeId = editingId;

  const { data: employeesData, isLoading: listLoading } = useQuery<EmployeeListResponse>({
    queryKey: ['employees', workspaceId],
    queryFn: async () => {
      try {
        const response = await http.get('/api/v1/hcm/employees/?page_size=200');
        const data = response.data;

        if (data.results && data.next) {
          let allResults = [...data.results];
          let nextUrl = data.next;

          while (nextUrl) {
            const nextResponse = await http.get(nextUrl.replace(/^.*api/, '/api'));
            allResults = [...allResults, ...nextResponse.data.results];
            nextUrl = nextResponse.data.next;
          }

          return { ...data, results: allResults };
        }

        return data;
      } catch (err) {
        console.error('Error fetching employees:', err);
        return { results: [] };
      }
    },
    enabled: !!workspaceId,
  });

  const employees: EmployeeRow[] = useMemo(
    () => employeesData?.results ?? (employeesData as any) ?? [],
    [employeesData]
  );

  // Filter active employees (exclude terminated) for statistics cards
  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.employment_status?.toLowerCase() !== 'terminated'),
    [employees]
  );

  const genderSummary = useMemo(() => {
    const mapped = activeEmployees.map((emp) => {
      const g = emp.gender?.toUpperCase();
      if (g === 'M') return 'Male';
      if (g === 'F') return 'Female';
      if (g) return 'Other';
      return 'Unknown';
    });
    return buildCountList(mapped, 'Unknown');
  }, [activeEmployees]);

  const ageSummary = useMemo(() => {
    const buckets = [
      { label: '18-25', min: 18, max: 25 },
      { label: '26-35', min: 26, max: 35 },
      { label: '36-45', min: 36, max: 45 },
      { label: '46-55', min: 46, max: 55 },
      { label: '56+', min: 56, max: 200 },
    ];
    const counts: Record<string, number> = { Unknown: 0 };
    buckets.forEach((b) => (counts[b.label] = 0));

    const today = new Date();
    activeEmployees.forEach((emp) => {
      if (!emp.date_of_birth) {
        counts.Unknown += 1;
        return;
      }
      const dob = new Date(emp.date_of_birth);
      if (Number.isNaN(dob.getTime())) {
        counts.Unknown += 1;
        return;
      }
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
      const bucket = buckets.find((b) => age >= b.min && age <= b.max);
      if (!bucket) {
        counts.Unknown += 1;
        return;
      }
      counts[bucket.label] += 1;
    });

    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [activeEmployees]);

  const nationalitySummary = useMemo(
    () => buildTopCounts(activeEmployees.map((emp) => emp.nationality), 5, 'Unknown'),
    [activeEmployees]
  );

  const departmentSummary = useMemo(
    () => buildTopCounts(activeEmployees.map((emp) => emp.department_name), 5, 'Unassigned'),
    [activeEmployees]
  );

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesDept = appliedFilters.dept
        ? emp.department_name?.toLowerCase() === appliedFilters.dept.toLowerCase()
        : true;
      const matchesStatus = appliedFilters.status
        ? emp.employment_status === appliedFilters.status
        : true;
      const matchesJobTitle = appliedFilters.jobTitle
        ? emp.job_title?.toLowerCase() === appliedFilters.jobTitle.toLowerCase()
        : true;
      const matchesName = appliedFilters.employeeName
        ? emp.full_name?.toLowerCase().includes(appliedFilters.employeeName.toLowerCase())
        : true;
      const hire = emp.hire_date ? new Date(emp.hire_date) : null;
      const fromOk = appliedFilters.hireFrom ? (!!hire && hire >= new Date(appliedFilters.hireFrom)) : true;
      const toOk = appliedFilters.hireTo ? (!!hire && hire <= new Date(appliedFilters.hireTo)) : true;
      return matchesDept && matchesStatus && matchesJobTitle && matchesName && fromOk && toOk;
    });
  }, [employees, appliedFilters]);

  const jobTitles = useMemo(() => {
    const titles = new Set(employees.map((e) => e.job_title).filter(Boolean));
    return Array.from(titles).sort();
  }, [employees]);

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['employee-summary', appliedFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedFilters.dept) params.append('department', appliedFilters.dept);
      if (appliedFilters.employeeName) params.append('search', appliedFilters.employeeName);
      if (appliedFilters.hireFrom) params.append('date_from', appliedFilters.hireFrom);
      if (appliedFilters.hireTo) params.append('date_to', appliedFilters.hireTo);
      const url = `/api/v1/hcm/employees/summary/${params.toString() ? '?' + params.toString() : ''}`;
      return (await http.get(url)).data;
    },
  });

  const { data: employeeDetail, isFetching: detailLoading } = useQuery<EmployeeDetail | undefined>({
    queryKey: ['employee-detail', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await http.get(`/api/v1/hcm/employees/${selectedId}/`);
      return res.data as EmployeeDetail;
    },
  });

  const employeePhotoUrl = useMemo(
    () => toAbsoluteMediaUrl(employeeDetail?.photo),
    [employeeDetail?.photo]
  );

  const { data: engagementData, isFetching: engagementLoading } = useQuery<EngagementRecord | undefined>({
    queryKey: ['engagement', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/engagements/', { params: { employee: selectedId } });
      const payload = res.data?.results ?? res.data ?? [];
      return payload[0];
    },
  });

  const { data: terminationData, isFetching: terminationLoading } = useQuery<TerminationRecord | undefined>({
    queryKey: ['termination', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/terminations/', { params: { employee: selectedId } });
      const payload = res.data?.results ?? res.data ?? [];
      return payload[0];
    },
  });

  const { data: contractTypes = [] } = useQuery<any[]>({
    queryKey: ['contract-types'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/contract-types/');
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const { data: terminationReasons = [] } = useQuery<any[]>({
    queryKey: ['termination-reasons'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/termination-reasons/');
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const { data: employeeDocuments = [], isFetching: documentsLoading } = useQuery<EmployeeDocument[]>({
    queryKey: ['employee-documents', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employee-documents/', { params: { employee: selectedId } });
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const { data: beneficiaries = [] } = useQuery<EmployeeBeneficiary[]>({
    queryKey: ['employee-beneficiaries', beneficiaryEmployeeId],
    enabled: !!beneficiaryEmployeeId && employeeModalOpen,
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employee-beneficiaries/', {
        params: { employee: beneficiaryEmployeeId },
      });
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const addBeneficiaryMutation = useMutation({
    mutationFn: async (values: { name: string; relationship: string; phone?: string; percentage?: number }) => {
      if (!beneficiaryEmployeeId) {
        throw new Error('Save the employee first before adding beneficiaries.');
      }

      return http.post('/api/v1/hcm/employee-beneficiaries/', {
        employee: beneficiaryEmployeeId,
        name: values.name,
        relationship: values.relationship,
        phone: values.phone || '',
        percentage: values.percentage,
      });
    },
    onSuccess: () => {
      message.success('Beneficiary added');
      setBeneficiaryModalOpen(false);
      beneficiaryForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['employee-beneficiaries', beneficiaryEmployeeId] });
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || error?.message || 'Could not add beneficiary');
    },
  });

  const deleteBeneficiaryMutation = useMutation({
    mutationFn: async (beneficiaryId: number) => {
      return http.delete(`/api/v1/hcm/employee-beneficiaries/${beneficiaryId}/`);
    },
    onSuccess: () => {
      message.success('Beneficiary removed');
      queryClient.invalidateQueries({ queryKey: ['employee-beneficiaries', beneficiaryEmployeeId] });
    },
    onError: () => {
      message.error('Could not remove beneficiary');
    },
  });

  const { data: employmentTypes = [] } = useQuery<any[]>({
    queryKey: ['employment-types'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employment-types/');
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedId) return;
      const formData = new FormData();
      formData.append('employee', String(selectedId));
      formData.append('title', file.name);
      formData.append('file', file);
      const res = await http.post('/api/v1/hcm/employee-documents/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: () => {
      message.success('Document uploaded');
      queryClient.invalidateQueries({ queryKey: ['employee-documents', selectedId] });
    },
    onError: () => {
      message.error('Failed to upload document');
    },
  });

  const { data: employeeCategories = [] } = useQuery<any[]>({
    queryKey: ['employee-categories'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/employee-categories/');
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const { data: departments = [] } = useQuery<any[]>({
    queryKey: ['departments'],
    queryFn: async () => {
      const res = await http.get('/api/v1/hcm/departments/');
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    },
  });

  const departmentOptions = useMemo(() => normalizeArray(departments), [departments]);

  useEffect(() => {
    if (engagementData) {
      engagementForm.setFieldsValue({
        engagement_date: engagementData.engagement_date ? dayjs(engagementData.engagement_date) : undefined,
        contract_type: engagementData.contract_type,
        contract_duration_months: engagementData.contract_duration_months,
        initial_contract_end_date: engagementData.initial_contract_end_date
          ? dayjs(engagementData.initial_contract_end_date)
          : undefined,
        notes: engagementData.notes,
      });
    } else {
      engagementForm.resetFields();
    }
  }, [engagementData, engagementForm]);

  useEffect(() => {
    if (terminationData) {
      terminationForm.setFieldsValue({
        termination_date: terminationData.termination_date ? dayjs(terminationData.termination_date) : undefined,
        termination_reason: terminationData.termination_reason,
        payroll_final: terminationData.payroll_final,
        comments: terminationData.comments,
      });
    } else {
      terminationForm.resetFields();
    }
  }, [terminationData, terminationForm]);

  const engagementMutation = useMutation({
    mutationFn: async (values: any) => {
      if (!selectedId) return;
      const payload = {
        employee: selectedId,
        engagement_date: values.engagement_date?.format('YYYY-MM-DD'),
        contract_type: values.contract_type || null,
        contract_duration_months: values.contract_duration_months,
        initial_contract_end_date: values.initial_contract_end_date?.format('YYYY-MM-DD'),
        notes: values.notes,
      };
      if (engagementData?.id) {
        return http.put(`/api/v1/hcm/engagements/${engagementData.id}/`, payload);
      }
      return http.post('/api/v1/hcm/engagements/', payload);
    },
    onSuccess: () => {
      message.success('Engagement saved');
      queryClient.invalidateQueries({ queryKey: ['engagement', selectedId] });
    },
    onError: () => message.error('Could not save engagement'),
  });

  const terminationMutation = useMutation({
    mutationFn: async (values: any) => {
      if (!selectedId) return;
      const payload = {
        employee: selectedId,
        termination_date: values.termination_date?.format('YYYY-MM-DD'),
        termination_reason: values.termination_reason || null,
        payroll_final: !!values.payroll_final,
        comments: values.comments,
      };
      if (terminationData?.id) {
        return http.put(`/api/v1/hcm/terminations/${terminationData.id}/`, payload);
      }
      return http.post('/api/v1/hcm/terminations/', payload);
    },
    onSuccess: () => {
      message.success('Termination saved');
      queryClient.invalidateQueries({ queryKey: ['termination', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['employee-detail', selectedId] });
    },
    onError: () => message.error('Could not save termination'),
  });

  const employeeMutation = useMutation({
    mutationFn: async (values: any) => {
      const formData = new FormData();
      formData.append('employee_id', values.employee_id);
      formData.append('first_name', values.first_name);
      formData.append('last_name', values.last_name);
      formData.append('job_title', values.job_title);
      formData.append('hire_date', values.hire_date?.format('YYYY-MM-DD'));
      formData.append('date_of_birth', values.date_of_birth?.format('YYYY-MM-DD'));
      formData.append('gender', values.gender);
      formData.append('nrc', values.nrc);
      if (values.tpin && values.tpin.trim()) formData.append('tpin', values.tpin.trim());
      if (values.nhima) formData.append('nhima', values.nhima);
      if (values.napsa_number) formData.append('napsa_number', values.napsa_number);
      if (values.sss_number) formData.append('sss_number', values.sss_number);
      if (values.bank_name) formData.append('bank_name', values.bank_name);
      if (values.bank_branch) formData.append('bank_branch', values.bank_branch);
      if (values.bank_account_number) formData.append('bank_account_number', values.bank_account_number);
      if (values.bank_account_name) formData.append('bank_account_name', values.bank_account_name);
      formData.append('phone', values.phone);
      if (values.email) formData.append('email', values.email);
      formData.append('house_address', values.house_address);
      if (values.point_of_hire) formData.append('point_of_hire', values.point_of_hire);
      formData.append('employment_type', String(values.employment_type));
      if (values.category) formData.append('category', String(values.category));
      if (values.classification) formData.append('classification', String(values.classification));
      if (values.department) formData.append('department', String(values.department));
      if (photoFile) formData.append('photo', photoFile);
      if (editingId) {
        return http.put(`/api/v1/hcm/employees/${editingId}/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      return http.post('/api/v1/hcm/employees/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      message.success('Employee saved');
      setEmployeeModalOpen(false);
      setEditingId(null);
      setPhotoFile(null);
      employeeForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['employees', workspaceId] });
      if (selectedId) {
        queryClient.invalidateQueries({ queryKey: ['employee-detail', selectedId] });
      }
    },
    onError: (error: any) => {
      console.error('Employee save error:', error?.response?.data);

      // Handle different error formats
      const data = error?.response?.data;
      let errorMsg = 'Could not save employee';

      if (data) {
        // Check for field-specific errors
        if (data.employee_id) errorMsg = `Employee ID: ${data.employee_id[0]}`;
        else if (data.nrc) errorMsg = `NRC: ${data.nrc[0]}`;
        else if (data.email) errorMsg = `Email: ${data.email[0]}`;
        else if (data.tpin) errorMsg = `TPIN: ${data.tpin[0]}`;
        else if (data.employment_type) errorMsg = `Employment Type: ${data.employment_type[0]}`;
        else if (data.error) errorMsg = data.error;
        else if (data.detail) errorMsg = data.detail;
        else if (typeof data === 'object') {
          // Show first error found
          const firstError = Object.entries(data).find(([key, val]) => Array.isArray(val) && val.length > 0);
          if (firstError) errorMsg = `${firstError[0]}: ${firstError[1][0]}`;
        }
      }

      message.error(errorMsg);
    },
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: (id: number) => http.delete(`/api/v1/hcm/employees/${id}/`),
    onSuccess: () => {
      message.success('Employee deleted');
      queryClient.invalidateQueries({ queryKey: ['employees', workspaceId] });
      if (drawerOpen) setDrawerOpen(false);
    },
    onError: () => message.error('Could not delete employee'),
  });

  const handleImport = async () => {
    if (!importFile) {
      message.error('Please select a file');
      return;
    }

    setImportLoading(true);
    const formData = new FormData();
    formData.append('file', importFile);

    try {
      const res = await http.post('/api/v1/hcm/employees/import_data/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = res.data;
      message.success(`Import complete: ${result.created} created, ${result.updated} updated`);
      if (result.errors && result.errors.length > 0) {
        console.warn('Import errors:', result.errors);
      }
      setImportModalOpen(false);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ['employees', workspaceId] });
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  const columns = [
    {
      title: 'Action',
      fixed: 'left' as const,
      render: (_: any, record: EmployeeRow) => (
        <Space size={0}>
          <Button
            type="link"
            onClick={() => {
              setSelectedId(record.id);
              setDrawerOpen(true);
            }}
          >
            View / Manage
          </Button>
          <Popconfirm
            title="Permanently delete this employee?"
            description="This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true, loading: deleteEmployeeMutation.isPending }}
            onConfirm={() => deleteEmployeeMutation.mutate(record.id)}
          >
            <Button type="link" danger size="small">Delete</Button>
          </Popconfirm>
        </Space>
      ),
      width: 210,
    },
    {
      title: 'Photo',
      dataIndex: 'photo',
      width: 80,
      render: (photo: string | null) => {
        const src = toAbsoluteMediaUrl(photo);
        return <Avatar src={src || undefined} icon={<UserOutlined />} />;
      },
    },
    { title: 'Employee ID', dataIndex: 'employee_id' },
    { title: 'First Name', dataIndex: 'first_name' },
    { title: 'Last Name', dataIndex: 'last_name' },
    { title: 'Job Title', dataIndex: 'job_title' },
    { title: 'Department', dataIndex: 'department_name' },
    { title: 'Status', dataIndex: 'employment_status', render: (s: string) => <Tag>{s}</Tag> },
    { title: 'Hire Date', dataIndex: 'hire_date' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <HeroBanner
        eyebrow="Human Capital"
        title="Employee Records Management"
        description="Comprehensive employee data management with advanced filtering, bulk imports, and export capabilities."
        icon={<Users className="h-9 w-9" style={{ color: 'var(--accent)' }} />}
        gradient="neutral"
        tags={[
          { label: 'Workforce Demography', variant: 'neutral' },
          { label: 'Directory Management', variant: 'cyan' },
          { label: 'Bulk Operations', variant: 'lime' },
        ]}
        actions={(
          <>
            <Button
              type="primary"
              size="large"
              onClick={() => {
                setEditingId(null);
                employeeForm.resetFields();
                setPhotoFile(null);
                setEmployeeModalOpen(true);
              }}
            >
              Add Employee
            </Button>
            <Button size="large" onClick={() => setImportModalOpen(true)}>
              Import CSV/XLSX
            </Button>
            <Button
              size="large"
              onClick={() => {
                window.open('/api/v1/hcm/employees/template_download/', '_blank');
              }}
            >
              Download Template
            </Button>
          </>
        )}
      />

      {/* Filter Bar */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <span style={{ color: '#666', fontSize: 12 }}>Filters:</span>
          <Input
            placeholder="Search by name"
            style={{ width: 180 }}
            allowClear
            value={pendingEmployeeName || undefined}
            onChange={(e) => setPendingEmployeeName(e.target.value || null)}
          />
          <Select
            placeholder="Filter by Department"
            style={{ width: 180 }}
            allowClear
            value={pendingDept || undefined}
            onChange={(val) => setPendingDept(val || null)}
          >
            {departmentOptions?.map((dept: any) => (
              <Select.Option key={dept.id} value={dept.name}>
                {dept.name}
              </Select.Option>
            ))}
          </Select>
          <Select
            placeholder="Filter by Employment Status"
            style={{ width: 180 }}
            allowClear
            value={pendingStatus || undefined}
            onChange={(val) => setPendingStatus(val || null)}
          >
            <Select.Option value="ACTIVE">Active</Select.Option>
            <Select.Option value="INACTIVE">Inactive</Select.Option>
            <Select.Option value="ON_LEAVE">On Leave</Select.Option>
          </Select>
          <Select
            placeholder="Filter by Job Title"
            style={{ width: 180 }}
            allowClear
            value={pendingJobTitle || undefined}
            onChange={(val) => setPendingJobTitle(val || null)}
          >
            {jobTitles?.map((title: string) => (
              <Select.Option key={title} value={title}>
                {title}
              </Select.Option>
            ))}
          </Select>
          <DatePicker.RangePicker onChange={(rng) => setPendingHireRange(rng)} />
          <Space style={{ marginLeft: 'auto' }}>
            <Button
              type="primary"
              onClick={() => setAppliedFilters({
                dept: pendingDept,
                status: pendingStatus,
                jobTitle: pendingJobTitle,
                employeeName: pendingEmployeeName,
                hireFrom: pendingHireRange?.[0]?.format?.('YYYY-MM-DD') || null,
                hireTo: pendingHireRange?.[1]?.format?.('YYYY-MM-DD') || null,
              })}
            >
              Apply
            </Button>
            <Button
              onClick={() => {
                setPendingDept(null);
                setPendingStatus(null);
                setPendingJobTitle(null);
                setPendingEmployeeName(null);
                setPendingHireRange(null);
                setAppliedFilters({ dept: null, status: null, jobTitle: null, employeeName: null, hireFrom: null, hireTo: null });
              }}
            >
              Reset
            </Button>
            <Button onClick={async () => {
              const root = document.getElementById('demography-root');
              if (!root) return;
              const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#0f1117' });
              const img = canvas.toDataURL('image/png');
              const pdf = new jsPDF('p', 'mm', 'a4');
              const pageWidth = pdf.internal.pageSize.getWidth();
              const pageHeight = pdf.internal.pageSize.getHeight();
              const ratio = canvas.width / canvas.height;
              const imgWidth = pageWidth;
              const imgHeight = pageWidth / ratio;
              if (imgHeight <= pageHeight) {
                pdf.addImage(img, 'PNG', 0, 0, imgWidth, imgHeight);
              } else {
                const pageCanvas = document.createElement('canvas');
                const ctx = pageCanvas.getContext('2d');
                pageCanvas.width = canvas.width;
                const sliceHeight = (canvas.width * pageHeight) / pageWidth;
                pageCanvas.height = sliceHeight;
                let sy = 0;
                while (sy < canvas.height) {
                  ctx?.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
                  ctx?.drawImage(canvas, 0, sy, canvas.width, sliceHeight, 0, 0, pageCanvas.width, pageCanvas.height);
                  const part = pageCanvas.toDataURL('image/png');
                  pdf.addImage(part, 'PNG', 0, 0, pageWidth, pageHeight);
                  sy += sliceHeight;
                  if (sy < canvas.height) pdf.addPage();
                }
              }
              pdf.save('demography.pdf');
            }}>Export PDF</Button>
          </Space>
        </Space>
      </Card>

      <div id="demography-root">
        {/* Summary Cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card>
              <Statistic
                title="Total Employees"
                value={summaryData?.employees?.total ?? 0}
                prefix={<TeamOutlined />}
                loading={summaryLoading}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card>
              <Statistic
                title="Terminated"
                value={summaryData?.employees?.terminated ?? 0}
                prefix={<CloseCircleOutlined />}
                loading={summaryLoading}
                valueStyle={{ color: '#f5222d' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card>
              <Statistic
                title="Contracts Expiring (30d)"
                value={summaryData?.situations?.contracts_expiring_30d ?? 0}
                prefix={<UserOutlined />}
                loading={summaryLoading}
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={12} lg={6}>
            <Card title="Gender Breakdown">
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {genderSummary.map((row) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text>{row.label}</Text>
                    <Tag color="gold">{row.count}</Tag>
                  </div>
                ))}
                {genderSummary.length === 0 && <Text type="secondary">No data</Text>}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Card title="Age Groups">
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {ageSummary.map((row) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text>{row.label}</Text>
                    <Tag color="blue">{row.count}</Tag>
                  </div>
                ))}
                {ageSummary.length === 0 && <Text type="secondary">No data</Text>}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Card title="Top Nationalities">
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {nationalitySummary.map((row) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text>{row.label}</Text>
                    <Tag color="green">{row.count}</Tag>
                  </div>
                ))}
                {nationalitySummary.length === 0 && <Text type="secondary">No data</Text>}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Card title="Top Departments">
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {departmentSummary.map((row) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text>{row.label}</Text>
                    <Tag color="purple">{row.count}</Tag>
                  </div>
                ))}
                {departmentSummary.length === 0 && <Text type="secondary">No data</Text>}
              </Space>
            </Card>
          </Col>
        </Row>

        <Card>
          <MobileCardList
            dataSource={filteredEmployees}
            rowKey="id"
            loading={listLoading}
            primaryField="full_name"
            secondaryField="job_title"
            avatarField="photo"
            statusField="employment_status"
            statusRender={(val) => (
              <Tag color={val === 'ACTIVE' ? 'green' : val === 'TERMINATED' ? 'red' : 'orange'} style={{ margin: 0 }}>
                {val}
              </Tag>
            )}
            fields={[
              { key: 'employee_id', label: 'Employee ID' },
              { key: 'department_name', label: 'Department' },
              { key: 'hire_date', label: 'Hire Date' },
              { key: 'nrc', label: 'NRC' },
            ]}
            onView={(record) => {
              setSelectedId(record.id);
              setDrawerOpen(true);
            }}
            onEdit={(record) => {
              setEditingId(record.id);
              employeeForm.setFieldsValue({
                ...record,
                hire_date: record.hire_date ? dayjs(record.hire_date) : null,
                date_of_birth: record.date_of_birth ? dayjs(record.date_of_birth) : null,
              });
              setEmployeeModalOpen(true);
            }}
            onDelete={(record) => deleteEmployeeMutation.mutate(record.id)}
            deleteConfirm="Permanently delete this employee? This cannot be undone."
            desktopTable={
              <Table
                loading={listLoading}
                columns={columns}
                dataSource={filteredEmployees}
                rowKey={(r: any) => r.id}
                scroll={{ x: 1200 }}
                pagination={{
                  pageSize: 50,
                  showSizeChanger: true,
                  pageSizeOptions: ['20', '50', '100', '200'],
                  showTotal: (total) => `Total ${total} employees`
                }}
                rowClassName={(record: any) => record.employment_status === 'TERMINATED' ? 'terminated-employee-row' : ''}
              />
            }
          />
        </Card>
        <style>{`
        .terminated-employee-row {
          background-color: #3a3f47 !important;
          opacity: 0.7;
        }
      `}</style>
      </div>

      <Drawer
        size="large"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnClose
        title={employeeDetail?.full_name || 'Employee Details'}
        closeIcon={
          <button
            type="button"
            aria-label="Close employee details"
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
        extra={
          employeeDetail ? (
            <Button
              onClick={() => {
                setEditingId(employeeDetail.id);
                employeeForm.setFieldsValue({
                  ...employeeDetail,
                  hire_date: employeeDetail.hire_date ? dayjs(employeeDetail.hire_date) : undefined,
                  date_of_birth: employeeDetail.date_of_birth ? dayjs(employeeDetail.date_of_birth) : undefined,
                  employment_type: employeeDetail.employment_type,
                  category: employeeDetail.category,
                  classification: employeeDetail.classification,
                  department: employeeDetail.department,
                });
                setPhotoFile(null);
                setEmployeeModalOpen(true);
              }}
            >
              Edit Employee
            </Button>
          ) : null
        }
      >
        {detailLoading ? (
          <Skeleton active />
        ) : employeeDetail ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {employeePhotoUrl && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Avatar
                  src={employeePhotoUrl}
                  size={120}
                  icon={<UserOutlined />}
                  style={{ border: '3px solid #f5c400' }}
                />
              </div>
            )}
            <Card title="Profile">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Employee ID">{employeeDetail.employee_id}</Descriptions.Item>
                <Descriptions.Item label="Job Title">{employeeDetail.job_title}</Descriptions.Item>
                <Descriptions.Item label="Department">{employeeDetail.department_detail?.name}</Descriptions.Item>
                <Descriptions.Item label="Category">{employeeDetail.category_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="Classification">{employeeDetail.classification_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="Employment Type">{employeeDetail.employment_type_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="NRC">{employeeDetail.nrc || '—'}</Descriptions.Item>
                <Descriptions.Item label="Status">{employeeDetail.employment_status}</Descriptions.Item>
                <Descriptions.Item label="Hire Date">{employeeDetail.hire_date}</Descriptions.Item>
                <Descriptions.Item label="DOB">{employeeDetail.date_of_birth}</Descriptions.Item>
                <Descriptions.Item label="Gender">{employeeDetail.gender}</Descriptions.Item>
                <Descriptions.Item label="Nationality">{employeeDetail.nationality}</Descriptions.Item>
                <Descriptions.Item label="Email">{employeeDetail.email}</Descriptions.Item>
                <Descriptions.Item label="Phone">{employeeDetail.phone}</Descriptions.Item>
                <Descriptions.Item label="Address" span={2}>{employeeDetail.house_address}</Descriptions.Item>
                <Descriptions.Item label="Next of Kin" span={2}>
                  {employeeDetail.next_of_kin_name} ({employeeDetail.next_of_kin_relationship}) - {employeeDetail.next_of_kin_phone}
                </Descriptions.Item>
                {(employeeDetail.bank_name || employeeDetail.bank_account_number) && (
                  <>
                    <Descriptions.Item label="Bank" span={2}>{employeeDetail.bank_name || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Branch">{employeeDetail.bank_branch || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Account No.">{employeeDetail.bank_account_number || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Account Name" span={2}>{employeeDetail.bank_account_name || '—'}</Descriptions.Item>
                  </>
                )}
              </Descriptions>
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card title="Engagement">
                  {engagementLoading ? (
                    <Skeleton active />
                  ) : engagementData ? (
                    <Space direction="vertical" size="small">
                      <Text>Engaged: {engagementData.engagement_date}</Text>
                      {engagementData.initial_contract_end_date && (
                        <Text>Initial End: {engagementData.initial_contract_end_date}</Text>
                      )}
                      {engagementData.contract_duration_months && (
                        <Text>Duration: {engagementData.contract_duration_months} months</Text>
                      )}
                      {engagementData.notes && <Text type="secondary">Notes: {engagementData.notes}</Text>}
                    </Space>
                  ) : (
                    <Text type="secondary">No engagement record yet.</Text>
                  )}
                  <Form
                    form={engagementForm}
                    layout="vertical"
                    style={{ marginTop: 12 }}
                    onFinish={(vals) => engagementMutation.mutate(vals)}
                    onValuesChange={(_, values) => {
                      if (values.engagement_date && values.contract_duration_months) {
                        const endDate = values.engagement_date.add(values.contract_duration_months, 'months');
                        engagementForm.setFieldValue('initial_contract_end_date', endDate);
                      }
                    }}
                  >
                    <Form.Item name="engagement_date" label="Engagement Date" rules={[{ required: true, message: 'Required' }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="contract_type" label="Contract Type">
                      <Select
                        allowClear
                        placeholder={contractTypes.length ? 'Select contract type' : 'No contract types found'}
                        disabled={!contractTypes.length}
                      >
                        {contractTypes?.map((ct: any) => (
                          <Select.Option key={ct.id} value={ct.id}>
                            {ct.display_name || ct.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item name="contract_duration_months" label="Contract Duration (months)">
                      <InputNumber style={{ width: '100%' }} min={0} placeholder="Duration in months (auto-calculates end date)" />
                    </Form.Item>
                    <Form.Item name="initial_contract_end_date" label="Initial Contract End Date (auto-calculated)">
                      <DatePicker style={{ width: '100%' }} disabled />
                    </Form.Item>
                    <Form.Item name="notes" label="Notes">
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={engagementMutation.isPending}>
                        Save Engagement
                      </Button>
                      <Button onClick={() => engagementForm.resetFields()}>Reset</Button>
                    </Space>
                  </Form>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="Termination">
                  {terminationLoading ? (
                    <Skeleton active />
                  ) : terminationData ? (
                    <Space direction="vertical" size="small">
                      <Text>Terminated: {terminationData.termination_date}</Text>
                      {terminationData.comments && <Text type="secondary">Comments: {terminationData.comments}</Text>}
                    </Space>
                  ) : (
                    <Text type="secondary">No termination record yet.</Text>
                  )}
                  <Form
                    form={terminationForm}
                    layout="vertical"
                    style={{ marginTop: 12 }}
                    onFinish={(vals) => terminationMutation.mutate(vals)}
                  >
                    <Form.Item name="termination_date" label="Termination Date" rules={[{ required: true, message: 'Required' }]}>
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="termination_reason" label="Termination Reason">
                      <Select allowClear placeholder="Select reason">
                        {terminationReasons?.map((tr: any) => (
                          <Select.Option key={tr.id} value={tr.id}>
                            {tr.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item name="payroll_final" label="Payroll Final" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="comments" label="Comments">
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={terminationMutation.isPending}>
                        Save Termination
                      </Button>
                      <Button onClick={() => terminationForm.resetFields()}>Reset</Button>
                    </Space>
                  </Form>
                </Card>
              </Col>
            </Row>

            <Card title="Documents" style={{ marginTop: 16 }}>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Upload
                  multiple
                  showUploadList={false}
                  beforeUpload={(file) => {
                    uploadDocumentMutation.mutate(file);
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={uploadDocumentMutation.isPending}>
                    Upload Document
                  </Button>
                </Upload>
                {documentsLoading ? (
                  <Skeleton active />
                ) : employeeDocuments.length > 0 ? (
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {employeeDocuments.map((doc) => (
                      <Space key={doc.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Text>{doc.title || 'Untitled Document'}</Text>
                        <Button type="link" onClick={() => window.open(doc.file, '_blank')}>Open</Button>
                      </Space>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">No documents uploaded yet.</Text>
                )}
              </Space>
            </Card>
          </Space>
        ) : (
          <Text type="secondary">Select an employee to view details.</Text>
        )}
      </Drawer>

      <Modal
        title={editingId ? 'Edit Employee' : 'Add Employee'}
        open={employeeModalOpen}
        onCancel={() => {
          setEmployeeModalOpen(false);
          setEditingId(null);
          setPhotoFile(null);
          employeeForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Form
          layout="vertical"
          form={employeeForm}
          onFinish={(vals) => employeeMutation.mutate(vals)}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="employee_id" label="Employee ID" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="job_title" label="Job Title" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="first_name" label="First Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="last_name" label="Last Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="hire_date" label="Hire Date" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="date_of_birth" label="Date of Birth" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="gender" label="Gender" rules={[{ required: true }]}>
                <Select options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'OTHER', label: 'Other' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="nrc" label="NRC" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tpin" label="TPIN">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="nhima" label="NHIMA Number">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="napsa_number" label="NAPSA Number">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sss_number" label="S/S Number">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="house_address" label="House Address" rules={[{ required: true }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Photo">
                <Upload
                  beforeUpload={(file) => {
                    setPhotoFile(file as File);
                    return false; // prevent auto-upload
                  }}
                  maxCount={1}
                >
                  <Button icon={<UploadOutlined />}>Select Photo</Button>
                </Upload>
                {photoFile && <span style={{ marginLeft: 8 }}>{photoFile.name}</span>}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="point_of_hire" label="Point of Hire">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="employment_type" label="Employment Type" rules={[{ required: true, message: 'Please select employment type' }]}>
                <Select allowClear placeholder="Select type">
                  {employmentTypes?.map((et: any) => (
                    <Select.Option key={et.id} value={et.id}>
                      {et.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="Employee Category">
                <Select allowClear placeholder="Select category">
                  {employeeCategories?.map((c: any) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="classification" label="Employee Classification">
                <Select allowClear placeholder="Select classification (Local/Regional/National/Expatriate)">
                  <Select.Option value={1}>Local</Select.Option>
                  <Select.Option value={2}>Regional</Select.Option>
                  <Select.Option value={3}>National</Select.Option>
                  <Select.Option value={4}>Expatriate</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="department" label="Department">
                <Select allowClear placeholder="Select department">
                  {departmentOptions.map((d: any) => (
                    <Select.Option key={d.id} value={d.id}>
                      {d.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" style={{ marginTop: 8 }}>Banking Details</Divider>
          <Row gutter={[16, 0]}>
            <Col span={12}>
              <Form.Item name="bank_name" label="Bank Name">
                <Input placeholder="e.g. Zanaco, FNB, Standard Chartered" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_branch" label="Branch / Sort Code">
                <Input placeholder="e.g. Cairo Road, 0001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_account_number" label="Account Number">
                <Input placeholder="e.g. 0123456789" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_account_name" label="Account Name">
                <Input placeholder="Name as on bank account" />
              </Form.Item>
            </Col>
          </Row>

          <Card
            size="small"
            title="Beneficiaries"
            style={{ marginBottom: 12 }}
            extra={<Button disabled={!beneficiaryEmployeeId} onClick={() => setBeneficiaryModalOpen(true)}>Add Beneficiary</Button>}
          >
            {beneficiaries.length === 0 ? (
              <Text type="secondary">No beneficiaries added yet.</Text>
            ) : (
              <Table
                size="small"
                rowKey="id"
                dataSource={beneficiaries}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  { title: 'Relationship', dataIndex: 'relationship' },
                  { title: 'Phone', dataIndex: 'phone' },
                  { title: '%', dataIndex: 'percentage', width: 80 },
                  {
                    title: 'Action', width: 100, render: (_: any, row: EmployeeBeneficiary) => (
                      <Button danger size="small" loading={deleteBeneficiaryMutation.isPending} onClick={() => deleteBeneficiaryMutation.mutate(row.id)}>Remove</Button>
                    )
                  }
                ]}
              />
            )}
            {!beneficiaryEmployeeId && <Text type="secondary">Save employee first to add beneficiaries.</Text>}
          </Card>
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => employeeForm.resetFields()}>Reset</Button>
            <Button type="primary" htmlType="submit" loading={employeeMutation.isPending}>
              Save
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="Add Beneficiary"
        open={beneficiaryModalOpen}
        onCancel={() => { setBeneficiaryModalOpen(false); beneficiaryForm.resetFields(); }}
        onOk={() => beneficiaryForm.submit()}
        okButtonProps={{ loading: addBeneficiaryMutation.isPending, disabled: !beneficiaryEmployeeId }}
      >
        <Form form={beneficiaryForm} layout="vertical" onFinish={(vals) => addBeneficiaryMutation.mutate(vals)}>
          <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="relationship" label="Relationship" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item name="percentage" label="Percentage">
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Import Employees from CSV/XLSX"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          setImportFile(null);
        }}
        onOk={handleImport}
        confirmLoading={importLoading}
        okText="Import"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload
            beforeUpload={(file) => {
              setImportFile(file as File);
              return false;
            }}
            onRemove={() => setImportFile(null)}
            maxCount={1}
            accept=".csv,.xlsx,.xls"
          >
            <Button icon={<UploadOutlined />}>Select CSV or XLSX File</Button>
          </Upload>
          {importFile && <Text>Selected: {importFile.name}</Text>}
          <Text type="secondary">
            Supports CSV and Excel files. Column headers should match: Employee ID, First Name, Last Name, Job Title, Hire Date, Date of Birth, Gender, NRC, TPIN, NHIMA, S/S Number, Phone, Email, House Address, Point of Hire.
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
