import React, { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import AppLayout from '@/layout/AppLayout';
import { useAuthStore } from '@/store/authStore';
import LoginView from '@/views/LoginView';
import RegisterView from '@/views/RegisterView';
import NotFoundView from '@/views/NotFoundView';
import { RouteErrorFallback } from '@/components/shell/AppErrorFallback';
import { canAccessWorkspacePath } from '@/utils/workspaceAccess';

const ChatView = lazy(() => import('@/views/ChatView'));
const ContactsView = lazy(() => import('@/views/ContactsView'));
const AgentsView = lazy(() => import('@/views/AgentsView'));
const SkillsView = lazy(() => import('@/views/SkillsView'));
const KnowledgeView = lazy(() => import('@/views/KnowledgeView'));
const TaskBoardView = lazy(() => import('@/views/TaskBoardView'));
const ReportsView = lazy(() => import('@/views/ReportsView'));
const SettingsView = lazy(() => import('@/views/SettingsView'));

const withSuspense = (el: React.ReactNode) => (
  <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin /></div>}>
    {el}
  </Suspense>
);

/** 检查是否已登录，未登录则重定向到登录页 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** 已登录用户访问登录/注册页时重定向到首页 */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AdminWorkspaceRoute({ path, children }: { path: string; children: React.ReactNode }) {
  const isAdmin = useAuthStore((state) => state.user?.is_admin ?? false);
  if (!canAccessWorkspacePath(path, isAdmin)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const routes: RouteObject[] = [
  {
    path: '/login',
    element: <PublicOnlyRoute><LoginView /></PublicOnlyRoute>,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/register',
    element: <PublicOnlyRoute><RegisterView /></PublicOnlyRoute>,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: withSuspense(<ChatView />) },
      { path: 'contacts', element: withSuspense(<ContactsView />) },
      { path: 'agents', element: withSuspense(<AgentsView />) },
      { path: 'skills', element: <AdminWorkspaceRoute path="/skills">{withSuspense(<SkillsView />)}</AdminWorkspaceRoute> },
      { path: 'knowledge', element: <AdminWorkspaceRoute path="/knowledge">{withSuspense(<KnowledgeView />)}</AdminWorkspaceRoute> },
      { path: 'tasks', element: <AdminWorkspaceRoute path="/tasks">{withSuspense(<TaskBoardView />)}</AdminWorkspaceRoute> },
      { path: 'reports', element: withSuspense(<ReportsView />) },
      { path: 'settings', element: withSuspense(<SettingsView />) },
    ],
  },
  {
    path: '*',
    element: <NotFoundView />,
    errorElement: <RouteErrorFallback />,
  },
];

export const router = createBrowserRouter(routes);
