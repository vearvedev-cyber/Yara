/**
 * MobileModal — renders as a centred Modal on desktop,
 * a slide-up bottom-sheet Drawer on mobile portrait.
 */
import React from 'react';
import { Modal, Drawer, Grid } from 'antd';
import type { ModalProps } from 'antd';

interface MobileModalProps extends Omit<ModalProps, 'onCancel'> {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  height?: string | number;
}

export default function MobileModal({
  open,
  onClose,
  title,
  children,
  footer,
  height = '85vh',
  width = 680,
  ...rest
}: MobileModalProps) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        placement="bottom"
        height={height}
        styles={{
          body: {
            padding: '0 16px 16px',
            overflowY: 'auto',
          },
          header: {
            padding: '12px 16px 8px',
            borderBottom: '1px solid var(--border)',
          },
          wrapper: {
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
          },
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Drag handle */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--border)',
                  margin: '0 auto 8px',
                }}
              />
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                {title}
              </span>
            </div>
          </div>
        }
        closeIcon={
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
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
        footer={
          footer ? (
            <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              {footer}
            </div>
          ) : null
        }
      >
        {children}
      </Drawer>
    );
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      footer={footer ?? null}
      width={width}
      destroyOnClose
      {...rest}
    >
      {children}
    </Modal>
  );
}
