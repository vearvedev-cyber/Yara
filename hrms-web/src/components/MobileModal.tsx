/**
 * MobileModal — renders as a centred Modal on desktop,
 * a slide-up bottom-sheet Drawer on mobile portrait.
 *
 * When `onOk` is given and `footer` isn't, both layouts show Cancel and OK buttons
 * (okText, cancelText, confirmLoading and okButtonProps are honoured). Pass
 * `footer={null}` for no footer. The phone back button closes it.
 */
import React from 'react';
import { Button, Grid, Space } from 'antd';
import type { ModalProps } from 'antd';
import { Drawer, Modal } from './overlays';

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
  onOk,
  okText,
  cancelText,
  confirmLoading,
  okButtonProps,
  ...rest
}: MobileModalProps) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const useDefaultFooter = footer === undefined && !!onOk;

  if (isMobile) {
    const buttons = useDefaultFooter ? (
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{cancelText ?? 'Cancel'}</Button>
        <Button
          type="primary"
          loading={!!confirmLoading}
          {...okButtonProps}
          onClick={(e) => onOk?.(e as React.MouseEvent<HTMLButtonElement>)}
        >
          {okText ?? 'OK'}
        </Button>
      </Space>
    ) : footer;

    return (
      <Drawer
        open={open}
        onClose={onClose}
        placement="bottom"
        height={height}
        destroyOnHidden
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
        // The Drawer calls onClose when this icon is tapped; no extra onClick, or it fires twice
        closeIcon={
          <span
            aria-label="Close"
            style={{
              color: 'var(--text-dim)',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </span>
        }
        footer={
          buttons ? (
            <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              {buttons}
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
      onOk={onOk}
      okText={okText}
      cancelText={cancelText}
      confirmLoading={confirmLoading}
      okButtonProps={okButtonProps}
      title={title}
      // undefined → antd's own Cancel/OK footer; otherwise what the caller passed (or none)
      footer={useDefaultFooter ? undefined : (footer ?? null)}
      width={width}
      destroyOnClose
      {...rest}
    >
      {children}
    </Modal>
  );
}
