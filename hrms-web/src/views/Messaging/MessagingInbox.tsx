import React, { useEffect, useMemo, useState } from 'react';
import { Card, Input, Avatar, Typography, Space, Button, Badge, Divider, Layout, Spin, Select, message } from 'antd';
import { Modal } from '@/components/overlays';
import { SendOutlined, ArrowLeftOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import http from '../../lib/http';

const { Title, Text } = Typography;

interface Conversation {
  id: number;
  name?: string;
  is_group: boolean;
  unread_count?: number;
  last_message?: { body: string; created_at: string; sender?: { first_name?: string; last_name?: string; username: string } } | null;
  participants: Array<{ id: number; username: string; first_name?: string; last_name?: string }>;
}

interface MessageItem {
  id: number;
  body: string;
  created_at: string;
  sender?: { username: string; first_name?: string; last_name?: string };
}

export default function MessagingInbox() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [targetUsers, setTargetUsers] = useState<number[]>([]);
  const [groupName, setGroupName] = useState('');
  const [lastMessageCount, setLastMessageCount] = useState<number>(0);

  const workspaceId = localStorage.getItem('workspaceId');

  const { data: conversations, isLoading: convLoading } = useQuery<Conversation[]>({
    queryKey: ['conversations', workspaceId],
    queryFn: async () => {
      const params = workspaceId ? { workspace: workspaceId } : {};
      const res = await http.get('/api/v1/core/conversations/', { params });
      return Array.isArray(res.data) ? res.data : res.data?.results || [];
    },
    refetchInterval: 5000, // Poll for new messages every 5 seconds
  });

  // Show notification when new messages arrive
  useEffect(() => {
    if (conversations) {
      const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
      if (lastMessageCount > 0 && totalUnread > lastMessageCount) {
        message.info({
          content: '📬 You have new message(s)!',
          duration: 3,
          style: {
            marginTop: '20vh',
          },
        });
        // Play notification sound
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuAze/bjTcIF2i877iYSAwPTqHj77hjHQU7k9r0yXcsBSN0xe/bjkAJE1y06uqnVRQKRp7f87xiIAUrgc3u2o44CBZotO+5mUgMDk2h5O+5Yx0FOZHU8sh4LAUjdcXv24tAChNctOrqp1UUCkef3/S8Yh8GK4LM79qPOQgWZ7Pvupp');
          audio.volume = 0.3;
          audio.play().catch(() => { }); // Ignore errors if autoplay is blocked
        } catch (e) {
          // Ignore sound errors
        }
      }
      setLastMessageCount(totalUnread);
    }
  }, [conversations, lastMessageCount]);

  useEffect(() => {
    if (!activeId && conversations && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  const { data: messages, isLoading: msgLoading } = useQuery<MessageItem[]>({
    queryKey: ['conversation-messages', activeId],
    queryFn: async () => {
      if (!activeId) return [];
      const res = await http.get(`/api/v1/core/conversations/${activeId}/messages/`);
      return Array.isArray(res.data) ? res.data : res.data?.results || [];
    },
    enabled: !!activeId,
    refetchInterval: 3000, // Poll for new messages every 3 seconds
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!activeId) throw new Error('No conversation');
      return http.post(`/api/v1/core/conversations/${activeId}/messages/`, { body });
    },
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', activeId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['users-min', localStorage.getItem('workspaceId')],
    queryFn: async () => {
      try {
        // The workspace ID is automatically sent by http interceptor
        const res = await http.get('/api/v1/core/users/', {
          params: { page_size: 200 }
        });
        console.log('Fetched users for messaging:', res.data?.results || res.data || []);
        return res.data?.results || res.data || [];
      } catch (error) {
        console.error('Error fetching users:', error);
        throw error;
      }
    },
  });

  // Log users for debugging
  React.useEffect(() => {
    console.log('Users available:', users);
    console.log('Users loading:', usersLoading);
    console.log('Users error:', usersError);
  }, [users, usersLoading, usersError]);

  const createConversation = useMutation({
    mutationFn: async () => {
      if (targetUsers.length === 0) throw new Error('Select at least one user');
      // Send user IDs (not usernames) - backend will query by ID
      const payload: any = {
        participants_ids: targetUsers,
        is_group: isGroup,
        workspace: null  // Explicitly null for cross-workspace
      };
      if (isGroup) payload.name = groupName || 'New Group';
      console.log('Creating conversation with payload:', payload);
      const res = await http.post('/api/v1/core/conversations/', payload);
      return res.data;
    },
    onSuccess: (conv: any) => {
      message.success('Conversation created');
      setNewOpen(false);
      setTargetUsers([]);
      setGroupName('');
      setIsGroup(false);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setActiveId(conv.id);
    },
    onError: (err) => {
      console.error('Failed to create conversation:', err);
      message.error('Failed to create conversation');
    },
  });

  const activeThread = useMemo(() => conversations?.find((c) => c.id === activeId), [conversations, activeId]);

  const sendMessage = () => {
    if (!draft.trim() || !activeId) return;
    sendMutation.mutate(draft.trim());
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#0f1117' }}>
      <Layout.Content style={{ padding: 24 }}>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => nav(-1)}
              style={{ color: '#D4AF37' }}
            >
              Back
            </Button>
            <Title level={3} style={{ color: '#D4AF37', marginTop: 8 }}>
              Messaging
            </Title>
          </div>
          <Space>
            <Button icon={<UserAddOutlined />} onClick={() => { setIsGroup(false); setNewOpen(true); }}>New Message</Button>
            <Button icon={<TeamOutlined />} onClick={() => { setIsGroup(true); setNewOpen(true); }}>New Group</Button>
          </Space>
        </div>

        <Space align="start" size={16} style={{ width: '100%' }}>
          <Card style={{ width: 300, background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(212,175,55,0.4)' }} styles={{ body: { padding: 12 } }}>
            <Input.Search placeholder="Search conversations" style={{ marginBottom: 12 }} />
            {convLoading ? (
              <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {(conversations || []).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    style={{ cursor: 'pointer', background: item.id === activeId ? 'rgba(212,175,55,0.08)' : 'transparent', borderRadius: 8, padding: 8 }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <Avatar>{(item.name || item.participants[0]?.username || 'C').charAt(0).toUpperCase()}</Avatar>
                      <div style={{ flex: 1 }}>
                        <Space>
                          <Text strong>{item.name || item.participants.map((p) => p.first_name || p.username).join(', ')}</Text>
                          {item.unread_count && item.unread_count > 0 ? <Badge count={item.unread_count} size="small" /> : null}
                        </Space>
                        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 4 }}>
                          {item.last_message ? item.last_message.body : 'No messages yet'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card style={{ flex: 1, minHeight: 420, background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(212,175,55,0.4)' }} styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column' } }}>
            {msgLoading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
            ) : activeThread ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Space>
                    <Avatar>{(activeThread.name || activeThread.participants[0]?.username || 'C').charAt(0).toUpperCase()}</Avatar>
                    <div>
                      <Text strong>{activeThread.name || activeThread.participants.map((p) => p.first_name || p.username).join(', ')}</Text>
                      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Conversation</Text>
                    </div>
                  </Space>
                </div>
                <Divider style={{ margin: '8px 0 12px' }} />

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
                  {(messages || []).slice().reverse().map((m) => (
                    <div key={m.id} style={{ marginBottom: 12 }}>
                      <Text strong style={{ display: 'block' }}>{m.sender?.first_name || m.sender?.username || 'User'}</Text>
                      <Text style={{ display: 'block' }}>{m.body}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </div>
                  ))}
                </div>

                <Divider style={{ margin: '12px 0' }} />

                <Space direction="horizontal" style={{ width: '100%' }}>
                  <Input.TextArea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder="Type a message"
                    style={{ flex: 1 }}
                  />
                  <Button type="primary" icon={<SendOutlined />} onClick={sendMessage} loading={sendMutation.isPending}>
                    Send
                  </Button>
                </Space>
              </>
            ) : (
              <Text type="secondary">Select a conversation or start a new one.</Text>
            )}
          </Card>
        </Space>
      </Layout.Content>
      <Modal
        title={isGroup ? 'Start New Group' : 'Start New Message'}
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={() => createConversation.mutate()}
        confirmLoading={createConversation.isPending}
      >
        {isGroup ? (
          <Input
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          placeholder={isGroup ? 'Select participants' : 'Select user'}
          optionFilterProp="label"
          value={targetUsers}
          onChange={setTargetUsers as any}
          options={(users || []).map((u: any) => ({ value: u.id, label: u.first_name ? `${u.first_name} ${u.last_name}` : u.username }))}
        />
      </Modal>
    </Layout>
  );
}
