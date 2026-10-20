import React, { useState } from 'react';
import MobileTable from '../../components/MobileTable';
import {
  Button,
  Form,
  Input,
  Checkbox,
  message,
  Space,
  Card,
  Empty,
  Spin,
  Popconfirm,
  Tag,
  Divider,
  Row,
  Col,
  Select,
  Tabs,
  Alert,
  Typography,
} from 'antd';
import { Modal } from '@/components/overlays';
import { PlusOutlined, EditOutlined, DeleteOutlined, UserAddOutlined, CopyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';
import { canPerformAction } from '../../lib/permissions';

const { Text } = Typography;

interface CustomRole {
  id: number;
  name: string;
  description: string;
  color: string;
  is_active: boolean;
  created_at: string;
  permissions: { permission_code: string }[];
}

interface AvailablePermission {
  code: string;
  label: string;
}

interface CreateRoleResponse {
  id: number;
  name: string;
  description: string;
  color: string;
  is_active: boolean;
  created_at: string;
  permissions: { permission_code: string }[];
}

const RolesManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [form] = Form.useForm();
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  
  // Assign employee modal
  const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
  const [assigningRole, setAssigningRole] = useState<CustomRole | null>(null);
  const [assignForm] = Form.useForm();
  const [generatedPassword, setGeneratedPassword] = useState<string>('');
  const [assignTabKey, setAssignTabKey] = useState<string>('existing');

  const canManageRoles = canPerformAction('can_manage_members');

  // Fetch custom roles
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['customRoles'],
    queryFn: async () => {
      const response = await http.get('/api/v1/core/custom-roles/');
      return response.data as CustomRole[];
    },
    enabled: canManageRoles,
  });

  // Fetch available permissions
  const { data: availablePerms } = useQuery({
    queryKey: ['availablePermissions'],
    queryFn: async () => {
      const response = await http.get('/api/v1/core/custom-roles/available_permissions/');
      return response.data as AvailablePermission[];
    },
  });
  
  // Fetch workspace members for assignment
  const { data: workspaceMembers } = useQuery({
    queryKey: ['workspaceMembers'],
    queryFn: async () => {
      const response = await http.get('/api/v1/core/users/');
      return response.data as any[];
    },
    enabled: isAssignModalVisible,
  });

  // Create role mutation
  const createRoleMutation = useMutation({
    mutationFn: (data: { name: string; description: string; color: string }) =>
      http.post('/api/v1/core/custom-roles/', data),
    onSuccess: (response: any) => {
      const roleId = (response.data as CreateRoleResponse).id;
      // Set permissions for newly created role
      if (selectedPermissions.length > 0) {
        setPermissionsMutation.mutate({
          roleId,
          permissions: selectedPermissions,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['customRoles'] });
        message.success('Role created successfully');
        setIsModalVisible(false);
        form.resetFields();
      }
    },
    onError: (error: any) => {
      message.error(error.response?.data?.name?.[0] || 'Failed to create role');
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: (data: { id: number; name: string; description: string; color: string }) =>
      http.patch(`/api/v1/core/custom-roles/${data.id}/`, {
        name: data.name,
        description: data.description,
        color: data.color,
      }),
    onSuccess: (response: any) => {
      const roleId = (response.data as CreateRoleResponse).id;
      // Update permissions
      setPermissionsMutation.mutate({
        roleId,
        permissions: selectedPermissions,
      });
    },
    onError: (error: any) => {
      message.error(error.response?.data?.name?.[0] || 'Failed to update role');
    },
  });

  // Set permissions mutation
  const setPermissionsMutation = useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: number; permissions: string[] }) =>
      http.post(`/api/v1/core/custom-roles/${roleId}/set_permissions/`, {
        permission_codes: permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customRoles'] });
      message.success(editingRole ? 'Role updated successfully' : 'Role created successfully');
      setIsModalVisible(false);
      form.resetFields();
      setEditingRole(null);
      setSelectedPermissions([]);
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || 'Failed to set permissions');
    },
  });

  // Delete role mutation
  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: number) => http.delete(`/api/v1/core/custom-roles/${roleId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customRoles'] });
      message.success('Role deleted successfully');
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || 'Failed to delete role');
    },
  });

  // Assign role to existing user
  const assignToUserMutation = useMutation({
    mutationFn: ({ roleId, userId }: { roleId: number; userId: number }) =>
      http.post(`/api/v1/core/custom-roles/${roleId}/assign_to_user/`, { user_id: userId }),
    onSuccess: () => {
      message.success('Role assigned successfully');
      setIsAssignModalVisible(false);
      assignForm.resetFields();
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || 'Failed to assign role');
    },
  });

  // Create user with role
  const createUserWithRoleMutation = useMutation({
    mutationFn: ({ roleId, userData }: { roleId: number; userData: any }) =>
      http.post(`/api/v1/core/custom-roles/${roleId}/create_user_with_role/`, userData),
    onSuccess: (response: any) => {
      const password = response.data.password;
      setGeneratedPassword(password);
      message.success(`User created successfully! Password: ${password}`);
      queryClient.invalidateQueries({ queryKey: ['workspaceMembers'] });
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || 'Failed to create user');
    },
  });

  const handleOpenModal = (role?: CustomRole) => {
    if (role) {
      setEditingRole(role);
      form.setFieldsValue({
        name: role.name,
        description: role.description,
        color: role.color,
      });
      setSelectedPermissions(role.permissions.map((p) => p.permission_code));
    } else {
      setEditingRole(null);
      form.resetFields();
      setSelectedPermissions([]);
    }
    setIsModalVisible(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      if (editingRole) {
        updateRoleMutation.mutate({
          id: editingRole.id,
          ...values,
        });
      } else {
        createRoleMutation.mutate(values);
      }
    } catch (error) {
      // Form validation failed
    }
  };
  
  const handleOpenAssignModal = (role: CustomRole) => {
    setAssigningRole(role);
    setIsAssignModalVisible(true);
    setGeneratedPassword('');
    setAssignTabKey('existing');
    assignForm.resetFields();
  };
  
  const handleAssignModalOk = async () => {
    try {
      const values = await assignForm.validateFields();
      
      if (assignTabKey === 'existing') {
        // Assign to existing user
        assignToUserMutation.mutate({
          roleId: assigningRole!.id,
          userId: values.user_id,
        });
      } else {
        // Create new user with role
        createUserWithRoleMutation.mutate({
          roleId: assigningRole!.id,
          userData: {
            username: values.username,
            email: values.email || values.username,
            first_name: values.first_name,
            last_name: values.last_name,
          },
        });
      }
    } catch (error) {
      // Form validation failed
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('Copied to clipboard');
  };

  if (!canManageRoles) {
    return (
      <Card style={{ marginTop: '20px' }}>
        <Empty
          description="Access Denied"
          style={{ marginTop: '40px' }}
        >
          <p>You don't have permission to manage roles.</p>
        </Empty>
      </Card>
    );
  }

  const columns = [
    {
      title: 'Role Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: CustomRole) => (
        <Space>
          <Tag color={record.color}>{text}</Tag>
          {!record.is_active && <Tag color="red">Inactive</Tag>}
        </Space>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (text: string) => text || '-',
    },
    {
      title: 'Permissions',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: { permission_code: string }[]) => (
        <span>{permissions.length} permission(s)</span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: CustomRole) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<UserAddOutlined />}
            onClick={() => handleOpenAssignModal(record)}
            title="Assign to Employee"
          />
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
          />
          <Popconfirm
            title="Delete Role"
            description={`Are you sure you want to delete the role "${record.name}"?`}
            onConfirm={() => deleteRoleMutation.mutate(record.id)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              danger
              loading={deleteRoleMutation.isPending}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card title="Custom Roles Management" style={{ marginTop: '20px' }}>
      <Row justify="space-between" style={{ marginBottom: '20px' }}>
        <Col>
          <p>Create and manage custom roles with specific permissions for your workspace.</p>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenModal()}
          >
            Create Role
          </Button>
        </Col>
      </Row>

      <Spin spinning={rolesLoading}>
        {rolesData && rolesData.length > 0 ? (
          <MobileTable
            columns={columns}
            dataSource={rolesData}
            rowKey="id"
            pagination={{ pageSize: 10 }}
          />
        ) : (
          <Empty
            description="No custom roles yet"
            style={{ marginTop: '40px' }}
          >
            <Button
              type="primary"
              onClick={() => handleOpenModal()}
            >
              Create Your First Role
            </Button>
          </Empty>
        )}
      </Spin>

      {/* Role Modal */}
      <Modal
        title={editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Role'}
        open={isModalVisible}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalVisible(false);
          setEditingRole(null);
          form.resetFields();
        }}
        width={700}
        okButtonProps={{
          loading: createRoleMutation.isPending || updateRoleMutation.isPending || setPermissionsMutation.isPending,
        }}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="Role Name"
            name="name"
            rules={[
              { required: true, message: 'Please enter a role name' },
              { min: 2, message: 'Role name must be at least 2 characters' },
            ]}
          >
            <Input placeholder="e.g., Admin Payroll Only, Project Manager" />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
          >
            <Input.TextArea
              rows={3}
              placeholder="Describe what this role is for"
            />
          </Form.Item>

          <Form.Item
            label="Color"
            name="color"
          >
            <Input
              type="color"
              style={{ height: '40px', cursor: 'pointer' }}
            />
          </Form.Item>

          <Divider />

          <Form.Item label="Permissions">
            <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}>
              {availablePerms && availablePerms.length > 0 ? (
                <div>
                  {/* Group permissions by category */}
                  {availablePerms.map((perm: AvailablePermission) => (
                    <div key={perm.code} style={{ marginBottom: '8px' }}>
                      <Checkbox
                        checked={selectedPermissions.includes(perm.code)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPermissions([...selectedPermissions, perm.code]);
                          } else {
                            setSelectedPermissions(selectedPermissions.filter((p) => p !== perm.code));
                          }
                        }}
                      >
                        <span style={{ fontSize: '12px' }}>{perm.label}</span>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="No permissions available" />
              )}
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              {selectedPermissions.length} permission(s) selected
            </div>
          </Form.Item>
        </Form>
      </Modal>
      
      {/* Assign Employee Modal */}
      <Modal
        title={`Assign Role: ${assigningRole?.name || ''}`}
        open={isAssignModalVisible}
        onOk={handleAssignModalOk}
        onCancel={() => {
          setIsAssignModalVisible(false);
          setAssigningRole(null);
          assignForm.resetFields();
          setGeneratedPassword('');
        }}
        width={600}
        okButtonProps={{
          loading: assignToUserMutation.isPending || createUserWithRoleMutation.isPending,
        }}
      >
        <Tabs
          activeKey={assignTabKey}
          onChange={setAssignTabKey}
          items={[
            {
              key: 'existing',
              label: 'Existing Employee',
              children: (
                <Form form={assignForm} layout="vertical" autoComplete="off">
                  <Form.Item
                    label="Select Employee"
                    name="user_id"
                    rules={[{ required: assignTabKey === 'existing', message: 'Please select an employee' }]}
                  >
                    <Select
                      placeholder="Choose an employee"
                      showSearch
                      filterOption={(input, option: any) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      options={workspaceMembers?.map(member => ({
                        value: member.id,
                        label: `${member.first_name} ${member.last_name} (${member.username})`,
                      }))}
                    />
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'new',
              label: 'New Employee',
              children: (
                <Form form={assignForm} layout="vertical" autoComplete="off">
                  <Form.Item
                    label="Email / Username"
                    name="username"
                    rules={[
                      { required: assignTabKey === 'new', message: 'Please enter email/username' },
                      { type: 'email', message: 'Please enter a valid email' },
                    ]}
                  >
                    <Input placeholder="john@example.com" />
                  </Form.Item>
                  
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="First Name" name="first_name">
                        <Input placeholder="John" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Last Name" name="last_name">
                        <Input placeholder="Doe" />
                      </Form.Item>
                    </Col>
                  </Row>
                  
                  <Alert
                    message="Password will be auto-generated"
                    description="A secure password will be automatically created for this user."
                    type="info"
                    showIcon
                    style={{ marginBottom: '16px' }}
                  />
                  
                  {generatedPassword && (
                    <Alert
                      message="User Created Successfully!"
                      description={
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text>Generated Password:</Text>
                          <Space>
                            <Text strong code copyable>{generatedPassword}</Text>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(generatedPassword)}
                            >
                              Copy
                            </Button>
                          </Space>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            Make sure to save this password - it won't be shown again!
                          </Text>
                        </Space>
                      }
                      type="success"
                      showIcon
                    />
                  )}
                </Form>
              ),
            },
          ]}
        />
      </Modal>
    </Card>
  );
};

export default RolesManagement;
