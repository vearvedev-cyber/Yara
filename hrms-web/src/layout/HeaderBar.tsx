import { Flex, Input, Avatar, Upload, Button, Space, Drawer, Switch, Dropdown, Tabs, Card, Spin, Empty, Divider, Typography, Modal, List, Select, Popconfirm, message, Tag, Badge } from 'antd';
import { MessageOutlined, SettingOutlined, UploadOutlined, LogoutOutlined, UserOutlined, HomeOutlined, SearchOutlined, UserAddOutlined, MoonOutlined, SunOutlined, MenuOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { coreApi } from '../api/services/coreApi';
import { hcmApi } from '../api/services/hcmApi';
import { ApiService } from '../api/services/ApiService';
import http from '../lib/http';
import { canPerformAction, getRoleLabel, getRoleColor } from '../lib/permissions';
import { useTheme } from '../contexts/ThemeContext';

const { Text } = Typography;

const toAbsoluteLogoUrl = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (window.location.protocol === 'https:' && trimmed.startsWith('http://')) {
      return `https://${trimmed.slice('http://'.length)}`;
    }
    return trimmed;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const envBaseURL = (import.meta.env.VITE_API_BASE_URL || '').trim();
  const apiOrigin = envBaseURL
    ? envBaseURL.replace(/\/+$/, '').replace(/\/api$/, '')
    : window.location.origin;

  return `${apiOrigin}${normalized}`;
};

const withCacheBust = (value?: string | null): string | null => {
  if (!value) return null;
  const sep = value.includes('?') ? '&' : '?';
  return `${value}${sep}v=${Date.now()}`;
};

const isImageResponse = (blob: Blob, contentType?: string): boolean => {
  const detected = (blob?.type || contentType || '').toLowerCase();
  return detected.startsWith('image/');
};

