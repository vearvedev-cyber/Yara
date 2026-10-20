/**
 * Drop-in replacements for antd's Modal and Drawer that close when the phone/browser
 * back button is pressed (see useBackButtonClose). Import Modal and Drawer from here
 * instead of 'antd'; static helpers like Modal.confirm are unchanged.
 */
/* eslint-disable react-refresh/only-export-components --
   Modal and Drawer are components with antd's static helpers attached via Object.assign,
   which the rule can't recognise as components. */
import type { MouseEvent } from 'react';
import { Drawer as AntDrawer, Modal as AntModal } from 'antd';
import type { DrawerProps, ModalProps } from 'antd';
import { useBackButtonClose } from '@/lib/useBackButtonClose';

function BackAwareModal(props: ModalProps) {
  const { open, onCancel, closable } = props;
  useBackButtonClose(
    !!open && closable !== false,
    onCancel ? () => onCancel(undefined as unknown as MouseEvent<HTMLButtonElement>) : undefined,
  );
  return <AntModal {...props} />;
}

function BackAwareDrawer(props: DrawerProps) {
  const { open, onClose } = props;
  useBackButtonClose(
    !!open,
    onClose ? () => onClose(undefined as unknown as MouseEvent<HTMLElement>) : undefined,
  );
  return <AntDrawer {...props} />;
}

export const Modal = Object.assign(BackAwareModal, AntModal) as typeof AntModal;
export const Drawer = Object.assign(BackAwareDrawer, AntDrawer) as typeof AntDrawer;
