"""
Core URL Configuration for assignment, workspace and RBAC related APIs.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SiteViewSet, ProjectViewSet, ClientViewSet, AssignmentViewSet,
    WorkspaceViewSet, WorkspaceMembershipViewSet, UserViewSet,
    WorkspaceAccessRequestViewSet
)
from .custom_role_views import CustomRoleViewSet
from .messaging_views import ConversationViewSet
from .profile_views import UserProfileView
from .holiday_views import PublicHolidayViewSet

app_name = 'core'

router = DefaultRouter()
router.register(r'workspaces', WorkspaceViewSet, basename='workspace')
router.register(r'workspace-memberships', WorkspaceMembershipViewSet, basename='workspace-membership')
router.register(r'sites', SiteViewSet, basename='site')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'clients', ClientViewSet, basename='client')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'custom-roles', CustomRoleViewSet, basename='custom-role')
router.register(r'conversations', ConversationViewSet, basename='conversation')
router.register(r'users', UserViewSet, basename='user')
router.register(r'access-requests', WorkspaceAccessRequestViewSet, basename='access-request')
router.register(r'public-holidays', PublicHolidayViewSet, basename='public-holiday')

urlpatterns = [
    path('', include(router.urls)),
]
