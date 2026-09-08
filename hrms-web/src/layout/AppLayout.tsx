import { Layout, Drawer, Grid } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import HeaderBar from './HeaderBar';
import Sidebar from './Sidebar';
import BottomNav from '../components/BottomNav';
import http from '../lib/http';

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

const { Content, Sider, Header } = Layout;

const SIDEBAR_WIDTH = 240;

export default function AppLayout() {
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string>('/yara-bg.svg');
  const logoBlobUrlRef = useRef<string | null>(null);

  const applyLogoSrc = (next: string) => {
    if (logoBlobUrlRef.current && logoBlobUrlRef.current !== next) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
      logoBlobUrlRef.current = null;
    }
    if (next.startsWith('blob:')) {
      logoBlobUrlRef.current = next;
    }
    setLogoSrc(next);
  };

  useEffect(() => {
    const isConsultant = localStorage.getItem('isConsultant') === '1';
    const isPortfolioRoute = location.pathname.startsWith('/portfolio');
    if (!isConsultant || !isPortfolioRoute) {
      return;
    }

    const ensureConsultantWorkspaceContext = async () => {
      try {
        const res = await http.get('/api/v1/core/workspaces/my_workspaces/');
        const memberships = Array.isArray(res.data) ? res.data : [];
        if (!memberships.length) {
          return;
        }

        const consultantWs = memberships.find((m: any) => m?.workspace?.workspace_type === 'CONSULTANT');
        const defaultWs = memberships.find((m: any) => m?.is_default) || memberships[0];
        const homeWs = consultantWs || defaultWs;

        const homeWorkspaceId = String(homeWs?.workspace?.id || '');
        const homeWorkspaceName = String(homeWs?.workspace?.name || '');
        const homeWorkspaceRole = String(homeWs?.role || 'VIEWER');

        if (homeWorkspaceId) {
          localStorage.setItem('consultantHomeWorkspaceId', homeWorkspaceId);
          localStorage.setItem('consultantHomeWorkspaceName', homeWorkspaceName);
          localStorage.setItem('consultantHomeWorkspaceRole', homeWorkspaceRole);

          if (localStorage.getItem('workspaceId') !== homeWorkspaceId) {
            localStorage.setItem('workspaceId', homeWorkspaceId);
            localStorage.setItem('workspaceName', homeWorkspaceName);
            localStorage.setItem('workspaceRole', homeWorkspaceRole);
            window.dispatchEvent(new Event('workspaceChanged'));
          }
        }
      } catch {
        const homeWorkspaceId = localStorage.getItem('consultantHomeWorkspaceId');
        const homeWorkspaceName = localStorage.getItem('consultantHomeWorkspaceName');
        const homeWorkspaceRole = localStorage.getItem('consultantHomeWorkspaceRole');

        if (homeWorkspaceId && localStorage.getItem('workspaceId') !== homeWorkspaceId) {
          localStorage.setItem('workspaceId', homeWorkspaceId);
          if (homeWorkspaceName) localStorage.setItem('workspaceName', homeWorkspaceName);
          if (homeWorkspaceRole) localStorage.setItem('workspaceRole', homeWorkspaceRole);
          window.dispatchEvent(new Event('workspaceChanged'));
        }
      }
    };

    ensureConsultantWorkspaceContext();
  }, [location.pathname]);

  useEffect(() => {
    const fetchLogo = async () => {
      const workspaceId = localStorage.getItem('workspaceId');

      if (!workspaceId) {
        applyLogoSrc('/yara-bg.svg');
        setTimeout(() => {
          const lateWorkspaceId = localStorage.getItem('workspaceId');
          if (lateWorkspaceId) {
            fetchLogo();
          }
        }, 900);
        return;
      }

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

    const updateLogo = () => {
      fetchLogo();
    };

    fetchLogo();
    window.addEventListener('storage', updateLogo);
    window.addEventListener('companyLogoUpdated', updateLogo as EventListener);
    window.addEventListener('workspaceChanged', updateLogo as EventListener);
    return () => {
      window.removeEventListener('storage', updateLogo);
      window.removeEventListener('companyLogoUpdated', updateLogo as EventListener);
      window.removeEventListener('workspaceChanged', updateLogo as EventListener);
      if (logoBlobUrlRef.current) {
        URL.revokeObjectURL(logoBlobUrlRef.current);
        logoBlobUrlRef.current = null;
      }
    };
  }, []);
  const sidebarContent = (
    <>
      <div style={{
        padding: '20px 16px',
        textAlign: 'center',
        borderBottom: '1px solid var(--sidebar-border)',
        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, transparent 100%)',
        flexShrink: 0,
      }}>
        <img
          src={logoSrc}
          alt="Company Logo"
          style={{ height: 44, objectFit: 'contain', width: '100%' }}
          onError={(event) => {
            const target = event.currentTarget;
            if (!target.src.includes('/yara-bg.svg')) target.src = '/yara-bg.svg';
            else if (!target.src.includes('/yara-hero.png')) target.src = '/yara-hero.png';
          }}
        />
      </div>
      <Sidebar activePath={location.pathname} onNavClick={isMobile ? () => setDrawerOpen(false) : undefined} />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--shell-bg)', position: 'relative' }}>
      {/* Background glows */}
      <div style={{ position: 'fixed', inset: 0, background: 'var(--shell-glow)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, background: 'var(--shell-grid)', pointerEvents: 'none', zIndex: 0 }} />

      {/* Desktop sidebar */}
      {!isMobile && (
        <Sider
          width={SIDEBAR_WIDTH}
          style={{
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--sidebar-border)',
            boxShadow: '4px 0 12px rgba(25, 17, 42, 0.18)',
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 10,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollBehavior: 'smooth',
          }}
        >
          {sidebarContent}
        </Sider>
      )}

      {/* Mobile sidebar — slide-in Drawer */}
      {isMobile && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          width={260}
          closeIcon={
            <button
              type="button"
              aria-label="Close navigation"
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
          styles={{
            body: { padding: 0, background: 'var(--sidebar-bg)', display: 'flex', flexDirection: 'column' },
            header: { display: 'none' },
            wrapper: { boxShadow: '4px 0 20px rgba(0,0,0,0.4)' },
          }}
          style={{ zIndex: 1000 }}
        >
          {sidebarContent}
        </Drawer>
      )}

      <Layout
        style={{
          background: 'transparent',
          position: 'relative',
          zIndex: 1,
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          transition: 'margin-left 0.2s ease',
        }}
      >
        <Header
          style={{
            background: 'var(--header-bg)',
            padding: 0,
            borderBottom: '1px solid var(--header-border)',
            boxShadow: '0 4px 16px rgba(28, 22, 44, 0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <HeaderBar onMobileMenu={isMobile ? () => setDrawerOpen(true) : undefined} />
        </Header>
        <Content
          style={{
            margin: isMobile ? '12px 10px' : 24,
            background: 'transparent',
            minHeight: 'calc(100vh - 112px)',
            paddingBottom: isMobile ? 72 : 0,
          }}
        >
          <Outlet />
        </Content>
      </Layout>

      {/* Bottom nav — mobile only */}
      <BottomNav onMore={() => setDrawerOpen(true)} />

      {/* Footer floater — hidden on mobile to save space */}
      {!isMobile && (
        <div
          style={{
            position: 'fixed',
            right: 12,
            bottom: 12,
            background: 'var(--bg-card-soft)',
            color: 'var(--text-dim)',
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 10,
            letterSpacing: '0.05em',
            boxShadow: '0 4px 12px rgba(27, 20, 41, 0.12)',
            zIndex: 3,
            fontWeight: 500,
          }}
        >
          <span>HRMS</span>
          <span style={{ margin: '0 8px', opacity: 0.5 }}>•</span>
          <span>Workspace Suite</span>
        </div>
      )}
    </Layout>
  );
}