export default function HeaderBar({ onMobileMenu }: { onMobileMenu?: () => void } = {}) {
  const nav = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [logo, setLogo] = useState<string>('/yara-bg.svg');
  const logoBlobUrlRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showNet, setShowNet] = useState<boolean>(() => localStorage.getItem('pref_showNet') !== 'false');
  const [denseMode, setDenseMode] = useState<boolean>(() => localStorage.getItem('pref_dense') === 'true');
  const [userRole, setUserRole] = useState<string | null>(() => localStorage.getItem('workspaceRole'));

  const applyLogoSrc = (next: string) => {
    if (logoBlobUrlRef.current && logoBlobUrlRef.current !== next) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
      logoBlobUrlRef.current = null;
    }
    if (next.startsWith('blob:')) {
      logoBlobUrlRef.current = next;
    }
    setLogo(next);
  };

  const loadWorkspaceLogo = async (workspaceId: string) => {
    const cacheKey = `workspace-logo-url-${workspaceId}`;

    try {
      const blobRes = await http.get(`/api/v1/core/workspaces/${workspaceId}/logo/`, { responseType: 'blob' });
      const responseType = (blobRes.headers?.['content-type'] as string | undefined) || '';
      if (blobRes.data && blobRes.data.size > 0 && isImageResponse(blobRes.data, responseType)) {
        const blobUrl = URL.createObjectURL(blobRes.data);
        applyLogoSrc(blobUrl);
        return;
      }
    } catch {
    }

    try {
      const res = await http.get(`/api/v1/core/workspaces/${workspaceId}/`);
      const logoUrl = res.data?.logo;
      const finalUrl = withCacheBust(toAbsoluteLogoUrl(logoUrl)) || '/yara-bg.svg';
      if (logoUrl) {
        const absoluteLogo = toAbsoluteLogoUrl(logoUrl);
        if (absoluteLogo) {
          localStorage.setItem(cacheKey, absoluteLogo);
        }
      }
      applyLogoSrc(finalUrl);
    } catch {
      const cachedLogo = localStorage.getItem(cacheKey);
      if (cachedLogo) {
        applyLogoSrc(withCacheBust(cachedLogo) || '/yara-bg.svg');
        return;
      }
      applyLogoSrc('/yara-bg.svg');
    }
  };

  const handleLogoUpload = async (info: any) => {
    const file = info.file?.originFileObj || info.file;
    if (!file) return;

    const workspaceId = localStorage.getItem('workspaceId');
    if (!workspaceId) {
      message.error('Select a workspace before uploading a logo');
      return;
    }

    const formData = new FormData();
    formData.append('logo', file);

    try {
      await http.post(`/api/v1/core/workspaces/${workspaceId}/upload_logo/`, formData);

      await loadWorkspaceLogo(workspaceId);
      window.dispatchEvent(new Event('companyLogoUpdated'));
      message.success('Company logo updated');
    } catch {
      message.error('Failed to upload logo');
    }
  };

  useEffect(() => {
    const loadLogo = async () => {
      const workspaceId = localStorage.getItem('workspaceId');
      if (!workspaceId) {
        applyLogoSrc('/yara-bg.svg');
        setTimeout(() => {
          const lateWorkspaceId = localStorage.getItem('workspaceId');
          if (lateWorkspaceId) {
            loadWorkspaceLogo(lateWorkspaceId).catch(() => applyLogoSrc('/yara-bg.svg'));
          }
        }, 900);
        return;
      }
      await loadWorkspaceLogo(workspaceId);
    };
    loadLogo();
    window.addEventListener('workspaceChanged', loadLogo as EventListener);
    return () => {
      window.removeEventListener('workspaceChanged', loadLogo as EventListener);
    };
  }, []);

  // Watch for workspace changes from storage and reload logo
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'workspaceId' && e.newValue) {
        // Force reload logo when workspace changes
        setTimeout(() => {
          const workspaceId = localStorage.getItem('workspaceId');
          if (workspaceId) {
            loadWorkspaceLogo(workspaceId).catch(() => applyLogoSrc('/yara-bg.svg'));
          }
        }, 100);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (logoBlobUrlRef.current) {
        URL.revokeObjectURL(logoBlobUrlRef.current);
        logoBlobUrlRef.current = null;
      }
    };
  }, []);

  const { data: profile } = useQuery({
    queryKey: ['user-profile-header'],
    queryFn: async () => (await http.get('/api/v1/auth/profile/')).data,
    enabled: !!localStorage.getItem('access'),
    staleTime: 60_000,
  });

  const displayName = (() => {
    const first = profile?.first_name?.trim();
    const last = profile?.last_name?.trim();
    const full = [first, last].filter(Boolean).join(' ');
    return full || profile?.username || 'User';
  })();


  useEffect(() => {
    document.body.dataset.dense = denseMode ? '1' : '';
    localStorage.setItem('pref_dense', denseMode ? 'true' : 'false');
  }, [denseMode]);

  const accountMenu: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: 'Profile' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out' },
  ];

  const [isConsultant, setIsConsultant] = useState<boolean>(() => localStorage.getItem('isConsultant') === '1');
  const [searchTab, setSearchTab] = useState<string>(isConsultant ? 'clients' : 'employees');
  useEffect(() => {
    // Refresh consultant flag on mount in case login recently set it
    setIsConsultant(localStorage.getItem('isConsultant') === '1');
  }, []);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Workspace members management
  const [memberships, setMemberships] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [userOptions, setUserOptions] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('VIEWER');
  const [createNewAccountModal, setCreateNewAccountModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<string>('VIEWER');

  // Fetch unread message count for header badge
  const { data: conversations } = useQuery<any[]>({
    queryKey: ['conversations-header'],
    queryFn: async () => {
      const res = await http.get('/api/v1/core/conversations/');
      return Array.isArray(res.data) ? res.data : res.data?.results || [];
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    enabled: !!localStorage.getItem('access'),
  });

  const unreadCount = conversations?.reduce((sum, conv) => sum + (conv.unread_count || 0), 0) || 0;

  const roleOptions = [
    { label: 'Owner', value: 'OWNER' },
    { label: 'Admin', value: 'ADMIN' },
    { label: 'HR Manager', value: 'HR_MANAGER' },
    { label: 'Manager', value: 'MANAGER' },
    { label: 'Viewer', value: 'VIEWER' },
  ];

  const resolveConsultantHomeWorkspace = async () => {
    const memberships = await coreApi.listMyWorkspaces();
    if (!Array.isArray(memberships) || memberships.length === 0) {
      return null;
    }

    const consultantWs = memberships.find((m: any) => m?.workspace?.workspace_type === 'CONSULTANT');
    const defaultWs = memberships.find((m: any) => m?.is_default) || memberships[0];
    const homeWs = consultantWs || defaultWs;

    if (homeWs?.workspace?.id) {
      localStorage.setItem('consultantHomeWorkspaceId', String(homeWs.workspace.id));
      localStorage.setItem('consultantHomeWorkspaceName', String(homeWs.workspace.name || ''));
      localStorage.setItem('consultantHomeWorkspaceRole', homeWs.role || 'VIEWER');
    }

    return homeWs;
  };

  const onAccountClick: MenuProps['onClick'] = (info) => {
    if (info.key === 'logout') {
      localStorage.removeItem('access');
      localStorage.removeItem('refresh');
      localStorage.removeItem('workspaceId');
      localStorage.removeItem('workspaceName');
      window.location.replace('/');
    } else if (info.key === 'profile') {
      nav('/profile');
    }
  };

  const handleSearch = async (value: string) => {
    if (!value?.trim()) {
      setSearchResults([]);
      setSearchVisible(false);
      return;
    }
    setSearchLoading(true);
    try {
      let data: any[] = [];
      if (searchTab === 'clients') {
        data = await coreApi.listClients({ search: value, page_size: 5 });
      } else if (searchTab === 'employees') {
        data = await hcmApi.searchEmployees(value);
      } else if (searchTab === 'cases') {
        const res: any = await ApiService.apiV1ActivitiesCaseStudiesList(undefined, undefined, value as any);
        data = res?.results || res || [];
      } else if (searchTab === 'contractors') {
        data = [];
      }
      setSearchResults(data || []);
      setSearchVisible(true);
    } catch (_) {
      setSearchResults([]);
      setSearchVisible(true);
    } finally {
      setSearchLoading(false);
    }
  };

  const loadUserOptions = async (query?: string) => {
    try {
      const res = await http.get('/api/v1/core/users/', { params: { search: query, page_size: 50 } });
      setUserOptions(res.data?.results || res.data || []);
    } catch (_) {
      setUserOptions([]);
    }
  };

  const loadMemberships = async () => {
    const workspaceId = localStorage.getItem('workspaceId');
    if (!workspaceId) return;

    // Check if user has permission to manage members
    if (!canPerformAction('can_manage_members')) {
      message.error('You do not have permission to manage workspace members');
      return;
    }

    setMembersLoading(true);
    try {
      const data = await coreApi.listMemberships({ workspace: workspaceId, page_size: 100 });
      setMemberships(data || []);
    } catch (err: any) {
      message.error('Could not load workspace members');
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    if (settingsOpen) {
      setUserRole(localStorage.getItem('workspaceRole'));
      loadMemberships();
      loadUserOptions();
    }
  }, [settingsOpen]);

  const handleAddMember = async () => {
    if (!canPerformAction('can_manage_members')) {
      message.error('You do not have permission to add members');
      return;
    }

    const workspaceId = localStorage.getItem('workspaceId');
    if (!workspaceId || !selectedUser) {
      message.warning('Select a user to add');
      return;
    }
    setMemberSaving(true);
    try {
      const created = await coreApi.createMembership({ user: selectedUser, workspace: Number(workspaceId), role: selectedRole });
      setMemberships((prev) => [created, ...prev]);
      setSelectedUser(null);
      message.success('Member added');
    } catch (err: any) {
      message.error('Could not add member');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleRoleChange = async (id: number, role: string) => {
    if (!canPerformAction('can_manage_members')) {
      message.error('You do not have permission to update roles');
      return;
    }

    setMemberSaving(true);
    try {
      const updated = await coreApi.updateMembership(id, { role });
      setMemberships((prev) => prev.map((m) => (m.id === id ? { ...m, role: updated.role } : m)));
      message.success('Role updated');
    } catch (err: any) {
      message.error('Could not update role');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleRemoveMember = async (id: number) => {
    if (!canPerformAction('can_manage_members')) {
      message.error('You do not have permission to remove members');
      return;
    }

    setMemberSaving(true);
    try {
      await coreApi.deleteMembership(id);
      setMemberships((prev) => prev.filter((m) => m.id !== id));
      message.success('Member removed');
    } catch (err: any) {
      message.error('Could not remove member');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!canPerformAction('can_manage_members')) {
      message.error('You do not have permission to create accounts');
      return;
    }

    setMemberSaving(true);
    try {
      const created = await coreApi.createUserWithMembership({
        email: newUserEmail,
        first_name: newUserFirstName,
        last_name: newUserLastName,
        password: newUserPassword || undefined,
        role: newUserRole,
      });
      setMemberships((prev) => [created, ...prev]);
      setCreateNewAccountModal(false);
      setNewUserEmail('');
      setNewUserFirstName('');
      setNewUserLastName('');
      setNewUserPassword('');
      setNewUserRole('VIEWER');
      const tempPass = (created as any).temporary_password;
      if (tempPass) {
        message.success(`Account created! Temporary password: ${tempPass}`, 8);
      } else {
        message.success('Account created');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.email?.[0] || err?.response?.data?.detail || 'Could not create account');
    } finally {
      setMemberSaving(false);
    }
  };


  return (
    <Flex align="center" justify="space-between" style={{ padding: '10px 16px', height: '100%', width: '100%' }}>
      <Flex align="center" gap={10} style={{ flex: '0 0 auto', maxWidth: 260 }}>
        {/* Hamburger — mobile only */}
        {onMobileMenu && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={onMobileMenu}
            style={{
              fontSize: 18,
              color: theme === 'dark' ? '#f5c400' : '#4a3fcf',
              padding: '4px 8px',
              flexShrink: 0,
            }}
          />
        )}
        {localStorage.getItem('isConsultant') === '1' && (
          <Button
            size="small"
            icon={<HomeOutlined />}
            onClick={async () => {
              try {
                const homeWs = await resolveConsultantHomeWorkspace();
                const homeWorkspaceId = String(homeWs?.workspace?.id || localStorage.getItem('consultantHomeWorkspaceId') || '');
                const homeWorkspaceName = String(homeWs?.workspace?.name || localStorage.getItem('consultantHomeWorkspaceName') || '');
                const homeWorkspaceRole = String(homeWs?.role || localStorage.getItem('consultantHomeWorkspaceRole') || 'VIEWER');

                if (homeWorkspaceId) {
                  localStorage.setItem('workspaceId', homeWorkspaceId);
                  if (homeWorkspaceName) localStorage.setItem('workspaceName', homeWorkspaceName);
                  if (homeWorkspaceRole) localStorage.setItem('workspaceRole', homeWorkspaceRole);
                  window.dispatchEvent(new Event('workspaceChanged'));
                }
              } catch (_) {
                // fallback to existing local storage values
              }

              window.location.href = '/portfolio';
            }}
            style={{
              background: theme === 'dark' ? 'rgba(245, 196, 0, 0.1)' : 'rgba(74, 63, 207, 0.12)',
              borderColor: theme === 'dark' ? 'rgba(245, 196, 0, 0.3)' : 'rgba(74, 63, 207, 0.24)',
              color: theme === 'dark' ? '#f5c400' : '#4437b8',
            }}
          >
            Home
          </Button>
        )}
        <img
          src={logo}
          alt="Company Logo"
          style={{
            height: 32,
            maxWidth: 160,
            width: 'auto',
            objectFit: 'contain',
            display: 'block',
          }}
          onError={(event) => {
            const target = event.currentTarget;
            if (!target.src.includes('/yara-bg.svg')) {
              target.src = '/yara-bg.svg';
            } else if (!target.src.includes('/yara-hero.png')) {
              target.src = '/yara-hero.png';
            }
          }}
        />
      </Flex>

      <Flex vertical style={{ flex: 1, minWidth: 0, marginLeft: 16, overflow: 'hidden' }}>
        <Text strong style={{ color: theme === 'dark' ? '#D4AF37' : '#352b47', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>Hello, {displayName}</Text>
        <Text type="secondary" style={{ fontSize: 11, color: theme === 'dark' ? '#c4c8d4' : '#70697f', whiteSpace: 'nowrap' }}>What are we doing today?</Text>
      </Flex>

      <Flex align="center" gap={20} style={{ flex: 0, marginLeft: 'auto' }}>
        <SearchOutlined
          style={{
            fontSize: 18,
            cursor: 'pointer',
            color: theme === 'dark' ? '#f5c400' : '#3b82f6',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textShadow = theme === 'dark'
              ? '0 0 10px rgba(245, 196, 0, 0.4)'
              : '0 0 10px rgba(74, 63, 207, 0.28)';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.textShadow = 'none'; }}
          onClick={() => setSearchOpen((v) => !v)}
        />
        <Badge count={unreadCount} offset={[-5, 5]} size="small">
          <MessageOutlined
            style={{
              fontSize: 18,
              cursor: 'pointer',
              color: theme === 'dark' ? '#3ee7ff' : '#4a3fcf',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textShadow = theme === 'dark'
                ? '0 0 10px rgba(62, 231, 255, 0.4)'
                : '0 0 10px rgba(74, 63, 207, 0.28)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.textShadow = 'none'; }}
            onClick={() => nav('/messaging')}
          />
        </Badge>
        {theme === 'dark' ? (
          <SunOutlined
            style={{
              fontSize: 18,
              cursor: 'pointer',
              color: '#eab308',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textShadow = '0 0 10px rgba(234, 179, 8, 0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.textShadow = 'none'; }}
            onClick={toggleTheme}
            title="Switch to Light Mode"
          />
        ) : (
          <MoonOutlined
            style={{
              fontSize: 18,
              cursor: 'pointer',
              color: '#4a3fcf',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textShadow = '0 0 10px rgba(74, 63, 207, 0.35)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.textShadow = 'none'; }}
            onClick={toggleTheme}
            title="Switch to Dark Mode"
          />
        )}
        <SettingOutlined
          style={{
            fontSize: 18,
            cursor: 'pointer',
            color: theme === 'dark' ? '#7cff6b' : '#3f8a63',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textShadow = theme === 'dark'
              ? '0 0 10px rgba(124, 255, 107, 0.4)'
              : '0 0 10px rgba(63, 138, 99, 0.3)';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.textShadow = 'none'; }}
          onClick={() => setSettingsOpen(true)}
        />
        <Dropdown menu={{ items: accountMenu, onClick: onAccountClick }} placement="bottomRight" trigger={['click']}>
          <Avatar
            style={{
              backgroundColor: theme === 'dark' ? '#f5c400' : '#4a3fcf',
              color: theme === 'dark' ? '#05060a' : '#ffffff',
              cursor: 'pointer',
              border: theme === 'dark'
                ? '2px solid rgba(245, 196, 0, 0.3)'
                : '2px solid rgba(74, 63, 207, 0.24)',
              boxShadow: theme === 'dark'
                ? '0 0 12px rgba(245, 196, 0, 0.2)'
                : '0 0 12px rgba(74, 63, 207, 0.16)',
              fontWeight: 600,
            }}
          >
            U
          </Avatar>
        </Dropdown>
      </Flex>

      {searchOpen && (
        <div
          style={{
            position: 'absolute',
            top: 64,
            right: 24,
            padding: '10px 12px',
            background: theme === 'dark'
              ? 'linear-gradient(135deg, rgba(11, 15, 26, 0.95) 0%, rgba(15, 22, 40, 0.9) 100%)'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.97) 0%, rgba(247, 243, 237, 0.98) 100%)',
            borderRadius: 10,
            width: 360,
            zIndex: 100,
            border: theme === 'dark' ? '1px solid rgba(245, 196, 0, 0.2)' : '1px solid rgba(53, 44, 70, 0.14)',
            boxShadow: theme === 'dark'
              ? '0 8px 24px rgba(245, 196, 0, 0.15), 0 0 16px rgba(62, 231, 255, 0.1)'
              : '0 10px 24px rgba(35, 26, 53, 0.13)',
          }}
        >
          <Input.Search
            placeholder={isConsultant ? 'Search clients, contractors, employees, cases...' : 'Search employees, cases...'}
            style={{ width: '100%', marginBottom: isConsultant ? 6 : 0 }}
            allowClear
            loading={searchLoading}
            onSearch={handleSearch}
            onChange={(e) => { if (!e.target.value) { setSearchVisible(false); setSearchResults([]); } }}
          />
          {isConsultant && (
            <Tabs
              size="small"
              activeKey={searchTab}
              onChange={setSearchTab}
              items={[
                { key: 'clients', label: 'Clients' },
                { key: 'contractors', label: 'Contractors' },
                { key: 'employees', label: 'Employees' },
                { key: 'cases', label: 'Cases' },
              ]}
              style={{ marginTop: 0 }}
            />
          )}
          {searchVisible && (
            <Card
              size="small"
              style={{
                position: 'absolute',
                top: isConsultant ? 96 : 52,
                left: 0,
                width: 360,
                zIndex: 10,
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(15, 22, 40, 0.95) 0%, rgba(11, 15, 26, 0.92) 100%)'
                  : 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 245, 240, 0.98) 100%)',
                border: theme === 'dark' ? '1px solid rgba(245, 196, 0, 0.2)' : '1px solid rgba(53, 44, 70, 0.14)',
                boxShadow: theme === 'dark' ? '0 8px 20px rgba(245, 196, 0, 0.1)' : '0 8px 20px rgba(35, 26, 53, 0.1)',
                borderRadius: 10,
              }}
              styles={{ body: { padding: 10, maxHeight: 260, overflowY: 'auto' } }}
              onMouseLeave={() => setSearchVisible(false)}
            >
              {searchLoading ? (
                <Spin />
              ) : searchResults.length === 0 ? (
                <Empty description="No results" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {searchResults.map((item: any) => {
                    return <div
                      key={item.id || Math.random()}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: theme === 'dark' ? 'rgba(245, 196, 0, 0.06)' : 'rgba(53, 44, 70, 0.05)',
                        border: theme === 'dark' ? '1px solid rgba(245, 196, 0, 0.12)' : '1px solid rgba(53, 44, 70, 0.1)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(245, 196, 0, 0.12)';
                        e.currentTarget.style.borderColor = 'rgba(245, 196, 0, 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(245, 196, 0, 0.06)';
                        e.currentTarget.style.borderColor = 'rgba(245, 196, 0, 0.12)';
                      }}
                    >
                      {searchTab === 'clients' && item.name}
                      {searchTab === 'employees' && item.full_name}
                      {searchTab === 'cases' && (item.title || item.case_title || `Case #${item.id}`)}
                      {searchTab === 'contractors' && 'Contractor'}
                    </div>;
                  })}
                </Space>
              )}
            </Card>
          )}
        </div>
      )}

      <Drawer
        title="Settings"
        placement="right"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        closeIcon={
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
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
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <span style={{ display: 'block', marginBottom: 8 }}>Upload Company Logo</span>
            <Upload
              beforeUpload={() => false}
              onChange={handleLogoUpload}
              showUploadList={false}
              accept="image/*"
            >
              <Button icon={<UploadOutlined />} size="small">Choose Logo</Button>
            </Upload>
            {logo && (
              <div style={{ marginTop: 8, padding: 8, border: '1px solid rgba(212,175,55,0.3)', borderRadius: 4 }}>
                <img
                  src={logo}
                  alt="Current Logo"
                  style={{ height: 40, objectFit: 'contain' }}
                  onError={(event) => {
                    const target = event.currentTarget;
                    if (!target.src.includes('/yara-bg.svg')) {
                      target.src = '/yara-bg.svg';
                    } else if (!target.src.includes('/yara-hero.png')) {
                      target.src = '/yara-hero.png';
                    }
                  }}
                />
                <div style={{ marginTop: 4, fontSize: 12 }}>Current logo (workspace)</div>
              </div>
            )}
          </div>
          <Divider />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Show Net on Salary</span>
            <Switch
              checked={showNet}
              onChange={(v) => {
                setShowNet(v);
                localStorage.setItem('pref_showNet', v ? 'true' : 'false');
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Dense Mode</span>
            <Switch checked={denseMode} onChange={setDenseMode} />
          </div>

          <Divider />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span>Current Role</span>
              {userRole && <Tag color={getRoleColor(userRole as any)}>{getRoleLabel(userRole as any)}</Tag>}
            </div>
          </div>

          {canPerformAction('can_manage_members') && (
            <>
              <Divider />
              <div>
                <Button
                  block
                  type="dashed"
                  style={{ marginBottom: 12 }}
                  onClick={() => {
                    setSettingsOpen(false);
                    nav('/settings/roles');
                  }}
                >
                  Manage Roles & Permissions
                </Button>
              </div>
            </>
          )}

          {canPerformAction('can_manage_members') ? (
            <>
              <Divider />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Workspace Members</span>
                <Space>
                  <Button size="small" onClick={() => setCreateNewAccountModal(true)}>
                    Create Account
                  </Button>
                  <Button icon={<UserAddOutlined />} size="small" type="primary" onClick={handleAddMember} loading={memberSaving}>
                    Add Existing
                  </Button>
                </Space>
              </div>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  showSearch
                  placeholder="Select existing user"
                  value={selectedUser ?? undefined}
                  onSearch={(v) => loadUserOptions(v)}
                  onChange={(v) => setSelectedUser(v)}
                  filterOption={false}
                  options={userOptions.map((u) => ({
                    label: `${u.full_name || u.username || 'User'} (${u.email || 'no email'})`,
                    value: u.id,
                  }))}
                  loading={membersLoading}
                  style={{ width: '100%' }}
                />
                <Select
                  value={selectedRole}
                  onChange={setSelectedRole}
                  options={roleOptions}
                  style={{ width: '100%' }}
                />
              </Space>

              <Card size="small" style={{ marginTop: 12 }} styles={{ body: { padding: 0 } }}>
                <List
                  loading={membersLoading}
                  dataSource={memberships}
                  renderItem={(item: any) => (
                    <List.Item
                      actions={[
                        <Select
                          key="role"
                          size="small"
                          value={item.role}
                          onChange={(val) => handleRoleChange(item.id, val)}
                          options={roleOptions}
                          style={{ width: 140 }}
                          disabled={memberSaving}
                        />,
                        <Popconfirm
                          key="remove"
                          title="Remove member?"
                          onConfirm={() => handleRemoveMember(item.id)}
                        >
                          <Button danger size="small" loading={memberSaving}>
                            Remove
                          </Button>
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={item.user_details?.full_name || item.user_details?.username || 'User'}
                        description={`${item.user_details?.email || ''}`}
                      />
                    </List.Item>
                  )}
                />
                {(!memberships || memberships.length === 0) && !membersLoading && (
                  <div style={{ padding: 12 }}>
                    <Empty description="No workspace members" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  </div>
                )}
              </Card>
            </>
          ) : (
            <>
              <Divider />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Only Owner/Admin can manage workspace members. Your current role: <strong>{userRole}</strong>
              </Typography.Text>
            </>
          )}
        </Space>
      </Drawer>

      {/* Create New Account Modal */}
      <Modal
        title="Create New Account"
        open={createNewAccountModal}
        onCancel={() => setCreateNewAccountModal(false)}
        onOk={handleCreateAccount}
        confirmLoading={memberSaving}
        okText="Create"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="Email (required)"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
          />
          <Input
            placeholder="First Name"
            value={newUserFirstName}
            onChange={(e) => setNewUserFirstName(e.target.value)}
          />
          <Input
            placeholder="Last Name"
            value={newUserLastName}
            onChange={(e) => setNewUserLastName(e.target.value)}
          />
          <Input.Password
            placeholder="Password (optional, auto-generated if blank)"
            value={newUserPassword}
            onChange={(e) => setNewUserPassword(e.target.value)}
          />
          <Select
            value={newUserRole}
            onChange={setNewUserRole}
            options={roleOptions}
            style={{ width: '100%' }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            If password is not specified, a temporary password will be generated and shown after creation.
          </Typography.Text>
        </Space>
      </Modal>

      {/* Search Modal */}
      <Modal
        title="Search"
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        width={600}
      >
        <Tabs
          activeKey={searchTab}
          onChange={setSearchTab}
          items={[
            ...(isConsultant ? [{ key: 'clients', label: 'Clients' }] : []),
            { key: 'employees', label: 'Employees' },
            { key: 'cases', label: 'Case Studies' },
          ]}
        />
        <Input.Search
          placeholder={`Search ${searchTab}...`}
          onSearch={handleSearch}
          loading={searchLoading}
          style={{ marginBottom: 16 }}
        />
        {searchVisible && (
          <Card>
            {searchLoading ? (
              <Spin />
            ) : searchResults.length > 0 ? (
              <List
                dataSource={searchResults}
                renderItem={(item: any) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      if (searchTab === 'employees') {
                        nav(`/hcm/demography`);
                      } else if (searchTab === 'clients') {
                        nav(`/core/clients`);
                      } else if (searchTab === 'cases') {
                        nav(`/activities/cases`);
                      }
                      setSearchOpen(false);
                    }}
                  >
                    <List.Item.Meta
                      title={item.full_name || item.name || item.title || 'Unknown'}
                      description={
                        searchTab === 'employees'
                          ? `${item.employee_id || ''} - ${item.job_title || ''}`
                          : searchTab === 'clients'
                            ? `${item.code || ''}`
                            : item.status || ''
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No results found" />
            )}
          </Card>
        )}
      </Modal>
    </Flex>
  );
}
